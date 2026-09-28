'use strict';
/**
 * diag-edition-keys.js — R14 快捷键速查面板探针（run-all OFFLINE 集）
 * 验证：? 呼出面板（8 行两列）/ kbd 帽渲染 / Esc 关闭 / 再次 ? 往复开合
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-edition-keys-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 120 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false, width: 1600, height: 1000,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(600);
    const run = (tag, js) => {
      console.log('PHASE ' + tag);
      return win.webContents.executeJavaScript(`(async () => { try { ${js} } catch (e) { return { __err: String(e && e.stack || e) }; } })()`);
    };
    const a = await run('keys', `
      const mod = await import('./views/edition-reader.js');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要 ' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 12 }, (_, i) => mk(i)), fetchArticle: async () => '' });
      window.__er = er;
      er.present(); clearTimeout(er._autoTimer); er._doOpen();
      await new Promise(r => setTimeout(r, 1000));
      // ? 呼出（Shift+/）
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 300));
      const panel = document.querySelector('.er-keys-panel');
      const rows = panel ? panel.querySelectorAll('.er-keys-row').length : 0;
      const kbdSample = panel?.querySelector('.er-keys-row kbd')?.textContent || '';
      const hasSearch = panel ? panel.textContent.includes('搜索') : false;
      // Esc 关闭
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      const closedByEsc = !document.querySelector('.er-keys-panel');
      // 再 ? 往复
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 200));
      const reopened = !!document.querySelector('.er-keys-panel');
      // 按钮点按关闭（面板内点击非 kbd 区域）
      document.querySelector('.er-keys-panel').click();
      await new Promise(r => setTimeout(r, 200));
      const closedByClick = !document.querySelector('.er-keys-panel');
      er.dismiss();
      return { rows, kbdSample, hasSearch, closedByEsc, reopened, closedByClick };
    `);
    if (a.__err) throw new Error('keys: ' + a.__err);
    ok(a.rows === 8, '面板 8 行快捷键（' + a.rows + '）');
    ok(a.kbdSample.length > 0, 'kbd 键帽渲染（' + a.kbdSample + '）');
    ok(a.hasSearch, '含搜索条目');
    ok(a.closedByEsc, 'Esc 关闭');
    ok(a.reopened, '再 ? 往复打开');
    ok(a.closedByClick, '面板点击关闭');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.message || e).slice(0, 400));
    app.exit(1);
  }
});
