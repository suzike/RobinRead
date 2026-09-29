'use strict';
/**
 * diag-edition-focus.js — R19 段落聚焦探针（run-all OFFLINE 集）
 * 验证：P 开启聚焦（overlay 类 + 首段聚焦类）/ 点击第二段迁移 / ↓↑ 换段 /
 *       翻页后新页重聚焦 / P 关闭清除 / 版面态 P 提示
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-edition-focus-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 150 * 1000).unref();
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
    const a = await run('focus', `
      const mod = await import('./views/edition-reader.js');
      const PARA = '段落内容用于段落聚焦模式验证：纸感阅读的关键不在于仿旧，而在于把注意力还给文字本身。';
      const ARTICLE = ('<h2>第一章</h2><p>' + PARA + '</p><p>' + PARA + '其二。</p><p>' + PARA + '其三。</p><p>' + PARA + '其四。</p>').repeat(4);
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要 ' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 12 }, (_, i) => mk(i)), fetchArticle: async () => ARTICLE });
      window.__er = er;
      er.present(); clearTimeout(er._autoTimer); er._doOpen();
      await new Promise(r => setTimeout(r, 1000));
      // 版面态 P → 提示
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 200));
      const editionHint = document.querySelector('.er-notice').textContent;
      // 进文章开聚焦
      await er._openArticle(er.items[0]);
      for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 150)); if (er.mode === 'article') break; }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 300));
      const focusOn = document.querySelector('.er-overlay').classList.contains('er-focus');
      const focused0 = document.querySelector('.er-article > .er-blk-focus');
      const idx0 = [...document.querySelectorAll('.er-article > *')].indexOf(focused0);
      // ↓ 两段
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      const blocks = [...document.querySelectorAll('.er-article > *')];
      const idx2 = blocks.indexOf(document.querySelector('.er-article > .er-blk-focus'));
      const dimmed = blocks.filter((b) => b !== focused0 && getComputedStyle(b).opacity !== '').length;
      // 翻页重聚焦
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
      for (let i = 0; i < 25; i++) { await new Promise(r => setTimeout(r, 150)); if (er.index === 1) break; }
      await new Promise(r => setTimeout(r, 400));
      const focusedNew = document.querySelector('.er-article > .er-blk-focus');
      const hasFocusNew = !!focusedNew && focusedNew.closest('.er-article') !== null;
      // P 关闭清除
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 200));
      const classOff = !document.querySelector('.er-overlay').classList.contains('er-focus');
      const residue = document.querySelectorAll('.er-blk-focus').length;
      er.dismiss();
      return { editionHint, focusOn, idx0, idx2, dimmed, hasFocusNew, classOff, residue };
    `);
    if (a.__err) throw new Error('focus: ' + a.__err);
    ok(a.editionHint.includes('文章模式'), '版面态 P 提示（' + a.editionHint + '）');
    ok(a.focusOn && a.idx0 === 0, 'P 开启聚焦（首段 idx ' + a.idx0 + '）');
    ok(a.idx2 === 2, '↓ 两段迁移（idx ' + a.idx2 + '）');
    ok(a.dimmed >= 1, '非聚焦段降透明生效');
    ok(a.hasFocusNew, '翻页后新页重聚焦');
    ok(a.classOff && a.residue === 0, 'P 关闭清除（类清 ' + a.classOff + '，残留 ' + a.residue + '）');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.message || e).slice(0, 400));
    app.exit(1);
  }
});
