'use strict';
/** R21 分组面板补图验收：① 下滚露出「全局」组头+发丝线 ② 输入「期刊」组名可搜 → .tmp-shots/r21-*.png（真窗口） */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r21-shot-'));
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
    // ① 下滚：露出「全局」组头及其上缘发丝分隔线
    await win.webContents.executeJavaScript(`(async () => {
      const mod = await import('./views/edition-reader.js');
      const { CommandPalette } = await import('./views/command-palette.js');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i + '：纸感阅读与命令面板', summaryPreview: '摘要文本用于命令面板接入验证：期刊命令在面板中直达。', sourceTitle: '潮流周刊', publishedAt: 1758902400 + i * 86400, isRead: i % 3 === 0, readMinutes: 4, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 24 }, (_, i) => mk(i)), startIndex: 0, reduceMotion: false, onOpen: () => {}, fetchArticle: async () => '' });
      window.__er = er;
      er.present();
      await new Promise(r => setTimeout(r, 1500));
      const palette = new CommandPalette();
      const edition = er.paletteCommands();
      const global = [
        { group: '全局', label: '打开：今天', keywords: 'today 今日', icon: 'sun', action: () => {} },
        { group: '全局', label: '打开：未读', keywords: 'unread 未读', icon: 'envelopeClosed', action: () => {} },
        { group: '全局', label: '切换：浅色 / 深色主题', keywords: 'theme 主题', icon: 'appearance', action: () => {} },
        { group: '全局', label: '打开：设置', keywords: 'settings 设置', icon: 'gear', action: () => {} },
      ];
      palette.present([...edition, ...global]);
      await new Promise(r => setTimeout(r, 600));
      const list = document.querySelector('.cmd-palette-list');
      if (list) list.scrollTop = list.scrollHeight;
      await new Promise(r => setTimeout(r, 300));
      const heads = [...document.querySelectorAll('.cmd-group-head')].map((h) => h.textContent).join(',');
      return { heads, scrollTop: list ? list.scrollTop : -1, scrollH: list ? list.scrollHeight : -1 };
    })()`);
    await sleep(300);
    await shot('r21-1-groups-scrolled.png');
    // ② 组名可搜：清空滚动、输入「期刊」，应命中期刊组全部命令
    await win.webContents.executeJavaScript(`(async () => {
      const input = document.querySelector('.cmd-palette input');
      if (!input) return { err: 'no-input' };
      input.value = '期刊';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 400));
      const labels = [...document.querySelectorAll('.cmd-item .cmd-label')].map((el) => el.textContent.trim());
      const heads = [...document.querySelectorAll('.cmd-group-head')].map((h) => h.textContent).join(',');
      return { inputValue: input.value, count: labels.length, heads, labels };
    })()`);
    await sleep(300);
    await shot('r21-2-groups-search.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('SHOT-FAIL', e && e.stack || e);
    app.exit(1);
  }
});
