'use strict';
/**
 * diag-edition-paper.js — R2 纸张质感探针（run-all OFFLINE 集）
 * 验证：四态循环（paper/white/book/kraft）/ 日间写 magPaper / 夜间写 magPaperDark /
 *       夜间未设置回退日间值 / 牛皮态 CSS 变量生效（日/夜两套）
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-edition-paper-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 120 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false, width: 1600, height: 1000,
      webPreferences: { contextIsolation: true, backgroundThrottling: false },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(500);
    const run = (tag, js) => {
      console.log('PHASE ' + tag);
      return win.webContents.executeJavaScript(`(async () => { try { ${js} } catch (e) { return { __err: String(e && e.stack || e) }; } })()`);
    };
    // 日间：四态循环 + 写 magPaper + 牛皮变量
    const day = await run('day', `
      const mod = await import('./views/edition-reader.js');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要 ' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 12 }, (_, i) => mk(i)), fetchArticle: async () => '' });
      window.__er = er;
      document.body.classList.remove('dark');
      localStorage.removeItem('robinread.magPaper');
      localStorage.removeItem('robinread.magPaperDark');
      er.present();
      const ov = document.querySelector('.er-overlay');
      const btn = ov.querySelector('.er-paper');
      const seq = [];
      for (let i = 0; i < 5; i++) {
        btn.click();
        await new Promise(r => setTimeout(r, 60));
        seq.push(ov.dataset.paper);
      }
      btn.click(); // 回到 white
      await new Promise(r => setTimeout(r, 60));
      // 拨到 kraft 量变量
      while (ov.dataset.paper !== 'kraft') { btn.click(); await new Promise(r => setTimeout(r, 40)); }
      const kraftPaper = getComputedStyle(ov).getPropertyValue('--erp-paper').trim();
      const kraftMuted = getComputedStyle(ov).getPropertyValue('--erp-muted').trim();
      const chipBg = ov.querySelector('.er-paper-chip') ? ov.querySelector('.er-paper-chip').style.background : '';
      const storeDay = localStorage.getItem('robinread.magPaper');
      const storeDark = localStorage.getItem('robinread.magPaperDark');
      er.dismiss();
      return { seq, kraftPaper, kraftMuted, chipBg, storeDay, storeDark, label: btn.textContent.trim() };
    `);
    if (day.__err) throw new Error('day: ' + day.__err);
    ok(day.seq.join(',') === 'white,book,kraft,paper,white', '日间四态循环 white→book→kraft→paper→white（' + day.seq.join(',') + '）');
    ok(day.storeDay === 'kraft' && !day.storeDark, '日间切纸写 magPaper、不碰 magPaperDark（day=' + day.storeDay + ', dark=' + day.storeDark + '）');
    ok(/^#E9DCC0$/i.test(day.kraftPaper), '日间牛皮 --erp-paper #E9DCC0 生效（' + day.kraftPaper + '）');
    ok(/^#6E6047$/i.test(day.kraftMuted), '日间牛皮 muted 提深 #6E6047（' + day.kraftMuted + '）');
    ok(day.chipBg.includes('233, 220, 192') || /#E9DCC0/i.test(day.chipBg), '纸态按钮样本点为牛皮色（' + day.chipBg + '）');
    // 夜间：回退日间值 → 独立写入 → 变量换深色套
    const night = await run('night', `
      const mod = await import('./views/edition-reader.js');
      document.body.classList.add('dark');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要 ' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 12 }, (_, i) => mk(i)), fetchArticle: async () => '' });
      window.__er = er;
      er.present();
      const ov = document.querySelector('.er-overlay');
      const fallbackPaper = ov.dataset.paper;
      const btn = ov.querySelector('.er-paper');
      btn.click();
      await new Promise(r => setTimeout(r, 40)); // 先拨走（触发夜间写入），再拨回 kraft
      while (ov.dataset.paper !== 'kraft') { btn.click(); await new Promise(r => setTimeout(r, 40)); }
      const kraftDark = getComputedStyle(ov).getPropertyValue('--erp-paper').trim();
      const kraftMutedDark = getComputedStyle(ov).getPropertyValue('--erp-muted').trim();
      const chipBgDark = ov.querySelector('.er-paper-chip') ? ov.querySelector('.er-paper-chip').style.background : '';
      const storeDay = localStorage.getItem('robinread.magPaper');
      const storeDark = localStorage.getItem('robinread.magPaperDark');
      er.dismiss();
      document.body.classList.remove('dark');
      return { fallbackPaper, kraftDark, kraftMutedDark, chipBgDark, storeDay, storeDark };
    `);
    if (night.__err) throw new Error('night: ' + night.__err);
    ok(night.fallbackPaper === 'kraft', '夜间未设置时回退日间选择（' + night.fallbackPaper + '）');
    ok(night.storeDark === 'kraft' && night.storeDay === 'kraft', '夜间切纸写 magPaperDark、magPaper 不被覆盖（dark=' + night.storeDark + ', day=' + night.storeDay + '）');
    ok(/^#2E2820$/i.test(night.kraftDark), '夜间牛皮 --erp-paper #2E2820 深色套生效（' + night.kraftDark + '）');
    ok(/^#C9BFA9$/i.test(night.kraftMutedDark), '夜间牛皮 muted 提亮 #C9BFA9（' + night.kraftMutedDark + '）');
    ok(night.chipBgDark.includes('233, 220, 192') || /#E9DCC0/i.test(night.chipBgDark), '夜间样本点仍为牛皮色（' + night.chipBgDark + '）');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.message || e).slice(0, 400));
    app.exit(1);
  }
});
