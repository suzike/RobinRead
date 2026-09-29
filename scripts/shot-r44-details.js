'use strict';
/** R44 验收截图：装载呼吸点 + 滑轨键盘翻页 → .tmp-shots/r44-1-loading.png / r44-2-rail-flip.png */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r44-'));
app.setPath('userData', userData);
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 180 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const win = new BrowserWindow({
      show: true, width: 1360, height: 860,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(900);
    const shot = async (name) => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(OUT, name), img.toPNG());
      console.log(`shot ${name}`);
    };
    await win.webContents.executeJavaScript(`(async () => {
      const mod = await import('./views/edition-reader.js');
      const ARTICLE = Array.from({ length: 14 }, (_, i) => '<h2>第' + (i + 1) + '节</h2><p>段落用于装载动画与键盘翻页验收。</p>').join('');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i + '：装载动画验收', summaryPreview: '摘要布景。', sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 12 }, (_, i) => mk(i)), startIndex: 0, reduceMotion: false, onOpen: () => {}, fetchArticle: async () => { await new Promise(r => setTimeout(r, 2600)); return ARTICLE; } });
      window.__er = er;
      er.present();
      clearTimeout(er._autoTimer);
      er._doOpen();
      await new Promise(r => setTimeout(r, 1100));
      // 打开文章 → 装载页呼吸点可见
      window.__er._openArticle(window.__er.items[0]).catch(() => {});
      await new Promise(r => setTimeout(r, 500));
      const lp = document.querySelector('.er-loading-page');
      const cs = lp ? getComputedStyle(lp, '::after') : null;
      return { anim: cs ? cs.animationName : 'absent', opacity: cs ? cs.opacity : '?' };
    })()`);
    await sleep(150);
    await shot('r44-1-loading.png');
    // 装载完成 → 滑轨刻度聚焦 + ArrowRight 翻页
    await win.webContents.executeJavaScript(`(async () => {
      await new Promise(r => setTimeout(r, 2500)); // 等装载完成
      const tick = document.querySelector('.er-rail .er-tick[data-index="0"]');
      tick.focus();
      tick.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 1100));
      return { idx: window.__er.index };
    })()`);
    await sleep(200);
    await shot('r44-2-rail-flip.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 700));
    app.exit(1);
  }
});
