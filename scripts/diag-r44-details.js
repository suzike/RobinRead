'use strict';
/**
 * diag-r44-details.js — R44 细节三连探针（run-all OFFLINE 集）
 * 验证：滑轨刻度聚焦 ←/→ 触发翻页（_go 接线）/ 刻度 title 页码 /
 *       装载页呼吸点动画规则在册（CSSOM）/ 空态刷新按钮 :active/:focus-visible 在册
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r44-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 150 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false, width: 1440, height: 900,
      webPreferences: { contextIsolation: true, backgroundThrottling: false },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(600);
    const run = (tag, js) => {
      console.log('PHASE ' + tag);
      return win.webContents.executeJavaScript(`(async () => { try { ${js} } catch (e) { return { __err: String(e && e.stack || e) }; } })()`);
    };
    const a = await run('details', `
      const mod = await import('./views/edition-reader.js');
      const ARTICLE = Array.from({ length: 14 }, (_, i) => '<h2>第' + (i + 1) + '节</h2><p>段落用于 R44 探针。</p>').join('');
      const mk = (i) => ({ id: 'r44-' + i, title: '条目' + i, summaryPreview: '摘要', sourceTitle: '潮流周刊', publishedAt: 1758902400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 40 }, (_, i) => mk(i)), fetchArticle: async () => ARTICLE });
      er.present();
      clearTimeout(er._autoTimer);
      er._doOpen();
      await new Promise(r => setTimeout(r, 900));
      const ticks = [...document.querySelectorAll('.er-rail .er-tick')];
      const tick = ticks[1] || ticks[0];
      if (!tick) return { __err: 'no ticks' };
      const tickTitle = tick.title || '';
      const rail = document.querySelector('.er-rail');
      let goCalled = 0;
      const origGo = er._go.bind(er);
      er._go = (i) => { goCalled += 1; return origGo(i); };
      rail.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 60));
      const keyFlips = goCalled;
      let anim = 'absent';
      let breatheKeyframes = false;
      for (const sheet of document.styleSheets) {
        try {
          for (const r of sheet.cssRules) {
            if (r.selectorText && r.selectorText.includes('.er-loading-page::after')) anim = r.style.animationName || 'rule-no-anim';
            if (r.type === CSSRule.KEYFRAMES_RULE && r.name === 'er-dot-breathe') breatheKeyframes = true;
          }
        } catch (_) {}
      }
      let activeRule = false;
      let focusRule = false;
      for (const sheet of document.styleSheets) {
        try {
          for (const r of sheet.cssRules) {
            if (r.selectorText && r.selectorText.includes('.list-empty-refresh:active')) activeRule = true;
            if (r.selectorText && r.selectorText.includes('.list-empty-refresh:focus-visible')) focusRule = true;
          }
        } catch (_) {}
      }
      return { tickTitle, keyFlips, anim, breatheKeyframes, activeRule, focusRule };
    `);
    if (a.__err) throw new Error('details: ' + a.__err);
    ok(a.tickTitle.includes('/'), '刻度 title 页码（' + a.tickTitle + '）');
    ok(a.keyFlips >= 1, '滑轨聚焦 ←/→ 触发翻页（_go 调用 ' + a.keyFlips + ' 次）');
    ok(a.anim === 'er-dot-breathe' && a.breatheKeyframes, '装载页呼吸点动画规则在册（' + a.anim + '）');
    ok(a.activeRule && a.focusRule, '空态刷新 :active/:focus-visible 规则在册');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
