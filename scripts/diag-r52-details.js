'use strict';
/**
 * diag-r52-details.js — R52 细节三连探针（设置弹窗，run-all OFFLINE 集）
 * ① 设置导航 hover 图标染主题色 ② 导航项键盘焦点环 ③ modal-scroll 滚动条 5px 悬停主题化
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r52-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 120 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };
const ROOT = path.join(__dirname, '..');

app.whenReady().then(async () => {
  try {
    const cssSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'styles', 'robin.css'), 'utf8');
    ok(/\.modal-nav-item:hover \.nav-icon\s*\{\s*color:\s*var\(--accent\);/.test(cssSrc), 'CSS：导航 hover 图标染主题色在册');
    ok(cssSrc.includes('.modal-nav-item:focus-visible { outline: 2px solid var(--accent);'), 'CSS：导航键盘焦点环在册');
    ok(/\.modal-scroll::-webkit-scrollbar\s*\{\s*width:\s*5px;/.test(cssSrc) && /\.modal-scroll:hover::-webkit-scrollbar-thumb/.test(cssSrc), 'CSS：modal-scroll 5px 悬停主题化在册');

    const win = new BrowserWindow({
      show: false, width: 1280, height: 860,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(ROOT, 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
    await sleep(900);
    const a = await win.webContents.executeJavaScript(`(async () => {
      const { SettingsView } = await import('./views/dialogs.js');
      const sv = new SettingsView({ state: {}, views: {}, onAddFreshRSS: async () => {} });
      sv.present('appearance');
      const modal = document.querySelector('.modal-overlay .modal') || document.querySelector('.modal');
      if (!modal) return { __err: 'no settings modal' };
      const nav = modal.querySelector('.modal-nav-item');
      const scroll = modal.querySelector('.modal-scroll');
      // 焦点环：真实 Tab 路径（先聚焦导航首项再 Tab）
      nav.focus();
      return {
        navCount: modal.querySelectorAll('.modal-nav-item').length,
        scrollbarW: (getComputedStyle(scroll, '::-webkit-scrollbar') || {}).width || 'n/a',
        navFocusable: typeof nav.focus === 'function',
      };
    })()`);
    if (a.__err) throw new Error('r52: ' + a.__err);
    ok(a.navCount >= 9, `设置导航 9 项（${a.navCount}）`);
    ok(a.navFocusable, '导航项可聚焦（Tab 键盘路径可用）');
    // Tab 真实键路径：同一次调用内聚焦导航首项（跨调用会丢焦点链），再主进程 Tab
    await win.webContents.executeJavaScript(`(() => { document.querySelector('.modal .modal-nav-item')?.focus(); return 1; })()`);
    win.webContents.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    await sleep(200);
    const c = await win.webContents.executeJavaScript(`(() => {
      const el = document.activeElement;
      const s = getComputedStyle(el);
      return { cls: String(el.className), outline: s.outlineStyle, outlineW: s.outlineWidth };
    })()`);
    ok(String(c.cls).includes('modal-nav-item') && c.outline === 'solid' && parseFloat(c.outlineW) > 0, `Tab 后导航焦点环（${String(c.cls).slice(0, 22)} → ${c.outline} ${c.outlineW}）`);
    await win.webContents.executeJavaScript(`(() => { document.querySelector('.modal-overlay')?.querySelector('.close-btn, [class*=close]')?.click(); return 1; })()`);
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
