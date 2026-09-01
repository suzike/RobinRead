'use strict';
/**
 * RobinRead（知更）— 网页正文提取与 HTML 消毒（主进程门面 + utilityProcess 工作进程池）
 *
 * 职责拆分（性能重构）：
 * - 纯逻辑（噪音剥离/容器启发式/Readability/白名单消毒/段落 ID/编码探测）在
 *   ./ArticleExtractCore —— 主进程与工作进程共享的纯 Node 模块。
 * - sanitizedHTML / readerParagraphs 等导出仍是主进程内同步函数（RSS 正文、翻译轨道
 *   路径不经过 worker，行为与重构前完全一致）。
 * - extract() 把「30s fetch → 4MB 截断 → 多编码探测 → jsdom+Readability 双引擎 → 消毒」
 *   投给常驻 utilityProcess 工作进程（./workers/extractor-worker.js）执行：
 *   后台预抓（并发 3）+ 用户打开文章叠加时，jsdom 的 CPU 峰值不再占住主进程事件循环，
 *   ipcMain.handle 不再排队（消除 UI 间歇性僵住）。
 *
 * 工作进程生命周期与回退：
 * - 懒启动：首个任务时才 fork；一次只派发一个任务（worker 内串行，单任务延迟可控）。
 * - 优先级队列：priority='user'（默认）恒在 'prefetch' 之前；队列上限 QUEUE_CAP，
 *   满了丢 prefetch（立即失败）不丢 user。
 * - 总超时：主进程侧每个任务 ≤45s（WORKER_TASK_TIMEOUT_MS），超时判定该次 worker 尝试
 *   失败 → 杀掉卡死的 worker（jsdom 同步解析卡死时 worker 无法再收消息，只能杀）并回退。
 * - 回退：worker 启动失败 / spawn 超时 / 任务出错 / 异常退出 / 超时 → 主进程内直接执行
 *   原逻辑（Core.extractInProcess，即重构前的 extract 实现）——保证打包环境（asar）或
 *   utilityProcess 不可用时功能不劣化。
 * - 自动重启：worker 异常退出后进入短暂冷却（防 crash 循环高频 fork），冷却结束后的
 *   下一个任务懒重启新 worker；冷却期 prefetch 在队列等待，user 立即回退执行。
 */
const path = require('node:path');
const Core = require('./ArticleExtractCore');

// utilityProcess 仅在 Electron 主进程可用；普通 node 环境下 require('electron')
// 返回的是可执行文件路径字符串，此处安全降级为 null → 全部任务走主进程回退。
let utilityProcess = null;
try {
  const electron = require('electron');
  if (electron && typeof electron === 'object' && electron.utilityProcess && typeof electron.utilityProcess.fork === 'function') {
    utilityProcess = electron.utilityProcess;
  }
} catch (_) { /* ignore */ }

// MARK: - 工作进程池

