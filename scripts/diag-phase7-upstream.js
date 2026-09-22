'use strict';
/**
 * diag-phase7-upstream.js — 上游借鉴功能端到端探测（存储治理 / 杂志视图 / 每源翻译）
 *
 * 与生产一致的 boot：独立临时 userData + 真实 registerIPCHandlers + show:false。
 * 覆盖：
 *   A 存储治理  保留期限淘汰（已读删/未读/收藏/稍后读保留）+ 墓碑防复活 + cleanupNow 回收
 *   B 杂志视图  listViewMode 偏好读写 + 列表渲染 .nj-mag-grid 卡片 + 切换按钮
 *   C 每源翻译  setTranslateFeedMode 三态 + readerLayout 载荷携带 + 单篇 skip 记忆
 *   D 实体自愈  _repairEncodedEntities 解码存量实体（独立标记幂等）
 * 退出码 0 = 全 PASS，1 = 有 FAIL。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

require('../src/main/ipc');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-phase7-upstream-'));
app.setPath('userData', userData);

const nowSeconds = () => Date.now() / 1000;

app.whenReady().then(async () => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(Boolean(ok));
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const watchdog = setTimeout(() => { console.log('FAIL watchdog'); app.exit(1); }, 180000);
  watchdog.unref();

  let code = 1;
  try {
    const { AppStore } = require('../src/main/AppStore');
    const store = new AppStore(userData);

    // ══ A 存储治理 ══
    const feed = store.feedsRepo.insertFeed({
      accountID: 'local-default', title: '治理探针源', siteURL: 'https://example.com', feedURL: 'https://example.com/feed',
    });
    const seed = (title, createdDaysAgo, { read = false, starred = false, later = false } = {}) => {
      const id = `local:${feed.id}:seed-${title}`;
      store.articlesRepo.upsertEntry({
        id, accountID: 'local-default', externalID: id, feedID: feed.id,
        title, url: `https://example.com/${title}`, publishedAt: nowSeconds() - createdDaysAgo * 86400,
        summary: '', contentHTML: `<p>${title}</p>`, dateArrived: nowSeconds() - createdDaysAgo * 86400,
      });
      store.database.prepare(
        'UPDATE article_states SET is_read = ?, is_starred = ?, is_later = ? WHERE item_id = ?'
      ).run(read ? 1 : 0, starred ? 1 : 0, later ? 1 : 0, id);
      return id;
    };
    const oldRead = seed('旧-已读', 400, { read: true });
    const oldUnread = seed('旧-未读', 400);
    const oldStar = seed('旧-收藏', 400, { read: true, starred: true });
    const oldLater = seed('旧-稍后读', 400, { read: true, later: true });
    const newRead = seed('新-已读', 1, { read: true });

    const setRet = store.setRetentionDays(180);
    check('A1 保留期限设置并立即淘汰', setRet.retentionDays === 180 && setRet.pruned === 1, `pruned=${setRet.pruned}`);
    const gone = store.articlesRepo.entry(oldRead);
    const keptUnread = store.articlesRepo.entry(oldUnread);
    const keptStar = store.articlesRepo.entry(oldStar);
    const keptLater = store.articlesRepo.entry(oldLater);
    const keptNew = store.articlesRepo.entry(newRead);
    check('A2 超期已读被删、未读/收藏/稍后读/新文保留',
      !gone && keptUnread && keptStar && keptLater && keptNew,
      `gone=${!gone} unread=${!!keptUnread} star=${!!keptStar} later=${!!keptLater} new=${!!keptNew}`);
    const tomb = store.database.prepare('SELECT feed_id FROM pruned_articles WHERE item_id = ?').get(oldRead);
    check('A3 墓碑写入', Boolean(tomb), JSON.stringify(tomb || {}));

    // 墓碑防复活：模拟刷新重灌（refresh 走 _applyParsedEntries，内部先查墓碑）
    store._applyParsedEntries(feed, [{ id: 'seed-旧-已读', title: '旧-已读（复活尝试）', publishedAt: nowSeconds(), summary: '', contentHTML: '<p>x</p>', url: 'https://example.com/x2' }]);
    // 直接断言：_applyParsedEntries 对墓碑身份不再入库
    const afterReapply = store.database.prepare('SELECT COUNT(*) AS c FROM items WHERE id = ?').get(oldRead).c;
    check('A4 墓碑拦截刷新复活', Number(afterReapply) === 0, `count=${afterReapply}`);

    const cleanup = store.cleanupNow();
    check('A6 cleanupNow 返回回收信息', typeof cleanup.pruned === 'number' && cleanup.freedBytes >= 0, JSON.stringify(cleanup));

    // ══ C 每源翻译 ══
    store.setTranslateFeedMode(feed.id, 'always');
    let layout = store.readerLayout();
    check('C1 always 写入并随 layout 携带', layout.translateFeedModes[feed.id] === 'always', JSON.stringify(layout.translateFeedModes));
    store.setTranslateFeedMode(feed.id, 'auto');
    layout = store.readerLayout();
    check('C2 auto 回到跟随默认（键删除）', layout.translateFeedModes[feed.id] === undefined, JSON.stringify(layout.translateFeedModes));
    store.skipArticleTranslate('entry-x');
    layout = store.readerLayout();
    check('C3 单篇 skip 记忆', layout.translateSkipped['entry-x'] === true, JSON.stringify(layout.translateSkipped));
    store.setTranslateFeedMode(feed.id, 'never');
    layout = store.readerLayout();
    check('C4 never 黑名单', layout.translateFeedModes[feed.id] === 'never');

    // ══ D 实体自愈 ══
    store.database.prepare("UPDATE articles SET title = ? WHERE item_id = ?").run('R&amp;D 与 &#39;引号&#39; 实体', oldUnread);
    store.preferences.set('RobinRead.repair.encodedEntities', false);
    store._repairEncodedEntities();
    const fixed = store.database.prepare('SELECT title FROM articles WHERE item_id = ?').get(oldUnread);
    check('D1 存量实体解码', fixed.title === "R&D 与 '引号' 实体", fixed.title);
    check('D2 修复标记幂等', store.preferences.get('RobinRead.repair.encodedEntities', false) === true);

    // ══ B 杂志视图（UI 侧）══
    const win = new BrowserWindow({
      width: 1280, height: 800, show: false,
      webPreferences: { preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'), contextIsolation: true, backgroundThrottling: false },
    });
    const { registerIPCHandlers } = require('../src/main/ipc');
    registerIPCHandlers(store, win);
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(3500);
    const uiProbe = await win.webContents.executeJavaScript(`(async () => {
      try {
        const w = window;
        if (!w.robin) return { err: 'no-robin' };
        // 切杂志视图（走与真实按钮同一偏好链路）
        await w.robin.setReaderLayout({ listViewMode: 'magazine' });
        await new Promise((r) => setTimeout(r, 1600));
        const grid = document.querySelector('.nj-mag-grid');
        const cards = document.querySelectorAll('.nj-mag-card');
        const btn = document.querySelector('#view-mode-btn');
        // 选一篇卡片打开 → 阅读器应有翻页动画挂载点
        const readerEl = document.querySelector('.reader-article');
        return {
          grid: Boolean(grid),
          cards: cards.length,
          btnLabel: btn ? btn.textContent.trim() : '',
          readerEl: Boolean(readerEl),
        };
      } catch (e) { return { err: String((e && e.message) || e) }; }
    })()`);
    check('B1 杂志网格渲染', uiProbe.grid === true && uiProbe.cards > 0, `cards=${uiProbe.cards} err=${uiProbe.err || ''}`);
    check('B2 切换按钮存在且高亮杂志', uiProbe.btnLabel.includes('杂志'), uiProbe.btnLabel);
    // 切回列表
    await win.webContents.executeJavaScript(`window.robin.setReaderLayout({ listViewMode: 'list' })`);
    await sleep(1400);
    const backList = await win.webContents.executeJavaScript(`Boolean(document.querySelector('.entry-row:not(.nj-mag-card)'))`);
    check('B3 切回经典列表', backList === true);

    clearTimeout(watchdog);
    code = results.every(Boolean) ? 0 : 1;
    console.log(code === 0 ? 'PHASE7 UPSTREAM PROBE: ALL PASSED' : 'PHASE7 UPSTREAM PROBE: FAILED');
  } catch (error) {
    console.log('FAIL probe-error — ' + String((error && error.stack) || error).slice(0, 300));
  }
  setTimeout(() => app.exit(code), 200).unref();
});
