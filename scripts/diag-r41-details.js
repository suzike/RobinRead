'use strict';
/**
 * diag-r41-details.js — R41 细节三连探针（run-all OFFLINE 集）
 * 验证：失败图点击手动重试（计数清零/进入 loading/换缓存戳）/ 列表空态「立即刷新」按钮
 *       （有源显示+点击调 refresh+无源不显示）/ star-mini 悬停「已收藏」双处齐备
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, ipcMain } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r41-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 180 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
let refreshRuns = 0;
ipcMain.handle('refresh:run', () => { refreshRuns += 1; return { ok: true }; });
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
    const a = await run('details', `
      // ① 失败图点击手动重试
      const { ReaderView } = await import('./views/reader.js');
      const rhost = document.createElement('div');
      rhost.className = 'reader-article';
      document.body.appendChild(rhost);
      const proto = Object.create(ReaderView.prototype);
      proto.body = rhost;
      proto.feed = {}; proto.entry = {};
      rhost.innerHTML = '<p><img id="fx" src="https://127.0.0.1:1/broken.jpg" width="800" height="450"></p>';
      const img = rhost.querySelector('img');
      proto._decorateImage(img);
      await new Promise(r => setTimeout(r, 1900)); // 自动重试链走完 → failed
      const wrapEl = img.closest('.nj-img-failed-wrap');
      const failedBefore = img.classList.contains('nj-img-failed');
      window.__at1900 = { cls: img.className, wrap: !!img.closest('.nj-img-failed-wrap'), tipInRhost: !!rhost.querySelector('.nj-img-failed-tip'), tipAnywhere: !!document.querySelector('.nj-img-failed-tip'), tipParent: document.querySelector('.nj-img-failed-tip')?.parentElement?.className || null };
      const tipShown = !!rhost.querySelector('.nj-img-failed-tip');
      const retryBefore = img.dataset.retryCount;
      (rhost.querySelector('.nj-img-failed-tip') || img).click(); // 点提示条同样触发重试

      const afterClick = {
        loading: img.classList.contains('nj-img-loading'),
        failedGone: !img.classList.contains('nj-img-failed'),
        retryReset: img.dataset.retryCount === '0',
        cacheBust: img.src.includes('r='),
      };
      // ② 空态「立即刷新」
      const { ListView } = await import('./views/list.js');
      const lhost = document.createElement('div');
      lhost.className = 'list-scroll';
      document.body.appendChild(lhost);
      const lv = new ListView(lhost, { onSelect: () => {}, onContext: () => {}, onLoadMore: () => {}, onSearch: () => {} });
      window.__lv = lv;
      window.__robinSidebar = [{ allFeeds: [{ id: 'f1' }] }]; // 有源
      lv.setViewMode('list');
      lv._sigBust = true; // R33 签名去重：同空态需真重绘
      lv.render([], { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 150));
      const refreshBtn = lhost.querySelector('.list-empty-refresh');
      const btnShownWithFeeds = !!refreshBtn;
      refreshBtn?.click();
      await new Promise(r => setTimeout(r, 60));
      // 无源不显示
      window.__robinSidebar = [];
      lv._sigBust = true;
      lv.render([], { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 120));
      const btnGoneNoFeeds = !lhost.querySelector('.list-empty-refresh');
      // ③ star-mini 悬停（列表行 + 杂志卡）
      const titles = ['量子计算商用化进展观察', '深海火山口的生态系统'];
      const mk = (i, over = {}) => ({ id: 'st-' + i, title: titles[i], summaryPreview: '摘要', sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 60, isStarred: true, contentHead: '', ...over });
      lv.setViewMode('list');
      lv.render([mk(0), mk(1)], { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 200));
      const starListTitle = lhost.querySelector('.entry-row .star-mini')?.title || '';
      lv.setViewMode('magazine');
      lv.render([mk(0)], { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 200));
      const starMagTitle = document.querySelector('.nj-mag-card .star-mini')?.title || '';
      return {
        failedBefore, tipShown, retryBefore, afterClick, btnShownWithFeeds, btnGoneNoFeeds,
        wrapDbg: { wrap: !!rhost.querySelector('.nj-img-failed-wrap'), tip: (rhost.querySelector('.nj-img-failed-tip') || {}).textContent || null, imgClasses: img.className },
        starListTitle, starMagTitle, at1900: window.__at1900,
      };
    `);
    if (a.__err) throw new Error('details: ' + a.__err);
    console.error('DBG', JSON.stringify({ failedBefore: a.failedBefore, tipShown: a.tipShown, at1900: a.at1900, wrapDbg: a.wrapDbg }));
    ok(a.failedBefore && a.tipShown, '失败态编排占位：壳+「点击图片可重试」提示条齐备');
    ok(a.failedBefore && a.retryBefore === '1', '自动重试链走完进入 failed（retryCount 1）');
    ok(a.afterClick.loading && a.afterClick.failedGone && a.afterClick.retryReset && a.afterClick.cacheBust, '点击失败图 → 手动重试（清计数/进 loading/换缓存戳）');
    ok(a.btnShownWithFeeds, '有源空态显示「立即刷新」');
    ok(refreshRuns === 1, '点击空态刷新按钮调用真实通道 refresh:run（' + refreshRuns + ' 次）');
    ok(a.btnGoneNoFeeds, '无源空态不显示刷新按钮');
    ok(a.starListTitle.includes('已收藏') && a.starMagTitle.includes('已收藏'), 'star-mini 悬停「已收藏」双处齐备');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
