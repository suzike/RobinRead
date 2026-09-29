'use strict';
/**
 * diag-edition-resume.js — R18 续读提醒探针（run-all OFFLINE 集）
 * 验证：有位置记忆时开书后 notice「已续读至上次位置 · 第 N 页」且落位正确 / 无记忆时无该 notice
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-edition-res-')));
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
    const a = await run('resume', `
      const mod = await import('./views/edition-reader.js');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要 ' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 40 }, (_, i) => mk(i)), fetchArticle: async () => '', feedKey: 'all:test' });
      window.__er = er;
      localStorage.setItem('robinread.editionPos', JSON.stringify({ 'all:test': 1 }));
      er.present(); clearTimeout(er._autoTimer); er._doOpen();
      await new Promise(r => setTimeout(r, 1600));
      const notice = document.querySelector('.er-notice');
      const noticeText = notice && !notice.hidden ? notice.textContent : '';
      const landed = er.index;
      er.dismiss();
      return { noticeText, landed, indexStart: er.startIndex };
    `);
    if (a.__err) throw new Error('resume: ' + a.__err);
    ok(a.landed === 1, '位置记忆落位（index=' + a.landed + '）');
    ok(a.noticeText.includes('续读') && a.noticeText.includes('2'), '续读提醒文案（' + a.noticeText + '）');
    const b = await run('no-resume', `
      localStorage.removeItem('robinread.editionPos');
      const mod = await import('./views/edition-reader.js');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要 ' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 40 }, (_, i) => mk(i)), fetchArticle: async () => '', feedKey: 'all:fresh' });
      window.__er = er;
      er.present(); clearTimeout(er._autoTimer); er._doOpen();
      await new Promise(r => setTimeout(r, 1600));
      const notice = document.querySelector('.er-notice');
      const hasResumeNotice = notice && !notice.hidden && notice.textContent.includes('续读');
      er.dismiss();
      return { hasResumeNotice };
    `);
    if (b.__err) throw new Error('no-resume: ' + b.__err);
    ok(!b.hasResumeNotice, '无记忆时无续读提醒');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.message || e).slice(0, 400));
    app.exit(1);
  }
});
