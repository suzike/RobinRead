'use strict';
/**
 * diag-r48-details.js — R48 收官探针（run-all OFFLINE 集）
 * 验证：划词弹层出场动画规则在册 / 目录面板关闭滑出（.closing 类 + 延迟移除）/
 *       reduce-motion 覆盖新动画（媒体规则在册）
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r48-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 150 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false, width: 1440, height: 900,
      webPreferences: { contextIsolation: true, backgroundThrottling: false },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(600);
    const run = (tag, js) => {
      console.log('PHASE ' + tag);
      return win.webContents.executeJavaScript(`(async () => { try { ${js} } catch (e) { return { __err: String(e && e.stack || e) }; } })()`);
    };
    const a = await run('details', `
      const mod = await import('./views/edition-reader.js');
      const ARTICLE = '<h2>第1节</h2><p>正文用于 R48 收官探针。</p>';
      const mk = (i) => ({ id: 'r48-' + i, title: '条目' + i, summaryPreview: '摘要', sourceTitle: '潮流周刊', publishedAt: 1758902400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 6 }, (_, i) => mk(i)), fetchArticle: async () => ARTICLE });
      er.present();
      clearTimeout(er._autoTimer);
      er._doOpen();
      await new Promise(r => setTimeout(r, 900));
      // 目录开 → 关（.closing 滑出）→ 延迟移除
      er._toggleToc(0);
      await new Promise(r => setTimeout(r, 300));
      const openNoClosing = !!document.querySelector('.er-toc:not(.closing)');
      er._toggleToc(0);
      await new Promise(r => setTimeout(r, 80));
      const closingClass = !!document.querySelector('.er-toc.closing');
      await new Promise(r => setTimeout(r, 300));
      const removedAfter = !document.querySelector('.er-toc');
      // CSSOM：划词弹层出场动画 + reduce-motion 覆盖
      let popoverAnim = 'absent';
      let reduceCovers = false;
      for (const sheet of document.styleSheets) {
        try {
          for (const r of sheet.cssRules) {
            if (r.selectorText && r.selectorText.includes('.er-sel-popover') && (r.style.animation || '').includes('sel-popover-in')) popoverAnim = 'sel-popover-in';
            if (r.media && r.media.mediaText.includes('prefers-reduced-motion: reduce')) {
              const inner = [...r.cssRules].map((rr) => rr.selectorText || '').join(';');
              if (inner.includes('.er-sel-popover')) reduceCovers = true;
            }
          }
        } catch (_) {}
      }
      const selRules = [];
      for (const sheet of document.styleSheets) {
        try { for (const r of sheet.cssRules) { if (r.selectorText && r.selectorText.includes('sel-popover')) selRules.push(r.selectorText + ' :: anim=' + (r.style ? r.style.animationName : 'n/a')); } } catch (_) {}
      }
      return { openNoClosing, closingClass, removedAfter, popoverAnim, reduceCovers, selRules };
    `);
    if (a.__err) throw new Error('details: ' + a.__err);
    ok(a.openNoClosing, '目录开启态无 closing 类');
    ok(a.closingClass, '关闭时 .closing 滑出类挂载');
    ok(a.removedAfter, '滑出动画完成后移除（不残留）');
    ok(a.popoverAnim === 'sel-popover-in', '划词弹层出场动画规则在册（' + a.popoverAnim + '）');
    ok(a.reduceCovers, 'reduce-motion 覆盖划词弹层动画');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
