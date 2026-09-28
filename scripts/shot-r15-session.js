'use strict';
/** R15 会话统计验收截图：帮助面板底部统计行 + 退出小结 toast → .tmp-shots/r15-*.png（真窗口） */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r15-shot-'));
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
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i + '：纸感阅读与会话统计', summaryPreview: '摘要文本用于会话阅读统计验证：翻页与读文累计，退出时浮出小结。', sourceTitle: '潮流周刊', publishedAt: 1758902400 + i * 86400, isRead: i % 3 === 0, readMinutes: 4, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 40 }, (_, i) => mk(i)), startIndex: 0, reduceMotion: false, onOpen: () => {}, fetchArticle: async () => '' });
      window.__er = er;
      er.present();
      await new Promise(r => setTimeout(r, 1500));
      er._go(1);
      await new Promise(r => setTimeout(r, 1600));
      er._go(0);
      await new Promise(r => setTimeout(r, 1600));
      const card = document.querySelector('.er-sheet[data-role="a"] .er-place') || document.querySelector('.er-place');
      card.click();
      await new Promise(r => setTimeout(r, 1600));
      er._closeArticle();
      await new Promise(r => setTimeout(r, 900));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 600));
      return { sess: document.querySelector('.er-keys-session')?.textContent || '' };
    })()`);
    await sleep(300);
    await shot('r15-1-panel-session.png');
    // 关面板 → 退出期刊 → 小结 toast
    await win.webContents.executeJavaScript(`(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      window.__er.dismiss();
      await new Promise(r => setTimeout(r, 500));
      return { toast: document.querySelector('.er-session-toast')?.textContent || '' };
    })()`);
    await sleep(200);
    await shot('r15-2-dismiss-toast.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('SHOT-FAIL', e && e.stack || e);
    app.exit(1);
  }
});
