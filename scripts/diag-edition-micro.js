'use strict';
/**
 * diag-edition-micro.js — R6 版面微交互探针（run-all OFFLINE 集）
 * 验证：落页卡片错落淡入（er-place-in + 递增 --stagger）/ reduceMotion 关闭动画 /
 *       hover 微交互 CSS 规则存在（标题强调/图片微缩放）/ 翻页后新页重新触发
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-edition-micro-')));
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
    const a = await run('stagger', `
      const mod = await import('./views/edition-reader.js');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要文本用于微交互验证，长度适中。' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: i % 2 === 0 ? '<p><img src="data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#A8B2B9"/></svg>') + '"></p>' : '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 40 }, (_, i) => mk(i)), fetchArticle: async () => '' });
      window.__er = er;
      er.present(); clearTimeout(er._autoTimer); er._doOpen();
      await new Promise(r => setTimeout(r, 1300));
      const sheet = document.querySelector('.er-sheet[data-role="a"]');
      const places = [...sheet.querySelectorAll('.er-place.er-place-in')];
      const staggers = places.slice(0, 4).map((p) => p.style.getPropertyValue('--stagger').trim());
      const animName = places[0] ? getComputedStyle(places[0]).animationName : '';
      // 翻页后新页重建并再次触发
      er._go(1);
      await new Promise(r => setTimeout(r, 1500));
      const sheet2 = document.querySelector('.er-sheet[data-role="a"]');
      const places2 = [...sheet2.querySelectorAll('.er-place.er-place-in')];
      return { count: places.length, staggers, animName, count2: places2.length, pages: er.pages.length };
    `);
    if (a.__err) throw new Error('stagger: ' + a.__err);
    ok(a.count >= 3, '落页卡片带错落淡入类（' + a.count + ' 张）');
    ok(a.staggers.length >= 2 && a.staggers[0] === '0ms' && a.staggers[1] === '45ms', 'stagger 递增（' + a.staggers.join(',') + '）');
    ok(a.animName === 'erPlaceIn', '动画名 erPlaceIn 生效');
    ok(a.count2 >= 1, '翻页后新页重新触发（' + a.count2 + ' 张）');
    const b = await run('reduce-motion-hover', `
      const er = window.__er;
      er.dismiss();
      await new Promise(r => setTimeout(r, 150));
      const mod = await import('./views/edition-reader.js');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要 ' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const er2 = new mod.EditionReader({ items: Array.from({ length: 24 }, (_, i) => mk(i)), reduceMotion: true, fetchArticle: async () => '' });
      window.__er2 = er2;
      er2.present(); clearTimeout(er2._autoTimer); er2._doOpen();
      await new Promise(r => setTimeout(r, 1000));
      const rmCount = document.querySelectorAll('.er-place.er-place-in').length;
      er2.dismiss();
      // hover CSS 规则存在性（样式表文本扫描）
      let hoverTitle = false, hoverImg = false;
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch { continue; }
        for (const r of rules) {
          const t = r.cssText || '';
          if (t.includes('.er-story:hover .er-title')) hoverTitle = true;
          if (t.includes('.er-story:hover .er-img img')) hoverImg = true;
        }
      }
      return { rmCount, hoverTitle, hoverImg };
    `);
    if (b.__err) throw new Error('rm: ' + b.__err);
    ok(b.rmCount === 0, 'reduceMotion 下无错落动画类');
    ok(b.hoverTitle && b.hoverImg, 'hover 微交互 CSS 规则存在');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.message || e).slice(0, 400));
    app.exit(1);
  }
});
