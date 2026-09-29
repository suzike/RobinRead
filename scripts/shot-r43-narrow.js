'use strict';
/** R43 验收截图：900px 窄窗期刊（进度文字让位+工具条胶囊无重叠）→ .tmp-shots/r43-1-narrow.png */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r43-'));
app.setPath('userData', userData);
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 180 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const win = new BrowserWindow({
      show: true, width: 900, height: 860,
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
      const ARTICLE = Array.from({ length: 14 }, (_, i) => '<h2>第' + (i + 1) + '节</h2><p>段落内容用于窄窗版面验收：进度文字让位后工具条胶囊与滑轨互不重叠。</p>').join('');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i + '：窄窗版面', summaryPreview: '摘要布景。', sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 12 }, (_, i) => mk(i)), startIndex: 0, reduceMotion: false, onOpen: () => {}, fetchArticle: async () => ARTICLE });
      window.__er = er;
      er.present();
      clearTimeout(er._autoTimer);
      er._doOpen();
      await new Promise(r => setTimeout(r, 1400));
      // 翻一页触发滑轨计数同步
      er._go(1);
      await new Promise(r => setTimeout(r, 1100));
      const countEl = document.querySelector('.er-rail .er-count');
      const tools = document.querySelector('.er-tools');
      const cntR = countEl ? countEl.getBoundingClientRect() : null;
      const tR = tools ? tools.getBoundingClientRect() : null;
      const overlap = cntR && tR && !(tR.left > cntR.right || tR.right < cntR.left || tR.bottom < cntR.top || tR.top > cntR.bottom);
      return { cntDisplay: countEl ? getComputedStyle(countEl).display : 'absent', overlap: !!overlap };
    })()`);
    await sleep(250);
    await shot('r43-1-narrow.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 700));
    app.exit(1);
  }
});
