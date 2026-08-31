'use strict';
/**
 * diag-phase5-desktop.js — 阶段五「桌面存在感与数据安全四件套」端到端探测
 *
 * 与生产一致的 boot：独立临时 userData（os.tmpdir 隔离）+ 真实 registerIPCHandlers
 * （含 robin-icon:// 协议与 Referer 拦截器）+ show:false 窗口加载 src/renderer/index.html。
 * 刷新用 FeedService.fetchFeed 打桩（参照 diag-phase3-lru），完全本地、不联网。
 *
 * 覆盖：
 *   a. storage:stats 返回数值字段齐全（dbSize>0）；storage:cleanup 清过期缓存/孤儿 AI 产物
 *   b. backupExportTo（ipc.js 导出核心，可直调）→ 单文件 JSON 结构 → VACUUM INTO 产物
 *      解码后用 node:sqlite 打开（副本）断言含 feeds/items 等完整表结构
 *   c. 备份导入的启动恢复：backupImportFrom 写 restore-pending 三件套 →
 *      applyPendingRestore（main.js 导出的纯函数）直调 → library.db 被替换
 *      （含探针标记表、且不含「导出后才建」的表）+ pending 三件套清理 + 偏好回滚
 *   d. 设置持久化：RobinRead.closeToTray / newArticleNotify 经 IPC 写读回 + 偏好直读
 *   e. loginItem：dev 下 supported=false 且带「仅打包版可用」提示；写请求不抛错不生效
 *   f. 关闭到托盘：偏好开启时 win.close()（Alt+F4 等价）被拦截为 hide；关闭偏好后放行销毁
 *   g. 新文章通知观察器（notificationBridge 打桩，三个门控场景）：
 *      隐藏窗口 + 净增1 → 触发（标题/数量正确）；前台 → 不打扰；偏好关 → 不弹
 *
 * 无法无头断言（需真机确认）：托盘图标显示/菜单交互、系统通知气泡的实际弹出效果、
 * 开机自启注册表真实写入（打包版）。
 *
 * 幂等：全部数据落在一次性临时目录；退出码 0=全 PASS，1=有 FAIL。
 */

// 探针隔离：必须先于 require('../src/main/main') 置位，
// main.js 据此跳过整套应用生命周期（窗口/托盘/单实例锁），只导出纯函数。
process.env.ROBINREAD_PROBE = '1';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

// electron 主进程 require：先取 ipc.js 模块引用并给通知构造打桩
// （notificationBridge.create 是 ipc.js 留出的可替换缝；生产路径 = new Notification）。
// 观察器门控逻辑（净增阈值 / 偏好开关 / 前后台）由此可无头验证；
// 真实系统气泡的视觉效果仍需真机确认。
const notificationLog = [];

// gotcha（顺序敏感）：ipc.js 顶部会 require AppStore，AppStore 顶部
// `const { fetchFeed } = require('./FeedService')` 在加载期解构取值。
// 因此 fetchFeed 的「可调度包装」必须先于 require ipc.js 安装，
// AppStore 拿到的才是包装；运行期替换 FeedService.fetchFeed 属性无效。
const FeedService = require('../src/main/FeedService');
const realFetchFeed = FeedService.fetchFeed;
let fetchFeedDispatch = null; // g 段刷新时指向受控返回，其余路径回落真实 fetch
FeedService.fetchFeed = async (feed) => (fetchFeedDispatch ? fetchFeedDispatch(feed) : realFetchFeed(feed));

const ipcModule = require('../src/main/ipc');
ipcModule.notificationBridge.create = (options) => {
  notificationLog.push({ title: options?.title, body: options?.body });
  return { on() {}, show() {} };
};

// 与生产 main.js 相同路径：ready 前 require ipc.js 以注册 robin-icon 特权 scheme
require('../src/main/ipc');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-phase5-desktop-'));
app.setPath('userData', userData);

// f3 步骤会真关闭最后一个窗口：压制 Electron「全窗口关闭即退出」的默认行为，
// 探针的退出时机由末尾 app.exit(code) 自行控制。
app.on('window-all-closed', () => { /* 探针自行控制退出 */ });

