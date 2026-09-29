'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-search-dbg-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 90 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false, width: 1440, height: 900,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    let s = null;
    for (let i = 0; i < 30 && !s; i += 1) { await sleep(300); s = await win.webContents.executeJavaScript(`!!document.querySelector('.list-search')`); }
    await sleep(600);
    const res = await win.webContents.executeJavaScript(`(() => {
      const s = document.querySelector('.list-search');
      if (!s) return { none: true };
      const cs = getComputedStyle(s);
      const r = s.getBoundingClientRect();
      const inset = document.querySelector('.list-top-inset');
      const ir = inset ? inset.getBoundingClientRect() : { right: 0, width: 0 };
      const ics = inset ? getComputedStyle(inset) : null;
      return { marginRight: cs.marginRight, rectRight: Math.round(r.right), rectW: Math.round(r.width),
        insetRight: Math.round(ir.right), insetPadR: ics ? ics.paddingRight : null, insetW: Math.round(ir.width),
        parentOverflow: s.parentElement ? getComputedStyle(s.parentElement).overflow : null };
    })()`);
    console.log(JSON.stringify(res));
    app.exit(0);
  } catch (e) { console.error('DBG-FAIL', e && e.stack || e); app.exit(1); }
});
