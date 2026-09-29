'use strict';
/** R32 验收截图：命令面板真 ↓ 键导航 active 态 → .tmp-shots/r32-1-palette-move.png */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r32-'));
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
    await win.webContents.executeJavaScript(`(async () => {
      const { CommandPalette } = await import('./views/command-palette.js');
      const cp = new CommandPalette();
      window.__cp = cp;
      cp.present(Array.from({ length: 9 }, (_, i) => ({ label: '示例命令 ' + (i + 1) + '：面板导航验收', keywords: 'cmd', icon: 'gear', action: () => {} })));
      await new Promise(r => setTimeout(r, 500));
      return { ok: 1 };
    })()`);
    const tap = (kc, vk) => {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: kc, windowsVirtualKeyCode: vk });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: kc, windowsVirtualKeyCode: vk });
    };
    tap('Down', 40); await sleep(150);
    tap('Down', 40); await sleep(150);
    tap('Down', 40); await sleep(150);
    tap('Down', 40); await sleep(350);
    await shot('r32-1-palette-move.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('SHOT-FAIL', e && e.stack || e);
    app.exit(1);
  }
});
