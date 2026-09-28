'use strict';
/**
 * diag-edition-toc.js — R8 滑轨分段 + 目录树状探针（run-all OFFLINE 集）
 * 验证：滑轨 feature 页前出现 er-tick-sep 分隔（分段数 = feature 边界数）/
 *       文章目录 h3 行带 data-level=2 缩进样式 / h2 行 level=1 / 目录跳页仍工作
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-edition-toc-')));
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
    const IMG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#A8B2B9"/></svg>');
    const a = await run('rail-sep', `
      const mod = await import('./views/edition-reader.js');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i + '：纸感阅读与版面节奏的边界验证', summaryPreview: '摘要文本用于滑轨分段验证，长度适中且足以支撑版面高度，覆盖 feature 头条页的判定条件与 supporting 卡的填充需求，确保本期出现至少两个头条专题页。' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: i < 10 ? '<p><img src="' + '${IMG}' + '"></p>' : '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 40 }, (_, i) => mk(i)), fetchArticle: async () => '' });
      window.__er = er;
      er.present(); clearTimeout(er._autoTimer); er._doOpen();
      await new Promise(r => setTimeout(r, 1300));
      const rail = document.querySelector('.er-rail');
      const seps = rail.querySelectorAll('.er-tick-sep').length;
      const ticks = rail.querySelectorAll('.er-tick').length;
      // feature 页边界数（template 由 feature 变为其他或其他变 feature 的次数，计入分段参照）
      const templates = er.pages.map((p) => p.template);
      let boundaries = 0;
      for (let i = 1; i < templates.length; i++) {
        const isLead = templates[i] === 'feature' || templates[i] === 'imageLead';
        if (isLead && templates[i - 1] !== templates[i]) boundaries += 1;
      }
      return { seps, ticks, boundaries, templates: templates.join(',') };
    `.split('${IMG}').join(IMG));
    if (a.__err) throw new Error('rail: ' + a.__err);
    ok(a.ticks >= 3 && a.seps === a.boundaries, '滑轨分段线 = 头条边界数（sep ' + a.seps + ' / 边界 ' + a.boundaries + '，刻度 ' + a.ticks + '）');
    const b = await run('toc-tree', `
      const er = window.__er;
      er.dismiss();
      await new Promise(r => setTimeout(r, 200));
      const mod = await import('./views/edition-reader.js');
      const PARA = '段落内容用于目录树状验证：纸感阅读的关键不在于仿旧，而在于把注意力还给文字本身，版心、行距、页边与留白共同构成节奏，让长文在屏幕上也保有翻阅的呼吸感，安静是最重要的排版变量，中英混排 Mixed English 与数字 2026 亦不例外。';
      const ARTICLE = ('<h2>第一章 总纲</h2><p>' + PARA + '</p><h3>第一节 缘起</h3><p>' + PARA + '</p><h3>第二节 方法</h3><p>' + PARA + '</p><h2>第二章 展开</h2><p>' + PARA + '</p><p>' + PARA + '</p>').repeat(6);
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要 ' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const er2 = new mod.EditionReader({ items: Array.from({ length: 12 }, (_, i) => mk(i)), fetchArticle: async () => ARTICLE });
      window.__er2 = er2;
      er2.present(); clearTimeout(er2._autoTimer); er2._doOpen();
      await new Promise(r => setTimeout(r, 1000));
      await er2._openArticle(er2.items[0]);
      await new Promise(r => setTimeout(r, 1200));
      const tocBtn = document.querySelector('.er-head-toc');
      if (!tocBtn) return { noTocBtn: true };
      tocBtn.click();
      await new Promise(r => setTimeout(r, 400));
      const rows = [...document.querySelectorAll('.er-toc-row')];
      const lv = rows.map((r) => Number(r.dataset.level));
      const indented = rows.filter((r) => r.dataset.level === '2' && getComputedStyle(r).paddingLeft !== getComputedStyle(rows.find((x) => x.dataset.level === '1')).paddingLeft).length;
      const curCount = rows.filter((r) => r.classList.contains('cur')).length;
      const curIdx = rows.findIndex((r) => r.classList.contains('cur'));
      // 翻一页后面板高亮应移动到下一节（锚定跟随）
      er2._go(Math.min(1, er2.pages.length - 1));
      await new Promise(r => setTimeout(r, 1500));
      const curIdxAfter = rows.findIndex((r) => r.classList.contains('cur'));
      const curCountAfter = rows.filter((r) => r.classList.contains('cur')).length;
      const first = rows[curIdx] || rows[0];
      first.click();
      await new Promise(r => setTimeout(r, 600));
      const jumped = er2.mode === 'article';
      er2.dismiss();
      return { rows: rows.length, lv: lv.join(','), indented, curCount, curIdx, curIdxAfter, curCountAfter, jumped, tocClosed: !document.querySelector('.er-toc') };
    `);
    if (b.__err) throw new Error('toc: ' + b.__err);
    ok(!b.noTocBtn && b.rows >= 4, '目录面板打开（' + (b.rows || 0) + ' 行）');
    ok(b.lv.startsWith('1,') && b.lv.includes('2'), '层级标注 h2=1 h3=2（' + b.lv + '）');
    ok(b.indented >= 2, 'h3 行实际缩进渲染（' + b.indented + ' 行）');
    ok(b.curCount === 1 && b.curCountAfter === 1 && b.curIdxAfter > b.curIdx, '当前节单行锚定且随翻页前移（idx ' + b.curIdx + '→' + b.curIdxAfter + '）');
    ok(b.jumped && b.tocClosed, '点击行跳页 + 目录关闭');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.message || e).slice(0, 400));
    app.exit(1);
  }
});
