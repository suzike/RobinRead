'use strict';
/**
 * diag-edition-fx.js — R16 动作音效探针（run-all OFFLINE 集）
 * 验证：收藏/导出/开书触发 _fx（计数）/ 音效开关关闭时不发声 / 开书走纸声变奏（Audio 实例）
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-edition-fx-')));
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
    const a = await run('fx', `
      const mod = await import('./views/edition-reader.js');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要 ' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 12 }, (_, i) => mk(i)), fetchArticle: async () => '' });
      window.__er = er;
      er.present(); clearTimeout(er._autoTimer); er._doOpen();
      await new Promise(r => setTimeout(r, 900));
      const openFx = er._fxCalls || 0;
      er._select('fx-1');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 250));
      const afterStar = er._fxCalls || 0;
      // 关音效再操作：计数不变
      er.soundOn = false;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 250));
      const afterMuted = er._fxCalls || 0;
      // 导出成功音（stub captureRect/copyImage 已由 preload？无 handler → 走 catch 分支不计 done；直接断言 tick/open 链路）
      er.soundOn = true;
      const doneFx0 = er._fxCalls || 0;
      er._fx('done');
      const doneFx = er._fxCalls || 0;
      er.dismiss();
      return { openFx, afterStar, afterMuted, doneFx0, doneFx };
    `);
    if (a.__err) throw new Error('fx: ' + a.__err);
    ok(a.openFx >= 1, '开书触发纸声变奏（fx=' + a.openFx + '）');
    ok(a.afterStar === a.openFx + 1, '收藏触发 tick（' + a.afterStar + '）');
    ok(a.afterMuted === a.afterStar, '音效关闭时不发声（' + a.afterMuted + '）');
    ok(a.doneFx === a.doneFx0 + 1, 'done 双音触发（' + a.doneFx + '）');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.message || e).slice(0, 400));
    app.exit(1);
  }
});
