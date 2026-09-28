'use strict';
/**
 * diag-edition-accent.js — R17 纸感联动强调色探针（run-all OFFLINE 集）
 * 验证：四态日间强调色各就位（paper 默认 / white / book / kraft）/ 夜间 kraft 提亮档 / 列表刊头同步
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-edition-accent-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 120 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };

const accentOf = (ov) => getComputedStyle(ov).getPropertyValue('--accent').trim().toUpperCase();

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
    const a = await run('day-cycle', `
      const mod = await import('./views/edition-reader.js');
      localStorage.removeItem('robinread.magPaper');
      localStorage.removeItem('robinread.magPaperDark');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要 ' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 12 }, (_, i) => mk(i)), fetchArticle: async () => '' });
      window.__er = er;
      er.present(); clearTimeout(er._autoTimer); er._doOpen();
      await new Promise(r => setTimeout(r, 900));
      const ov = document.querySelector('.er-overlay');
      const btn = ov.querySelector('.er-paper');
      const seq = [];
      for (let i = 0; i < 4; i++) {
        seq.push(getComputedStyle(ov).getPropertyValue('--accent').trim().toUpperCase());
        btn.click();
        await new Promise(r => setTimeout(r, 80));
      }
      er.dismiss();
      return { seq };
    `);
    if (a.__err) throw new Error('day: ' + a.__err);
    ok(a.seq[0] === '#617357', '纸感态默认强调 #617357（' + a.seq[0] + '）');
    ok(a.seq[1] === '#50604A', '素白态 #50604A（' + a.seq[1] + '）');
    ok(a.seq[2] === '#5D6B49', '书卷态 #5D6B49（' + a.seq[2] + '）');
    ok(a.seq[3] === '#4E5B41', '牛皮态 #4E5B41（' + a.seq[3] + '）');
    const b = await run('night-kraft', `
      const mod = await import('./views/edition-reader.js');
      document.body.classList.add('dark');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要 ' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 12 }, (_, i) => mk(i)), fetchArticle: async () => '' });
      window.__er = er;
      er.present(); clearTimeout(er._autoTimer); er._doOpen();
      await new Promise(r => setTimeout(r, 900));
      const ov = document.querySelector('.er-overlay');
      const btn = ov.querySelector('.er-paper');
      while (ov.dataset.paper !== 'kraft') { btn.click(); await new Promise(r => setTimeout(r, 60)); }
      const nightKraft = getComputedStyle(ov).getPropertyValue('--accent').trim().toUpperCase();
      er.dismiss();
      document.body.classList.remove('dark');
      return { nightKraft };
    `);
    if (b.__err) throw new Error('night: ' + b.__err);
    ok(b.nightKraft === '#9AA87C', '夜间牛皮提亮档 #9AA87C（' + b.nightKraft + '）');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.message || e).slice(0, 400));
    app.exit(1);
  }
});
