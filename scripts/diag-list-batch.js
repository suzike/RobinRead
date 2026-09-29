'use strict';
/**
 * diag-list-batch.js — R23 列表批量多选探针（run-all OFFLINE 集）
 * 验证：Ctrl+点击单选 / Shift+点击区间 / 再点反选清零 / 批量条计数与按钮 /
 *       批量动作走 read:*Many 通道且选后清空 / Esc 取消 / 重渲染清选
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, ipcMain } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-list-batch-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 120 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };
const ipcCalls = { markMany: [], starMany: [], laterMany: [] };
ipcMain.handle('read:markMany', (_e, ids, read) => { ipcCalls.markMany.push([ids, read]); return { ok: true }; });
ipcMain.handle('read:starMany', (_e, ids, starred) => { ipcCalls.starMany.push([ids, starred]); return { ok: true }; });
ipcMain.handle('read:laterMany', (_e, ids, later) => { ipcCalls.laterMany.push([ids, later]); return { ok: true }; });

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
    const a = await run('batch', `
      const { ListView } = await import('./views/list.js');
      const host = document.createElement('div');
      host.className = 'list-scroll';
      document.body.appendChild(host);
      let opened = 0;
      const lv = new ListView(host, { onSelect: () => { opened += 1; }, onContext: () => {}, onLoadMore: () => {}, onSearch: () => {} });
      window.__lv = lv;
      const titles = ['量子计算商用化进展观察', '深海火山口的生态系统', '城市地铁新线通车运营', '手冲咖啡的水温与粉水比', '山脊线上的冬季气象站'];
      const mk = (i, over = {}) => ({ id: 'b-' + i, title: titles[i], summaryPreview: '摘要用于探针', sourceTitle: '潮流周刊', publishedAt: 1758902400 + i * 86400, contentHead: '', ...over });
      lv.setViewMode('list');
      lv.render(Array.from({ length: 5 }, (_, i) => mk(i)), { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 250));
      const row = (i) => document.querySelector('.entry-row[data-entry-id="b-' + i + '"]');
      const click = (el, mods = {}) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...mods }));
      const pickedCount = () => document.querySelectorAll('.entry-row.nj-picked').length;
      const bar = () => document.querySelector('.list-batch-bar');
      // Ctrl+点击单选
      click(row(1), { ctrlKey: true });
      await new Promise(r => setTimeout(r, 60));
      const afterCtrl = { picked: pickedCount(), barShown: !!bar(), countText: bar()?.querySelector('.list-batch-count')?.textContent, opened };
      // Shift+点击区间 1→3
      click(row(3), { shiftKey: true });
      await new Promise(r => setTimeout(r, 60));
      const afterShift = { picked: pickedCount(), countText: bar()?.querySelector('.list-batch-count')?.textContent };
      // Ctrl+点击已选行 → 反选移除（2 条仍在），再移除剩余 → 条消失
      click(row(2), { ctrlKey: true });
      await new Promise(r => setTimeout(r, 60));
      const afterToggle = { picked: pickedCount(), barShown: !!bar() };
      click(row(1), { ctrlKey: true });
      await sleep2();
      function sleep2() { return new Promise(r => setTimeout(r, 60)); }
      click(row(3), { ctrlKey: true });
      await new Promise(r => setTimeout(r, 60));
      const afterToggleAll = { picked: pickedCount(), barGone: !bar() };
      // 重新圈选 0..2（Ctrl 定锚 + Shift 收区间）后点批量已读
      click(row(0), { ctrlKey: true });
      await new Promise(r => setTimeout(r, 60));
      click(row(2), { shiftKey: true });
      await new Promise(r => setTimeout(r, 60));
      const before = pickedCount();
      click(bar().querySelector('.b-read'));
      await new Promise(r => setTimeout(r, 120));
      const afterRead = { pickedBeforeRead: before, picked: pickedCount(), barGone: !bar() };
      // 收藏 + 稍后读通道
      click(row(0), { ctrlKey: true });
      await new Promise(r => setTimeout(r, 60));
      click(bar().querySelector('.b-star'));
      await new Promise(r => setTimeout(r, 60));
      click(row(0), { ctrlKey: true });
      await new Promise(r => setTimeout(r, 60));
      click(bar().querySelector('.b-later'));
      await new Promise(r => setTimeout(r, 60));
      // Esc 取消
      click(row(0), { ctrlKey: true });
      click(row(4), { ctrlKey: true });
      await new Promise(r => setTimeout(r, 60));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 60));
      const afterEsc = { picked: pickedCount(), barGone: !bar() };
      // 重渲染清选（R33 起：同签名跳过重建会保留选择——这是收益；改用三态变化的重载验证清选）
      click(row(0), { ctrlKey: true });
      click(row(1), { ctrlKey: true });
      await new Promise(r => setTimeout(r, 60));
      const keptThroughSameSig = document.querySelectorAll('.entry-row.nj-picked').length;
      lv.render(Array.from({ length: 5 }, (_, i) => mk(i, i === 0 ? { isRead: true } : {})), { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 120));
      const afterRender = { keptThroughSameSig, picked: document.querySelectorAll('.entry-row.nj-picked').length, barGone: !document.querySelector('.list-batch-bar') };
      return { afterCtrl, afterShift, afterToggle, afterToggleAll, afterRead, afterEsc, afterRender, opened };
    `);
    if (a.__err) throw new Error('batch: ' + a.__err);
    ok(a.afterCtrl.picked === 1 && a.afterCtrl.barShown && a.afterCtrl.opened === 0, 'Ctrl+点击单选且不打开文章（picked ' + a.afterCtrl.picked + '）');
    ok(a.afterCtrl.countText.includes('1'), '批量条计数「已选 1 篇」（' + a.afterCtrl.countText + '）');
    ok(a.afterShift.picked === 3, 'Shift+点击区间选 1→3（picked ' + a.afterShift.picked + '）');
    ok(a.afterToggle.picked === 2 && a.afterToggle.barShown, 'Ctrl+点击已选行反选移除（picked ' + a.afterToggle.picked + '）');
    ok(a.afterToggleAll.picked === 0 && a.afterToggleAll.barGone, '全部反选到 0 后批量条消失');
    ok(a.afterRead.pickedBeforeRead === 3 && a.afterRead.picked === 0 && a.afterRead.barGone, '批量已读后清选收条');
    ok(a.afterEsc.picked === 0 && a.afterEsc.barGone, 'Esc 取消选择');
    ok(a.afterRender.keptThroughSameSig === 2, 'R33 同签名推送不清批量选择（保 ' + a.afterRender.keptThroughSameSig + ' 条）');
    ok(a.afterRender.picked === 0 && a.afterRender.barGone, '实质变化重载清选收条');
    ok(ipcCalls.markMany.length === 1 && ipcCalls.markMany[0][0].length === 3 && ipcCalls.markMany[0][1] === true, 'read:markMany 参数正确（' + JSON.stringify(ipcCalls.markMany[0]) + '）');
    ok(ipcCalls.starMany.length === 1, 'read:starMany 通道命中（' + ipcCalls.starMany.length + ' 次）');
    ok(ipcCalls.laterMany.length === 1 && ipcCalls.laterMany[0][1] === true, 'read:laterMany 通道命中');
    // R25：Ctrl+A 全选 / 视野智能（收藏视野→取消收藏 starMany(false)；稍后读视野→移出 laterMany(false)）
    const b = await run('r25', `
      const lv = window.__lv;
      const bar2 = () => document.querySelector('.list-batch-bar');
      document.body.focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 80));
      const allPicked = document.querySelectorAll('.entry-row.nj-picked').length;
      const countAll = bar2()?.querySelector('.list-batch-count')?.textContent;
      bar2()?.querySelector('.b-cancel')?.click();
      await new Promise(r => setTimeout(r, 60));
      // 收藏视野：批量条第二键应为「取消收藏」→ starMany(ids,false)
      lv.render([{ id: 's-0', title: '量子计算商用化进展观察', summaryPreview: '摘要', sourceTitle: '潮流周刊', publishedAt: 1758902400, contentHead: '' }, { id: 's-1', title: '深海火山口的生态系统', summaryPreview: '摘要', sourceTitle: '潮流周刊', publishedAt: 1758902000, contentHead: '' }], { kind: 'starred' }, null, true);
      await new Promise(r => setTimeout(r, 150));
      document.querySelectorAll('.entry-row')[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
      document.querySelectorAll('.entry-row')[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
      await new Promise(r => setTimeout(r, 60));
      const starLabel = bar2()?.querySelector('.b-star')?.textContent;
      bar2()?.querySelector('.b-star')?.click();
      await new Promise(r => setTimeout(r, 80));
      const starBarGone = !bar2();
      // 稍后读视野：第二键应为「移出稍后读」→ laterMany(ids,false)
      lv.render([{ id: 'l-0', title: '城市地铁新线通车运营', summaryPreview: '摘要', sourceTitle: '潮流周刊', publishedAt: 1758902400, contentHead: '' }], { kind: 'later' }, null, true);
      await new Promise(r => setTimeout(r, 150));
      document.querySelectorAll('.entry-row')[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
      await new Promise(r => setTimeout(r, 60));
      const laterLabel = bar2()?.querySelector('.b-later')?.textContent;
      bar2()?.querySelector('.b-later')?.click();
      await new Promise(r => setTimeout(r, 80));
      return { allPicked, countAll, starLabel, starBarGone, laterLabel };
    `);
    if (b.__err) throw new Error('r25: ' + b.__err);
    ok(b.allPicked === 5 && (b.countAll || '').includes('5'), 'R25 Ctrl+A 全选当前视野（' + b.countAll + '）');
    ok(b.starLabel === '取消收藏', 'R25 收藏视野批量条出「取消收藏」（' + b.starLabel + '）');
    ok(b.starBarGone && ipcCalls.starMany.some(([ids, v]) => v === false && ids.length === 2), 'R25 starMany(ids,false) 通道命中（取消收藏）');
    ok(b.laterLabel === '移出稍后读', 'R25 稍后读视野批量条出「移出稍后读」（' + b.laterLabel + '）');
    ok(ipcCalls.laterMany.some(([ids, v]) => v === false), 'R25 laterMany(ids,false) 通道命中（移出）');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