// packaged（asar）：electron-builder files 已含 src/**/*，fork 路径直接指向 asar 内文件。
// Electron 的 utilityProcess.fork 支持加载 asar 内的 JS；若个别环境不支持（fork 抛错或
// 子进程秒退），下方回退路径会自动接管，功能不劣化——无需为此改打包配置。
const WORKER_PATH = path.join(__dirname, 'workers', 'extractor-worker.js');
const WORKER_TASK_TIMEOUT_MS = 45_000;   // 单任务总超时（≤45s，超时算 worker 尝试失败并回退）
const WORKER_SPAWN_TIMEOUT_MS = 15_000;  // fork 后迟迟不 spawn（如 asar 加载挂起）→ 回退
const WORKER_RESTART_COOLDOWN_MS = 1_000; // 异常退出后的重启冷却（防 crash 循环）
// 队列上限：满了丢 prefetch 不丢 user。诊断脚本可用 ROBIN_EXTRACT_QUEUE_CAP 覆盖。
const QUEUE_CAP = (() => {
  const parsed = Number.parseInt(process.env.ROBIN_EXTRACT_QUEUE_CAP || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
})();

const pool = {
  worker: null,            // 当前 utilityProcess 子进程
  spawnTimer: null,        // spawn 看门狗
  restartCooldownUntil: 0, // 异常退出后的冷却截止时刻
  cooldownTimer: null,
  queue: [],               // { id, url, priority, resolve, reject, timer, settled }
  current: null,           // 已派发给 worker 的任务（串行：同一时刻最多一个）
  nextID: 1,
  stats: { worker: 0, fallback: 0, timeout: 0, queueFullDropped: 0, restarts: 0 },
};

/**
 * 网页正文提取。对外行为与重构前一致（Promise → { entryID, text, html, imageURLs, fetchedAt, sourceURL, isSanitized }）。
 * @param {string} url
 * @param {{priority?: 'user'|'prefetch'}} [options] priority='prefetch' 的任务排在 'user' 之后；
 *   队列满（≥QUEUE_CAP）时 prefetch 立即失败（'extract-queue-full'），user 不受影响。
 */
function extract(url, options = {}) {
  const priority = options && options.priority === 'prefetch' ? 'prefetch' : 'user';
  if (!utilityProcess) return Core.extractInProcess(url); // utilityProcess 不可用：主进程原逻辑
  if (priority === 'prefetch' && pool.queue.length >= QUEUE_CAP) {
    pool.stats.queueFullDropped += 1;
    return Promise.reject(new Error('extract-queue-full'));
  }
  return new Promise((resolve, reject) => {
    pool.queue.push({ id: pool.nextID++, url, priority, resolve, reject, timer: null, settled: false });
    pump();
  });
}

/** 派发队列：user 恒先于 prefetch（同类 FIFO）；冷却期只回退 user，prefetch 等重启后的 worker。 */
function pump() {
  while (!pool.current && pool.queue.length > 0) {
    const cooling = Date.now() < pool.restartCooldownUntil;
    let index = pool.queue.findIndex((task) => task.priority === 'user');
    if (index < 0) {
      if (cooling) { scheduleCooldownPump(); return; }
      index = 0;
    }
    const task = pool.queue.splice(index, 1)[0];
    const worker = cooling ? null : ensureWorker();
    if (!worker) {
      runFallback(task, cooling ? 'restart-cooldown' : 'worker-unavailable');
      return;
    }
    dispatch(worker, task);
  }
}

function dispatch(worker, task) {
  pool.current = task;
  task.sent = false;
  task.timer = setTimeout(() => onTaskTimeout(task), WORKER_TASK_TIMEOUT_MS);
  // spawn 前不投递消息：冷启动的首个 fork 在个别环境下会丢失/迟滞 spawn 前的消息，
  // 等 'spawn' 事件后再发（ensureWorker 里注册的回调负责 flush）。
  if (worker.__njSpawned) sendTask(worker, task);
}

function sendTask(worker, task) {
  const post = (payload) => {
    // 派发前复核：主进程预抓（网络等待）期间任务可能已超时回退/被接管，此景下投递会被错路由
    if (pool.current !== task || task.settled) return;
    try {
      worker.postMessage(payload);
      task.sent = true;
    } catch (error) {
      clearTaskTimer(task);
      pool.current = null;
      runFallback(task, 'postMessage-failed: ' + String((error && error.message) || error));
    }
  };
  // 主进程侧预抓：net.fetch 走系统代理（worker 内无 electron，自抓只能是直连）。
  // 未注入 net.fetch（探针/异常环境）或预抓失败时，原样派发、worker 内自行抓取，行为不劣化。
  if (!Core.hasNetFetch()) {
    post({ type: 'extract', id: task.id, url: task.url });
    return;
  }
  Core.fetchViaNetFetch(task.url).then(
    (pre) => post({ type: 'extract', id: task.id, url: task.url, buffer: pre.buffer, contentType: pre.contentType, finalURL: pre.finalURL }),
    () => post({ type: 'extract', id: task.id, url: task.url }),
  );
}

/** 懒启动 / 复用 worker。返回 null 表示本轮不可用（调用方走回退）。 */
function ensureWorker() {
  if (pool.worker) return pool.worker;
  if (!utilityProcess) return null;
  if (Date.now() < pool.restartCooldownUntil) return null;
  let child;
  try {
    child = utilityProcess.fork(WORKER_PATH);
  } catch (_) {
    // fork 不可用（如个别 asar 环境）：冷却后重试，期间全部回退主进程
    pool.restartCooldownUntil = Date.now() + WORKER_RESTART_COOLDOWN_MS;
    return null;
  }
  pool.stats.restarts += 1;
  pool.worker = child;
  let spawned = false;
  child.__njSpawned = false;
  pool.spawnTimer = setTimeout(() => {
    if (pool.worker === child && !spawned) {
      killWorker('spawn-timeout');
      failWorkerAttempt('spawn-timeout');
      pump();
    }
  }, WORKER_SPAWN_TIMEOUT_MS);
  child.on('spawn', () => {
    spawned = true;
    child.__njSpawned = true;
    if (pool.spawnTimer) { clearTimeout(pool.spawnTimer); pool.spawnTimer = null; }
    if (pool.worker === child && pool.current && !pool.current.sent) sendTask(child, pool.current);
  });
  child.on('message', onWorkerMessage);
  child.on('exit', () => onWorkerExit(child));
  return child;
}

function onWorkerMessage(message) {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'fatal') {
    // worker 不可恢复异常：杀掉重启，in-flight 任务回退（worker 已报告任务 ID 但进程将死）
    killWorker('worker-fatal');
    failWorkerAttempt('worker-fatal');
    pump();
    return;
  }
  if (message.type !== 'result' || !pool.current || message.id !== pool.current.id) return;
  const task = pool.current;
  clearTaskTimer(task);
  pool.current = null;
  if (message.ok) {
    task.settled = true;
    pool.stats.worker += 1;
    task.resolve(message.result);
  } else {
    runFallback(task, 'worker-error: ' + String(message.error || ''));
  }
  pump();
}

