'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-pal-real-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 90 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: true, width: 1440, height: 900,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(800);
    const r1 = await win.webContents.executeJavaScript(`(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'P', ctrlKey: true, shiftKey: true, bubbles: true }));
      await new Promise(r => setTimeout(r, 600));
      const overlay = document.querySelector('.cmd-palette-overlay');
      const cs = overlay ? getComputedStyle(overlay) : null;
      return { on: !!overlay, z: cs ? cs.zIndex : null, opacity: cs ? cs.opacity : null,
        vis: cs ? cs.visibility : null, anim: cs ? cs.animationName : null,
        input: !!document.querySelector('.cmd-palette input') };
    })()`);
    console.log('REAL1 ' + JSON.stringify(r1));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, '..', '.tmp-shots', 'pal-real.png'), img.toPNG());
    app.exit(0);
  } catch (e) { console.error('DBG-FAIL', e && e.stack || e); app.exit(1); }
});
