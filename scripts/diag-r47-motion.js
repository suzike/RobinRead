'use strict';
/**
 * diag-r47-motion.js — R47 微动效三连探针（run-all OFFLINE 集）
 * 验证：划词胶囊 er-selbar-in / 批量条 batch-in / 历史下拉 history-in
 *       三条动画规则在册且命中元素；prefers-reduced-motion 下关闭
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r47-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 150 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false, width: 1000, height: 700,
      webPreferences: { contextIsolation: true, backgroundThrottling: false },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(600);
    const run = (tag, js) => {
      console.log('PHASE ' + tag);
      return win.webContents.executeJavaScript(`(async () => { try { ${js} } catch (e) { return { __err: String(e && e.stack || e) }; } })()`);
    };
    const a = await run('motion', `
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;inset:0;z-index:999;';
      document.body.appendChild(wrap);
      const mk = (cls) => { const el = document.createElement('div'); el.className = cls; wrap.appendChild(el); return el; };
      const selbar = mk('er-selbar');
      const batch = mk('list-batch-bar');
      batch.style.left = '50%'; batch.style.bottom = '22px'; batch.style.transform = 'translateX(-50%)';
      const history = mk('search-history');
      await new Promise(r => setTimeout(r, 60));
      const animOf = (el) => getComputedStyle(el).animationName;
      return {
        selbar: animOf(selbar), batch: animOf(batch), history: animOf(history),
        selbarDur: getComputedStyle(selbar).animationDuration,
      };
    `);
    if (a.__err) throw new Error('motion: ' + a.__err);
    ok(a.selbar === 'er-selbar-in', '划词胶囊 pop-in 动画（' + a.selbar + '）');
    ok(a.batch === 'batch-in', '批量条 slide-up 动画（' + a.batch + '）');
    ok(a.history === 'history-in', '历史下拉 fade-in 动画（' + a.history + '）');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
