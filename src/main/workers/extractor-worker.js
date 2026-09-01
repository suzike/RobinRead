'use strict';
/**
 * extractor-worker.js — utilityProcess 常驻工作进程（正文提取）
 *
 * 职责：在独立进程里完成「fetch → 编码探测 → jsdom+Readability 双引擎提取 → 白名单消毒」，
 * 使 jsdom 的 CPU 峰值（数百 ms~秒级同步解析）不再占用主进程事件循环——
 * 后台预抓（并发 3）+ 用户打开文章叠加时，ipcMain.handle 不再排队冻结 UI。
 *
 * 运行环境约束（Electron utilityProcess）：
 *   - 只能 require Node 内置模块 + 纯 Node 依赖链（ArticleExtractCore → Models → I18N）。
 *   - 不能 require('electron')（app/BrowserWindow/utilityProcess 在子进程不可用）。
 *   - 与主进程通过 process.parentPort 收发消息（结构化克隆，支持大字符串）。
 *
 * 协议（主进程每次只派发一个任务，worker 内串行执行，保证单任务延迟可控）：
 *   收 { type: 'extract', id: number, url: string }
 *   回 { type: 'result', id, ok: true,  result }   // 与主进程回退路径完全相同的返回结构
 *   回 { type: 'result', id, ok: false, error }    // 任务级错误（主进程会回退重试原逻辑）
 *   回 { type: 'fatal',  error }                   // worker 不可恢复错误（主进程会杀掉并重启）
 */

// 误在普通 node / 渲染进程里运行时的防御（parentPort 仅存在于 utilityProcess 上下文）
if (!process.parentPort) {
  console.error('[extractor-worker] must be started via utilityProcess.fork (process.parentPort missing)');
  process.exit(1);
}

const { extractInProcess } = require('../ArticleExtractCore');

let handlingID = null;

process.parentPort.on('message', (event) => {
  const message = event && event.data;
  if (!message || message.type !== 'extract' || typeof message.id !== 'number') return;
  if (handlingID !== null) {
    // 主进程侧本就一次只派发一个任务；收到越界消息说明协议错乱，拒绝而不是排队
    postSafe({ type: 'result', id: message.id, ok: false, error: 'worker-busy' });
    return;
  }
  handlingID = message.id;
  // 主进程预抓的字节流（net.fetch 走系统代理）优先；缺省时 worker 内自行抓取（全局 fetch）。
  // structured clone 传来的 buffer 是 Uint8Array，还原为 Buffer 供编码探测/4MB 截断使用。
  const preloaded = message.buffer
    ? { buffer: Buffer.from(message.buffer), contentType: message.contentType || null, finalURL: message.finalURL || null }
    : null;
  // 独立微任务里跑，消息循环保持响应（jsdom 解析本身仍是同步的——这正是它被隔离进本进程的原因）
  Promise.resolve()
    .then(() => extractInProcess(message.url, preloaded))
    .then(
      (result) => {
        handlingID = null;
        postSafe({ type: 'result', id: message.id, ok: true, result });
      },
      (error) => {
        handlingID = null;
        postSafe({ type: 'result', id: message.id, ok: false, error: String((error && error.message) || error) });
      },
    );
});

// 不可恢复异常：把 in-flight 任务报告给主进程后自杀——主进程检测到 exit 会对该任务
// 回退到主进程内执行原逻辑，并懒重启一个新的 worker 处理后续队列。
process.on('uncaughtException', (error) => {
  postSafe({ type: 'fatal', error: String((error && error.message) || error), id: handlingID });
  handlingID = null;
  try { process.exit(1); } catch (_) { /* 尽力而为 */ }
});

function postSafe(message) {
  try { process.parentPort.postMessage(message); } catch (_) { /* 进程正在退出，主进程超时兜底 */ }
}
