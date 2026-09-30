'use strict';
/** 诊断：逐个 import reader 依赖链，定位模块级 parentElement TypeError */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-impdiag-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 120 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 1200, height: 800,
    webPreferences: { contextIsolation: true, backgroundThrottling: false },
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await sleep(600);
  const mods = ['./i18n.js', './icons.js', './list.js', '../markdown.js', './context-menu.js', './cjk-micro.js', './article-search.js', '../card-export/parse.js', '../card-export/preview.js', './views/reader.js'];
  for (const m of mods) {
    const res = await win.webContents.executeJavaScript(`(async () => { try { await import('${m}'); return 'ok'; } catch (e) { return 'THROW: ' + (e && e.stack ? e.stack.split('\\n').slice(0, 3).join(' | ') : e); } })()`);
    console.log(m, '=>', String(res).slice(0, 220));
  }
  app.exit(0);
});
