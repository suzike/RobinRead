'use strict';
/**
 * diag-phase6-later.js — 阶段六「稍后读队列」端到端探测
 *
 * 与生产一致的 boot：独立临时 userData（os.tmpdir 隔离）+ FeedParser 样本本地入库（不联网）+
 * 真实 registerIPCHandlers + show:false 窗口加载 src/renderer/index.html（preload 桥）。
 *
 * 覆盖：
 *   a. toggleLater(true) → listItems({kind:'later'}) 含该篇；all 视图 isLater=true；
 *      reader 载荷（LRU 快路径）entry.isLater 同步；增量 entryChanges 携带 isLater
 *   b. toggleLater(false) → later 视图排除该篇（行消失）；retainingIDs 模式（同 unread）
 *      可保留该行；已读/星标状态不被 upsert 覆盖；FreshRSS outbox 不参与
 *   c. fetchSidebarCounts laterCount 正确（直查 + snapshot 侧栏计数双口径）
 *   d. IPC 链路：preload 经 registerIPCHandlers 后 webContents 调 window.robin.toggleLater /
 *      getList({kind:'later'}) / getState().sidebarCounts.laterCount
 *   e. 迁移幂等：v6 up() 直接重放（列已存在走 try/catch）不报错；
 *      runMigrations 重跑 + 同一目录新建第二个 AppStore 均不报错且 is_later 列在位
 *
 * 幂等：全部数据落在一次性临时目录；退出码 0=全 PASS，1=有 FAIL。
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-phase6-later-'));
app.setPath('userData', userData);

app.on('window-all-closed', () => { /* 探针自行控制退出 */ });

