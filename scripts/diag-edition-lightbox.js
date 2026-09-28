'use strict';
/**
 * diag-edition-lightbox.js — R5 灯箱增强探针（run-all OFFLINE 集）
 * 验证：滚轮缩放（transform+百分比角标）/ 双击 2×↔复位 / ←→ 切图重置 /
 *       单图隐藏箭头 / Esc 关闭（放大态 Esc 先复位）
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-edition-lb-')));
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
    const IMG = (n) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#' + ['A8B2B9', 'C4A98E', '9FAF9A'][n] + '"/></svg>');
    const a = await run('lightbox-zoom', `
      const mod = await import('./views/edition-reader.js');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要 ' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const ARTICLE = '<p>图一</p><p><img src="' + '${IMG(0)}' + '"></p><p>图二</p><p><img src="' + '${IMG(1)}' + '"></p><p>图三</p><p><img src="' + '${IMG(2)}' + '"></p>';
      const er = new mod.EditionReader({ items: Array.from({ length: 12 }, (_, i) => mk(i)), fetchArticle: async () => ARTICLE });
      window.__er = er;
      er.present(); clearTimeout(er._autoTimer); er._doOpen();
      await new Promise(r => setTimeout(r, 900));
      await er._openArticle(er.items[0]);
      await new Promise(r => setTimeout(r, 1200));
      const img = document.querySelector('.er-article img');
      img.click();
      await new Promise(r => setTimeout(r, 100));
      const lb = document.querySelector('.er-lightbox');
      const onEarly = lb.classList.contains('on');
      await new Promise(r => setTimeout(r, 300));
      const count0 = lb.querySelector('.er-lb-count').textContent;
      const on0 = lb.classList.contains('on');
      // 滚轮放大两档
      lb.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 800, clientY: 400, bubbles: true, cancelable: true }));
      lb.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 800, clientY: 400, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const tf1 = lb.querySelector('img').style.transform;
      const count1 = lb.querySelector('.er-lb-count').textContent;
      // 双击 → 复位（>1.02 时双击是复位）
      lb.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
      const tf2 = lb.querySelector('img').style.transform;
      const count2 = lb.querySelector('.er-lb-count').textContent;
      // 双击 → 2×
      lb.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
      const tf3 = lb.querySelector('img').style.transform;
      const count3 = lb.querySelector('.er-lb-count').textContent;
      // 放大态 Esc：先复位
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
      const stillOn = lb.classList.contains('on');
      const tf4 = lb.querySelector('img').style.transform;
      // 再 Esc：关闭
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
      const closed = !lb.classList.contains('on');
      return { onEarly, on0, count0, tf1, count1, tf2, count2, tf3, count3, stillOn, tf4, closed };
    `.split('${IMG(0)}').join(IMG(0)).split('${IMG(1)}').join(IMG(1)).split('${IMG(2)}').join(IMG(2)));
    if (a.__err) throw new Error('lb: ' + a.__err);
    ok(a.on0 && /^1 \/ 3$/.test(a.count0), '灯箱开启计数 1/3（onEarly=' + a.onEarly + ' on0=' + a.on0 + ' count=' + a.count0 + '）');
    ok(/scale\(1\.32/.test(a.tf1) && a.count1.includes('132%'), '滚轮两档缩放至 132%（' + a.tf1.slice(0, 40) + '…）');
    ok(a.tf2 === '' && !a.count2.includes('%'), '双击复位（transform 清空、无百分比）');
    ok(/scale\(2\)/.test(a.tf3) && a.count3.includes('200%'), '双击 2×（' + a.count3 + '）');
    ok(a.stillOn && a.tf4 === '', '放大态 Esc 先复位不关闭');
    ok(a.closed, '再 Esc 关闭灯箱');
    const b = await run('lightbox-keys', `
      const er = window.__er;
      const img = document.querySelector('.er-article img');
      img.click();
      await new Promise(r => setTimeout(r, 300));
      const lb = document.querySelector('.er-lightbox');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      const c2 = lb.querySelector('.er-lb-count').textContent;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      const c1 = lb.querySelector('.er-lb-count').textContent;
      // 单图箭头隐藏
      window.__er._lbList = [window.__er._lbList[0]];
      window.__er._lbIdx = 0;
      window.__er._lbShow(lb);
      await new Promise(r => setTimeout(r, 150));
      const prevHidden = lb.querySelector('.er-lb-nav.prev').style.display === 'none';
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return { c2, c1, prevHidden };
    `);
    if (b.__err) throw new Error('keys: ' + b.__err);
    ok(b.c2.startsWith('2 / 3'), '→ 切到第 2 张（' + b.c2 + '）');
    ok(b.c1.startsWith('1 / 3'), '← 切回第 1 张（' + b.c1 + '）');
    ok(b.prevHidden, '单图隐藏左右箭头');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.message || e).slice(0, 400));
    app.exit(1);
  }
});
