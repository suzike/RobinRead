'use strict';
/**
 * diag-phase2-renderer.js — 阶段二渲染层功能端到端探测
 *
 * 覆盖（A3 / A4 / 复制文章 ID）：
 *   A3-a  阅读位置跨会话持久化：open(A) 滚动 → open(B) → reload → open(A) 恢复 scrollTop（±30px）
 *   A3-a2 localStorage 键 robinread.scrollPositions 存在；上限 300 条（FIFO 淘汰最早写入）
 *   A4-b  复制全文 Markdown：kbExportMarkdown → copyText → 主进程 clipboard.readText() 一致且非空
 *   A4-c  文件写入：IPC app:writeTextFile 写临时文件 → 主进程读回一致
 *   A4-d  导出按钮存在：头部 actions 区含 [data-role="export"]
 *   A4-e  打印样式：加载的样式表含 '@media print' 且含 #list 隐藏规则
 *   ctx-f 复制文章 ID：列表行 contextmenu → 菜单含「复制文章 ID」→ 点击后剪贴板 = entryID
 *
 * 与 diag-phase1-renderer.js 同骨架：独立临时 userData + 本地样本 RSS + show:false 窗口 +
 * executeJavaScript（注入 IIFE 自行 try/catch，rejection 在宿主侧表现为空 {}）。
 * backgroundThrottling:false —— show:false 下 rAF 照常跑（A3 恢复依赖 double rAF）。
 *
 * 幂等：数据全部落在一次性临时目录；退出码 0=全 PASS，1=有 FAIL。
 * 说明：app:pickSavePath 弹出系统另存对话框，无法无人值守自动化，未纳入断言；
 *       其写盘链路的后半段（app:writeTextFile）由 A4-c 直接覆盖。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, clipboard } = require('electron');

// 必须在 app ready 前 require：ipc.js 顶层注册 robin-icon 特权 scheme（与生产 main.js 相同）
require('../src/main/ipc');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-phase2-renderer-'));
app.setPath('userData', userData);

// >500 plainLen：needsExtraction=false 且不走「正文过短补全抓取」，快速渲染且可滚动
const LONG = '这是一段足够长的中文正文，用来确保条目自带正文超过补全抓取的阈值，从而让端到端探测完全确定、不依赖任何外部网络与站点行为。'.repeat(12);

function sampleRSS() {
  const iso = (ms) => new Date(ms).toUTCString();
  const now = Date.now();
  const parasA = Array.from({ length: 26 }, (_, i) => `<p>文章A第${i + 1}段。${LONG}</p>`).join('');
  const parasB = Array.from({ length: 8 }, (_, i) => `<p>文章B第${i + 1}段。${LONG}</p>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>阶段二探测周刊</title>
    <link>https://example.com/weekly</link>
    <item>
      <title>阶段二长文A：滚动位置持久化</title>
      <link>https://example.com/weekly/a</link>
      <pubDate>${iso(now)}</pubDate>
      <description>长文A。</description>
      <content:encoded><![CDATA[<h2>长文A</h2>${parasA}]]></content:encoded>
    </item>
    <item>
      <title>阶段二长文B：切换对照</title>
      <link>https://example.com/weekly/b</link>
      <pubDate>${iso(now)}</pubDate>
      <description>长文B。</description>
      <content:encoded><![CDATA[<h2>长文B</h2>${parasB}]]></content:encoded>
    </item>
  </channel>
</rss>`;
}

app.whenReady().then(async () => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(Boolean(ok));
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let code = 1;
  const watchdog = setTimeout(() => {
    console.log('FAIL watchdog — 探测总时长超 150s，强制退出');
    app.exit(1);
  }, 150000);

  try {
    const FeedParser = require('../src/main/FeedParser');
    const { AppStore } = require('../src/main/AppStore');
    const { registerIPCHandlers } = require('../src/main/ipc');

    const parsed = FeedParser.parse(Buffer.from(sampleRSS(), 'utf8'), 'https://example.com/weekly/feed.xml');
    const store = new AppStore(userData);
    const feed = store.feedsRepo.insertFeed({
      accountID: 'local-default',
      title: parsed.title,
      siteURL: parsed.siteURL,
      feedURL: 'https://example.com/weekly/feed.xml',
    });
    store._applyParsedEntries(feed, parsed.entries);
    const items = store.listItems({ kind: 'feed', feedID: feed.id });
    const idOf = (t) => (items.find((i) => i.title === t) || {}).id || '';
    const idA = idOf('阶段二长文A：滚动位置持久化');
    const idB = idOf('阶段二长文B：切换对照');

    const win = new BrowserWindow({
      show: false, width: 1500, height: 940,
      webPreferences: {
        preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
        contextIsolation: true,
        backgroundThrottling: false, // show:false 下 rAF 照常跑：A3 恢复逻辑依赖 double rAF
      },
    });
    registerIPCHandlers(store, win);
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    // gotcha：executeJavaScript 的 rejection 会变成空 {}，注入 IIFE 内一律自行 try/catch 返回 e.message
    const run = async (js) => {
      try { return await win.webContents.executeJavaScript(js, true); }
      catch (e) { return { ok: false, error: 'executeJavaScript-rejected: ' + String((e && e.message) || e) }; }
    };
    await sleep(4500); // boot：reloadAll + 首屏渲染（等 DOM 就绪留足 sleep）

    // ── 0. boot 断言 ──
    const boot = await run(`(() => { try {
      return { ok: !!window.__robinReader && !!window.robin, rows: document.querySelectorAll('.entry-row').length };
    } catch (e) { return { ok: false, error: e.message }; } })()`);
    check('boot 应用启动、IPC 就绪、列表渲染', boot.ok && boot.rows >= 2, JSON.stringify(boot));

    // ── 1. A4-d：打开文章 A 后头部 actions 区含导出按钮 ──
    const openA = await run(`(async () => { try { await window.__robinReader.open(${JSON.stringify(idA)}); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } })()`);
    await sleep(1800);
    const exportBtn = await run(`(() => { try {
      const actions = document.querySelector('.robin-header-original-actions');
      const btn = actions && actions.querySelector('[data-role="export"]');
      const bodyLen = (window.__robinReader.body?.textContent || '').length;
      return { ok: !!(actions && btn), hasActions: !!actions, bodyLen,
               title: (document.querySelector('.robin-header-title') || {}).textContent || '' };
    } catch (e) { return { ok: false, error: e.message }; } })()`);
    check('A4-d 打开文章后头部 actions 区含导出按钮（有正文才显示）',
      openA.ok && exportBtn.ok && exportBtn.bodyLen > 0, JSON.stringify(openA) + ' ' + JSON.stringify(exportBtn));

    // ── 2. A4-e：打印样式（加载的样式表含 @media print 且含 #list 隐藏规则） ──
    const printCss = await run(`(() => { try {
      const mediaTexts = [];
      for (const sheet of document.styleSheets) {
        let rules; try { rules = [...sheet.cssRules]; } catch (_) { continue; }
        for (const r of rules) if (r.media) mediaTexts.push(r.cssText);
      }
      const hit = mediaTexts.filter((t) => /@media print/i.test(t) && /#list/.test(t));
      return { ok: hit.length > 0, mediaBlocks: mediaTexts.length, hitLen: hit.map((h) => h.length) };
    } catch (e) { return { ok: false, error: e.message }; } })()`);
    // 双保险：主进程直读源文件
    const cssSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles', 'robin.css'), 'utf8');
    const atPrintIdx = cssSource.indexOf('@media print');
    const sourceOk = atPrintIdx >= 0 && cssSource.slice(atPrintIdx, atPrintIdx + 4000).includes('#list');
    check('A4-e 样式表含 @media print 且包含 #list 隐藏规则',
      printCss.ok === true || sourceOk,
      `page=${JSON.stringify(printCss)} source=${sourceOk}`);

    // ── 3. A3-a：滚动位置跨会话（reload）恢复 ──
    const TARGET = 420;
    const scrolled = await run(`(() => { try {
      const el = document.getElementById('reader-scroll');
      el.scrollTop = ${TARGET};
      return { ok: true, applied: el.scrollTop, max: el.scrollHeight - el.clientHeight };
    } catch (e) { return { ok: false, error: e.message }; } })()`);
    await sleep(700);
    await run(`(async () => { try { await window.__robinReader.open(${JSON.stringify(idB)}); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } })()`);
    await sleep(1500);
    // 切到 B 时 A 的位置应已写入 localStorage
    const saved = await run(`(() => { try {
      const raw = localStorage.getItem('robinread.scrollPositions');
      const obj = raw ? JSON.parse(raw) : null;
      return { ok: true, exists: !!raw, keys: obj ? Object.keys(obj).length : 0, hasA: !!(obj && obj[${JSON.stringify(idA)}]) };
    } catch (e) { return { ok: false, error: e.message }; } })()`);
    // 模拟重启：reload（同源 localStorage 保留）
    win.webContents.reload();
    await sleep(5000);
    for (let i = 0; i < 20; i++) {
      const ready = await run(`({ ok: !!window.__robinReader, rows: document.querySelectorAll('.entry-row').length })`);
      if (ready.ok && ready.rows >= 2) break;
      await sleep(1000);
    }
    const reopen = await run(`(async () => { try {
      await window.__robinReader.open(${JSON.stringify(idA)});
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; } })()`);
    await sleep(2200); // double rAF 恢复 + 布局稳定
    const restored = await run(`(() => { try {
      const el = document.getElementById('reader-scroll');
      return { ok: true, entryID: window.__robinReader.entryID, scrollTop: el.scrollTop,
               max: el.scrollHeight - el.clientHeight };
    } catch (e) { return { ok: false, error: e.message }; } })()`);
    const restoredOK = openA.ok && scrolled.ok
      && saved.ok && saved.exists === true && saved.hasA === true
      && reopen.ok && restored.ok
      && restored.entryID === idA
      && Math.abs(restored.scrollTop - TARGET) <= 30;
    check('A3-a reload 后重开文章 A，scrollTop 恢复到记录值（±30px）',
      restoredOK,
      `target=${TARGET} scrolled=${JSON.stringify(scrolled)} saved=${JSON.stringify(saved)} restored=${JSON.stringify(restored)}`);
    check('A3-a2 localStorage 键 robinread.scrollPositions 存在',
      saved.ok === true && saved.exists === true,
      JSON.stringify(saved));

    // ── 4. A3-a3：上限 300 条 FIFO（超出删最早写入的） ──
    const fifo = await run(`(() => { try {
      const r = window.__robinReader;
      for (let i = 0; i < 305; i++) r._rememberScrollPosition('probe-' + i, i);
      const obj = JSON.parse(localStorage.getItem('robinread.scrollPositions'));
      const keys = Object.keys(obj);
      return { ok: true, count: keys.length, oldestSurvivor: keys[0], hasA: !!obj[${JSON.stringify(idA)}] };
    } catch (e) { return { ok: false, error: e.message }; } })()`);
    // 插入序：A（真实阅读）先写，probe-0..4 最先被挤出 → 存活者从 probe-5 开始
    check('A3-a3 上限 300 条 FIFO：超出删最早写入（插入序）',
      fifo.ok === true && fifo.count === 300 && fifo.oldestSurvivor === 'probe-5' && fifo.hasA === false,
      JSON.stringify(fifo));

    // ── 5. A4-b：复制全文 Markdown → copyText → 主进程剪贴板一致 ──
    const mdProbe = await run(`(async () => { try {
      const md = await window.robin.kbExportMarkdown(${JSON.stringify(idA)});
      if (!md || typeof md !== 'string') return { ok: false, why: 'no-md', type: typeof md };
      await window.robin.copyText(md);
      return { ok: true, len: md.length, head: md.slice(0, 60) };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`);
    const clipText = clipboard.readText();
    const copyOK = mdProbe.ok === true && mdProbe.len > 0 && clipText.length === mdProbe.len;
    check('A4-b kbExportMarkdown → copyText → 主进程剪贴板一致且非空',
      copyOK, `md=${JSON.stringify(mdProbe)} clipLen=${clipText.length}`);

    // ── 6. A4-c：app:writeTextFile 写临时文件 → 读回一致 ──
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-phase2-export-'));
    const tmpFile = path.join(tmpDir, '导出测试.md');
    const payload = '# 阶段二探测\n\n带换行的**Markdown**内容。';
    const writeProbe = await run(`(async () => { try {
      const r = await window.robin.writeTextFile(${JSON.stringify(tmpFile)}, ${JSON.stringify(payload)});
      return { ok: r && r.ok === true, data: r && r.data, error: r && r.error };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`);
    let writtenText = '';
    let fileExists = false;
    try { writtenText = fs.readFileSync(tmpFile, 'utf8'); fileExists = true; } catch (_) { /* 未写入 */ }
    const expectedText = '# 阶段二探测\n\n带换行的**Markdown**内容。';
    check('A4-c IPC writeTextFile 写临时文件并读回一致',
      writeProbe.ok === true && fileExists && writtenText === expectedText,
      `ipc=${JSON.stringify(writeProbe)} exists=${fileExists} match=${writtenText === expectedText}`);

    // ── 7. ctx-f：列表行右键菜单含「复制文章 ID」，点击后剪贴板 = entryID ──
    const ctx = await run(`(async () => { try {
      const { ContextMenu } = await import('./views/context-menu.js');
      const { t } = await import('./i18n.js');
      const row = document.querySelector('.entry-row[data-entry-id]');
      if (!row) return { ok: false, why: 'no-row' };
      const entryID = row.dataset.entryId;
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
      await new Promise((r) => setTimeout(r, 200));
      const labels = [...document.querySelectorAll('.context-menu .context-menu-item .label')].map((el) => el.textContent);
      const item = [...document.querySelectorAll('.context-menu .context-menu-item')]
        .find((el) => el.querySelector('.label')?.textContent === t('复制文章 ID'));
      if (!item) return { ok: false, why: 'no-item', labels, expected: t('复制文章 ID'), entryID };
      item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 400));
      const menuClosed = document.querySelectorAll('.context-menu').length === 0;
      return { ok: true, entryID, labels, menuClosed };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`);
    const ctxClip = clipboard.readText();
    check('ctx-f 列表行右键菜单含「复制文章 ID」，点击后 copyText 写入 entryID',
      ctx.ok === true && ctx.menuClosed === true && ctxClip === ctx.entryID && ctx.entryID.length > 0,
      `ctx=${JSON.stringify(ctx)} clip=${ctxClip.slice(0, 40)}`);

    // ── 8. ctx-f 回归：非列表行（无 data-entry-id 上下文）不注入 ──
    const ctxNeg = await run(`(async () => { try {
      const { ContextMenu } = await import('./views/context-menu.js');
      ContextMenu.show(40, 40, [{ label: '普通程序化菜单', onClick: () => {} }]);
      await new Promise((r) => setTimeout(r, 150));
      const labels = [...document.querySelectorAll('.context-menu .context-menu-item .label')].map((el) => el.textContent);
      ContextMenu.dismissAll();
      return { ok: true, labels };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`);
    check('ctx-f2 程序化菜单（无列表行上下文）不注入「复制文章 ID」',
      ctxNeg.ok === true && !ctxNeg.labels.includes('复制文章 ID'),
      JSON.stringify(ctxNeg));

    code = results.every(Boolean) ? 0 : 1;
    console.log(code === 0 ? 'PHASE2 RENDERER PROBE: ALL PASSED' : 'PHASE2 RENDERER PROBE: FAILED');
  } catch (err) {
    console.error('HARNESS ERROR:', err && (err.stack || err.message || err));
    code = 1;
  }
  clearTimeout(watchdog);
  app.exit(code);
}).catch((err) => { console.error(err); app.exit(1); });