app.whenReady().then(async () => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(Boolean(ok));
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const watchdog = setTimeout(() => {
    console.log('FAIL watchdog — 探测总时长超 90s，强制退出');
    app.exit(1);
  }, 90000);

  // executeJavaScript 的 rejection 会变成空 {}，注入 IIFE 内一律自行 try/catch 返回 e.message
  let win = null;
  const run = async (js) => {
    try { return await win.webContents.executeJavaScript(js, true); }
    catch (e) { return { ok: false, error: 'executeJavaScript-rejected: ' + String((e && e.message) || e) }; }
  };

  try {
    const { AppStore } = require('../src/main/AppStore');
    const { runMigrations, MIGRATIONS } = require('../src/main/Persistence/DatabaseMigrations');

    const store = new AppStore(userData);

    // 样本数据：注入一个含 3 篇未读的本地 Feed（不经网络，参照 selftest / phase5）
    const feed = store.feedsRepo.insertFeed({
      accountID: 'local-default',
      title: '阶段六稍后读周刊',
      siteURL: 'https://example.com/p6',
      feedURL: 'https://example.com/p6/feed.xml',
    });
    store._applyParsedEntries(feed, [1, 2, 3].map((n) => ({
      id: `x-p6-later-${n}`,
      title: `稍后读样本文章${n}：读着累先存队列`,
      url: `https://example.com/p6/a${n}`,
      publishedAt: Math.floor(Date.now() / 1000) - n * 60,
      summary: `稍后读样本第 ${n} 篇摘要，与已读/收藏独立的第三状态验证。`,
      contentHTML: `<p>稍后读样本文章${n}的正文内容，篇幅足够通过评分与渲染路径。</p>`.repeat(4),
    })));
    const items = store.listItems({ kind: 'feed', feedID: feed.id });
    check('boot 样本入库 3 篇', items.length === 3, `n=${items.length}`);
    const target = items[0]; // 最新一篇
    const other = items[1];

    // ── a. 入队：toggleLater true ──
    const t0 = Date.now() / 1000;
    store.markRead(target.id, true); // 先读后入队：读着累 → 存队列
    const toggledOn = store.toggleLater(target.id, true);
    check('a1 toggleLater(true) 返回 true', toggledOn === true, `got=${toggledOn}`);
    const laterItems = store.listItems({ kind: 'later' });
    check('a2 later 视图含该篇', laterItems.some((i) => i.id === target.id),
      `n=${laterItems.length} ids=${laterItems.map((i) => i.id).join(',')}`);
    const allItems = store.listItems({ kind: 'all' });
    const allRow = allItems.find((i) => i.id === target.id);
    check('a3 all 视图 isLater=true', allRow && allRow.isLater === true, `isLater=${allRow && allRow.isLater}`);
    check('a4 列表行 isRead/isStarred 不受影响', allRow && allRow.isRead === true && allRow.isStarred === false,
      `read=${allRow && allRow.isRead} starred=${allRow && allRow.isStarred}`);
    check('a5 reader 载荷 entry.isLater=true（含 LRU 快路径）', store.readerArticle(target.id).entry.isLater === true);
    const entryChange = store.snapshot().entryChanges.find((c) => c.id === target.id);
    check('a6 增量 entryChanges 携带 isLater=true', entryChange && entryChange.isLater === true, JSON.stringify(entryChange));
    check('a7 未入队文章不在 later 视图', !store.listItems({ kind: 'later' }).some((i) => i.id === other.id));
    check('a8 setLater 时间戳落库', store.database.prepare(
      'SELECT updated_at FROM article_states WHERE item_id = ?'
    ).get(target.id).updated_at >= t0 - 1);

    // ── b. 出队：toggleLater false（移出队列行消失）+ 保留集模式 ──
    store.toggleLater(target.id, false);
    check('b1 取消后 later 视图排除', !store.listItems({ kind: 'later' }).some((i) => i.id === target.id),
      `n=${store.listItems({ kind: 'later' }).length}`);
    check('b2 all 视图 isLater=false', store.listItems({ kind: 'all' }).find((i) => i.id === target.id)?.isLater === false);
    const retained = store.listItems({ kind: 'later' }, { retainingIDs: [target.id] });
    check('b3 retainingIDs 模式（同 unread）保留该行', retained.some((i) => i.id === target.id),
      `n=${retained.length}`);
    // 已读/星标不被 setLater 的 upsert 分支覆盖（DO UPDATE 只改 is_later）
    store.toggleLater(target.id, true);
    store.toggleStar(target.id);
    store.markRead(target.id, false); // 标为未读（保留在队列里稍后读）
    const entryAfter = store.entry(target.id);
    check('b4 已读/星标/稍后读三状态互不覆盖',
      entryAfter.isLater === true && entryAfter.isStarred === true && entryAfter.isRead === false,
      `later=${entryAfter.isLater} starred=${entryAfter.isStarred} read=${entryAfter.isRead}`);
    store.markRead(target.id, true); // 队列内读完：稍后读状态应保持
    check('b5 队列内标已读不改变 isLater', store.entry(target.id).isLater === true
      && store.listItems({ kind: 'later' }).some((i) => i.id === target.id));
    check('b6 outbox 不参与（本地状态）', store.statesRepo.outboxCount('local-default') === 0,
      `outbox=${store.statesRepo.outboxCount('local-default')}`);

    // ── c. 侧栏计数 ──
    // 当前队列：target（在队）；再把 other 入队 → 共 2 篇
    store.toggleLater(other.id, true);
    const directCounts = store.timeline.fetchSidebarCounts('local-default', store._startOfDayTimestamp());
    check('c1 fetchSidebarCounts.laterCount=2', directCounts.laterCount === 2, `laterCount=${directCounts.laterCount}`);
    const snapCounts = store.snapshot().sidebarCounts;
    check('c2 snapshot.sidebarCounts.laterCount=2', snapCounts.laterCount === 2, `laterCount=${snapCounts.laterCount}`);
    store.toggleLater(other.id, false);
    store.toggleLater(target.id, false);
    check('c3 清空后 laterCount=0', store.timeline.fetchSidebarCounts('local-default', store._startOfDayTimestamp()).laterCount === 0);
    store.toggleLater(target.id, true); // 留 1 篇供 d 段 IPC 视图断言

    // ── e. 迁移幂等（先于窗口段：主进程侧直查）──
    let replayErr = null;
    try {
      MIGRATIONS.find((m) => m.id === 'v6-article-is-later').up(store.database.db); // 列已存在 → try/catch 吞掉
    } catch (err) { replayErr = err; }
    check('e1 v6 up() 重放（列已存在）不报错', replayErr == null, `err=${replayErr && replayErr.message}`);
    let rerunErr = null;
    try { runMigrations(store.database.db); } catch (err) { rerunErr = err; }
    check('e2 runMigrations 重跑不报错', rerunErr == null, `err=${rerunErr && rerunErr.message}`);
    const col = store.database.prepare(
      "SELECT name FROM pragma_table_info('article_states') WHERE name = 'is_later'"
    ).get();
    check('e3 is_later 列在位', Boolean(col));

    // ── d. IPC 链路（preload → registerIPCHandlers → webContents）──
    win = new BrowserWindow({
      show: false, width: 1500, height: 940,
      webPreferences: { preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'), contextIsolation: true },
    });
    const { registerIPCHandlers } = require('../src/main/ipc');
    registerIPCHandlers(store, win);
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(1200); // boot：首屏渲染

    const boot = await run(`(() => { try { return { ok: !!window.robin && typeof window.robin.toggleLater === 'function' }; } catch (e) { return { ok: false, error: e.message }; } })()`);
    check('d1 preload 桥就绪且暴露 toggleLater', boot.ok === true, JSON.stringify(boot));

    const ipcOff = await run(`window.robin.toggleLater(${JSON.stringify(target.id)}, false)`);
    check('d2 IPC toggleLater(false) 调用成功', ipcOff && ipcOff.ok === true && ipcOff.data === false, JSON.stringify(ipcOff));
    const laterAfterOff = await run(`window.robin.getList({ kind: 'later' }, {})`);
    check('d3 IPC 后 later 视图排除该篇', laterAfterOff.ok && !(laterAfterOff.data || []).some((i) => i.id === target.id),
      `n=${laterAfterOff.ok ? (laterAfterOff.data || []).length : 'err'}`);

    const ipcOn = await run(`window.robin.toggleLater(${JSON.stringify(target.id)}, true)`);
    check('d4 IPC toggleLater(true) 调用成功', ipcOn && ipcOn.ok === true && ipcOn.data === true, JSON.stringify(ipcOn));
    const laterAfterOn = await run(`window.robin.getList({ kind: 'later' }, {})`);
    check('d5 IPC 后 later 视图含该篇且行带 isLater', laterAfterOn.ok
      && (laterAfterOn.data || []).some((i) => i.id === target.id && i.isLater === true),
      `n=${laterAfterOn.ok ? (laterAfterOn.data || []).length : 'err'}`);
    const ipcCounts = await run(`window.robin.getState()`);
    check('d6 IPC getState().sidebarCounts.laterCount=1', ipcCounts.ok && ipcCounts.data.sidebarCounts.laterCount === 1,
      `laterCount=${ipcCounts.ok ? ipcCounts.data.sidebarCounts.laterCount : 'err'}`);
    const ipcReader = await run(`window.robin.getReader(${JSON.stringify(target.id)})`);
    check('d7 IPC reader 载荷 entry.isLater=true', ipcReader.ok && ipcReader.data.entry.isLater === true);

    // ── e4. 同一目录新建第二个 AppStore（冷启动重放全部迁移）──
    let store2Err = null;
    let store2 = null;
    try { store2 = new AppStore(userData); } catch (err) { store2Err = err; }
    check('e4 同目录二次新建 AppStore 不报错', store2Err == null && store2 != null, `err=${store2Err && store2Err.message}`);
    if (store2) {
      const laterCold = store2.listItems({ kind: 'later' });
      check('e5 冷启动后稍后读状态持久', laterCold.some((i) => i.id === target.id),
        `n=${laterCold.length}`);
    }

    if (win && !win.isDestroyed()) win.destroy();
  } catch (err) {
    check('unexpected-error', false, err.stack || err.message);
  }

  clearTimeout(watchdog);
  const failed = results.filter((r) => !r);
  console.log(failed.length === 0 ? 'PHASE6 LATER PROBE: ALL PASSED' : `PHASE6 LATER PROBE: ${failed.length} FAILED`);
  app.exit(failed.length === 0 ? 0 : 1);
});
