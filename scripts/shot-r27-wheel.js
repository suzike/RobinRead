'use strict';
/** R27 验收截图：Ctrl+滚轮字号步进（文章放大实差）+ 快查面板新行 → .tmp-shots/r27-*.png */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r27-shot-'));
app.setPath('userData', userData);
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 180 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const win = new BrowserWindow({
      show: true, width: 1600, height: 1000,
      webPreferences: {
        contextIsolation: true, backgroundThrottling: false,
        preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(800);
    const shot = async (name) => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(OUT, name), img.toPNG());
      console.log(`shot ${name}`);
    };
    // 开书 → 文章模式 → 快查面板（新 Ctrl+滚轮 行）
    await win.webContents.executeJavaScript(`(async () => {
      const mod = await import('./views/edition-reader.js');
      const ARTICLE = Array.from({ length: 14 }, (_, i) => '<h2>第' + (i + 1) + '节 · 字号步进验证</h2><p>这段正文的字号在 Ctrl+滚轮步进后应当直观变大：字号是阅读体验中最直接的偏好，三档步进让放大与缩小都不必打开面板。</p>').join('');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i + '：Ctrl+滚轮字号步进', summaryPreview: '摘要用于验收布景。', sourceTitle: '潮流周刊', publishedAt: 1758902400 + i * 86400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 8 }, (_, i) => mk(i)), startIndex: 0, reduceMotion: false, onOpen: () => {}, fetchArticle: async () => ARTICLE });
      window.__er = er;
      er.present();
      clearTimeout(er._autoTimer);
      er._doOpen();
      await new Promise(r => setTimeout(r, 1200));
      er._openArticle(er.items[0]).catch(() => {});
      await new Promise(r => setTimeout(r, 1400));
      er._toggleKeysPanel();
      await new Promise(r => setTimeout(r, 400));
      return { rows: document.querySelectorAll('.er-keys-row').length };
    })()`);
    await sleep(250);
    await shot('r27-1-keys-panel.png');
    // 关面板 → Ctrl+滚轮上滚两档 → 文章字号变大
    await win.webContents.executeJavaScript(`(async () => {
      document.querySelector('.er-keys-panel')?.remove();
      const stage = document.querySelector('.er-stage');
      const wheel = (dy) => stage.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, ctrlKey: true, bubbles: true, cancelable: true }));
      wheel(-120); await new Promise(r => setTimeout(r, 500));
      wheel(-120); await new Promise(r => setTimeout(r, 700));
      return { scale: document.querySelector('.er-overlay').style.getPropertyValue('--er-font-scale'), fs: getComputedStyle(document.querySelector('.er-article')).fontSize };
    })()`);
    await sleep(250);
    await shot('r27-2-article-enlarged.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('SHOT-FAIL', e && e.stack || e);
    app.exit(1);
  }
});
