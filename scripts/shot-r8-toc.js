'use strict';
/** R8 验收截图：目录树状面板 / 滑轨栏目分段 → .tmp-shots/r8-*.png（真窗口） */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r8-shot-'));
app.setPath('userData', userData);
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 180 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FIXTURE = `(async () => {
  const mod = await import('./views/edition-reader.js');
  const IMG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#A8B2B9'/><stop offset='1' stop-color='#5F6B73'/></linearGradient></defs><rect width='800' height='600' fill='url(#g)'/><circle cx='610' cy='160' r='95' fill='rgba(255,253,246,0.32)'/><path d='M0 470 L190 330 L340 470 L520 300 L800 520 L800 600 L0 600 Z' fill='rgba(32,28,22,0.32)'/></svg>".replace(/%27/g, '%27'));
  const PARA = '段落内容用于目录树状与滑轨分段验证：纸感阅读的关键不在于仿旧，而在于把注意力还给文字本身，版心、行距、页边与留白共同构成节奏，让长文在屏幕上也保有翻阅的呼吸感，安静是最重要的排版变量，中英混排 Mixed English 与数字 2026 亦不例外。';
  const ARTICLE = ('<h2>第一章 总纲</h2><p>' + PARA + '</p><h3>第一节 缘起</h3><p>' + PARA + '</p><h3>第二节 方法</h3><p>' + PARA + '</p><h2>第二章 展开</h2><p>' + PARA + '</p><p>' + PARA + '</p>').repeat(6);
  const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i + '：纸感阅读与版面节奏', summaryPreview: '摘要文本用于滑轨分段验证，长度适中且足以支撑版面高度，覆盖头条页判定与填充需求。' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 + i * 86400, isRead: i % 3 === 0, contentHead: i < 10 ? '<p><img src="' + IMG + '"></p>' : '' });
  const er = new mod.EditionReader({ items: Array.from({ length: 40 }, (_, i) => mk(i)), startIndex: 0, reduceMotion: false, onOpen: () => {}, fetchArticle: async () => ARTICLE });
  window.__er = er;
  er.present();
  await new Promise(r => setTimeout(r, 1500));
  er._go(1);
  await new Promise(r => setTimeout(r, 1600));
  return { pages: er.pages.length };
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
    await win.webContents.executeJavaScript(FIXTURE);
    // 1. 滑轨分段（版面态）
    await sleep(300);
    await shot('r8-1-rail-sep.png');
    // 2. 目录树状（文章模式打开目录）
    await win.webContents.executeJavaScript(`(async () => {
      const er = window.__er;
      const card = document.querySelector('.er-sheet[data-role="a"] .er-place') || document.querySelector('.er-place');
      card.click();
      await new Promise(r => setTimeout(r, 1600));
      const tocBtn = document.querySelector('.er-head-toc');
      if (tocBtn) tocBtn.click();
      await new Promise(r => setTimeout(r, 500));
      return { tocRows: document.querySelectorAll('.er-toc-row').length };
    })()`);
    await sleep(300);
    await shot('r8-2-toc-tree.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('SHOT-FAIL', e && e.stack || e);
    app.exit(1);
  }
});
