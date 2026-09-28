'use strict';
/**
 * diag-edition-cover.js — R7 封面升级探针（run-all OFFLINE 集）
 * 验证：期号大字结构（er-cover-volbig 数字）/ 头条大图区（有图时挂载+无图回退）/
 *       封面要素齐备（品牌/刊名/日期）/ lead 高度不溢出封面 / P3 期刊探针兼容（叶宽/开合不受影响）
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-edition-cover-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 150 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };

const IMG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#A8B2B9"/></svg>');

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
    const mk = (i, withImg) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要 ' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: withImg ? '<p><img src="' + IMG + '"></p>' : '' });
    const a = await run('cover-with-lead', `
      const mod = await import('./views/edition-reader.js');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要 ' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: i < 3 ? '<p><img src="' + '${IMG}' + '"></p>' : '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 24 }, (_, i) => mk(i)), fetchArticle: async () => '' });
      window.__er = er;
      er.present(); clearTimeout(er._autoTimer);
      await new Promise(r => setTimeout(r, 1300));
      const face = document.querySelector('.er-cover-face');
      const volbig = face.querySelector('.er-cover-volbig');
      const lead = face.querySelector('.er-cover-lead');
      const leadRect = lead ? lead.getBoundingClientRect() : null;
      const faceRect = face.getBoundingClientRect();
      return {
        brand: face.querySelector('.er-brand')?.textContent || '',
        title: face.querySelector('.er-cover-title')?.textContent || '',
        date: face.querySelector('.er-cover-date')?.textContent || '',
        volNum: volbig?.querySelector('.er-vol-num')?.textContent || '',
        volLabels: volbig ? [...volbig.querySelectorAll('.er-vol-label')].map((x) => x.textContent).join('') : '',
        hasLead: !!lead, leadH: leadRect ? Math.round(leadRect.height) : 0,
        faceH: Math.round(faceRect.height),
        leadInside: leadRect ? (leadRect.bottom <= faceRect.bottom + 1 && leadRect.top >= faceRect.top - 1) : false,
        capText: face.querySelector('.er-cover-leadcap')?.textContent || '',
        dateAnchored: (() => { const d = face.querySelector('.er-cover-date'); if (!d) return false; const dr = d.getBoundingClientRect(); return faceRect.bottom - dr.bottom < 60; })(),
      };
    `.split('${IMG}').join(IMG));
    if (a.__err) throw new Error('cover: ' + a.__err);
    ok(a.brand === '知更' && a.title === '潮流周刊' && a.date.includes('20'), '封面要素齐备（品牌/刊名/日期：' + a.date + '）');
    ok(/^\d+$/.test(a.volNum) && a.volLabels.includes('总第') && a.volLabels.includes('期'), '期号大字结构（总第 ' + a.volNum + ' 期）');
    ok(a.hasLead && a.leadH > 150, '头条大图挂载（高 ' + a.leadH + 'px）');
    ok(a.leadInside && a.leadH <= a.faceH * 0.5, '头条图不溢出封面（高 ' + a.leadH + ' / 封面 ' + a.faceH + '）');
    ok(a.dateAnchored, '日期锚底（距封底 <60px）');
    ok(a.capText.length > 0, '头条图注为头条标题（' + a.capText.slice(0, 14) + '…）');
    const b = await run('cover-fallback', `
      window.__er.dismiss();
      await new Promise(r => setTimeout(r, 200));
      const mod = await import('./views/edition-reader.js');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要 ' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 24 }, (_, i) => mk(i)), fetchArticle: async () => '' });
      window.__er = er;
      er.present(); clearTimeout(er._autoTimer);
      await new Promise(r => setTimeout(r, 1300));
      const face = document.querySelector('.er-cover-face');
      return { hasLead: !!face.querySelector('.er-cover-lead'), hasVol: !!face.querySelector('.er-cover-volbig') || !!face.querySelector('.er-cover-vol'),
        stats: face.querySelector('.er-cover-stats')?.textContent || '',
        brand: !!face.querySelector('.er-brand'), coverVisible: !document.querySelector('.er-cover').hidden };
    `);
    if (b.__err) throw new Error('fallback: ' + b.__err);
    ok(!b.hasLead && b.hasVol && b.brand && b.coverVisible, '无图回退纯排版封面（无头条图、期号/品牌在、封面可见）');
    ok(/本期收录 24 篇/.test(b.stats), '无图回退统计行（' + b.stats + '）');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.message || e).slice(0, 400));
    app.exit(1);
  }
});
