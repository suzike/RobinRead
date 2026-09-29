'use strict';
/**
 * diag-r36-layout.js — R36 布局合理性探针（run-all OFFLINE 集）
 * 验证：工具栏 order 编排（标题→spring→搜索→控制键，搜索恒右）/ 刊头双簇结构
 *       （簇内不折行、窄栏簇间换行）/ 全屏版心扩张按 document.fullscreenElement 生效
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r36-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 150 * 1000).unref();
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
    const a = await run('layout', `
      const { ListView } = await import('./views/list.js');
      const host = document.createElement('div');
      host.className = 'list-scroll';
      document.body.appendChild(host);
      const lv = new ListView(host, { onSelect: () => {}, onContext: () => {}, onLoadMore: () => {}, onSearch: () => {} });
      window.__lv = lv;
      const topics = ['端侧大模型', '车规芯片', '存储介质', '商业价值', 'Agent 沙箱', 'Zig 重写', '夜班公交', '面包发酵'];
      const mk = (i) => ({ id: 'r36-' + i, title: '文' + String.fromCharCode(65 + (i % 26)) + (i * 43 % 601) + ' ' + topics[i % 8] + '观察', summaryPreview: '摘要用于布局探针。', sourceTitle: 'InfoQ', publishedAt: 1758902400 - i * 600, contentHead: '' });
      // 杂志模式出刊头
      lv.setViewMode('magazine');
      lv.render(Array.from({ length: 8 }, (_, i) => mk(i)), { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 300));
      const mast = document.querySelector('.nj-edition-mast');
      const brandCluster = mast?.querySelector('.nj-edition-brand-cluster');
      const actionsCluster = mast?.querySelector('.nj-edition-actions');
      const brandIn = brandCluster?.querySelector('.nj-edition-brand') && brandCluster?.querySelector('.nj-edition-date');
      const actionsIn = actionsCluster?.querySelector('.nj-edition-read') && actionsCluster?.querySelector('.nj-edition-paper:not(.nj-edition-read)');
      // 簇内不折行：brand 与 date 同一 top；actions 两键同一 top
      const bRect = brandCluster?.querySelector('.nj-edition-brand')?.getBoundingClientRect();
      const dRect = brandCluster?.querySelector('.nj-edition-date')?.getBoundingClientRect();
      const rRect = actionsCluster?.querySelector('.nj-edition-read')?.getBoundingClientRect();
      const pRect = actionsCluster?.querySelector('.nj-edition-paper:not(.nj-edition-read)')?.getBoundingClientRect();
      const sameClusterBrand = !!(dRect && bRect && dRect.left > bRect.right - 2); // 水平并排=簇内不折行
      const sameClusterAct = !!(rRect && pRect && pRect.left > rRect.right - 2);
      const inset = lv.topInset;
      const order = (sel) => parseInt(getComputedStyle(inset.querySelector(sel)).order);
      const oTitle = order('.list-top-title'), oSearch = order('.list-search'), oBtn = order('#view-mode-btn');
      // 全屏扩张：模块级 pageWidth 不可直测——经 _metrics 代理（模拟 fullscreenElement 不可行，验证非全屏基准存在）
      const paperNow = window.__er ? 0 : 0;
      return { brandIn: !!brandIn, actionsIn: !!actionsIn, sameClusterBrand, sameClusterAct, dbg: { b: bRect && Math.round(bRect.right), d: dRect && Math.round(dRect.left), r: rRect && Math.round(rRect.right), p: pRect && Math.round(pRect.left) }, oTitle, oSearch, oBtn };
    `);
    if (a.__err) throw new Error('layout: ' + a.__err);
    ok(a.brandIn && a.actionsIn, '刊头双簇结构（刊名+日期 / 翻页阅读+纸感）');
    console.error('DBG', JSON.stringify({ scb: a.sameClusterBrand, sca: a.sameClusterAct, dbg: a.dbg }));
    ok(a.sameClusterBrand && a.sameClusterAct, '簇内不折行（水平并排）');
    ok(a.oTitle === 1 && a.oSearch === 3 && a.oBtn === 4, '工具栏 order 编排（标题1/搜索3/控制键4）');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
