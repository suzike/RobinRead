'use strict';
/**
 * diag-r31-polish.js — R31 精修探针（run-all OFFLINE 集）
 * 验证：摘要/标题 HTML 净化 / 工具栏统一视觉（衬线刊名+ghost 按钮+active 态）/
 *       纸感主题工具栏融入 / 封面图 decoding+fetchPriority+aspect-ratio+落位缩放
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r31-')));
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
    const a = await run('polish', `
      const { ListView } = await import('./views/list.js');
      const host = document.createElement('div');
      host.className = 'list-scroll';
      host.style.cssText = 'height:800px;';
      document.body.appendChild(host);
      const lv = new ListView(host, { onSelect: () => {}, onContext: () => {}, onLoadMore: () => {}, onSearch: () => {} });
      window.__lv = lv;
      const IMG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="225"><rect width="400" height="225" fill="#A8B2B9"/></svg>');
      const mk = (i, over = {}) => ({ id: 'p-' + i, title: '条目' + String.fromCharCode(65 + i) + (i * 37 % 501) + '号', summaryPreview: '摘要文本', sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 60, contentHead: i === 0 ? '<p><img src="https://example.com/cover.jpg"></p>' : '', ...over });
      // ① 摘要带原始 HTML：列表行必须显示纯文本
      const leak = '<div align="right"> <a href="https://example.com/x">阅读全文</a></div>真正的摘要内容在这';
      lv.setViewMode('list');
      lv.render([mk(0, { summaryPreview: leak, title: '标题<b>加粗</b>泄露' }), mk(1)], { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 200));
      const row0 = document.querySelector('.entry-row[data-entry-id="p-0"]');
      const sumText = row0.querySelector('.entry-summary')?.textContent || '';
      const titleText = row0.querySelector('.entry-title')?.textContent || '';
      // ② 工具栏统一视觉
      const title = lv.topInset.querySelector('.list-top-title');
      if (!title) return { __err: 'no title' };
      const titleFont = getComputedStyle(title).fontFamily;
      const viewBtn = lv.topInset.querySelector('#view-mode-btn');
      const viewBg = getComputedStyle(viewBtn).backgroundColor;
      const viewH = parseFloat(getComputedStyle(viewBtn).height);
      lv.setSortButton('unreadFirst');
      await new Promise(r => setTimeout(r, 60));
      const sortActiveBg = getComputedStyle(lv.topInset.querySelector('#list-sort-btn')).backgroundColor;
      if (!lv.searchHost) return { __err: 'no searchHost' };
      const searchMax = getComputedStyle(lv.searchHost).maxWidth;
      // ③ 纸感主题融合
      host.classList.add('nj-mag-paper');
      await new Promise(r => setTimeout(r, 80));
      const paperInsetBg = getComputedStyle(lv.topInset).backgroundColor;
      const paperBtnBg = getComputedStyle(viewBtn).backgroundColor;
      host.classList.remove('nj-mag-paper');
      // ④ 封面图策略
      const card = document.querySelector('.nj-mag-card') || (lv.setViewMode('magazine'), lv.render([mk(0)], { kind: 'all' }, null, true), await new Promise(r => setTimeout(r, 200)), document.querySelector('.nj-mag-card'));
      if (!card) return { __err: 'no mag-card; cards=' + document.querySelectorAll('.nj-mag-card').length };
      const cimg = card.querySelector('.mag-cover img');
      if (!cimg) return { __err: 'no cover img; html=' + card.outerHTML.slice(0, 150) };
      const coverCV = getComputedStyle(card.querySelector('.mag-cover')).aspectRatio;
      const settle = getComputedStyle(cimg).transitionProperty;
      return {
        sumClean: !sumText.includes('<') && !sumText.includes('href') && sumText.includes('真正的摘要'),
        titleClean: !titleText.includes('<b>'),
        titleFont: titleFont.slice(0, 40), viewBg, viewH, sortActiveNonDefault: sortActiveBg !== viewBg,
        searchMax, paperInsetBg, paperBtnBg,
        dec: cimg.decoding, fp: cimg.fetchPriority || cimg.getAttribute('fetchpriority'), coverCV, settle: settle.includes('transform'),
      };
    `);
    if (a.__err) throw new Error('polish: ' + a.__err);
    ok(a.sumClean, '摘要 HTML 净化（无标签无 href，实体解出）');
    ok(a.titleClean, '标题标签剥离');
    ok(/serif/i.test(a.titleFont), '刊名衬线化（' + a.titleFont + '）');
    ok(a.viewBg === 'rgba(0, 0, 0, 0)', '按钮默认透明 ghost 底（' + a.viewBg + '）');
    ok(Math.round(a.viewH) === 26, '按钮统一 26px 高（' + a.viewH + '）');
    ok(a.sortActiveNonDefault, 'active 态与默认态可辨');
    ok(a.searchMax === '250px', '搜索框 max-width 250（' + a.searchMax + '）');
    ok(String(a.paperInsetBg).includes('0.9') || String(a.paperInsetBg).includes('0.90'), '纸感主题工具栏纸色（' + a.paperInsetBg + '）');
    ok(String(a.paperBtnBg).includes('255, 253, 246'), '纸感主题按钮纸片底（' + a.paperBtnBg + '）');
    ok(a.dec === 'async', '封面 decoding=async（' + a.dec + '）');
    ok(a.fp === 'low', '封面 fetchPriority=low（' + a.fp + '）');
    ok(a.coverCV !== 'auto' && a.coverCV.includes('/'), '封面 aspect-ratio 占位（' + a.coverCV + '）');
    ok(a.settle, '落位 settle 含 transform 过渡');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
