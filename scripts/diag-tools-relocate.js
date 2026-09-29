'use strict';
/**
 * diag-tools-relocate.js — R35 工具条迁位+命中加固探针（run-all OFFLINE 集）
 * 验证：工具条与书页矩形零相交（不干涉内容）/ 逐按钮隔离真点击 8/8 命中 /
 *       按钮命中区 ≥28px / 胶囊底非透明（实体可点感）/ 面板开合后仍可点
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-tools-r35-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 180 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: true, width: 1600, height: 1000,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(800);
    const info = await win.webContents.executeJavaScript(`(async () => {
      const mod = await import('./views/edition-reader.js');
      const ARTICLE = Array.from({ length: 10 }, (_, i) => '<h2>第' + (i + 1) + '节</h2><p>正文用于工具条迁位验收。</p>').join('');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要', sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 6 }, (_, i) => mk(i)), startIndex: 0, reduceMotion: false, onOpen: () => {}, fetchArticle: async () => ARTICLE });
      window.__er = er;
      er.present();
      clearTimeout(er._autoTimer);
      er._doOpen();
      await new Promise(r => setTimeout(r, 1200));
      const tools = document.querySelector('.er-tools');
      const tr = tools.getBoundingClientRect();
      // ① 干涉断言：工具条与两片书页矩形零相交
      const sheets = [...document.querySelectorAll('.er-sheet')].map((s) => s.getBoundingClientRect());
      const intersect = sheets.filter((sr) => !(tr.right < sr.left || tr.left > sr.right || tr.bottom < sr.top || tr.top > sr.bottom)).length;
      // ② 命中区与实体底
      const btns = [...tools.querySelectorAll('button')];
      const minW = Math.min(...btns.map((b) => b.getBoundingClientRect().width));
      const minH = Math.min(...btns.map((b) => b.getBoundingClientRect().height));
      const capBg = getComputedStyle(tools).backgroundColor;
      // ③ 命中计数器
      window.__hits = {};
      for (const b of btns) {
        const key = b.className.split(' ')[0];
        window.__hits[key] = 0;
        b.addEventListener('click', () => { window.__hits[key] += 1; }, true);
      }
      window.__centers = btns.map((b) => {
        const rc = b.getBoundingClientRect();
        return { key: b.className.split(' ')[0], x: rc.x + rc.width / 2, y: rc.y + rc.height / 2 };
      });
      return { intersect, minW: Math.round(minW), minH: Math.round(minH), capBg, count: btns.length, centers: window.__centers };
    })()`);
    // 逐按钮隔离真点击：每键点击前重取坐标（全屏/关闭会改变窗口与 overlay，放最后并放宽 ≥1）
    const clickBtn = async (key, times) => {
      for (let i = 0; i < times; i++) {
        const c = await win.webContents.executeJavaScript(`(() => { const b = document.querySelector('.er-tools .${key}'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
        if (!c) break;
        win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(c.x), y: Math.round(c.y), button: 'left', clickCount: 1 });
        win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(c.x), y: Math.round(c.y), button: 'left', clickCount: 1 });
        await sleep(80);
      }
      await win.webContents.executeJavaScript(`(() => { document.querySelector('.er-type-panel')?.remove(); document.querySelector('.er-toc')?.remove(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); })()`);
      await sleep(200);
    };
    for (const key of ['er-sound', 'er-paper', 'er-type', 'er-find', 'er-export', 'er-keys']) await clickBtn(key, 8);
    await clickBtn('er-full', 3);
    await clickBtn('er-close', 3);
    const hits = await win.webContents.executeJavaScript(`(() => {
      const h = window.__hits;
      const keys = Object.keys(h);
      return { allHit: keys.every((k) => h[k] === 8), detail: h };
    })()`);
    console.log('probe:', JSON.stringify({ ...info, ...hits }));
    let failed = 0;
    const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };
    ok(info.intersect === 0, '工具条与书页零相交（相交 ' + info.intersect + ' 片）');
    ok(info.minW >= 28 && info.minH >= 28, '按钮命中区 ≥28px（' + info.minW + 'x' + info.minH + '）');
    ok(info.capBg !== 'rgba(0, 0, 0, 0)', '胶囊实体底（' + info.capBg + '）');
    ok(info.count === 8, '8 键齐全（' + info.count + '）');
    const solid = ['er-sound', 'er-paper', 'er-type', 'er-find', 'er-export', 'er-keys'].every((k) => hits.detail[k] === 8);
    ok(solid, '常驻六键 8/8 真点击全命中（' + JSON.stringify(hits.detail) + '）');
    ok(hits.detail['er-full'] >= 1 && hits.detail['er-close'] >= 1, '全屏/关闭至少命中一次（全屏重排与关闭消亡属预期）');
    app.exit(failed ? 1 : 0);
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 600));
    app.exit(1);
  }
});
