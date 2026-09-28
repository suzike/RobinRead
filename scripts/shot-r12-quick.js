'use strict';
/** R12 快捷收藏/稍后读验收截图：选中卡 S/L 后的星标+时钟标记 → .tmp-shots/r12-*.png（真窗口） */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r12-shot-'));
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
      const PALETTES = [['#C9BFA8', '#8F8368'], ['#A8B2B9', '#5F6B73'], ['#C4A98E', '#7D6650'], ['#9FAF9A', '#5F6F58']];
      const svgImg = (i) => {
        const p = PALETTES[i % 4];
        const base = "<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='" + p[0] + "'/><stop offset='1' stop-color='" + p[1] + "'/></linearGradient></defs><rect width='800' height='600' fill='url(#g)'/><circle cx='610' cy='160' r='95' fill='rgba(255,253,246,0.32)'/><path d='M0 470 L190 330 L340 470 L520 300 L800 520 L800 600 L0 600 Z' fill='rgba(32,28,22,0.32)'/></svg>";
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(base).replace(/'/g, '%27');
      };
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i + '：纸感阅读与快捷操作', summaryPreview: '摘要文本用于快捷收藏/稍后读验证：方向键选中后按 S 收藏、按 L 稍后读。', sourceTitle: '潮流周刊', publishedAt: 1758902400 + i * 86400, isRead: i % 3 === 0, readMinutes: 3 + (i % 9), contentHead: i % 2 === 0 ? '<p><img src="' + svgImg(i) + '"></p>' : '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 40 }, (_, i) => mk(i)), startIndex: 0, reduceMotion: false, onOpen: () => {}, fetchArticle: async () => '' });
      window.__er = er;
      er.present();
      await new Promise(r => setTimeout(r, 1500));
      er._go(1);
      await new Promise(r => setTimeout(r, 1600));
      // 选中两张卡并按 S/L
      er._select('fx-9');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
      await new Promise(r => setTimeout(r, 500));
      er._select('fx-12');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
      await new Promise(r => setTimeout(r, 600));
      return {
        star9: er.items.find((x) => x.id === 'fx-9').isStarred,
        later12: er.items.find((x) => x.id === 'fx-12').isLater,
        marks: document.querySelectorAll('.er-sheet[data-role="a"] .er-star, .er-sheet[data-role="a"] .er-later').length,
      };
    })()`);
    await sleep(300);
    await shot('r12-1-quick-marks.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('SHOT-FAIL', e && e.stack || e);
    app.exit(1);
  }
});
