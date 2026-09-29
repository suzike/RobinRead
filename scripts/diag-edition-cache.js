'use strict';
/**
 * diag-edition-cache.js — R34 期刊重排缓存 + 翻页 will-change 探针（run-all OFFLINE 集）
 * 验证：同文章二次打开命中缓存（pages 对象同一）/ 排版参数或视口变化换键（重新装箱）/
 *       缓存入队（size 递增）/ er-turning 时叶面 will-change:transform
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-edition-cache-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 150 * 1000).unref();
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
    const a = await run('cache', `
      const mod = await import('./views/edition-reader.js');
      const ARTICLE = Array.from({ length: 12 }, (_, i) => '<h2>第' + (i + 1) + '节</h2><p>段落内容用于重排缓存探针，margin 折叠建模后叶内容必须完整：标题层级、段距、页码、目录锚点全部保持不丢。</p>').join('');
      const mk = (i) => ({ id: 'cx-' + i, title: '条目' + String.fromCharCode(65 + i) + (i * 37 % 501) + '号', summaryPreview: '摘要', sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 6 }, (_, i) => mk(i)), fetchArticle: async () => ARTICLE });
      window.__er = er;
      er.present();
      clearTimeout(er._autoTimer);
      er._doOpen();
      await new Promise(r => setTimeout(r, 900));
      // 冷：首次打开文章
      await er._openArticle(er.items[0]);
      await new Promise(r => setTimeout(r, 800));
      const pagesCold = er.pages;
      const cacheAfterCold = (er._layoutCache || new Map()).size;
      // 返回版面再重开：应命中缓存（pages 同一对象）
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 500));
      await er._openArticle(er.items[0]);
      await new Promise(r => setTimeout(r, 600));
      const pagesWarm = er.pages;
      const hitSame = pagesCold === pagesWarm;
      // 排版参数变化：换键重新装箱
      er.typo.fontScale = 'large';
      await er._paginateArticle(er.article.entry, ARTICLE);
      await new Promise(r => setTimeout(r, 600));
      const pagesAfterTypo = er.pages;
      const newKey = pagesAfterTypo !== pagesWarm;
      const cacheSize = (er._layoutCache || new Map()).size;
      // will-change：翻页中类挂上即提升
      const book = document.querySelector('.er-book');
      const leaf = document.querySelector('.er-leaf');
      book.classList.add('er-turning');
      const wc = getComputedStyle(leaf).willChange; // 叶体本就常驻提升（单元素，既有设计）
      book.classList.remove('er-turning');
      // 叶内容不溢出（R34 打回护栏）：每片叶 scrollHeight 不得超 clientHeight+2
      // 内容守恒（R34 打回）：末节正文必须出现在页面上（丢行免疫的 scrollHeight 探针不足以覆盖）
      const allText = [...document.querySelectorAll('.er-sheet .er-in')].map((el) => el.textContent || '').join('');
      const lastKept = allText.includes('第12节') && allText.includes('全部保持不丢');
      let clipped = 0;
      const deltas = [];
      for (const el of document.querySelectorAll('.er-sheet .er-in')) {
        const d = el.scrollHeight - el.clientHeight;
        deltas.push(d);
        if (d > 2) clipped += 1;
      }
      // 翻页面（.er-face-*）仅在翻页中存在于 DOM——规则存在性走 CSSOM 断言
      let faceRuleOn = false;
      for (const sheet of document.styleSheets) {
        try { for (const r of sheet.cssRules) {
          if (r.selectorText && r.selectorText.includes('.er-book.er-turning .er-face-front') && r.style && r.style.willChange === 'transform') faceRuleOn = true;
        } } catch (_) {}
      }
      return { cacheAfterCold, hitSame, newKey, cacheSize, wc, faceRuleOn, clipped, deltas, lastKept };
    `);
    if (a.__err) throw new Error('cache: ' + a.__err);
    ok(a.cacheAfterCold === 1, '首次装箱入缓存（size ' + a.cacheAfterCold + '）');
    ok(a.hitSame, '同文章二次打开命中缓存（pages 对象同一）');
    ok(a.newKey, '排版参数变化换键重新装箱');
    ok(a.cacheSize === 2, '缓存按键累积（size ' + a.cacheSize + '）');
    ok(a.wc === 'transform' && a.faceRuleOn, '叶体常驻提升 + 翻页面 will-change 规则随 er-turning 挂载');
    console.error('DBG deltas', JSON.stringify(a.deltas));
    ok(a.clipped === 0, '页内容零溢出（margin 折叠建模，clipped ' + a.clipped + '）');
    ok(a.lastKept, '内容守恒：末节标题与句尾均在页面上（不丢行）');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
