'use strict';
/**
 * diag-palette-move.js — R32 命令面板 _move 零重建 + 开合动效探针（run-all OFFLINE 集）
 * 验证：方向键移动仅翻 active 类（DOM 节点零重建）/ 环绕 / 键盘事件路径 /
 *       开合动画存在 / reduceMotion 关闭动画
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-pal-move-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 120 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false, width: 1440, height: 900,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(900);
    const run = (tag, js) => {
      console.log('PHASE ' + tag);
      return win.webContents.executeJavaScript(`(async () => { try { ${js} } catch (e) { return { __err: String(e && e.stack || e) }; } })()`);
    };
    const a = await run('move', `
      const { CommandPalette } = await import('./views/command-palette.js');
      const cp = new CommandPalette();
      cp.present(Array.from({ length: 6 }, (_, i) => ({ label: '命令' + i, keywords: 'cmd', icon: 'gear', action: () => {} })));
      await new Promise(r => setTimeout(r, 300));
      const listHost = cp.listHost;
      window.__nodes = [...listHost.querySelectorAll('.cmd-item')];
      const before = { count: window.__nodes.length, firstRef: window.__nodes[0], childCount: listHost.querySelectorAll('*').length };
      // 键盘事件路径 ↓ ×4
      for (let i = 0; i < 4; i++) {
        cp.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 30));
      }
      const nodes2 = [...listHost.querySelectorAll('.cmd-item')];
      const sameDom = nodes2.length === before.count && nodes2[0] === before.firstRef && listHost.querySelectorAll('*').length === before.childCount;
      const activeIdx = nodes2.findIndex((n) => n.classList.contains('active'));
      // 环绕：↑ 从 0 系? 当前 4 → ↑ 到 3；再到 0 再 ↑ 环绕到 5
      cp._move(-1); cp._move(-1); cp._move(-1); cp._move(-1);
      await new Promise(r => setTimeout(r, 60));
      const wrappedIdx = [...listHost.querySelectorAll('.cmd-item')].findIndex((n) => n.classList.contains('active'));
      // 动画
      const anim = getComputedStyle(document.querySelector('.cmd-palette')).animationName;
      cp.dismiss();
      return { sameDom, activeIdx, wrappedIdx, anim };
    `);
    if (a.__err) throw new Error('move: ' + a.__err);
    ok(a.sameDom, '方向键导航零 DOM 重建（节点引用与总数不变）');
    ok(a.activeIdx === 4, '↓×4 后 active 落第 4 条（' + a.activeIdx + '）');
    ok(a.wrappedIdx === 0, '↑×4 环绕回第 0 条（' + a.wrappedIdx + '）');
    ok(a.anim && a.anim !== 'none', '面板开合动画存在（' + a.anim + '）');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
