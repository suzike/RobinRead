'use strict';
/**
 * diag-list-nav.js — R28 列表键盘导航探针（run-all OFFLINE 集）
 * 验证：J/K 移动光标（id 锚定）/ 顶底钳位 / Enter·o 打开光标项 / 输入框聚焦让路 /
 *       期刊与命令面板打开时让路 / 重渲染后光标环恢复 / 光标与批选叠态
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-list-nav-')));
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
    const a = await run('nav', `
      const { ListView } = await import('./views/list.js');
      const host = document.createElement('div');
      host.className = 'list-scroll';
      document.body.appendChild(host);
      const opened = [];
      const lv = new ListView(host, { onSelect: (id) => opened.push(id), onContext: () => {}, onLoadMore: () => {}, onSearch: () => {} });
      window.__lv = lv;
      const titles = ['量子计算商用化进展观察', '深海火山口的生态系统', '城市地铁新线通车运营', '手冲咖啡的水温与粉水比'];
      const mk = (i) => ({ id: 'n-' + i, title: titles[i], summaryPreview: '摘要用于探针', sourceTitle: '潮流周刊', publishedAt: 1758902400 + i * 86400, contentHead: '' });
      lv.setViewMode('list');
      lv.render([mk(0), mk(1), mk(2), mk(3)], { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 200));
      const cur = () => document.querySelector('.entry-row.nj-cursor')?.dataset.entryId || null;
      const key = (k, target) => (target || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      // J 两步 → n-1；K 一步 → n-0；K 顶部钳位
      key('j'); await new Promise(r => setTimeout(r, 40));
      const s1 = cur();
      key('j'); await new Promise(r => setTimeout(r, 40));
      key('k'); await new Promise(r => setTimeout(r, 40));
      const s2 = cur();
      key('k'); await new Promise(r => setTimeout(r, 40));
      const s3 = cur();
      key('k'); await new Promise(r => setTimeout(r, 40));
      const s4 = cur();
      // Enter 打开光标项；o 亦可
      key('Enter'); await new Promise(r => setTimeout(r, 40));
      key('j'); await new Promise(r => setTimeout(r, 40));
      key('o'); await new Promise(r => setTimeout(r, 40));
      const openSeq = opened.join(',');
      // 输入框聚焦让路
      const inp = document.createElement('input');
      document.body.appendChild(inp);
      inp.focus();
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 40));
      const beforeInputNav = cur();
      inp.remove();
      // 重渲染后光标环恢复（id 锚定）
      lv.render([mk(0), mk(1), mk(2), mk(3)], { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 150));
      const restored = cur();
      // 杂志卡同样受光标
      lv.setViewMode('magazine');
      lv.render([mk(0), mk(1), mk(2)], { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 200));
      key('k'); await new Promise(r => setTimeout(r, 40));
      const magCur = cur();
      // 光标+批选叠态
      lv.setViewMode('list');
      lv.render([mk(0), mk(1), mk(2), mk(3)], { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 150));
      const curID = window.__lv.cursorID;
      document.querySelector('.entry-row[data-entry-id="' + curID + '"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
      await new Promise(r => setTimeout(r, 40));
      const bothClasses = document.querySelector('.entry-row[data-entry-id="' + curID + '"]').className.includes('nj-cursor') && document.querySelector('.entry-row[data-entry-id="' + curID + '"]').className.includes('nj-picked');
      // R29：J 触底请求加载更多（先光标落末条再 J）；? 呼出速查；Esc 收起
      lv.render([mk(0), mk(1), mk(2), mk(3)], { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 150));
      window.__loadMore = 0;
      lv.handlers.onLoadMore = () => { window.__loadMore += 1; };
      key('j'); key('j'); key('j'); key('j');
      await new Promise(r => setTimeout(r, 60));
      const atLast = cur() === 'n-3';
      key('j');
      await new Promise(r => setTimeout(r, 60));
      const loadMoreCalls = window.__loadMore;
      key('?', null);
      await new Promise(r => setTimeout(r, 60));
      const keysRows = document.querySelectorAll('.list-keys-row').length;
      const keysHead = document.querySelector('.list-keys-head')?.textContent;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 60));
      const keysClosed = !document.querySelector('.list-keys-panel');
      return { s1, s2, s3, s4, openSeq, beforeInputNav, restored, magCur, bothClasses, atLast, loadMoreCalls, keysRows, keysHead, keysClosed };
    `);
    if (a.__err) throw new Error('nav: ' + a.__err);
    ok(a.s1 === 'n-0' && a.s2 === 'n-0', 'J/K 移动光标（首个 J 落第 0 条，' + a.s1 + ' → ' + a.s2 + '）');
    ok(a.s3 === 'n-0' && a.s4 === 'n-0', '顶部 K 钳位停在首条（' + a.s3 + '/' + a.s4 + '）');
    ok(a.openSeq === 'n-0,n-1', 'Enter/o 打开光标项（' + a.openSeq + '）');
    ok(a.beforeInputNav === 'n-1', '输入框聚焦时 J 不移动光标');
    ok(a.restored === 'n-1', '重渲染后光标环按 id 恢复（' + a.restored + '）');
    ok(a.magCur === 'n-0', '杂志卡同样受光标（' + a.magCur + '）');
    ok(a.bothClasses, '光标与批选叠态共存');
    ok(a.atLast && a.loadMoreCalls >= 1, 'R29 J 触底请求加载更多（' + a.loadMoreCalls + ' 次）');
    ok(a.keysRows === 6 && a.keysHead.length > 0, 'R29 ? 呼出速查 6 行（' + a.keysRows + '）');
    ok(a.keysClosed, 'R29 Esc 收起速查面板');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
