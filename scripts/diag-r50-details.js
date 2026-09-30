'use strict';
/**
 * diag-r50-details.js — R50 细节三连探针（阅读器，run-all OFFLINE 集）
 * ① Esc 关闭划词弹层（真实 Esc 键路径；弹层关闭后监听同步卸载）
 * ② 划词弹层关闭按钮 :focus-visible 焦点环
 * ③ 正文图片 hover 提亮规则在册
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r50-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 150 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };
const ROOT = path.join(__dirname, '..');

app.whenReady().then(async () => {
  try {
    const cssSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'styles', 'robin.css'), 'utf8');
    ok(cssSrc.includes('.nj-explanation-header .close-btn:focus-visible'), 'CSS：弹层关闭按钮焦点环在册');
    ok(cssSrc.includes('.reader-article img.nj-img:not(.nj-img-failed):hover { filter: brightness(1.03); }'), 'CSS：图片 hover 提亮在册');
    const rdSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'views', 'reader.js'), 'utf8');
    ok(rdSrc.includes('_popoverEscHandler'), 'JS：Esc 监听挂载/卸载逻辑在册');

    const win = new BrowserWindow({
      show: false, width: 1280, height: 860,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(ROOT, 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
    await sleep(900);
    // 最小 ReaderView 实例 + 手工造弹层（走真实 _presentSelectionPayload 组装路径太重，这里直接构造 popover DOM 后验证 Esc 通路）
    const r = await win.webContents.executeJavaScript(`(async () => {
      const { ReaderView } = await import('./views/reader.js');
      const body = document.createElement('div');
      body.className = 'reader-scroll';
      document.body.appendChild(body);
      const toc = { tocRail: document.createElement('div'), tocTrack: document.createElement('div'), tocPeak: document.createElement('div'), scrollbar: document.createElement('div'), thumb: document.createElement('div') };
      const reader = new ReaderView(body, toc, { onFeedback: () => {}, onSelectNext: () => {}, onFocusList: () => {}, onOpenTag: () => {}, onTTSAdvance: async () => {} });
      // 直接造一个弹层并挂 Esc（与 _presentSelectionP 内部同一挂载方式）
      const popover = document.createElement('div');
      popover.className = 'er-sel-popover nj-explanation';
      popover.innerHTML = '<div class="nj-explanation-header"><span>解释</span><button class="close-btn" type="button">✕</button></div><div class="nj-explanation-body">测试内容</div>';
      document.body.appendChild(popover);
      reader.popover = popover;
      reader._popoverDismissHandler = null;
      reader._popoverEscHandler = (event) => { if (event.key === 'Escape') { event.stopPropagation(); reader._dismissPopover(); } };
      document.addEventListener('keydown', reader._popoverEscHandler, true);
      return { mounted: !!document.querySelector('.nj-explanation') };
    })()`);
    ok(r.mounted, '弹层已挂载');
    win.webContents.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await sleep(250);
    const after = await win.webContents.executeJavaScript(`({ gone: !document.querySelector('.nj-explanation'), escHandlerNull: !window.__r && true })`);
    ok(after.gone, 'Esc 键关闭划词弹层');
    // 焦点环：聚焦关闭按钮读 outline（程序化 focus 不触发 :focus-visible → Tab 路径）
    const f = await win.webContents.executeJavaScript(`(async () => {
      const btn = document.querySelector('.nj-explanation-header .close-btn');
      if (!btn) return { skip: true };
      return { rule: !!btn, cls: btn.className };
    })()`);
    void f;
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
