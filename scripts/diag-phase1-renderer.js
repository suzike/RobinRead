'use strict';
/**
 * diag-phase1-renderer.js — 阶段一渲染层修复端到端探测（B06 / B03 / B04 / B08）
 *
 * 与生产一致的 boot：独立临时 userData（os.tmpdir 隔离）+ 真实 registerIPCHandlers
 * （含 robin-icon:// 协议与 Referer 拦截器）+ show:false 窗口加载 src/renderer/index.html。
 * 样本数据：本地注入 RSS（参照 selftest.js），另起本地 HTTP 服务器提供可控抓取目标：
 *   /slow-a  延迟 3s 返回长正文（模拟慢抓取，测 B04 竞态守卫）
 *   /fast-b  立即返回（对照文章）
 *
 * 覆盖：
 *   B06  ui-prompt ESC 取消必须 resolve（promptBox→null / confirmBox→false，500ms 内）
 *   B03  摘要卡 _renderSummaryCard 流式重绘 20 次后，点击仍只触发一次 toggleSummary
 *   B04  慢文章 A 抓取期间切到 B，A 返回后不得覆盖 B 的正文（entryID 与 DOM 双断言）
 *   B08  真实应用里列表/侧栏 favicon src 统一为 robin-icon://（无 storedIconURL 的源）
 *
 * 幂等：全部数据落在一次性临时目录；本地端口随机；退出码 0=全 PASS，1=有 FAIL。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { app, BrowserWindow } = require('electron');

// 必须在 app ready 前 require：ipc.js 顶层会在 !app.isReady() 时注册 robin-icon 特权
// scheme（与生产 main.js 相同路径），保证协议行为与线上一致。
require('../src/main/ipc');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-phase1-renderer-'));
app.setPath('userData', userData);

const SLOW_MS = 3000;
const serverLog = []; // { url, t } — B04 用于证明慢抓取确实先于 B 发出
const server = http.createServer((req, res) => {
  serverLog.push({ url: req.url, t: Date.now() });
  const isA = req.url.startsWith('/slow-a');
  const title = isA ? '慢文章A标题' : '快文章B标题';
  const para = `${title}——这一段本地正文用于通过抓取质量门槛判定，内容必须足够长。应用会把提取出的正文重新排版后呈现在三栏布局的最右侧阅读栏中。`;
  const paras = Array.from({ length: 8 }, (_, i) => `<p>${para}（第 ${i + 1} 段）</p>`).join('');
  const send = () => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>${title}</title></head><body><article><h1>${title}</h1>${paras}</article></body></html>`);
  };
  if (isA) setTimeout(send, SLOW_MS);
  else send();
});

// >500 plainLen：needsExtraction=false 且不走「正文过短补全抓取」，保证快速渲染确定性
const LONG = '这是一段足够长的中文正文，用来确保条目自带正文超过补全抓取的阈值，从而让端到端探测完全确定、不依赖任何外部网络与站点行为。'.repeat(12);

function sampleRSS(port) {
  const iso = (ms) => new Date(ms).toUTCString();
  const now = Date.now();
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>阶段一探测周刊</title>
    <link>https://example.com/weekly</link>
    <item>
      <title>样本文章一：基础渲染验证</title>
      <link>https://example.com/weekly/1</link>
      <pubDate>${iso(now)}</pubDate>
      <description>基础渲染样本。</description>
      <content:encoded><![CDATA[<h2>基础渲染</h2><p>${LONG}</p>]]></content:encoded>
    </item>
    <item>
      <title>慢文章A标题</title>
      <link>http://127.0.0.1:${port}/slow-a</link>
      <pubDate>${iso(now - 3600e3)}</pubDate>
      <description>很短的摘要。</description>
      <content:encoded><![CDATA[<p>这段正文故意很短，用于触发阅读器的网页正文补全抓取路径。</p>]]></content:encoded>
    </item>
    <item>
      <title>快文章B标题</title>
      <link>http://127.0.0.1:${port}/fast-b</link>
      <pubDate>${iso(now - 7200e3)}</pubDate>
      <description>很短的摘要。</description>
      <content:encoded><![CDATA[<h2>快文章B</h2><p>${LONG}</p>]]></content:encoded>
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
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;

    const FeedParser = require('../src/main/FeedParser');
    const { AppStore } = require('../src/main/AppStore');
    const { registerIPCHandlers } = require('../src/main/ipc');

    const parsed = FeedParser.parse(Buffer.from(sampleRSS(port), 'utf8'), 'https://example.com/weekly/feed.xml');
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
    const id1 = idOf('样本文章一：基础渲染验证');
    const idA = idOf('慢文章A标题');
    const idB = idOf('快文章B标题');

    const win = new BrowserWindow({
      show: false, width: 1500, height: 940,
      webPreferences: { preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'), contextIsolation: true },
    });
    registerIPCHandlers(store, win);
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    // gotcha：executeJavaScript 的 rejection 会变成空 {}，注入 IIFE 内一律自行 try/catch 返回 e.message
    const run = async (js) => {
      try { return await win.webContents.executeJavaScript(js, true); }
      catch (e) { return { ok: false, error: 'executeJavaScript-rejected: ' + String((e && e.message) || e) }; }
    };
    await sleep(4500); // boot：reloadAll + 首屏渲染（show:false 下 rAF 可能不跑，一律 setTimeout 等待）

    // ── 0. boot 断言 ──
    const boot = await run(`(() => { try {
      return { ok: !!window.__robinReader && !!window.robin, rows: document.querySelectorAll('.entry-row').length, side: document.querySelectorAll('.sidebar-row').length };
    } catch (e) { return { ok: false, error: e.message }; } })()`);
    check('boot 应用启动、IPC 就绪、列表/侧栏渲染', boot.ok && boot.rows >= 3, JSON.stringify(boot));

    // ── 1. B06：ESC 必须让 promptBox resolve(null) / confirmBox resolve(false) ──
    // ui-prompt 是 ESM，window.robin 上不可达 → 页面内动态 import（相对 index.html）
    const b06prompt = await run(`(async () => {
      try {
        const { promptBox } = await import('./ui-prompt.js');
        const p = promptBox('阶段一探测', { initial: 'x' });
        await new Promise((r) => setTimeout(r, 120));
        const overlayOpen = !!document.querySelector('.modal-overlay');
        const t0 = Date.now();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        const winner = await Promise.race([
          p.then((v) => ({ resolved: true, value: v })),
          new Promise((r) => setTimeout(() => r({ resolved: false }), 500)),
        ]);
        const overlayClosed = !document.querySelector('.modal-overlay');
        return { ok: winner.resolved === true && winner.value === null && overlayOpen && overlayClosed,
                 overlayOpen, overlayClosed, resolved: winner.resolved, value: winner.value, ms: Date.now() - t0 };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    })()`);
    check('B06 promptBox ESC 在 500ms 内 resolve(null) 且弹层关闭', b06prompt.ok === true, JSON.stringify(b06prompt));

    const b06confirm = await run(`(async () => {
      try {
        const { confirmBox } = await import('./ui-prompt.js');
        const p = confirmBox('阶段一探测', { message: '确认取消路径' });
        await new Promise((r) => setTimeout(r, 120));
        const overlayOpen = !!document.querySelector('.modal-overlay');
        const t0 = Date.now();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        const winner = await Promise.race([
          p.then((v) => ({ resolved: true, value: v })),
          new Promise((r) => setTimeout(() => r({ resolved: false }), 500)),
        ]);
        const overlayClosed = !document.querySelector('.modal-overlay');
        return { ok: winner.resolved === true && winner.value === false && overlayOpen && overlayClosed,
                 overlayOpen, overlayClosed, resolved: winner.resolved, value: winner.value, ms: Date.now() - t0 };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    })()`);
    check('B06 confirmBox ESC 在 500ms 内 resolve(false) 且弹层关闭', b06confirm.ok === true, JSON.stringify(b06confirm));

    // ── 2. 打开样本文章一（长正文，不触发抓取） ──
    await run(`(async () => { try { await window.__robinReader.open(${JSON.stringify(id1)}); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } })()`);
    await sleep(1500);

    // ── 3. B08：列表/侧栏 favicon 全部走 robin-icon:// 协议 ──
    const b08 = await run(`(() => { try {
      const imgs = [...document.querySelectorAll('.sidebar-icon img, img.entry-favicon')];
      const srcs = imgs.map((i) => i.getAttribute('src') || '');
      return { ok: imgs.length > 0 && srcs.every((s) => s.startsWith('robin-icon://')),
               count: imgs.length, nonRobin: srcs.filter((s) => !s.startsWith('robin-icon://')).length,
               sample: (srcs[0] || '').slice(0, 100) };
    } catch (e) { return { ok: false, error: e.message }; } })()`);
    check('B08 列表/侧栏 favicon src 统一为 robin-icon://', b08.ok === true, JSON.stringify(b08));

    // ── 4. B03：_renderSummaryCard 重绘 20 次后点击仍只触发一次 toggleSummary ──
    // showsAISummary 默认 true（Models.js defaultLLMConfiguration）；显式确保 + 注入已完成摘要，
    // 使点击走 toggleSummary 分支（而非 generateSummary）。
    const b03 = await run(`(async () => {
      try {
        const reader = window.__robinReader;
        const llm = (window.__robinLLM = window.__robinLLM || {});
        llm.showsAISummary = true;
        reader.summary = { expanded: false, artifact: { content: '阶段一探测用摘要内容，验证点击行为。', isComplete: true }, generating: false, streaming: '', error: null };
        for (let i = 0; i < 20; i++) reader._renderSummaryCard(); // 模拟流式 delta 高频重绘
        const card = document.getElementById('robin-summary-card');
        if (!card) return { ok: false, why: 'no-card', display: card ? card.style.display : null };
        const visible = card.style.display !== 'none';
        let calls = 0;
        reader.toggleSummary = function (...a) { calls++; return Object.getPrototypeOf(reader).toggleSummary.apply(reader, a); };
        card.click();
        await new Promise((r) => setTimeout(r, 150));
        delete reader.toggleSummary; // 恢复原型方法
        return { ok: visible && calls === 1, visible, calls, expandedAfter: reader.summary.expanded };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    })()`);
    check('B03 摘要卡重绘 20 次后点击仅触发 1 次 toggleSummary', b03.ok === true, JSON.stringify(b03));

    // ── 5. B04：慢文章 A 抓取期间切到 B，A 返回后不得覆盖 B ──
    const started = await run(`(() => { try {
      window.__phase1PA = window.__robinReader.open(${JSON.stringify(idA)});
      window.__phase1PA.catch(function () {});
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; } })()`);
    await sleep(300); // A 进入 needsExtraction → extractArticle → /slow-a（3s 慢）
    const tOpenB = Date.now();
    const mid = await run(`(async () => { try {
      await window.__robinReader.open(${JSON.stringify(idB)});
      const r = window.__robinReader;
      return { ok: true, entryID: r.entryID, title: (document.querySelector('.robin-header-title') || {}).textContent || '' };
    } catch (e) { return { ok: false, error: e.message }; } })()`);
    // 等 A 的 open 全流程结束（慢抓取 resolve 后走守卫）+ 余量观察至 ~6s
    const final = await run(`(async () => { try {
      await window.__phase1PA;
      await new Promise((r) => setTimeout(r, 2500));
      const r = window.__robinReader;
      const text = (document.getElementById('reader-scroll') || {}).textContent || '';
      return { ok: true, entryID: r.entryID, title: (document.querySelector('.robin-header-title') || {}).textContent || '', hasA: text.includes('慢文章A标题'), hasB: text.includes('快文章B标题') };
    } catch (e) { return { ok: false, error: e.message }; } })()`);
    const slowHitBeforeB = serverLog.some((l) => l.url.startsWith('/slow-a') && l.t < tOpenB);
    check('B04 前置：A 的慢抓取确实先于 open(B) 发出', started.ok === true && slowHitBeforeB,
      `started=${JSON.stringify(started)} slowHits=${JSON.stringify(serverLog.filter((l) => l.url.startsWith('/slow-a')).length)} tOpenB=${tOpenB}`);
    check('B04 A 抓取返回后 entryID 仍为 B（B 打开时与 6s 观察后均成立）',
      mid.ok && final.ok && mid.entryID === idB && final.entryID === idB,
      `mid=${JSON.stringify(mid)} final.entryID=${final.entryID} expected=${idB}`);
    check('B04 正文未被 A 覆盖（标题与正文均为 B）',
      final.ok && final.title.includes('快文章B标题') && !final.title.includes('慢文章A标题') && final.hasB === true && final.hasA === false,
      JSON.stringify(final));

    code = results.every(Boolean) ? 0 : 1;
    console.log(code === 0 ? 'PHASE1 RENDERER PROBE: ALL PASSED' : 'PHASE1 RENDERER PROBE: FAILED');
  } catch (err) {
    console.error('HARNESS ERROR:', err && (err.stack || err.message || err));
    code = 1;
  }
  clearTimeout(watchdog);
  try { server.close(); } catch (_) { /* 退出时无所谓 */ }
  app.exit(code);
}).catch((err) => { console.error(err); app.exit(1); });
