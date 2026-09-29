'use strict';
/** R19 段落聚焦验收截图：聚焦态（当前段落全亮、其余降透明）→ .tmp-shots/r19-*.png（真窗口） */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r19-shot-'));
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
      const PARA = '段落内容用于段落聚焦模式验证：纸感阅读的关键不在于仿旧，而在于把注意力还给文字本身。版心、行距、页边与留白共同构成节奏，让长文在屏幕上也保有翻阅的呼吸感。中英混排 Mixed English 与数字 2026 亦不例外，安静是最重要的排版变量。';
      const ARTICLE = ('<h2>第一章 版心与呼吸</h2><p>' + PARA + '</p><p>' + PARA + '其二：聚焦模式把当前段落提亮，其余段落退为底色，视线自然落在正在读的那一段。</p><h2>第二章 段落的取舍</h2><p>' + PARA + '其三。</p><p>' + PARA + '其四。</p>').repeat(4);
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要 ' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 + i * 86400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 12 }, (_, i) => mk(i)), startIndex: 0, reduceMotion: false, onOpen: () => {}, fetchArticle: async () => ARTICLE });
      window.__er = er;
      er.present();
      await new Promise(r => setTimeout(r, 1500));
      er._go(1);
      await new Promise(r => setTimeout(r, 1600));
      const card = document.querySelector('.er-sheet[data-role="a"] .er-place') || document.querySelector('.er-place');
      card.click();
      for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 150)); if (er.mode === 'article') break; }
      await new Promise(r => setTimeout(r, 800));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 300));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await new Promise(r => setTimeout(r, 500));
      return { on: document.querySelector('.er-overlay').classList.contains('er-focus') };
    })()`);
    await sleep(300);
    await shot('r19-1-focus-mode.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('SHOT-FAIL', e && e.stack || e);
    app.exit(1);
  }
});
