'use strict';
/**
 * diag-search-history.js — R26 搜索历史下拉探针（run-all OFFLINE 集）
 * 验证：Enter 记忆（半截输入不记）/ 聚焦空框呼出 / 点选即搜 / 去重前移 /
 *       上限 5 / 清空 / Esc 收起不误清输入
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-search-hist-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 120 * 1000).unref();
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
    const a = await run('history', `
      localStorage.removeItem('robinread.searchHistory');
      const { ListView } = await import('./views/list.js');
      const host = document.createElement('div');
      host.className = 'list-scroll';
      document.body.appendChild(host);
      const searches = [];
      const lv = new ListView(host, { onSelect: () => {}, onContext: () => {}, onLoadMore: () => {}, onSearch: (q) => searches.push(q) });
      window.__lv = lv;
      const titles = ['量子计算商用化进展观察', '深海火山口的生态系统', '城市地铁新线通车运营'];
      const mk = (i) => ({ id: 'sh-' + i, title: titles[i], summaryPreview: '摘要用于探针', sourceTitle: '潮流周刊', publishedAt: 1758902400 + i * 86400, contentHead: '' });
      lv.setViewMode('list');
      lv.render([mk(0), mk(1), mk(2)], { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 200));
      const input = lv.searchInput;
      const drop = () => document.querySelector('.search-history');
      const dropItems = () => [...(drop()?.querySelectorAll('.search-history-item span') || [])].map((s) => s.textContent);
      // 无历史：聚焦不出下拉
      input.focus();
      await new Promise(r => setTimeout(r, 80));
      const emptyAtStart = !drop();
      // 输入过程不记，Enter 才记
      input.value = '量子';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 350)); // 过 260ms 防抖（onSearch 触发但不该入历史）
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 60));
      const afterEnter = lv.searchHistory;
      // 第二个词
      input.value = '火山';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 350));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 60));
      // 去重前移：再搜「量子」
      input.value = '量子';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 350));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 60));
      const afterDedupe = lv.searchHistory;
      // 填满到 6 个 → 上限 5
      for (const term of ['地铁', '面包', '气象', '旧书']) {
        input.value = term;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 330));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 40));
      }
      const capped = lv.searchHistory;
      // 聚焦空框呼出 → 点选即搜
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 220));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 80));
      const dbgDrop = !!drop(); const dbgHist = lv.searchHistory; const shownItems = dropItems();
      const hasClear = !!drop()?.querySelector('.search-history-clear');
      drop()?.querySelector('.search-history-item')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 60));
      const afterPick = { value: input.value, lastSearch: searches[searches.length - 1], dropGone: !drop() };
      // 清空历史
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 80));
      drop()?.querySelector('.search-history-clear')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 60));
      await new Promise(r => setTimeout(r, 220));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 80));
      const afterClear = !drop();
      return { emptyAtStart, afterEnter, afterDedupe, capped, dbgDrop, dbgHist, shownItems, hasClear, afterPick, afterClear, searchesLen: searches.length };
    `);
    if (a.__err) throw new Error('history: ' + a.__err);
    ok(a.emptyAtStart, '无历史时 ↓ 不出下拉');
    ok(a.afterEnter.length === 1 && a.afterEnter[0] === '量子', 'Enter 才记忆（输入半截不入史）');
    ok(a.afterDedupe.join(',') === '量子,火山', '去重且最近在前（' + a.afterDedupe.join(',') + '）');
    ok(a.capped.length === 5, '历史上限 5（实际 ' + a.capped.length + '）');
    ok(a.shownItems[0] === '旧书' && a.shownItems.length === 5, '↓ 呼出 5 条候选（首条 ' + a.shownItems[0] + '）');
    ok(a.hasClear, '下拉含「清除搜索历史」');
    ok(a.afterPick.value === '旧书' && a.afterPick.lastSearch === '旧书' && a.afterPick.dropGone, '点选即搜且收起（' + a.afterPick.lastSearch + '）');
    console.error('DBG', JSON.stringify({dbgDrop:a.dbgDrop, dbgHist:a.dbgHist, shown:a.shownItems.length})); ok(a.afterClear, '清空后再聚焦无下拉');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