app.whenReady().then(async () => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(Boolean(ok));
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let code = 1;
  const watchdog = setTimeout(() => {
    console.log('FAIL watchdog — 探测总时长超 120s，强制退出');
    app.exit(1);
  }, 120000);

  // executeJavaScript 的 rejection 会变成空 {}，注入 IIFE 内一律自行 try/catch 返回 e.message
  const run = async (js) => {
    try { return await win.webContents.executeJavaScript(js, true); }
    catch (e) { return { ok: false, error: 'executeJavaScript-rejected: ' + String((e && e.message) || e) }; }
  };
  let win = null;

  try {
    const { DatabaseSync } = require('node:sqlite');
    const { AppStore } = require('../src/main/AppStore');
    const { registerIPCHandlers, backupExportTo, backupImportFrom } = require('../src/main/ipc');
    const { applyPendingRestore } = require('../src/main/main');

    const store = new AppStore(userData);

    // 样本数据：注入一个含 2 篇未读的本地 Feed（不经网络，参照 selftest）
    const feed = store.feedsRepo.insertFeed({
      accountID: 'local-default',
      title: '阶段五探测周刊',
      siteURL: 'https://example.com/p5',
      feedURL: 'https://example.com/p5/feed.xml',
    });
    store._applyParsedEntries(feed, [1, 2].map((n) => ({
      id: `x-p5-base-${n}`,
      title: `基线文章${n}`,
      url: `https://example.com/p5/b${n}`,
      publishedAt: Math.floor(Date.now() / 1000) - n * 60,
      summary: '基线样本。',
      contentHTML: `<p>基线文章${n}内容，足够长以通过渲染与统计路径。</p>`.repeat(4),
    })));
    const items = store.listItems({ kind: 'feed', feedID: feed.id });
    const realItemID = items[0] && items[0].id;

    win = new BrowserWindow({
      show: false, width: 1500, height: 940,
      webPreferences: { preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'), contextIsolation: true },
    });
    registerIPCHandlers(store, win);
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(1200); // boot：首屏渲染 + 让最后一条 state:changed 距下次刷新 emit > 80ms

    // ── 0. boot ──
    const boot = await run(`(() => { try { return { ok: !!window.robin }; } catch (e) { return { ok: false, error: e.message }; } })()`);
    check('boot 应用启动、preload 新 API 桥就绪', boot.ok === true, JSON.stringify(boot));

    // ── a. storage:stats（经真实 IPC preload 调用）──
    const stats = await run(`window.robin.storageStats()`);
    const statsOk = stats && typeof stats === 'object'
      && Number.isFinite(stats.dbSize) && stats.dbSize > 0
      && Number.isFinite(stats.walSize)
      && Number.isFinite(stats.cachesCount) && Number.isFinite(stats.cachesBytes)
      && Number.isFinite(stats.artifactsCount)
      && Number.isFinite(stats.iconsBytes);
    check('a1 storage:stats 数值字段齐全且 dbSize>0', statsOk === true, JSON.stringify(stats));

    // ── d. 设置持久化（closeToTray / newArticleNotify）──
    const setR = await run(`window.robin.setGeneral({ closeToTray: true, newArticleNotify: false })`);
    const gotR = await run(`window.robin.getGeneral()`);
    const directClose = store.preferences.get('RobinRead.closeToTray', null);
    const directNotify = store.preferences.get('RobinRead.newArticleNotify', null);
    check('d1 setGeneral 写入后 getGeneral 读回', setR && setR.ok === true
      && gotR && gotR.closeToTray === true && gotR.newArticleNotify === false,
      `set=${JSON.stringify(setR)} got=${JSON.stringify(gotR)}`);
    check('d2 偏好直读（开放 KV 字符串键）',
      directClose === true && directNotify === false,
      `closeToTray=${JSON.stringify(directClose)} newArticleNotify=${JSON.stringify(directNotify)}`);
    await run(`window.robin.setGeneral({ closeToTray: false, newArticleNotify: true })`);
    const gotReset = await run(`window.robin.getGeneral()`);
    check('d3 复位读回（默认态）', gotReset && gotReset.closeToTray === false && gotReset.newArticleNotify === true,
      JSON.stringify(gotReset));

    // ── a2. storage:cleanup（过期缓存 + 孤儿 AI 产物）──
    const nowSec = Math.floor(Date.now() / 1000);
    const before = await run(`window.robin.storageStats()`);
    store.database.prepare(
      'INSERT INTO article_caches (item_id, text, html, fetched_at) VALUES (?, ?, ?, ?)',
    ).run(realItemID, '过期正文缓存样本', '<p>过期</p>', nowSec - 50 * 86400); // 50 天前 → 过期
    const insertArtifact = (id, updatedAt) => store.database.prepare(
      'INSERT INTO ai_artifacts (id, account_id, item_id, subject_key, kind, content_hash, model, target_language, content, created_at, updated_at) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, 'probe-subject', 'summary', 'h-' + id, 'probe-model', 'zh', '样本产物', updatedAt - 10, updatedAt);
    insertArtifact('probe-art-old', nowSec - 30 * 86400); // item 为 NULL 且 30 天前 → 孤儿应删
    insertArtifact('probe-art-new', nowSec);              // 新鲜 → 保留
    const polluted = await run(`window.robin.storageStats()`);
    const cleaned = await run(`window.robin.storageCleanup()`);
    check('a2 注入后统计可见（缓存+1、产物+2）', polluted && polluted.cachesCount === before.cachesCount + 1
      && polluted.artifactsCount === before.artifactsCount + 2,
      `before=${JSON.stringify(before)} polluted=${JSON.stringify(polluted)}`);
    check('a3 立即清理：过期缓存与孤儿产物被删且统计回显',
      cleaned && cleaned.cachesCount === before.cachesCount && cleaned.artifactsCount === before.artifactsCount + 1,
      `cleaned=${JSON.stringify(cleaned)}`);

    // ── b. 备份导出（核心函数直调，不弹对话框）──
    store.preferences.set('RobinRead.probePhase5', 'exported'); // 导出侧偏好标记
    store.database.exec(`CREATE TABLE probe_phase5_marker (id INTEGER PRIMARY KEY, tag TEXT)`);
    store.database.prepare('INSERT INTO probe_phase5_marker (tag) VALUES (?)').run('restored-by-phase5');

    const exportPath = path.join(userData, 'probe-backup.json');
    const exported = await backupExportTo(store, exportPath);
    check('b1 backupExportTo 直调成功并产生文件', exported && exported.path === exportPath
      && exported.bytes > 0 && fs.existsSync(exportPath), JSON.stringify(exported || null));
    const payload = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
    check('b2 备份 JSON 结构 {version,exportedAt,dbBase64,preferences}', payload
      && typeof payload.version === 'string' && payload.version.length > 0
      && typeof payload.exportedAt === 'string' && !Number.isNaN(Date.parse(payload.exportedAt))
      && typeof payload.dbBase64 === 'string' && payload.dbBase64.length > 100
      && payload.preferences && typeof payload.preferences === 'object'
      && payload.preferences['RobinRead.probePhase5'] === 'exported',
      `keys=${Object.keys(payload).join(',')} prefsProbe=${payload.preferences && payload.preferences['RobinRead.probePhase5']}`);

    // 解码 VACUUM INTO 产物 → node:sqlite 打开（副本，等效只读）断言完整表结构
    const decodedPath = path.join(userData, 'probe-decoded-snapshot.db');
    fs.writeFileSync(decodedPath, Buffer.from(payload.dbBase64, 'base64'));
    let decoded;
    try { decoded = new DatabaseSync(decodedPath, { readOnly: true }); }
    catch (_) { decoded = new DatabaseSync(decodedPath); }
    const tables = new Set(decoded.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
    decoded.close();
    const needTables = ['accounts', 'feeds', 'items', 'articles', 'article_caches', 'ai_artifacts', 'probe_phase5_marker'];
    check('b3 快照含完整库表结构（含探针标记表）', needTables.every((t) => tables.has(t)),
      `missing=${needTables.filter((t) => !tables.has(t)).join(',') || '无'} total=${tables.size}`);

    // ── 备份导入核心：坏文件拒绝 + 好文件写 pending 三件套 ──
    const bogusPath = path.join(userData, 'probe-bogus.json');
    fs.writeFileSync(bogusPath, JSON.stringify({ hello: 'world' }), 'utf8');
    let bogusRejected = false;
    try { backupImportFrom(bogusPath); } catch (_) { bogusRejected = true; }
    check('b4 缺 version/dbBase64 的文件被拒绝', bogusRejected === true);
    const imported = backupImportFrom(exportPath);
    const pendingMarker = path.join(userData, 'restore-pending.json');
    const pendingDB = path.join(userData, 'restore-pending.db');
    const pendingPrefs = path.join(userData, 'restore-pending.preferences.json');
    check('b5 backupImportFrom 写入 restore-pending 三件套', imported && imported.ready === true
      && fs.existsSync(pendingMarker) && fs.existsSync(pendingDB) && fs.existsSync(pendingPrefs),
      JSON.stringify(imported || null));

    // ── e. loginItem（dev 环境）──
    const li = await run(`window.robin.loginItem()`);
    check('e1 dev 下 loginItem supported=false 且带提示', li && li.supported === false
      && typeof li.enabled === 'boolean' && typeof li.message === 'string' && li.message.includes('仅打包版'),
      JSON.stringify(li));
    const liSet = await run(`window.robin.loginItem(true)`);
    check('e2 dev 下写请求不生效且不抛错', liSet && liSet.supported === false && liSet.enabled === false,
      JSON.stringify(liSet));

    // ── g. 新文章通知观察器（三个门控场景：隐藏弹出 / 前台不打扰 / 偏好关闭不弹）──
    const refreshAddingOne = async (n) => {
      fetchFeedDispatch = async () => ({
        notModified: false, etag: null, lastModified: null,
        parsed: {
          title: '阶段五探测周刊', siteURL: 'https://example.com/p5',
          entries: [{
            id: `x-p5-new-${n}`, title: `阶段五新文章${n}`, url: `https://example.com/p5/n${n}`,
            publishedAt: Math.floor(Date.now() / 1000), summary: '', contentHTML: '<p>刷新新增的文章内容。</p>',
          }],
        },
      });
      try { await store.refresh('manual'); } finally { fetchFeedDispatch = null; }
      await sleep(400); // 等 80ms 防抖的收尾 emit 走完观察器
    };
    await run(`window.robin.setGeneral({ newArticleNotify: true })`);

    win.hide();
    await sleep(200); // 与上次 state:changed 拉开 >80ms，保证刷新起点 emit 即时可见
    const g1Before = notificationLog.length;
    await refreshAddingOne(1);
    check('g1 隐藏窗口刷新净增1 → 通知触发（标题/数量正确）',
      notificationLog.length === g1Before + 1
      && notificationLog[g1Before]?.title === '知更 · 新文章'
      && notificationLog[g1Before]?.body === '本次刷新新增 1 篇文章',
      JSON.stringify(notificationLog));

    win.show();
    await sleep(200);
    const g2Before = notificationLog.length;
    await refreshAddingOne(2);
    check('g2 前台阅读时刷新净增不弹通知（不打扰）',
      notificationLog.length === g2Before, JSON.stringify(notificationLog));

    await run(`window.robin.setGeneral({ newArticleNotify: false })`);
    win.hide();
    await sleep(200);
    const g3Before = notificationLog.length;
    await refreshAddingOne(3);
    check('g3 偏好关闭时不弹通知',
      notificationLog.length === g3Before, JSON.stringify(notificationLog));
    await run(`window.robin.setGeneral({ newArticleNotify: true })`);
    win.show();

    // ── h. 设置页「通用」分区渲染（桌面行为 / 备份与恢复 / 存储管理）──
    const h = await run(`(async () => { try {
      const { SettingsView } = await import('./views/dialogs.js');
      const view = new SettingsView({ state: { snapshot: {} }, views: {}, onRefreshState: () => {}, onReload: () => {} });
      view.present('general');
      await new Promise((r) => setTimeout(r, 600)); // 等 _general 异步拉取 IPC 并填充
      const navTitles = [...document.querySelectorAll('.modal-sidebar .modal-nav-item')].map((el) => el.textContent.trim());
      const groupHeads = [...document.querySelectorAll('.modal-main .settings-group-header')].map((el) => el.textContent.trim());
      const groupBody = document.querySelector('.modal-main .modal-scroll')?.textContent || '';
      const buttons = [...document.querySelectorAll('.modal-main .modal-scroll button')].map((b) => b.textContent.trim());
      const toggles = document.querySelectorAll('.modal-main .modal-scroll .toggle').length;
      const statsLoaded = groupBody.includes('数据库') && groupBody.includes('正文缓存') && groupBody.includes('站点图标');
      const out = {
        navHasGeneral: navTitles.some((s) => s.includes('通用')),
        groups: ['桌面行为', '备份与恢复', '存储管理'].every((g) => groupHeads.includes(g)),
        statsLoaded,
        btnExport: buttons.some((s) => s.includes('导出到文件')),
        btnImport: buttons.some((s) => s.includes('从文件恢复')),
        btnClean: buttons.some((s) => s.includes('立即清理')),
        btnOpenDir: buttons.some((s) => s.includes('打开数据目录')),
        toggles,
      };
      view.dismiss();
      document.querySelectorAll('.modal-overlay').forEach((el) => el.remove());
      return out;
    } catch (e) { return { error: String(e && e.message || e) }; } })()`);
    check('h 设置页「通用」分区：导航/三分组/统计回显/四按钮/三开关',
      h && h.navHasGeneral && h.groups && h.statsLoaded && h.btnExport && h.btnImport && h.btnClean && h.btnOpenDir && h.toggles === 3,
      JSON.stringify(h));

    // ── f. 关闭到托盘（close 拦截 / 放行）──
    await run(`window.robin.setGeneral({ closeToTray: true })`);
    await run(`window.robin.winClose()`); // 窗口按钮路径：window:close → hide
    await sleep(400);
    check('f1 偏好开启：window:close 走隐藏（窗口存活且不可见）',
      !win.isDestroyed() && win.isVisible() === false,
      `destroyed=${win.isDestroyed()} visible=${win.isVisible()}`);
    win.show();
    win.close(); // 系统级关闭（Alt+F4 / 任务栏关闭等价）：close 事件拦截 → hide
    await sleep(400);
    check('f2 偏好开启：close 事件被拦截为隐藏（未销毁）',
      !win.isDestroyed() && win.isVisible() === false,
      `destroyed=${win.isDestroyed()} visible=${win.isVisible()}`);
    win.show();
    await run(`window.robin.setGeneral({ closeToTray: false })`);
    win.close(); // 偏好关闭：放行真正关闭
    await sleep(600);
    check('f3 偏好关闭：close 放行（窗口销毁）', win.isDestroyed() === true,
      `destroyed=${win.isDestroyed()}`);

    // ── c. 启动恢复（applyPendingRestore 直调）──
    // 导出后再改 live 数据：恢复后这些「导出之后」的痕迹必须消失（证明文件真被替换）
    store.preferences.set('RobinRead.probePhase5', 'post-export-modified');
    store.database.exec('CREATE TABLE probe_phase5_post_export (id INTEGER PRIMARY KEY)');
    store.preferences.flushSync();
    store.database.close();

    const dbPath = path.join(userData, 'library.db');
    const restoredFlag = applyPendingRestore(userData);
    check('c1 applyPendingRestore 检测标记并执行恢复', restoredFlag === true);

    const restoredCopy = path.join(userData, 'probe-restored-copy.db');
    fs.copyFileSync(dbPath, restoredCopy);
    let restoredDB;
    try { restoredDB = new DatabaseSync(restoredCopy, { readOnly: true }); }
    catch (_) { restoredDB = new DatabaseSync(restoredCopy); }
    const restoredTables = new Set(restoredDB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
    const markerRow = restoredTables.has('probe_phase5_marker')
      ? restoredDB.prepare('SELECT tag FROM probe_phase5_marker ORDER BY id DESC LIMIT 1').get()
      : null;
    restoredDB.close();
    check('c2 library.db 已被备份快照替换（含导出时标记表，且导出后新建表不存在）',
      restoredTables.has('probe_phase5_marker') === true && markerRow && markerRow.tag === 'restored-by-phase5'
      && restoredTables.has('probe_phase5_post_export') === false,
      `marker=${JSON.stringify(markerRow)} hasPostExport=${restoredTables.has('probe_phase5_post_export')}`);

    const prefsAfter = JSON.parse(fs.readFileSync(path.join(userData, 'preferences.json'), 'utf8'));
    check('c3 preferences.json 被回滚为导出时内容 + 三件套清理',
      prefsAfter['RobinRead.probePhase5'] === 'exported'
      && !fs.existsSync(pendingMarker) && !fs.existsSync(pendingDB) && !fs.existsSync(pendingPrefs),
      `probePhase5=${JSON.stringify(prefsAfter['RobinRead.probePhase5'])} pendingLeft=${[pendingMarker, pendingDB, pendingPrefs].filter((p) => fs.existsSync(p)).length}`);

    check('c4 无标记时 applyPendingRestore 幂等返回 false 且零副作用',
      applyPendingRestore(userData) === false);

    code = results.every(Boolean) ? 0 : 1;
    console.log(code === 0 ? 'PHASE5 DESKTOP PROBE: ALL PASSED' : 'PHASE5 DESKTOP PROBE: FAILED');
  } catch (err) {
    console.error('HARNESS ERROR:', err && (err.stack || err.message || err));
    code = 1;
  }
  clearTimeout(watchdog);
  app.exit(code);
}).catch((err) => { console.error(err); app.exit(1); });
