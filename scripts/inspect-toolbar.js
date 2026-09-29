'use strict';
/** 勘察：list-top-inset 真实结构与各子项计算样式（R31 工具栏精修底账） */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-inspect-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 120 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false, width: 380, height: 900, // 窄栏复现用户截图的折行场景
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(900);
    const out = await win.webContents.executeJavaScript(`(async () => {
      const { ListView } = await import('./views/list.js');
      const host = document.createElement('div');
      host.className = 'list-scroll';
      host.style.cssText = 'height:100%;';
      document.body.appendChild(host);
      const lv = new ListView(host, { onSelect: () => {}, onContext: () => {}, onLoadMore: () => {}, onSearch: () => {} });
      lv.setViewMode('list');
      lv.setSortButton('unreadFirst');
      lv.render([], { kind: 'today' }, null, true);
      lv.topInset.querySelector('.list-top-title').textContent = '今天';
      await new Promise(r => setTimeout(r, 200));
      const inset = lv.topInset;
      const dump = (el) => {
        const cs = getComputedStyle(el);
        return {
          tag: el.tagName.toLowerCase(), id: el.id, cls: el.className,
          display: cs.display, h: cs.height, pad: cs.padding, margin: cs.margin,
          bg: cs.backgroundColor, border: cs.border, radius: cs.borderRadius,
          color: cs.color, font: cs.fontSize + '/' + cs.fontWeight, wrap: cs.flexWrap,
        };
      };
      return {
        inset: dump(inset),
        children: [...inset.children].map(dump),
        html: inset.innerHTML.slice(0, 600),
      };
    })()`);
    console.log(JSON.stringify(out, null, 1).slice(0, 3600));
    app.exit(0);
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 500));
    app.exit(1);
  }
});
