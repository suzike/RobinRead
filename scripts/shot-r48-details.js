'use strict';
/** R48 验收截图：目录关闭滑出 + 划词弹层出场 → .tmp-shots/r48-1/2/3.png */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r48-'));
app.setPath('userData', userData);
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 180 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const win = new BrowserWindow({
      show: true, width: 1360, height: 860,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(900);
    const shot = async (name) => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(OUT, name), img.toPNG());
      console.log(`shot ${name}`);
    };
    await win.webContents.executeJavaScript(`(async () => {
      const mod = await import('./views/edition-reader.js');
      const ARTICLE = Array.from({ length: 10 }, (_, i) => '<h2>第' + (i + 1) + '节</h2><p>正文用于浮层动画收官验收。</p>').join('');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要布景。', sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 8 }, (_, i) => mk(i)), startIndex: 0, reduceMotion: false, onOpen: () => {}, fetchArticle: async () => ARTICLE });
      window.__er = er;
      er.present();
      clearTimeout(er._autoTimer);
      er._doOpen();
      await new Promise(r => setTimeout(r, 1100));
      // 目录开启（滑入完成）
      er._toggleToc(0);
      await new Promise(r => setTimeout(r, 500));
      return { toc: !!document.querySelector('.er-toc') };
    })()`);
    await sleep(200);
    await shot('r48-1-toc-open.png');
    // 关闭 → 滑出中间帧
    await win.webContents.executeJavaScript(`(() => { window.__er._toggleToc(0); })()`);
    await sleep(90); // 0.22s 动画的 ~40% 处
    await shot('r48-2-toc-closing.png');
    await sleep(500); // 移除完成
    // 划词弹层出场中间帧
    await win.webContents.executeJavaScript(`(() => {
      window.__er._presentSelBar({ text: '验收文本', rect: { x: 500, y: 300, width: 200, height: 40 }, context: '上下文' });
    })()`);
    await sleep(50); // 0.16s 动画的 ~30% 处
    await shot('r48-3-selbar-pop.png');
    await sleep(600);
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 700));
    app.exit(1);
  }
});
