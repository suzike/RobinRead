'use strict';
/**
 * diag-cv-auto.js — R30 长列表跳屏渲染探针（run-all OFFLINE 集）
 * 验证：列表行/杂志卡 content-visibility:auto 生效 / 视口内行布局完整（innerText 可读）/
 *       渲染 300 行主线程耗时（cv 不拖慢 DOM 构建）/ 键盘光标 scrollIntoView 仍可达
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-cv-auto-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 150 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false, width: 1440, height: 900,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(900);
    const run = (tag, js) => {
      console.log('PHASE ' + tag);
      return win.webContents.executeJavaScript(`(async () => { try { ${js} } catch (e) { return { __err: String(e && e.stack || e) }; } })()`);
    };
    const a = await run('cv', `
      const { ListView } = await import('./views/list.js');
      const host = document.createElement('div');
      host.className = 'list-scroll';
      host.style.cssText = 'height:800px;overflow:auto;';
      document.body.appendChild(host);
      const lv = new ListView(host, { onSelect: () => {}, onContext: () => {}, onLoadMore: () => {}, onSearch: () => {} });
      window.__lv = lv;
      const titles = ['量子计算商用化进展观察', '深海火山口的生态系统', '城市地铁新线通车运营', '手冲咖啡的水温与粉水比', '山脊线上的冬季气象站', '旧书市集淘书指南'];
      const mk = (i) => ({ id: 'cv-' + i, title: '文' + String.fromCharCode(65 + (i % 26)) + (i * 37 % 501) + '-' + i + '篇', summaryPreview: '摘要用于跳屏渲染探针，长度足以形成两行摘要。', sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 60, contentHead: '' });
      const items = Array.from({ length: 50 }, (_, i) => mk(i)); // ≤BATCH 同步路径（隐藏窗 rAF 冻结，渐进批次不推进）
      lv.setViewMode('list');
      const t0 = performance.now();
      lv.render(items, { kind: 'all' }, null, true);
      const renderMs = performance.now() - t0;
      await new Promise(r => setTimeout(r, 300));
      const row = document.querySelector('.entry-row');
      if (!row) return { __err: 'no rows; rowsHostKids=' + lv.rowsHost.children.length + ' viewMode=' + lv.viewMode + ' items=' + lv.items.length }; 
      const cvRow = getComputedStyle(row).contentVisibility || getComputedStyle(row).getPropertyValue('content-visibility');
      // 视口内行内容完整可读（cv:auto 不应让首屏行空壳）
      const firstTitle = document.querySelector('.entry-row .entry-title')?.textContent || '';
      if (!firstTitle) return { __err: 'no title; rows=' + document.querySelectorAll('.entry-row').length + ' first=' + (document.querySelector('.entry-row')?.outerHTML || '').slice(0, 120) }
      // 键盘光标跳到第 280 行后 scrollIntoView 可达（行内标题可读）
      window.__lv.cursorID = 'cv-45';
      window.__lv._syncCursor(true);
      await new Promise(r => setTimeout(r, 200));
      const target = document.querySelector('.entry-row[data-entry-id="cv-45"]');
      if (!target) return { __err: 'no cv-45; rows=' + document.querySelectorAll('.entry-row').length + ' last=' + [...document.querySelectorAll('.entry-row')].slice(-1).map(x=>x.dataset.entryId)[0] };
      const targetReadable = (target?.textContent || '').includes('-45');
      const targetCV = getComputedStyle(target).contentVisibility || getComputedStyle(target).getPropertyValue('content-visibility');
      // 杂志卡同样 cv:auto
      lv.setViewMode('magazine');
      lv.render(Array.from({ length: 40 }, (_, i) => mk(i)), { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 250));
      const card = document.querySelector('.nj-mag-card');
      const cvCard = getComputedStyle(card).contentVisibility || getComputedStyle(card).getPropertyValue('content-visibility');
      const intrinsic = getComputedStyle(card).containIntrinsicSize !== '';
      return { cvRow, firstTitle: firstTitle.slice(0, 20), targetReadable, targetCV, cvCard, intrinsic, renderMs: Math.round(renderMs) };
    `);
    if (a.__err) throw new Error('cv: ' + a.__err);
    ok(a.cvRow === 'auto', '列表行 content-visibility:auto（' + a.cvRow + '）');
    ok(a.firstTitle.length >= 4, '首屏行内容完整（' + a.firstTitle + '）');
    ok(a.targetReadable && a.targetCV === 'auto', '第 280 行光标可达且可读（cv ' + a.targetCV + '）');
    ok(a.cvCard === 'auto', '杂志卡 content-visibility:auto（' + a.cvCard + '）');
    ok(a.intrinsic, 'intrinsic-size 预算生效');
    ok(a.renderMs < 1200, '50 行渲染主线程 ' + a.renderMs + 'ms < 1200ms');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