function onWorkerExit(child) {
  if (pool.worker !== child) return; // 主动 kill 的旧进程：超时/异常路径已接管
  pool.worker = null;
  if (pool.spawnTimer) { clearTimeout(pool.spawnTimer); pool.spawnTimer = null; }
  pool.restartCooldownUntil = Date.now() + WORKER_RESTART_COOLDOWN_MS;
  failWorkerAttempt('worker-exited');
  pump(); // 队列剩余任务在冷却结束后懒重启新 worker（异常退出自动重启=下次任务重试）
}

/** 当前 in-flight 任务的一次 worker 尝试失败 → 回退主进程原逻辑。 */
function failWorkerAttempt(reason) {
  const task = pool.current;
  if (!task) return;
  clearTaskTimer(task);
  pool.current = null;
  runFallback(task, reason);
}

function onTaskTimeout(task) {
  if (pool.current !== task) return;
  pool.stats.timeout += 1;
  // worker 侧 45s 无响应：jsdom 同步解析卡死时 worker 事件循环被占住、无法再收消息，
  // 只能杀掉（下次任务懒重启）；本任务按规格回退主进程执行原逻辑（原逻辑自带 30s fetch 超时）。
  killWorker('task-timeout');
  failWorkerAttempt('task-timeout');
  pump();
}

/** worker 尝试失败的任务回退：主进程内直接执行原逻辑（与重构前 extract 完全相同的实现）。 */
function runFallback(task, reason) {
  if (task.settled) return;
  task.settled = true;
  pool.stats.fallback += 1;
  void reason; // 保留参数便于排查（可用 console.debug 打开）
  Core.extractInProcess(task.url).then(
    (result) => { task.resolve(result); pump(); },
    (error) => { task.reject(error); pump(); },
  );
}

function killWorker(reason) {
  const child = pool.worker;
  pool.worker = null;
  if (pool.spawnTimer) { clearTimeout(pool.spawnTimer); pool.spawnTimer = null; }
  pool.restartCooldownUntil = Date.now() + WORKER_RESTART_COOLDOWN_MS;
  if (!child) return;
  void reason;
  try { child.removeAllListeners('message'); child.removeAllListeners('exit'); child.removeAllListeners('spawn'); } catch (_) { /* ignore */ }
  try { child.kill(); } catch (_) { /* ignore */ }
}

function scheduleCooldownPump() {
  if (pool.cooldownTimer || pool.queue.length === 0) return;
  const wait = Math.max(10, pool.restartCooldownUntil - Date.now() + 10);
  pool.cooldownTimer = setTimeout(() => { pool.cooldownTimer = null; pump(); }, wait);
}

function clearTaskTimer(task) {
  if (task.timer) { clearTimeout(task.timer); task.timer = null; }
}

// MARK: - 同步导出（全部直接委托 Core，主进程内同步执行，不经过 worker）

/** 内部诊断接口（scripts/diag-extract-worker.js 用；非对外 API，结构可能变化）。 */
const _extractorWorker = {
  stats: () => ({ ...pool.stats, queued: pool.queue.length, inFlight: pool.current ? 1 : 0, workerAlive: !!pool.worker }),
  killWorker: () => killWorker('diagnostics'),
};

/**
 * 预热：app 启动后空闲时提前 fork worker，消除首次「阅读原文/正文补全」的
 * 冷启动延迟（spawn 可达秒级，期间首篇提取会退化到主进程回退路径）。
 */
function prewarm() {
  if (!utilityProcess || pool.worker) return;
  try { ensureWorker(); } catch (_) { /* 预热失败静默，懒启动兜底 */ }
}

module.exports = {
  // —— 同步纯逻辑（RSS 正文消毒、翻译轨道等；行为与重构前逐字节一致）——
  setNetFetch: Core.setNetFetch,
  content: Core.content,
  readabilityContent: Core.readabilityContent,
  sanitizedHTML: Core.sanitizedHTML,
  imageURLsFrom: Core.imageURLsFrom,
  readerParagraphs: Core.readerParagraphs,
  insertingInlineTranslations: Core.insertingInlineTranslations,
  translationMarkup: Core.translationMarkup,
  pendingTranslationMarkup: Core.pendingTranslationMarkup,
  removingDuplicateLeadingHeading: Core.removingDuplicateLeadingHeading,
  needsExtraction: Core.needsExtraction,
  plainText: Core.plainText,
  normalizeFeedMarkup: Core.normalizeFeedMarkup,
  isSameReaderParagraph: Core.isSameReaderParagraph,

  // —— 异步全流程（worker 优先，主进程回退）——
  extract,
  prewarm,

  // —— 诊断（附加导出，原有导出不受影响）——
  _extractorWorker,
};
