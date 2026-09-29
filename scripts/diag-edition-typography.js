'use strict';
/**
 * diag-edition-typography.js — R1 阅读排版探针（run-all OFFLINE 集）
 * 验证：排版面板开合 / 密度三档即时生效（文章模式变量 + 版面卡片行距实差）/
 *       页边三档对称内缩 / 首字下沉（文章 ::first-letter + 版面头条 .er-cap）/ 偏好持久化
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-edition-typo-')));
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
    // 阶段一：装数据 → 开书 → 文章模式 → 面板/密度/页边/首字下沉 → 持久化
    const a = await run('article-panel', `
      const mod = await import('./views/edition-reader.js');
      const ARTICLE = Array.from({ length: 20 }, (_, i) => '<h2>第' + (i + 1) + '节</h2><p>段落内容用于排版密度切换与重排验证，长度适中，覆盖行距与段距变量。</p>').join('');
      const IMG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#A8B2B9"/></svg>');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要文本用于行距测量，长度足以占据两行版面空间。' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: i < 6 ? '<p><img src="' + IMG + '"></p>' : '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 24 }, (_, i) => mk(i)), fetchArticle: async () => ARTICLE });
      window.__er = er;
      er.present();
      clearTimeout(er._autoTimer);
      er._doOpen();
      await new Promise(r => setTimeout(r, 900));
      er._openArticle(er.items[0]).catch(() => {});
      await new Promise(r => setTimeout(r, 1200));
      document.querySelector('.er-type').click();
      await new Promise(r => setTimeout(r, 150));
      const panelOn = !!document.querySelector('.er-type-panel');
      const opt = (k, v) => [...document.querySelectorAll('.er-type-opts button')].find((b) => b.dataset.key === k && b.dataset.val === v);
      opt('density', 'airy').click();
      await new Promise(r => setTimeout(r, 500));
      const density = document.querySelector('.er-overlay').dataset.density;
      const leading = getComputedStyle(document.querySelector('.er-article p, .er-article')).lineHeight;
      opt('margin', 'wide').click();
      await new Promise(r => setTimeout(r, 400));
      const margin = document.querySelector('.er-overlay').dataset.margin;
      const insetX = document.querySelector('.er-in') ? getComputedStyle(document.querySelector('.er-in')).paddingLeft : '';
      opt('firstCap', 'on').click();
      await new Promise(r => setTimeout(r, 200));
      const firstcap = document.querySelector('.er-overlay').classList.contains('er-firstcap');
      const firstLetterFont = getComputedStyle(document.querySelector('.er-article > p:first-of-type, .er-article-leaf .er-article p'), null).fontSize;
      // R24 字号三档：切「大」→ --er-font-scale 系数 + 正文实差
      const fsBefore = parseFloat(getComputedStyle(document.querySelector('.er-article')).fontSize);
      opt('fontScale', 'large').click();
      await new Promise(r => setTimeout(r, 500));
      const fsAfter = parseFloat(getComputedStyle(document.querySelector('.er-article')).fontSize);
      const scaleVar = document.querySelector('.er-overlay').style.getPropertyValue('--er-font-scale');
      opt('fontScale', 'standard').click();
      await new Promise(r => setTimeout(r, 300));
      // R27 Ctrl+滚轮步进：上滚放大 → large；再上滚钳位；下滚回 standard
      const stage = document.querySelector('.er-stage');
      const wheel = (dy) => stage.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, ctrlKey: true, bubbles: true, cancelable: true }));
      wheel(-120);
      await new Promise(r => setTimeout(r, 400));
      const wScaleUp = document.querySelector('.er-overlay').style.getPropertyValue('--er-font-scale');
      wheel(-120);
      await new Promise(r => setTimeout(r, 300));
      const wScaleClamp = document.querySelector('.er-overlay').style.getPropertyValue('--er-font-scale');
      wheel(120);
      await new Promise(r => setTimeout(r, 300));
      const wScaleBack = document.querySelector('.er-overlay').style.getPropertyValue('--er-font-scale');
      const wPersisted = JSON.parse(localStorage.getItem('robinread.editionTypography') || '{}').fontScale;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
      const panelClosed = !document.querySelector('.er-type-panel');
      const stored = JSON.parse(localStorage.getItem('robinread.editionTypography') || '{}');
      return { panelOn, density, leading, margin, insetX, firstcap, firstLetterFont, panelClosed, stored, fsBefore, fsAfter, scaleVar, wScaleUp, wScaleClamp, wScaleBack, wPersisted };
    `);
    if (a.__err) throw new Error('phase1: ' + a.__err);
    // 阶段二：回版面 → 行距实差 / 页边对称 / 头条首字下沉
    const b = await run('edition-verify', `
      const er = window.__er;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 600));
      const backEdition = er.mode === 'edition';
      const ov = document.querySelector('.er-overlay');
      const sumEl = () => ov.querySelector('.er-story.r-lead .er-sum');
      const sumLhOf = () => { const s = sumEl(); return s ? parseFloat(getComputedStyle(s).lineHeight) : 0; };
      document.querySelector('.er-type').click();
      await new Promise(r => setTimeout(r, 150));
      const opt = (k, v) => [...document.querySelectorAll('.er-type-opts button')].find((b) => b.dataset.key === k && b.dataset.val === v);
      opt('density', 'standard').click();
      await new Promise(r => setTimeout(r, 600));
      const sumLhStd = sumLhOf();
      opt('density', 'airy').click();
      await new Promise(r => setTimeout(r, 700));
      const sumLhAiry = sumLhOf();
      const inEd = ov.querySelector('.er-in');
      const padL = inEd ? getComputedStyle(inEd).paddingLeft : '';
      const padR = inEd ? getComputedStyle(inEd).paddingRight : '';
      const cap = ov.querySelector('.er-story.r-lead .er-sum .er-cap');
      const sumFs = sumEl() ? parseFloat(getComputedStyle(sumEl()).fontSize) : 0;
      const capFs = cap ? parseFloat(getComputedStyle(cap).fontSize) : 0;
      document.querySelector('.er-type').click();
      return { backEdition, sumLhStd, sumLhAiry, padL, padR, hasCap: !!cap, sumFs, capFs,
        leadStory: !!ov.querySelector('.er-story.r-lead'), forms: er.pages.map(p => p.template + ':' + p.form).join(',') };
    `);
    if (b.__err) throw new Error('phase2: ' + b.__err);
    const out = { ...a, ...b };
    ok(out.panelOn, '排版面板打开');
    ok(out.density === 'airy', '密度切舒朗（dataset=' + out.density + '）');
    ok(out.margin === 'wide', '页边切宽（dataset=' + out.margin + '）');
    ok(out.insetX === '52px', '页边距 52px 生效（实际 ' + out.insetX + '）');
    ok(out.firstcap === true, '首字下沉开关生效');
    ok(out.panelClosed, 'Esc 关闭面板');
    ok(out.stored.density === 'airy' && out.stored.margin === 'wide' && out.stored.firstCap === true, '排版偏好持久化');
    ok(out.backEdition, 'Esc 返回版面态');
    ok(out.sumLhAiry - out.sumLhStd >= 2, '版面行距档位可辨（标准 ' + out.sumLhStd + 'px → 舒朗 ' + out.sumLhAiry + 'px）');
    ok(out.padL === '52px' && out.padR === '52px', '版面页边对称内缩（左 ' + out.padL + ' / 右 ' + out.padR + '）');
    ok(out.hasCap && out.capFs >= out.sumFs * 2.4, '版面头条首字下沉渲染（首字 ' + out.capFs + 'px / 摘要 ' + out.sumFs + 'px）');
    ok(out.scaleVar === '1.14' && out.fsAfter > out.fsBefore * 1.08, 'R24 字号切大档生效（scale ' + out.scaleVar + '，' + out.fsBefore + '→' + out.fsAfter + 'px）');
    ok(out.stored.fontScale === 'standard', 'R24 字号档持久化回标准');
    ok(out.wScaleUp === '1.14' && out.wScaleClamp === '1.14' && out.wScaleBack === '1', 'R27 Ctrl+滚轮步进+钳位+回落（' + out.wScaleUp + '/' + out.wScaleClamp + '/' + out.wScaleBack + '）');
    ok(out.wPersisted === 'standard', 'R27 滚轮步进持久化（' + out.wPersisted + '）');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.message || e).slice(0, 400));
    app.exit(1);
  }
});
