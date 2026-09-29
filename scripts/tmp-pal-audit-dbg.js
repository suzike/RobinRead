'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-pal-audit-dbg-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 120 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    const userData = app.getPath('userData');
    const { registerIPCHandlers } = require('../src/main/ipc');
    const { AppStore } = require('../src/main/AppStore');
    const store = new AppStore(userData);
    const win = new BrowserWindow({
      show: false, width: 1440, height: 900,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') },
    });
    registerIPCHandlers(store, win);
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(800);
    await win.webContents.executeJavaScript(`(async () => {
      await window.robin.setReaderLayout({ listViewMode: 'magazine', fontFamily: 'wenkai', titleFont: 'smiley', paraStyle: 'indent', dropCap: 'on' });
      return true;
    })()`);
    let coverOk = false;
    for (let i = 0; i < 24 && !coverOk; i += 1) { await sleep(500); coverOk = (await win.webContents.executeJavaScript(`return !!document.querySelector('.nj-edition-cover')`)) === true; }
    await sleep(1500);
    // 复刻 audit：dispatch → 轮询
    await win.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'P', ctrlKey: true, shiftKey: true, bubbles: true })); 1`);
    let palOk = false;
    for (let i = 0; i < 10 && !palOk; i += 1) {
      await sleep(300);
      palOk = (await win.webContents.executeJavaScript(`return !!document.querySelector('.cmd-palette-overlay')`)) === true;
      if (!palOk) await win.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'P', ctrlKey: true, shiftKey: true, bubbles: true })); 1`);
    }
    const state = await win.webContents.executeJavaScript(`(() => {
      const ov = document.querySelector('.cmd-palette-overlay');
      return { exists: !!ov };
    })()`);
    console.log('STATE ' + JSON.stringify(state));
    app.exit(0);
  } catch (e) { console.error('DBG-FAIL', e && e.stack || e); app.exit(1); }
});
