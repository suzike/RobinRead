'use strict';
/**
 * diag-palette-groups.js — R21 命令面板分组小节头探针（run-all OFFLINE 集）
 * 验证：带 group 的命令渲染组头（相邻同组只插一个）/ 无组命令不受影响 /
 *       组名可搜（搜「期刊」命中组内命令）/ 键盘导航计数不变（组头不参与）
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-pal-groups-')));
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
    const a = await run('groups', `
      const { CommandPalette } = await import('./views/command-palette.js');
      const cp = new CommandPalette();
      const cmds = [
        { group: '全局', label: '打开：今天', keywords: 'today', icon: 'sun', action: () => {} },
        { group: '全局', label: '打开：未读', keywords: 'unread', icon: 'envelopeClosed', action: () => {} },
        { label: '打开：设置', keywords: 'settings', icon: 'gear', action: () => {} },
        { group: '期刊', label: '期刊：下一页', keywords: 'next page', icon: 'chevronRight', action: () => {} },
        { group: '期刊', label: '期刊：上一页', keywords: 'prev page', icon: 'chevronLeft', action: () => {} },
      ];
      cp.present(cmds);
      await new Promise(r => setTimeout(r, 300));
      const heads = [...document.querySelectorAll('.cmd-group-head')].map((h) => h.textContent);
      const items = document.querySelectorAll('.cmd-item').length;
      // 键盘 ↓ 4 次（4 条命令），activeIndex 应走满 4 条且落在最后一条
      for (let i = 0; i < 4; i++) { cp._move(1); await new Promise(r => setTimeout(r, 40)); }
      const lastActive = document.querySelector('.cmd-item.active')?.dataset.index;
      const activeLabel = document.querySelector('.cmd-item.active .cmd-label')?.textContent;
      cp.dismiss();
      // 组名可搜
      cp.present(cmds);
      await new Promise(r => setTimeout(r, 200));
      const input = document.querySelector('.cmd-palette input');
      input.value = '期刊';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      const hits = document.querySelectorAll('.cmd-item').length;
      const hitHeads = [...document.querySelectorAll('.cmd-group-head')].map((h) => h.textContent);
      cp.dismiss();
      return { heads, items, lastActive, activeLabel, hits, hitHeads };
    `);
    if (a.__err) throw new Error('groups: ' + a.__err);
    ok(a.heads.join(',') === '全局,期刊', '组头按相邻组插入且不重复（' + a.heads.join(',') + '）');
    ok(a.items === 5, '命令条数不受组头影响（5 条）');
    ok(a.lastActive === '4' && a.activeLabel === '期刊：上一页', '键盘导航走满命令且跳过组头（active idx ' + a.lastActive + '）');
    ok(a.hits === 2 && a.hitHeads.join(',') === '期刊', '组名「期刊」可搜（2 条命中 + 组头）');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.message || e).slice(0, 400));
    app.exit(1);
  }
});
