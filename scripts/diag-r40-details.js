'use strict';
/**
 * diag-r40-details.js — R40 细节三连探针（run-all OFFLINE 集）
 * 验证：阅读器标签 chips 换行（窄容器不溢出）/ 搜索历史 ↓↓ 高亮循环 + Enter 选中 /
 *       ↑ 回退 / 期刊工具条 8 键 aria-label 齐备
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r40-')));
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
      // ① chips 换行：窄容器 6 长标签 → 容器高度两行、无横向溢出
      const chipsWrap = document.createElement('div');
      chipsWrap.className = 'robin-header-meta';
      chipsWrap.style.cssText = 'width:280px;';
      document.body.appendChild(chipsWrap);
      const chips = document.createElement('span');
      chips.className = 'robin-tag-chips';
      chipsWrap.appendChild(chips);
      for (const t of ['大模型', '智能体框架与编排', '检索增强生成', '多模态与具身智能', 'TypeScript 工程实践', '分布式系统']) {
        const chip = document.createElement('button');
        chip.className = 'robin-tag-chip';
        chip.textContent = '#' + t;
        chips.appendChild(chip);
      }
      await new Promise(r => setTimeout(r, 80));
      const cw = chipsWrap.clientWidth;
      const chipsOverflow = chips.scrollWidth > cw + 1;
      const twoRows = chips.getBoundingClientRect().height > 30;
      chipsWrap.remove();
      // ② 搜索历史键盘导航
      const { ListView } = await import('./views/list.js');
      const host = document.createElement('div');
      host.className = 'list-scroll';
      document.body.appendChild(host);
      const picked = [];
      const lv = new ListView(host, { onSelect: () => {}, onContext: () => {}, onLoadMore: () => {}, onSearch: (q) => picked.push(q) });
      window.__lv = lv;
      localStorage.removeItem('robinread.searchHistory');
      const titles = ['量子计算商用化进展观察', '深海火山口的生态系统', '城市地铁新线通车运营'];
      const mk = (i) => ({ id: 'r40-' + i, title: titles[i], summaryPreview: '摘要', sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 60, contentHead: '' });
      lv.setViewMode('list');
      lv.render([mk(0), mk(1), mk(2)], { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 200));
      const input = lv.searchInput;
      for (const term of ['量子', '火山', '地铁']) {
        input.value = term;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 330));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 40));
      }
      lv._showSearchHistory();
      await new Promise(r => setTimeout(r, 60));
      const items = [...document.querySelectorAll('.search-history-item')];
      const key = (k) => input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      key('ArrowDown'); key('ArrowDown'); // 高亮第 2 项「火山」
      await new Promise(r => setTimeout(r, 40));
      const hlAfter2 = [...document.querySelectorAll('.search-history-item')].findIndex((el) => el.classList.contains('hl'));
      key('ArrowUp'); // 回到第 1 项
      await new Promise(r => setTimeout(r, 40));
      const hlAfterUp = [...document.querySelectorAll('.search-history-item')].findIndex((el) => el.classList.contains('hl'));
      key('Enter'); // 选中高亮项
      await new Promise(r => setTimeout(r, 80));
      const enterPicked = { value: input.value, lastSearch: picked[picked.length - 1], gone: !document.querySelector('.search-history') };
      // ③ 工具条 aria-label
      const mod = await import('./views/edition-reader.js');
      const ARTICLE = '<p>正文用于 aria 探针。</p>';
      const mkE = (i) => ({ id: 'ax-' + i, title: '条目' + i, summaryPreview: '摘要', sourceTitle: '潮流周刊', publishedAt: 1758902400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 4 }, (_, i) => mkE(i)), fetchArticle: async () => ARTICLE });
      er.present();
      clearTimeout(er._autoTimer);
      er._doOpen();
      await new Promise(r => setTimeout(r, 800));
      const toolBtns = [...document.querySelectorAll('.er-tools button')];
      const ariaOk = toolBtns.length === 8 && toolBtns.every((b) => (b.getAttribute('aria-label') || '').length > 0);
      const sample = toolBtns.slice(0, 2).map((b) => b.getAttribute('aria-label'));
      return { chipsOverflow, twoRows, itemsN: items.length, hlAfter2, hlAfterUp, enterPicked, ariaOk, sample, toolN: toolBtns.length };
    `);
    if (a.__err) throw new Error('details: ' + a.__err);
    ok(!a.chipsOverflow && a.twoRows, '标签 chips 窄容器换行（两行、零横向溢出）');
    ok(a.itemsN === 3, '历史下拉 3 候选');
    ok(a.hlAfter2 === 1, '↓↓ 高亮第 2 项（' + a.hlAfter2 + '）');
    ok(a.hlAfterUp === 0, '↑ 回退第 1 项（' + a.hlAfterUp + '）');
    ok(a.enterPicked.value === '地铁' && a.enterPicked.lastSearch === '地铁' && a.enterPicked.gone, 'Enter 选中高亮项（第 0 项）即搜（' + a.enterPicked.lastSearch + '）');
    ok(a.toolN === 8 && a.ariaOk, '期刊工具条 8 键 aria-label 齐备（' + (a.sample || []).join('/') + '…）');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
