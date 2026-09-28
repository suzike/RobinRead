'use strict';
/** R17 纸感联动强调色验收截图：牛皮态强调色 vs 纸感态强调色对比 → .tmp-shots/r17-*.png（真窗口） */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r17-shot-'));
app.setPath('userData', userData);
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 180 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FIXTURE = `(async () => {
  const mod = await import('./views/edition-reader.js');
  const PALETTES = [['#C9BFA8', '#8F8368'], ['#A8B2B9', '#5F6B73'], ['#C4A98E', '#7D6650'], ['#9FAF9A', '#5F6F58']];
  const svgImg = (i) => {
    const p = PALETTES[i % 4];
    const base = "<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='" + p[0] + "'/><stop offset='1' stop-color='" + p[1] + "'/></linearGradient></defs><rect width='800' height='600' fill='url(#g)'/><circle cx='610' cy='160' r='95' fill='rgba(255,253,246,0.32)'/><path d='M0 470 L190 330 L340 470 L520 300 L800 520 L800 600 L0 600 Z' fill='rgba(32,28,22,0.32)'/></svg>";
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(base).replace(/'/g, '%27');
  };
  const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i + '：纸感联动强调色', summaryPreview: '摘要文本用于强调色随纸态微调验证：星标、选中条、未读点均随纸态收敛。', sourceTitle: '潮流周刊', publishedAt: 1758902400 + i * 86400, isRead: i % 3 === 0, isStarred: i % 4 === 0, readMinutes: 4, contentHead: i % 2 === 0 ? '<p><img src="' + svgImg(i) + '"></p>' : '' });
  const er = new mod.EditionReader({ items: Array.from({ length: 40 }, (_, i) => mk(i)), startIndex: 0, reduceMotion: false, onOpen: () => {}, fetchArticle: async () => '' });
  window.__er = er;
  er.present();
  await new Promise(r => setTimeout(r, 1500));
  er._go(1);
  await new Promise(r => setTimeout(r, 1600));
  // 选中一张卡（选中条=强调色）
  er._select('fx-9');
  await new Promise(r => setTimeout(r, 300));
  return getComputedStyle(document.querySelector('.er-overlay')).getPropertyValue('--accent').trim();
})()`;

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
    // 1. 纸感态（默认强调）
    await win.webContents.executeJavaScript(`(async () => { localStorage.removeItem('robinread.magPaper'); localStorage.removeItem('robinread.magPaperDark'); return true; })()`);
    const acc1 = await win.webContents.executeJavaScript(FIXTURE);
    console.log('accent paper ' + acc1);
    await shot('r17-1-paper-accent.png');
    // 2. 牛皮态（深一档强调）
    await win.webContents.executeJavaScript(`(async () => {
      window.__er.dismiss();
      await new Promise(r => setTimeout(r, 300));
      localStorage.setItem('robinread.magPaper', 'kraft');
      return true;
    })()`);
    const acc2 = await win.webContents.executeJavaScript(FIXTURE);
    console.log('accent kraft ' + acc2);
    await shot('r17-2-kraft-accent.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('SHOT-FAIL', e && e.stack || e);
    app.exit(1);
  }
});
