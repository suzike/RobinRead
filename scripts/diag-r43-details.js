'use strict';
/**
 * diag-r43-details.js — R43 细节三连探针（run-all OFFLINE 集）
 * 验证：期刊速查面板 role=dialog+aria-label / 搜索历史下拉 role=listbox+
 *       候选 role=option+aria-selected 同步 / 窄窗 (≤1000px) 进度文字让位防重叠
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r43-')));
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
    const a = await run('details', `
      // ① 速查面板 dialog 语义
      const mod = await import('./views/edition-reader.js');
      const ARTICLE = Array.from({ length: 14 }, (_, i) => '<h2>第' + (i + 1) + '节</h2><p>段落内容用于多页分页与窄窗进度文字探针，长度适中覆盖两到三行。</p>').join('');
      const mk = (i) => ({ id: 'r43-' + i, title: '条目' + i, summaryPreview: '摘要', sourceTitle: '潮流周刊', publishedAt: 1758902400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 12 }, (_, i) => mk(i)), fetchArticle: async () => ARTICLE });
      er.present();
      clearTimeout(er._autoTimer);
      er._doOpen();
      await new Promise(r => setTimeout(r, 800));
      er._toggleKeysPanel();
      await new Promise(r => setTimeout(r, 200));
      const panel = document.querySelector('.er-keys-panel');
      const panelRole = panel?.getAttribute('role');
      const panelLabel = panel?.getAttribute('aria-label');
      // ② 历史下拉 listbox 语义
      const { ListView } = await import('./views/list.js');
      const host = document.createElement('div');
      host.className = 'list-scroll';
      document.body.appendChild(host);
      const lv = new ListView(host, { onSelect: () => {}, onContext: () => {}, onLoadMore: () => {}, onSearch: () => {} });
      window.__lv = lv;
      localStorage.setItem('robinread.searchHistory', JSON.stringify(['量子', '火山', '地铁']));
      const titles = ['量子计算商用化进展观察', '深海火山口的生态系统', '城市地铁新线通车运营'];
      const mkL = (i) => ({ id: 'r43l-' + i, title: titles[i], summaryPreview: '摘要', sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 60, contentHead: '' });
      lv.setViewMode('list');
      lv.render([mkL(0), mkL(1), mkL(2)], { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 200));
      lv._showSearchHistory();
      await new Promise(r => setTimeout(r, 60));
      const drop = document.querySelector('.search-history');
      const dropRole = drop?.getAttribute('role');
      const opts = [...document.querySelectorAll('.search-history-item')];
      const optRoles = opts.map((o) => o.getAttribute('role')).join(',');
      lv._moveHistoryHighlight(1);
      await new Promise(r => setTimeout(r, 40));
      const selSync = opts.map((o) => o.getAttribute('aria-selected')).join(',');
      const hlIdx = opts.findIndex((o) => o.classList.contains('hl'));
      return { panelRole, panelLabel, dropRole, optRoles, selSync, hlIdx };
    `);
    if (a.__err) throw new Error('details: ' + a.__err);
    // ③ 窄窗进度文字让位（Node 侧收窗 → media query 生效）
    win.setBounds({ width: 900, height: 900 });
    await sleep(600);
    const b = await run('narrow', `return { narrowHidden: (() => { const el = document.querySelector('.er-rail .er-count'); return el ? getComputedStyle(el).display === 'none' : true; })() };`);
    if (b.__err) throw new Error('narrow: ' + b.__err);
    ok(a.panelRole === 'dialog' && (a.panelLabel || '').length > 0, '速查面板 role=dialog + aria-label');
    ok(a.dropRole === 'listbox', '历史下拉 role=listbox');
    ok(a.optRoles === 'option,option,option', '候选项 role=option（' + a.optRoles + '）');
    ok(a.hlIdx === 0 && a.selSync === 'true,false,false', 'aria-selected 随高亮同步（' + a.selSync + '）');
    console.error('DBG', JSON.stringify(b).slice(0, 600));
    ok(b.narrowHidden === true, '窄窗 ≤1000px 进度文字让位（media query 生效）');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
