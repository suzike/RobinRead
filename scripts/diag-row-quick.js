'use strict';
/**
 * diag-row-quick.js — R22 行内快捷操作探针（run-all OFFLINE 集）
 * 验证：列表行/杂志卡均挂 3 键（已读·收藏·稍后读）/ 静止隐藏、focus-within 浮现 /
 *       点击不触发整行打开且 IPC 参数正确（未读→已读、已读→未读、稍后读 toggle）
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, ipcMain } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-row-quick-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 120 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };
// 主进程侧记录真实 IPC 通道调用（list.js 点击 → preload invoke → ipcMain）
const ipcCalls = { read: [], star: [], later: [] };
ipcMain.handle('read:mark', (_e, id, v) => { ipcCalls.read.push([id, v]); return { ok: true }; });
ipcMain.handle('read:toggleStar', (_e, id) => { ipcCalls.star.push(id); return { ok: true }; });
ipcMain.handle('read:toggleLater', (_e, id, v) => { ipcCalls.later.push([id, v]); return { ok: true }; });

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
    const a = await run('list', `
      const { ListView } = await import('./views/list.js');
      const host = document.createElement('div');
      host.className = 'list-scroll';
      document.body.appendChild(host);
      let opened = 0;
      const lv = new ListView(host, { onSelect: () => { opened += 1; }, onContext: () => {}, onLoadMore: () => {}, onSearch: () => {} });
      window.__lv = lv;
      const titles = ['量子计算商用化进展观察', '深海火山口的生态系统', '城市地铁新线通车运营', '手冲咖啡的水温与粉水比'];
      const mk = (i, over = {}) => ({ id: 'q-' + i, title: titles[i], summaryPreview: '摘要用于探针', sourceTitle: '潮流周刊', publishedAt: 1758902400 + i * 86400, contentHead: '', ...over });
      lv.setViewMode('list');
      lv.render([mk(0), mk(1, { isRead: true }), mk(2, { isStarred: true }), mk(3, { isLater: true })], { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 250));
      const rows = [...document.querySelectorAll('.entry-row')];
      if (!rows.length) {
        return { __err: 'no rows; hostConnected=' + host.isConnected + ' rowsHostKids=' + (lv.rowsHost ? lv.rowsHost.children.length : 'n/a') + ' viewMode=' + lv.viewMode + ' items=' + (lv.items ? lv.items.length : 'n/a') };
      }
      const btnsPerRow = rows.map((r) => r.querySelectorAll('.row-quick-btn').length);
      const bar = rows[0].querySelector('.row-quick');
      const restOpacity = getComputedStyle(bar).opacity;
      // focus-within 浮现
      rows[0].querySelector('.q-star').focus();
      await new Promise(r => setTimeout(r, 400));
      const focusOpacity = getComputedStyle(bar).opacity;
      // 点击收藏：不打开整行、IPC 正确
      rows[0].querySelector('.q-star').click();
      await new Promise(r => setTimeout(r, 80));
      // 收藏点击计数由主进程 ipcCalls.star 侧验证
      // 已读切换两端：未读行 → markRead(id,true)；已读行 → markRead(id,false)
      rows[0].querySelector('.q-read').click();
      rows[1].querySelector('.q-read').click();
      await new Promise(r => setTimeout(r, 80));
      // 稍后读 toggle：非稍后读行 → true；已入队行 → false
      rows[0].querySelector('.q-later').click();
      rows[3].querySelector('.q-later').click();
      await new Promise(r => setTimeout(r, 80));
      const starTitle = rows[2].querySelector('.q-star').title;
      const laterTitle = rows[3].querySelector('.q-later').title;
      // 杂志卡同样挂浮条
      lv.setViewMode('magazine');
      lv.render([mk(0), mk(1, { isStarred: true })], { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 250));
      const cardBtns = [...document.querySelectorAll('.nj-mag-card')].map((c) => c.querySelectorAll('.row-quick-btn').length);
      return { btnsPerRow, restOpacity, focusOpacity, opened, starTitle, laterTitle, cardBtns };
    `);
    if (a.__err) throw new Error('list: ' + a.__err);
    const readCalls = ipcCalls.read.map((x) => x[1]);
    const laterCalls = ipcCalls.later.map((x) => x[1]);
    ok(a.btnsPerRow.join(',') === '3,3,3,3', '每行挂 3 键（' + a.btnsPerRow.join(',') + '）');
    ok(parseFloat(a.restOpacity) === 0, '静止态隐藏（opacity ' + a.restOpacity + '）');
    ok(parseFloat(a.focusOpacity) === 1, 'focus-within 浮现（opacity ' + a.focusOpacity + '）');
    ok(a.opened === 0 && ipcCalls.star.length === 1, '点击收藏不触发整行打开且只调一次 IPC（star ' + ipcCalls.star.length + ' 次）');
    ok(readCalls.join(',') === 'true,false', '已读切换两端正确（' + readCalls.join(',') + '）');
    ok(laterCalls.join(',') === 'true,false', '稍后读 toggle 两端正确（' + laterCalls.join(',') + '）');
    ok(a.starTitle.length > 0 && a.laterTitle.length > 0, '收藏/稍后读态 title 非空');
    ok(a.cardBtns.join(',') === '3,3', '杂志卡同样挂 3 键（' + a.cardBtns.join(',') + '）');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
