'use strict';
/** R36 验收截图：刊头双簇+工具栏秩序+全屏版心扩张 → .tmp-shots/r36-*.png */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r36-'));
app.setPath('userData', userData);
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 240 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const win = new BrowserWindow({
      show: true, width: 1600, height: 1000,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(800);
    const shot = async (name) => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(OUT, name), img.toPNG());
      console.log(`shot ${name}`);
    };
    // ① 宽栏：刊头单行双簇 + 工具栏一行
    await win.webContents.executeJavaScript(`(async () => {
      const { ListView } = await import('./views/list.js');
      document.getElementById('app') && (document.getElementById('app').style.display = 'none');
      const host = document.createElement('div');
      host.className = 'list-scroll';
      host.style.cssText = 'position:fixed;inset:0;z-index:400;background:var(--page-background,#faf8f2);overflow:auto;';
      document.body.appendChild(host);
      window.__host = host;
      const topics = ['端侧大模型', '车规芯片', '存储介质', '商业价值', 'Agent 沙箱', 'Zig 重写', '夜班公交', '面包发酵'];
      const mk = (i) => ({ id: 'r36-' + i, title: '文' + String.fromCharCode(65 + (i % 26)) + (i * 43 % 601) + ' ' + topics[i % 8] + '观察', summaryPreview: '这篇的摘要用于展示刊头双簇与工具栏秩序的排版效果。', sourceTitle: 'InfoQ', publishedAt: 1758902400 - i * 600, isRead: i % 4 === 0, contentHead: '' });
      const lv = new ListView(host, { onSelect: () => {}, onContext: () => {}, onLoadMore: () => {}, onSearch: () => {} });
      window.__lv = lv;
      lv.setViewMode('magazine');
      lv.render(Array.from({ length: 9 }, (_, i) => mk(i)), { kind: 'all' }, null, true);
      lv.topInset.querySelector('.list-top-title').textContent = '今天';
      lv.setSortButton('unreadFirst');
      await new Promise(r => setTimeout(r, 400));
      return { ok: 1 };
    })()`);
    await sleep(250);
    await shot('r36-1-wide-mast.png');
    // ② 窄栏 430：两行秩序（标题+搜索 / 控制键）
    win.setBounds({ width: 500, height: 900 });
    await win.webContents.executeJavaScript(`(async () => {
      window.__host.style.width = '100%';
      window.__lv.setViewMode('list');
      const topics = ['端侧大模型', '车规芯片', '存储介质', '商业价值'];
      const mk = (i) => ({ id: 'r36-' + i, title: '文' + String.fromCharCode(65 + (i % 26)) + (i * 43 % 601) + ' ' + topics[i % 4] + '观察', summaryPreview: '窄栏摘要。', sourceTitle: 'InfoQ', publishedAt: 1758902400 - i * 600, isRead: i % 4 === 0, contentHead: '' });
      window.__lv.render(Array.from({ length: 6 }, (_, i) => mk(i)), { kind: 'all' }, null, true);
      window.__lv.topInset.querySelector('.list-top-title').textContent = '今天'; // render 会重写标题，须在其后
      await new Promise(r => setTimeout(r, 300));
      return { ok: 1 };
    })()`);
    await sleep(250);
    await shot('r36-2-narrow-order.png');
    // ③ 全屏版心扩张：期刊阅读器 + requestFullscreen → paperW 应增长
    win.setBounds({ width: 1600, height: 1000 });
    const metrics = await win.webContents.executeJavaScript(`(async () => {
      const mod = await import('./views/edition-reader.js');
      const ARTICLE = Array.from({ length: 12 }, (_, i) => '<h2>第' + (i + 1) + '节</h2><p>正文用于全屏版心扩张验收。</p>').join('');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要', sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 6 }, (_, i) => mk(i)), startIndex: 0, reduceMotion: false, onOpen: () => {}, fetchArticle: async () => ARTICLE });
      window.__er = er;
      er.present();
      clearTimeout(er._autoTimer);
      er._doOpen();
      await new Promise(r => setTimeout(r, 1200));
      const before = er._metrics().paperW;
      try { await document.querySelector('.er-overlay').requestFullscreen(); } catch (e) { /* 忽略 */ }
      await new Promise(r => setTimeout(r, 900));
      const after = er._metrics().paperW;
      return { before, after, fs: !!document.fullscreenElement };
    })()`);
    console.log('fullscreen metrics:', JSON.stringify(metrics));
    await sleep(300);
    await shot('r36-3-fullscreen-expand.png');
    await win.webContents.executeJavaScript(`document.exitFullscreen().catch(() => {})`);
    await sleep(300);
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('SHOT-FAIL', e && e.stack || e);
    app.exit(1);
  }
});
