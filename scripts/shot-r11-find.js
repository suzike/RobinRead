'use strict';
/** R11 期刊内搜索验收截图：搜索条（文章命中计数）/ 版面条目命中 → .tmp-shots/r11-*.png（真窗口） */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r11-shot-'));
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
      const PARA = '段落内容用于期刊内搜索验证：山海关是明长城的东北关隘，纸感阅读的关键不在于仿旧，版心行距页边共同构成节奏，安静是最重要的排版变量。';
      const ARTICLE = ('<h2>第一章 关隘</h2><p>' + PARA + '</p><p>补充段落：山海关城楼上的匾额与远处的海面相映成趣，是搜索定位的第二个落点。</p>').repeat(5);
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i + (i === 3 ? '：山海关纪行' : '：纸感阅读与版面节奏'), summaryPreview: '摘要文本用于版面条目搜索验证。' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 + i * 86400, isRead: i % 3 === 0, readMinutes: 5, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 40 }, (_, i) => mk(i)), startIndex: 0, reduceMotion: false, onOpen: () => {}, fetchArticle: async () => ARTICLE });
      window.__er = er;
      er.present();
      await new Promise(r => setTimeout(r, 1500));
      er._go(1);
      await new Promise(r => setTimeout(r, 1600));
      const card = document.querySelector('.er-sheet[data-role="a"] .er-place') || document.querySelector('.er-place');
      card.click();
      await new Promise(r => setTimeout(r, 1600));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 400));
      const input = document.querySelector('.er-find-input');
      input.value = '山海关';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 1400));
      return { count: document.querySelector('.er-find-count').textContent };
    })()`);
    await sleep(300);
    await shot('r11-1-article-find.png');
    // 版面态条目搜索
    await win.webContents.executeJavaScript(`(async () => {
      const er = window.__er;
      er._findClose();
      er._closeArticle();
      await new Promise(r => setTimeout(r, 900));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 400));
      const input = document.querySelector('.er-find-input');
      input.value = '山海关';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      return { count: document.querySelector('.er-find-count').textContent };
    })()`);
    await sleep(300);
    await shot('r11-2-edition-find.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('SHOT-FAIL', e && e.stack || e);
    app.exit(1);
  }
});
