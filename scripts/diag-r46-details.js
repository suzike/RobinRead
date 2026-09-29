'use strict';
/**
 * diag-r46-details.js — R46 细节三连探针（run-all OFFLINE 集）
 * 验证：滚动触底出现底部呼吸点 + appendRows 移除 / 正文已加载图 zoom-in 光标 /
 *       分割条 hover 高亮规则在册
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r46-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 150 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false, width: 1000, height: 700,
      webPreferences: { contextIsolation: true, backgroundThrottling: false },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(600);
    const run = (tag, js) => {
      console.log('PHASE ' + tag);
      return win.webContents.executeJavaScript(`(async () => { try { ${js} } catch (e) { return { __err: String(e && e.stack || e) }; } })()`);
    };
    const a = await run('details', `
      // ① 底部呼吸点：触底 → 出现；appendRows → 移除
      const { ListView } = await import('./views/list.js');
      const host = document.createElement('div');
      host.className = 'list-scroll';
      host.style.cssText = 'width:600px;height:400px;overflow:auto;';
      document.body.appendChild(host);
      let loadMore = 0;
      const lv = new ListView(host, { onSelect: () => {}, onContext: () => {}, onLoadMore: () => { loadMore += 1; }, onSearch: () => {} });
      window.__lv = lv;
      const mk = (i) => ({ id: 'r46-' + i, title: '条目' + i, summaryPreview: '摘要', sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 60, contentHead: '' });
      lv.setViewMode('list');
      lv.render(Array.from({ length: 8 }, (_, i) => mk(i)), { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 250));
      host.scrollTop = host.scrollHeight; // 触底
      await new Promise(r => setTimeout(r, 120));
      const dotShown = !!host.querySelector('.list-loading-more');
      lv.appendRows(Array.from({ length: 4 }, (_, i) => mk(100 + i)));
      await new Promise(r => setTimeout(r, 100));
      const dotRemoved = !host.querySelector('.list-loading-more');
      // ② zoom-in 光标
      const { ReaderView } = await import('./views/reader.js');
      const rhost = document.createElement('div');
      rhost.className = 'reader-article';
      document.body.appendChild(rhost);
      const rproto = Object.create(ReaderView.prototype);
      rproto.body = rhost;
      rproto.feed = {}; rproto.entry = {};
      rhost.innerHTML = '<p><img src="https://127.0.0.1:1/x.jpg" width="400" height="200"></p>';
      rhost.querySelectorAll('img').forEach((im) => rproto._decorateImage(im));
      await new Promise(r => setTimeout(r, 100));
      const cursor = getComputedStyle(rhost.querySelector('img')).cursor;
      // ③ splitter hover 高亮规则在册
      let hoverRule = false;
      for (const sheet of document.styleSheets) {
        try { for (const r of sheet.cssRules) {
          if (r.selectorText && r.selectorText.includes('.splitter:hover::after')) hoverRule = true;
        } } catch (_) {}
      }
      return { dotShown, dotRemoved, loadMore, cursor, hoverRule };
    `);
    if (a.__err) throw new Error('details: ' + a.__err);
    ok(a.dotShown, '触底出现底部呼吸点');
    ok(a.dotRemoved, 'appendRows 到达即移除呼吸点');
    ok(a.loadMore >= 1, 'onLoadMore 触发（' + a.loadMore + ' 次）');
    ok(a.cursor === 'zoom-in', '已加载图 zoom-in 光标（' + a.cursor + '）');
    ok(a.hoverRule, '分割条 hover 高亮规则在册');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
