'use strict';
/**
 * diag-kb-trendfit.js — 知识中心看板趋势图适配探针（run-all OFFLINE 集）
 * 用户反馈：趋势图 canvas 超出卡片右边界（旧实现取 parent clientWidth 含 padding）。
 * 修复：CSS width:100% + 取 canvas 自身 content-box 量宽。
 * 断言：画布四缘全部落在 .kb-spark-wrap 内容区内；backing store 有效；CSS 规则在册。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-kbfit-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 120 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };

const ROOT = path.join(__dirname, '..');

app.whenReady().then(async () => {
  try {
    // 源码级：CSS 流式规则在册
    const cssSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'styles', 'robin.css'), 'utf8');
    ok(/\.kb-spark-canvas\s*\{\s*display:\s*block;\s*width:\s*100%;\s*height:\s*120px;/.test(cssSrc), 'CSS：.kb-spark-canvas 流式 100%×120 在册');
    const kbSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'views', 'knowledge.js'), 'utf8');
    ok(kbSrc.includes('canvas.clientWidth || canvas.parentElement.clientWidth'), 'JS：量宽走 canvas 自身 content-box（不再取父 clientWidth 全宽）');

    const win = new BrowserWindow({
      show: false, width: 1200, height: 800,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(ROOT, 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
    await sleep(900);
    const a = await win.webContents.executeJavaScript(`(async () => {
      const { KnowledgeCenter } = await import('./views/knowledge.js');
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;top:0;left:0;width:880px;';
      document.body.appendChild(host);
      const kc = Object.create(KnowledgeCenter.prototype);
      kc.contentHost = host;
      kc.tab = 'dashboard';
      const heat = {};
      const base = new Date();
      for (let i = 0; i < 30; i++) {
        const dt = new Date(base.getTime() - (29 - i) * 86400000);
        const key = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
        heat[key] = { read: [0, 1, 0, 0, 0, 0, 3, 8, 2, 0, 6, 9, 4, 1][i % 14], highlights: i % 3, notes: i % 5 === 0 ? 1 : 0 };
      }
      kc._renderDashboard({
        highlights: 28, notes: 6, review: 9, due: 2, collections: 0,
        tags: [{ tag: 'TypeScript', count: 4204 }, { tag: 'Agent', count: 2357 }, { tag: 'LLM', count: 1618 }],
        streak: 15, heat,
      });
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise(r => setTimeout(r, 120));
      const wrap = host.querySelector('.kb-spark-wrap');
      const canvas = host.querySelector('.kb-spark-canvas');
      if (!wrap || !canvas) return { __err: 'no wrap/canvas' };
      const wr = wrap.getBoundingClientRect();
      const cr = canvas.getBoundingClientRect();
      const ws = getComputedStyle(wrap);
      const contentRight = wr.right - parseFloat(ws.borderRightWidth);
      const contentLeft = wr.left + parseFloat(ws.borderLeftWidth);
      return {
        wrapW: Math.round(wr.width), padX: parseFloat(ws.paddingLeft) + parseFloat(ws.paddingRight),
        canvasW: Math.round(cr.width), canvasH: Math.round(cr.height),
        fitRight: cr.right <= contentRight + 0.5, fitLeft: cr.left >= contentLeft - 0.5,
        backing: canvas.width > 0 && canvas.height > 0,
        dpr: window.devicePixelRatio || 1,
      };
    })()`);
    if (a.__err) throw new Error('trendfit: ' + a.__err);
    ok(a.fitRight, `画布右缘未超出卡片内容区（wrap ${a.wrapW}px，画布 ${a.canvasW}px，横向 padding ${a.padX}px）`);
    ok(a.fitLeft, '画布左缘落在卡片内容区内');
    ok(Math.abs(a.canvasW - (a.wrapW - a.padX)) <= 2, `画布宽 = 卡片内容宽（${a.canvasW} ≈ ${a.wrapW} - ${a.padX}）`);
    ok(a.canvasH === 120, '画布高 120px');
    ok(a.backing, `backing store 有效（dpr ${a.dpr}）`);
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
