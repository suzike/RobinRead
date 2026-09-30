'use strict';
/**
 * diag-d5-cardfull.js — R-D5 卡片导出弹窗全屏探针（run-all OFFLINE 集）
 * 验证：全屏按钮存在且点击切换 .maximized / 还原生效 / 样式规则在册
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-d5-')));
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
      const { openCardExportModal } = await import('./card-export/preview.js');
      const DATA = {
        title: '全屏验收文章标题',
        feedTitle: '潮流周刊',
        date: '2026-09-30',
        cover: null,
        kind: 'deepRead',
        content: '<h2>第一节</h2><p>占位正文，用于全屏切换验收。</p><h2>第二节</h2><p>再一段占位正文。</p>',
        words: 1200, readMin: 3,
      };
      await openCardExportModal({ data: DATA, link: 'https://example.com/a' });
      await new Promise(r => setTimeout(r, 200));
      const modal = document.querySelector('.cardx-modal');
      if (!modal) return { __err: 'no modal' };
      const fullBtn = modal.querySelector('.cardx-full');
      const before = { maximized: modal.classList.contains('maximized'), w: Math.round(modal.getBoundingClientRect().width) };
      fullBtn.click();
      await new Promise(r => setTimeout(r, 120));
      const mr = modal.getBoundingClientRect();
      const after = { maximized: modal.classList.contains('maximized'), pos: getComputedStyle(modal).position, w: Math.round(mr.width), left: Math.round(mr.left), docCW: document.documentElement.clientWidth, inline: modal.style.cssText.slice(0, 80), modalCount: document.querySelectorAll('.cardx-modal').length };
      fullBtn.click();
      await new Promise(r => setTimeout(r, 120));
      const restored = { maximized: modal.classList.contains('maximized'), w: Math.round(modal.getBoundingClientRect().width) };
      return { before, after, restored, hasBtn: !!fullBtn };
    `);
    if (a.__err) throw new Error('details: ' + a.__err);
    console.error('STATE', JSON.stringify(a.after));
    ok(a.hasBtn && !a.before.maximized, '全屏按钮存在，初始非全屏（宽 ' + a.before.w + '）');
    ok(a.after.maximized && a.after.pos === 'fixed' && a.after.w > a.before.w + 300, '点击后最大化显著变大且 fixed（' + a.before.w + ' → ' + a.after.w + '）');
    ok(a.restored.maximized === false && a.restored.w < a.after.w, '再点还原为窗口尺寸（' + a.restored.w + '）');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
