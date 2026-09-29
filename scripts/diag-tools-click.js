'use strict';
/** 诊断：期刊工具条按钮真点击命中率 + elementFromPoint 落点（R35 不灵敏取证） */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-tools-diag-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 180 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: true, width: 1600, height: 1000,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(800);
    const info = await win.webContents.executeJavaScript(`(async () => {
      const mod = await import('./views/edition-reader.js');
      const ARTICLE = Array.from({ length: 10 }, (_, i) => '<h2>第' + (i + 1) + '节</h2><p>正文用于工具条诊断场景。</p>').join('');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要', sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 6 }, (_, i) => mk(i)), startIndex: 0, reduceMotion: false, onOpen: () => {}, fetchArticle: async () => ARTICLE });
      window.__er = er;
      er.present();
      clearTimeout(er._autoTimer);
      er._doOpen();
      await new Promise(r => setTimeout(r, 1200));
      // 给每个按钮挂命中计数器（capture 阶段，含 pointerdown/click）
      window.__hits = {};
      const btns = [...document.querySelectorAll('.er-tools button')];
      for (const b of btns) {
        const key = b.className.split(' ')[0];
        window.__hits[key] = { down: 0, click: 0 };
        b.addEventListener('pointerdown', () => { window.__hits[key].down += 1; }, true);
        b.addEventListener('click', () => { window.__hits[key].click += 1; }, true);
      }
      const centers = btns.map((b) => {
        const rc = b.getBoundingClientRect();
        return { key: b.className.split(' ')[0], x: rc.x + rc.width / 2, y: rc.y + rc.height / 2 };
      });
      window.__centers = centers;
      // 落点元素侦查
      window.__landings = centers.map((c) => {
        const el = document.elementFromPoint(c.x, c.y);
        return { key: c.key, hit: el ? (el.className && String(el.className).split(' ')[0] || el.tagName) : 'none', inTools: !!(el && el.closest('.er-tools')) };
      });
      return { centers, landings: window.__landings };
    })()`);
    console.log('landings:', JSON.stringify(info.landings || info));
    // 逐按钮真点击 5 次
    for (const c of info.centers) {
      for (let i = 0; i < 5; i++) {
        win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(c.x), y: Math.round(c.y), button: 'left', clickCount: 1 });
        win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(c.x), y: Math.round(c.y), button: 'left', clickCount: 1 });
        await sleep(90);
      }
      await sleep(250);
    }
    const hits = await win.webContents.executeJavaScript(`window.__hits`);
    console.log('hits:', JSON.stringify(hits));
    app.exit(0);
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 600));
    app.exit(1);
  }
});
