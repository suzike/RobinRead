'use strict';
/** R7 封面升级验收截图：期号大字 + 头条大图封面 → .tmp-shots/r7-1-cover.png（真窗口） */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r7-shot-'));
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
    await win.webContents.executeJavaScript(`(async () => {
      const mod = await import('./views/edition-reader.js');
      localStorage.removeItem('robinread.magPaper');
      localStorage.removeItem('robinread.magPaperDark');
      const PALETTES = [['#A8B2B9', '#5F6B73'], ['#C4A98E', '#7D6650'], ['#9FAF9A', '#5F6F58']];
      const svgImg = (i) => {
        const p = PALETTES[i % 3];
        const base = "<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='760'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='" + p[0] + "'/><stop offset='1' stop-color='" + p[1] + "'/></linearGradient></defs><rect width='1200' height='760' fill='url(#g)'/><circle cx='920' cy='200' r='120' fill='rgba(255,253,246,0.34)'/><path d='M0 560 L300 380 L540 560 L820 330 L1200 620 L1200 760 L0 760 Z' fill='rgba(32,28,22,0.32)'/><path d='M0 660 L380 520 L720 680 L1200 540 L1200 760 L0 760 Z' fill='rgba(32,28,22,0.46)'/></svg>";
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(base).replace(/'/g, '%27');
      };
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要文本用于封面头条图验证。', sourceTitle: '潮流周刊', publishedAt: 1758902400 + i * 86400, contentHead: '<p><img src="' + svgImg(i) + '"></p>' });
      const er = new mod.EditionReader({ items: Array.from({ length: 40 }, (_, i) => mk(i)), startIndex: 0, reduceMotion: false, onOpen: () => {}, fetchArticle: async () => '' });
      window.__er = er;
      er.present();
      clearTimeout(er._autoTimer); // 保持合书封面态（否则 700ms 后自动开书）
      await new Promise(r => setTimeout(r, 2000));
      const lead = document.querySelector('.er-cover-lead img');
      return { leadLoaded: lead ? lead.classList.contains('ok') || lead.complete : false };
    })()`);
    await sleep(500);
    await shot('r7-1-cover.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('SHOT-FAIL', e && e.stack || e);
    app.exit(1);
  }
});
