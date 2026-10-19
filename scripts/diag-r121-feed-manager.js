'use strict';
/**
 * diag-r121-feed-manager.js — R121 批量订阅管理探针（run-all OFFLINE 集，真实后端零网络）
 *
 * 背景：侧栏 Ctrl+点多选 + 右键批量删除早已存在但不可发现，用户实报
 * 「没法批量选择订阅源、一键移除」。R121 做显式订阅管理浮层。
 *
 * 验证项：
 *  1 侧栏「更多」行管理入口在册（title=订阅管理）
 *  2 浮层打开：分组行数与订阅总数一致
 *  3 行点击即选 + Shift 连选区间（已选 N 项计数）
 *  4 全选/搜索过滤联动（过滤后全选只选可见项）
 *  5 一键移除：确认框（危险色 OK）→ 源真删（getSidebar 数量）→ 浮层行数同步
 *  6 Esc 关浮层
 *  7 静态锚：侧栏 Shift 连选在场（_multiSelectAnchor）+ 右键菜单「批量管理订阅…」入口
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

// 必须在 app ready 前 require：ipc.js 顶层注册 robin-icon 特权 scheme（与生产 main.js 相同）
require('../src/main/ipc');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r121-'));
app.setPath('userData', userData);
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 180 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };

app.whenReady().then(async () => {
  try {
    const { AppStore } = require('../src/main/AppStore');
    const { LOCAL_ACCOUNT_ID } = require('../src/main/Models');
    const { registerIPCHandlers } = require('../src/main/ipc');
    const store = new AppStore(userData);

    // 6 个源（feed-0 带 3 篇文章；标题/摘要/正文逐篇差异化——同模板种子会被
    // F21 事件聚合成一条 cluster 行，entry-row 判据就数不到行）
    const feedIDs = [];
    for (let i = 0; i < 6; i += 1) {
      const f = store.feedsRepo.insertFeed({
        accountID: LOCAL_ACCOUNT_ID, title: `管理探针源 ${i}`,
        siteURL: 'https://probe.example', feedURL: `https://probe.example/${i}/rss`,
      });
      feedIDs.push(f.id);
    }
    const THEMES = ['超导量子比特', '深海热泉生态', '城市轨道通车'];
    store._applyParsedEntries(store.feedsRepo.feed(feedIDs[0]), THEMES.map((theme, n) => ({
      id: `m-${n}`, title: `${theme}的最新观察`, url: `https://probe.example/a/${n}`,
      publishedAt: Math.floor(Date.now() / 1000) + n,
      summary: `${theme}领域的独立摘要，内容互不相同以避免事件聚类。编号 ${n}。`,
      contentHTML: `<p>${theme}的正文段落，每篇主题独立、词汇分布不同，确保 bigram 相似度低于聚类阈值。</p>`,
      enclosure: null,
    })));

    const win = new BrowserWindow({
      show: false, width: 1600, height: 1000,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') },
    });
    registerIPCHandlers(store, win);
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    const run = (tag, js) => {
      console.log('PHASE ' + tag);
      return win.webContents.executeJavaScript('(async () => { try { ' + js + ' } catch (e) { return { __err: String(e && e.stack || e) }; } })()');
    };

    // boot：等 app.js bootstrap 完成
    let booted = false;
    for (let i = 0; i < 80 && !booted; i += 1) {
      await sleep(250);
      booted = await win.webContents.executeJavaScript('!!window.__robinReader && document.querySelectorAll("#list-scroll .entry-row").length >= 3');
    }
    ok(booted, 'boot 应用启动、列表渲染 ≥3 行');

    // ── 1 管理入口 ──
    const entry = await run('entry', `
      const btn = [...document.querySelectorAll('#sidebar-footer .footer-nav-btn')].find((b) => (b.title || '').includes('订阅管理'));
      if (!btn) return { noBtn: true };
      btn.click();
      await new Promise((r) => setTimeout(r, 900));
      return { opened: !!document.querySelector('.fm-modal'), rows: document.querySelectorAll('.fm-row').length,
        title: document.querySelector('.fm-title')?.textContent || '' };
    `);
    if (entry.__err) throw new Error('entry: ' + entry.__err);
    ok(!entry.noBtn, '1 侧栏「更多」行管理入口在册（title=订阅管理）');
    ok(entry.opened && entry.rows === 6, `2 浮层打开且 6 行全量在册（实际 rows=${entry.rows}）`);

    // ── 3 点击选择 + Shift 连选 ──
    const sel = await run('select', `
      const rows = [...document.querySelectorAll('.fm-row')];
      rows[0].click();
      await new Promise((r) => setTimeout(r, 120));
      rows[3].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
      await new Promise((r) => setTimeout(r, 220));
      return { note: document.querySelector('.fm-sel-note')?.textContent || '',
        checked: document.querySelectorAll('.fm-row.fm-checked').length };
    `);
    if (sel.__err) throw new Error('select: ' + sel.__err);
    ok(sel.checked === 4 && /4/.test(sel.note), `3 行点击 + Shift 连选区间（选中 ${sel.checked}，note=${sel.note}）`);

    // ── 4 搜索过滤 + 过滤后全选（含焦点保持：审查 P1 修复锁）──
    const filt = await run('filter', `
      const input = document.querySelector('.fm-search');
      input.focus();
      input.value = '管理探针源 1';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      const focusKept = document.activeElement === input;
      const visible = document.querySelectorAll('.fm-row').length;
      const allBtn = [...document.querySelectorAll('.fm-toolbar .btn-text')].find((b) => b.textContent === '全选');
      allBtn.click();
      await new Promise((r) => setTimeout(r, 200));
      const checked = document.querySelectorAll('.fm-row.fm-checked').length;
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      const noneBtn = [...document.querySelectorAll('.fm-toolbar .btn-text')].find((b) => b.textContent === '全不选');
      noneBtn.click();
      await new Promise((r) => setTimeout(r, 200));
      return { focusKept, visible, checkedAfterAll: checked, noneLeft: document.querySelectorAll('.fm-row.fm-checked').length };
    `);
    if (filt.__err) throw new Error('filter: ' + filt.__err);
    ok(filt.focusKept, '4-0 搜索防抖重渲染后输入框焦点保持（审查 P1 修复锁）');
    ok(filt.visible === 1 && filt.checkedAfterAll === 1, `4a 搜索过滤后全选只选可见（可见 ${filt.visible}，选中 ${filt.checkedAfterAll}）`);
    ok(filt.noneLeft === 0, '4b 全不选清空');

    // ── 5 一键移除 ──
    const feedCount = () => store.feedsRepo.allFeeds().length;
    const before = feedCount();
    const rm = await run('remove', `
      const rows = [...document.querySelectorAll('.fm-row')];
      rows[0].click();
      await new Promise((r) => setTimeout(r, 120));
      rows[1].click();
      await new Promise((r) => setTimeout(r, 220));
      const removeBtn = [...document.querySelectorAll('.fm-actions .btn-text')].find((b) => b.textContent.includes('移除所选'));
      removeBtn.click();
      await new Promise((r) => setTimeout(r, 350));
      const confirmBtn = document.querySelector('.modal.small .modal-footer .btn-text.danger');
      if (!confirmBtn) return { noConfirm: true };
      const confirmText = confirmBtn.textContent;
      confirmBtn.click();
      await new Promise((r) => setTimeout(r, 900));
      return { confirmText, rowsAfter: document.querySelectorAll('.fm-row').length,
        noteHidden: document.querySelector('.fm-actions')?.hidden };
    `);
    if (rm.__err) throw new Error('remove: ' + rm.__err);
    ok(!rm.noConfirm && rm.confirmText === '删除', `5a 移除确认框（危险色 OK=${rm.confirmText || '无'}）`);
    const after = feedCount();
    ok(before === 6 && after === 4, `5b 一键移除真删（订阅 ${before} → ${after}）`);
    ok(rm.rowsAfter === 4, `5c 浮层行数同步（${rm.rowsAfter} 行）`);

    // ── 6 Esc 关浮层 ──
    const esc = await run('esc', `
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((r) => setTimeout(r, 250));
      return { gone: !document.querySelector('.fm-modal') };
    `);
    if (esc.__err) throw new Error('esc: ' + esc.__err);
    ok(esc.gone, '6 Esc 关浮层');

    // ── 7 静态锚：侧栏 Shift 连选 + 右键菜单批量管理入口 ──
    const sbSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'sidebar.js'), 'utf8');
    const appSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
    ok(sbSrc.includes('_multiSelectAnchor') && sbSrc.includes('shiftKey'), '7a 侧栏 Shift 连选在场（sidebar.js）');
    ok(appSrc.includes('批量管理订阅…'), '7b 右键菜单「批量管理订阅…」入口在场（app.js）');

    console.log(failed === 0 ? 'ALL PASSED' : `${failed} 项失败`);
    try { store.database.close(); } catch (_) { /* 探针直关即可 */ }
    app.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error('PROBE ERROR:', err && err.stack || err);
    app.exit(2);
  }
});
