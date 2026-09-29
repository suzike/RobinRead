'use strict';
/** R20 命令面板接入验收截图：期刊上浮出命令面板（含期刊命令组）→ .tmp-shots/r20-*.png（真窗口） */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r20-shot-'));
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
      const { CommandPalette } = await import('./views/command-palette.js');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i + '：纸感阅读与命令面板', summaryPreview: '摘要文本用于命令面板接入验证：期刊命令在面板中直达。', sourceTitle: '潮流周刊', publishedAt: 1758902400 + i * 86400, isRead: i % 3 === 0, readMinutes: 4, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 24 }, (_, i) => mk(i)), startIndex: 0, reduceMotion: false, onOpen: () => {}, fetchArticle: async () => '' });
      window.__er = er;
      er.present();
      await new Promise(r => setTimeout(r, 1500));
      er._go(1);
      await new Promise(r => setTimeout(r, 1600));
      // 同 app.js 真实通路：全局命令 + 期刊命令合并（期刊组在前，模拟合并后的排序）
      const palette = new CommandPalette();
      const edition = er.paletteCommands();
      const global = [
        { label: '打开：今天', keywords: 'today 今日', icon: 'sun', action: () => {} },
        { label: '打开：未读', keywords: 'unread 未读', icon: 'envelopeClosed', action: () => {} },
        { label: '切换：浅色 / 深色主题', keywords: 'theme 主题', icon: 'appearance', action: () => {} },
        { label: '打开：设置', keywords: 'settings 设置', icon: 'gear', action: () => {} },
      ];
      palette.present([...edition, ...global]);
      await new Promise(r => setTimeout(r, 500));
      return { cmds: edition.length + global.length, visible: !!document.querySelector('.cmd-palette') };
    })()`);
    await sleep(300);
    await shot('r20-1-palette-on-edition.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('SHOT-FAIL', e && e.stack || e);
    app.exit(1);
  }
});
