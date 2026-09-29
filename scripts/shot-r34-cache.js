'use strict';
/** R34 验收截图：重排缓存命中后重开文章（视觉零回归）→ .tmp-shots/r34-1-cache-hit.png */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r34-'));
app.setPath('userData', userData);
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 180 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const win = new BrowserWindow({
      show: true, width: 1600, height: 1000,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(800);
    const shot = async (name) => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(OUT, name), img.toPNG());
      console.log(`shot ${name}`);
    };
    const info = await win.webContents.executeJavaScript(`(async () => {
      const mod = await import('./views/edition-reader.js');
      const ARTICLE = Array.from({ length: 12 }, (_, i) => '<h2>第' + (i + 1) + '节 · 重排缓存</h2><p>这段正文在缓存命中后重开，版面必须与首次装箱逐块一致：标题层级、段距、页码、目录锚点全部保持。</p>').join('');
      const IMG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='800' height='450'><rect width='800' height='450' fill='#B9C2B0'/></svg>");
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i + '：重排缓存验收', summaryPreview: '摘要布景。', sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: i === 0 ? '<p><img src="' + IMG + '"></p>' : '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 24 }, (_, i) => mk(i)), startIndex: 0, reduceMotion: false, onOpen: () => {}, fetchArticle: async () => ARTICLE });
      window.__er = er;
      er.present();
      clearTimeout(er._autoTimer);
      er._doOpen();
      await new Promise(r => setTimeout(r, 1200));
      await er._openArticle(er.items[0]);
      await new Promise(r => setTimeout(r, 1200));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 700));
      await er._openArticle(er.items[0]); // 二次打开：缓存命中
      await new Promise(r => setTimeout(r, 1000));
      const deltas = [...document.querySelectorAll('.er-sheet .er-in')].map((el) => el.scrollHeight - el.clientHeight);
      const conserved = (document.querySelector('.er-sheet .er-in')?.textContent || '').includes('全部保持不丢');
      return { size: (er._layoutCache || new Map()).size, deltas, conserved };
    })()`);
    console.log('cache:', JSON.stringify(info));
    await sleep(250);
    await shot('r34-1-cache-hit.png');
    await win.webContents.executeJavaScript(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); })()`);
    await sleep(900);
    // 真实右方向键翻页：触发 _syncRail 让「本期约剩 N 分钟 1/N」自然出现（R35 打回补拍）
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right', windowsVirtualKeyCode: 39 });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right', windowsVirtualKeyCode: 39 });
    await sleep(1100);
    await shot('r35-1-tools-bottom.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('SHOT-FAIL', e && e.stack || e);
    app.exit(1);
  }
});
