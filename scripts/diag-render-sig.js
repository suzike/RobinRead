'use strict';
/**
 * diag-render-sig.js — R33 渲染签名去重 + 新到高亮探针（run-all OFFLINE 集）
 * 验证：同签名跳过重建（节点引用不变）/ 三态或选中变化触发重建 / 新到行 row-new 一次性 /
 *       重复渲染不再标新 / setViewMode 击穿签名 / appendRows 行并入已见识
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-render-sig-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 120 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false, width: 1440, height: 900,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(900);
    const run = (tag, js) => {
      console.log('PHASE ' + tag);
      return win.webContents.executeJavaScript(`(async () => { try { ${js} } catch (e) { return { __err: String(e && e.stack || e) }; } })()`);
    };
    const a = await run('sig', `
      const { ListView } = await import('./views/list.js');
      const host = document.createElement('div');
      host.className = 'list-scroll';
      document.body.appendChild(host);
      const lv = new ListView(host, { onSelect: () => {}, onContext: () => {}, onLoadMore: () => {}, onSearch: () => {} });
      window.__lv = lv;
      const mk = (i, over = {}) => ({ id: 's-' + i, title: '文' + String.fromCharCode(65 + i) + (i * 41 % 501) + ' 号观察', summaryPreview: '摘要用于签名探针', sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 60, contentHead: '', ...over });
      const A = () => [mk(0), mk(1), mk(2)];
      lv.setViewMode('list');
      lv.render(A(), { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 200));
      const first = document.querySelector('.entry-row');
      // 同签名重入：跳过重建
      lv.render(A(), { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 100));
      const skipSame = document.querySelector('.entry-row') === first;
      // 三态变化：重建
      const B = [mk(0), mk(1, { isRead: true }), mk(2)];
      lv.render(B, { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 120));
      const rebuilt = document.querySelector('.entry-row') !== first;
      // 新到：追加 s-3 → 仅新行 row-new；再渲染同数据 → row-new 消失
      const C = [mk(3), ...B.map((x) => ({ ...x }))];
      lv.render(C, { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 120));
      const newHas = document.querySelector('.entry-row[data-entry-id="s-3"]').classList.contains('row-new');
      const oldClean = ![...document.querySelectorAll('.entry-row:not([data-entry-id="s-3"])')].some((r) => r.classList.contains('row-new'));
      lv.render(C.map((x) => ({ ...x })), { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 120));
      await new Promise(r => setTimeout(r, 1900)); // 等 setTimeout 摘类
      const secondClean = ![...document.querySelectorAll('.entry-row')].some((r) => r.classList.contains('row-new'));
      // setViewMode 击穿签名：同数据也真重绘
      const beforeMag = document.querySelector('.entry-row');
      lv.setViewMode('magazine');
      lv.render(C.map((x) => ({ ...x })), { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 200));
      const magCards = document.querySelectorAll('.nj-mag-card').length;
      const dbgView = lv.viewMode;
      const magNoNew = ![...document.querySelectorAll('.nj-mag-card')].some((c) => c.classList.contains('row-new'));
      // appendRows 行并入已见识：再 append 同 id 不标新
      lv.setViewMode('list');
      lv.render(C.map((x) => ({ ...x })), { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 120));
      lv.appendRows([mk(4)]);
      await new Promise(r => setTimeout(r, 60));
      lv.render([mk(4), ...C.map((x) => ({ ...x }))], { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 120));
      const appendedClean = !document.querySelector('.entry-row[data-entry-id="s-4"]').classList.contains('row-new');
      return { skipSame, rebuilt, newHas, oldClean, secondClean, magCards, dbgView, magNoNew, appendedClean };
    `);
    if (a.__err) throw new Error('sig: ' + a.__err);
    ok(a.skipSame, '同签名重入跳过重建（节点引用不变）');
    ok(a.rebuilt, '三态变化触发真重建');
    ok(a.newHas && a.oldClean, '新到行标 row-new、旧行不标');
    ok(a.secondClean, '重复渲染不再标新（一次性）');
    ok(a.magCards === 4 && a.magNoNew, 'setViewMode 击穿签名切杂志（4 卡）且不误标新');
    ok(a.appendedClean, 'appendRows 行并入已见识不误标');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
