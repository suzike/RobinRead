'use strict';
/**
 * diag-edition-progress.js — R4 阅读进度与剩余时间探针（run-all OFFLINE 集）
 * 验证：滑轨 .er-count 显示「约剩 N 分钟 · P/T」且随翻页递减 / 末页「已读完」/
 *       文章模式进度线右端 .er-remain-tip 存在且随页递减 / 进度线宽度单调增
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-edition-prog-')));
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
    const a = await run('edition-rail', `
      const mod = await import('./views/edition-reader.js');
      const ARTICLE = Array.from({ length: 24 }, (_, i) => '<p>第' + (i + 1) + '段：用于文章剩余时间估算的正文段落，长度约百字，覆盖估算链路与随页递减的验证需求，纸感阅读把散落的订阅还原成一个安静的阅读空间。</p>').join('');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要文本用于剩余时间估算验证，长度适中。' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, readMinutes: 5, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 40 }, (_, i) => mk(i)), fetchArticle: async () => ARTICLE });
      window.__er = er;
      er.present();
      clearTimeout(er._autoTimer);
      er._doOpen();
      await new Promise(r => setTimeout(r, 900));
      const readCount = () => {
        const c = document.querySelector('.er-count');
        return { hidden: c.hidden, text: c.textContent.replace(/\\s+/g, ' ').trim() };
      };
      const s1 = readCount();
      er._go(1);
      await new Promise(r => setTimeout(r, 1300));
      const s2 = readCount();
      er._go(er.pages.length - 1);
      await new Promise(r => setTimeout(r, 1300));
      const sLast = readCount();
      const total = er.pages.length;
      const remainOf = (s) => { const m = s.text.match(/约剩 (\\d+) 分钟/); return m ? Number(m[1]) : null; };
      return { total, s1, s2, sLast, r1: remainOf(s1), r2: remainOf(s2), rLast: remainOf(sLast) };
    `);
    if (a.__err) throw new Error('rail: ' + a.__err);
    ok(!a.s1.hidden && a.s1.text.includes('分钟') && a.s1.text.includes(' / '), '滑轨显示 剩余分钟 + 页码（' + a.s1.text + '）');
    ok(a.r1 !== null && a.r1 > 0 && a.sLast.text.includes('已读完') && a.sLast.text.includes(String(a.total) + ' / ' + String(a.total)), '剩余分钟有值且末页归零显示已读完（' + a.r1 + ' → ' + a.sLast.text + '）');
    ok(a.sLast.text.includes('已读完'), '末页显示已读完（' + a.sLast.text + '）');
    const b = await run('article-tip', `
      const er = window.__er;
      er._go(0);
      await new Promise(r => setTimeout(r, 1300));
      const firstCard = document.querySelector('.er-sheet[data-role="a"] .er-place') || document.querySelector('.er-place');
      firstCard.click();
      await new Promise(r => setTimeout(r, 1200));
      const readTip = () => {
        const tip = document.querySelector('.er-remain-tip');
        const line = document.querySelector('.er-article-progress i');
        return { tip: tip ? tip.textContent.trim() : null, w: line ? parseFloat(line.style.width) : null };
      };
      const t1 = readTip();
      er._go(1);
      await new Promise(r => setTimeout(r, 1300));
      const t2 = readTip();
      const remainOf = (t) => { const m = (t.tip || '').match(/约剩 (\\d+) 分钟/); return m ? Number(m[1]) : null; };
      return { pages: er.pages.length, t1, t2, a1: remainOf(t1), a2: remainOf(t2) };
    `);
    if (b.__err) throw new Error('tip: ' + b.__err);
    ok(b.t1.tip && b.t1.tip.includes('分钟'), '文章进度线右端剩余时间存在（' + b.t1.tip + '）');
    ok(b.a1 !== null && b.a1 > 0 && (b.a2 === null ? b.t2.tip.includes('已读完') : b.a1 >= b.a2), '文章剩余时间随页递减至已读完（' + b.t1.tip + ' → ' + b.t2.tip + '）');
    ok(b.t2.w > b.t1.w, '进度线宽度随页推进（' + b.t1.w + '% → ' + b.t2.w + '%）');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.message || e).slice(0, 400));
    app.exit(1);
  }
});
