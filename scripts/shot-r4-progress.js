'use strict';
/** R4 阅读进度验收截图：版面滑轨剩余时间 / 文章进度线剩余时间 → .tmp-shots/r4-*.png（真窗口） */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r4-shot-'));
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
      const ARTICLE = Array.from({ length: 24 }, (_, i) => '<p>第' + (i + 1) + '段：纸感阅读的关键不在于仿旧，而在于把注意力还给文字本身。版心、行距、页边与留白共同构成节奏，让长文在屏幕上也保有翻阅的呼吸感，中英混排 Mixed English 与数字 2026 亦不例外，安静是最重要的排版变量。</p>').join('');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要文本用于剩余时间估算验证，长度适中，足以占据两行版面空间。' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, readMinutes: 5, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 40 }, (_, i) => mk(i)), startIndex: 0, reduceMotion: false, onOpen: () => {}, fetchArticle: async () => ARTICLE });
      window.__er = er;
      er.present();
      await new Promise(r => setTimeout(r, 1500));
      er._go(1);
      await new Promise(r => setTimeout(r, 1600));
      const count = document.querySelector('.er-count');
      return { countText: count && !count.hidden ? count.textContent.trim() : null, page: er.index, pages: er.pages.length };
    })()`);
    await sleep(300);
    await shot('r4-1-rail-remain.png');
    const art = await win.webContents.executeJavaScript(`(async () => {
      const er = window.__er;
      const card = document.querySelector('.er-sheet[data-role="a"] .er-place') || document.querySelector('.er-place');
      card.click();
      await new Promise(r => setTimeout(r, 1500));
      const tip = document.querySelector('.er-remain-tip');
      const line = document.querySelector('.er-article-progress i');
      return { tip: tip ? tip.textContent.trim() : null, w: line ? line.style.width : null };
    })()`);
    console.log('art ' + JSON.stringify(art));
    await sleep(300);
    await shot('r4-2-article-remain.png');
    // 末页跨页情形（评委要求复验项）：进度线 100% + 「本文已读完」+ 末行墨迹不贴纸缘
    const end = await win.webContents.executeJavaScript(`(async () => {
      const er = window.__er;
      er._go(er.pages.length - 1);
      await new Promise(r => setTimeout(r, 1500));
      const tip = document.querySelector('.er-remain-tip');
      return { tip: tip ? tip.textContent.trim() : null, page: er.index + 1, pages: er.pages.length };
    })()`);
    console.log('end ' + JSON.stringify(end));
    await sleep(300);
    await shot('r4-3-article-end.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('SHOT-FAIL', e && e.stack || e);
    app.exit(1);
  }
});
