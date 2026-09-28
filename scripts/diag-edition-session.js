'use strict';
/**
 * diag-edition-session.js — R15 会话阅读统计探针（run-all OFFLINE 集）
 * 验证：翻页/读文累计（面板统计行）/ dismiss 后页面级小结 toast / 无行为时无 toast
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-edition-sess-')));
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
    const a = await run('session', `
      const mod = await import('./views/edition-reader.js');
      const ARTICLE = Array.from({ length: 12 }, (_, i) => '<p>第' + (i + 1) + '段：会话统计验证段落，长度适中覆盖翻页与读文累计。</p>').join('');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要 ' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 40 }, (_, i) => mk(i)), fetchArticle: async () => ARTICLE });
      window.__er = er;
      er.present(); clearTimeout(er._autoTimer); er._doOpen();
      await new Promise(r => setTimeout(r, 1000));
      // 翻两页 + 读一篇文章
      let polls = 0;
      const goAndWait = async (idx) => { er._go(idx); for (let i = 0; i < 25; i++) { await new Promise(r => setTimeout(r, 150)); if (er.index === idx) break; } };
      await goAndWait(1);
      await goAndWait(0);
      await er._openArticle(er.items[0]);
      for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 150)); if (er.mode === 'article') break; }
      // 帮助面板统计行
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 300));
      const sess = document.querySelector('.er-keys-session')?.textContent || '';
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      // 退出 → 小结 toast
      er.dismiss();
      await new Promise(r => setTimeout(r, 500));
      const toast = document.querySelector('.er-session-toast');
      const toastText = toast ? toast.textContent : '';
      return { sess, toastText, pages: er._sessionPages, entries: er._sessionEntries ? er._sessionEntries.size : 0 };
    `);
    if (a.__err) throw new Error('session: ' + a.__err);
    ok(a.pages >= 2, '翻页累计（' + a.pages + '）');
    ok(a.entries === 1, '读文累计（' + a.entries + ' 篇）');
    ok(a.sess.includes('本次会话') && /\d/.test(a.sess), '面板统计行（' + a.sess + '）');
    ok(a.toastText.includes('本次阅读') && /\d/.test(a.toastText), '退出小结 toast（' + a.toastText + '）');
    const b = await run('no-behavior', `
      document.querySelectorAll('.er-session-toast').forEach((t) => t.remove()); // 清掉上段残留 toast
      const mod = await import('./views/edition-reader.js');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要 ' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 12 }, (_, i) => mk(i)), fetchArticle: async () => '' });
      window.__er2 = er;
      er.present(); clearTimeout(er._autoTimer); er._doOpen();
      await new Promise(r => setTimeout(r, 900));
      er.dismiss();
      await new Promise(r => setTimeout(r, 400));
      return { toast: !!document.querySelector('.er-session-toast') };
    `);
    if (b.__err) throw new Error('nob: ' + b.__err);
    ok(!b.toast, '无阅读行为时无小结 toast');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.message || e).slice(0, 400));
    app.exit(1);
  }
});
