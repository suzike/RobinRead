'use strict';
/** R9 栏宽验收截图：面板四组（含栏宽）+ 窄栏阅读态 → .tmp-shots/r9-*.png（真窗口） */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r9-shot-'));
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
      localStorage.removeItem('robinread.editionTypography');
      const PARA = '段落内容用于栏宽舒适度验证：纸感阅读的关键不在于仿旧，而在于把注意力还给文字本身，版心、行距、页边与留白共同构成节奏，让长文在屏幕上也保有翻阅的呼吸感。中英混排 Mixed English 与数字 2026 亦不例外，安静是最重要的排版变量，栏宽决定每一行的字数与视线的回行距离。';
      const ARTICLE = ('<h2>第一章 版心与呼吸</h2><p>' + PARA + '</p><p>' + PARA + '</p><h2>第二章 栏宽的取舍</h2><p>' + PARA + '</p><p>' + PARA + '</p>').repeat(6);
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要 ' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 + i * 86400, readMinutes: 6, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 12 }, (_, i) => mk(i)), startIndex: 0, reduceMotion: false, onOpen: () => {}, fetchArticle: async () => ARTICLE });
      window.__er = er;
      er.present();
      await new Promise(r => setTimeout(r, 1500));
      er._go(1);
      await new Promise(r => setTimeout(r, 1600));
      const card = document.querySelector('.er-sheet[data-role="a"] .er-place') || document.querySelector('.er-place');
      card.click();
      await new Promise(r => setTimeout(r, 1600));
      // 切窄栏后关面板：r9-1 呈现无遮挡的纯净窄栏阅读态
      const narrow = await (async () => {
        document.querySelector('.er-type').click();
        await new Promise(r => setTimeout(r, 400));
        const colRow = [...document.querySelectorAll('.er-type-row')].find((r) => r.textContent.includes('栏宽'));
        [...colRow.querySelectorAll('button')].find((b) => b.dataset.val === 'narrow').click();
        await new Promise(r => setTimeout(r, 1200));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise(r => setTimeout(r, 300));
        return document.querySelector('.er-article-leaf .er-article').style.width;
      })();
      window.__colW = narrow;
      return { narrow };
    })()`);
    await sleep(400);
    await shot('r9-1-narrow-col.png');
    // 面板四组同框（等 0.18s 淡入动画完全结束再截）
    await win.webContents.executeJavaScript(`(async () => {
      document.querySelector('.er-type').click();
      await new Promise(r => setTimeout(r, 700));
      const p = document.querySelector('.er-type-panel');
      return { open: !!p, rows: p ? p.querySelectorAll('.er-type-row').length : 0,
        colOn: !!p?.querySelector('[data-key="col"][data-val="narrow"].on') };
    })()`);
    await sleep(300);
    await shot('r9-2-panel-4rows.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('SHOT-FAIL', e && e.stack || e);
    app.exit(1);
  }
});
