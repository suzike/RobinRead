'use strict';
/**
 * diag-phase3-bugfix.js — 渲染层 bugfix 端到端探测（B13 高亮越界 / B20 灯箱监听泄漏）
 *
 * 与生产一致的 boot（参照 diag-phase3-render.js 骨架）：独立临时 userData（os.tmpdir 隔离）
 * + 真实 registerIPCHandlers + show:false 窗口 + backgroundThrottling:false 加载 src/renderer/index.html；
 * 本地注入样本 RSS（长中文正文，不触发补全抓取，全确定性）。
 *
 * 覆盖：
 *   b13a 同节点内选区（段中选词组，startWithin>0 且 endWithin<len）：
 *        _wrapRange 包出的 mark 必须 == 选区，不得溢出到文本节点末尾（splitText 后
 *        node.textContent.length 失真导致的终点守卫恒假回归）。
 *   b13b 段中选到节点末尾（endWithin==len）：应完整包到末尾且段落文本零丢失。
 *   b13c 段首选到段中（startWithin==0）：前缀不被包裹。
 *   b20  灯箱任意关闭路径（点击 / Esc）都必须移除 document 上的 keydown 监听：
 *        用 monkey-patch 计数 add/removeEventListener('keydown')，两次开灯箱分别走
 *        点击关闭与 Esc 关闭，断言注册数 == 注销数（长会话零泄漏）。
 *
 * 幂等：全部数据落在一次性临时目录；退出码 0=全 PASS，1=有 FAIL。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

// 必须在 app ready 前 require：ipc.js 顶层注册 robin-icon 特权 scheme（与生产 main.js 相同路径）
require('../src/main/ipc');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-phase3-bugfix-'));
app.setPath('userData', userData);

function sampleRSS() {
  const long = (tag) =>
    `<p>${tag}这一段足够长的中文正文用来确保条目自带正文超过补全抓取的阈值，让端到端探测完全确定、不依赖任何外部网络与站点行为，正文长度需要稳定超过渲染器的补全抓取门槛，之后还有更多的文字用于验证高亮边界不得溢出。</p>`;
  const body = `
<h2>高亮边界样本</h2>
${long('A段。')}
${long('B段。')}
${long('C段。')}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>阶段三修复探测周刊</title>
    <link>https://example.com/phase3-bugfix</link>
    <item>
      <title>高亮与灯箱修复样本</title>
      <link>https://example.com/phase3-bugfix/1</link>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <description>B13/B20 探测样本。</description>
      <content:encoded><![CDATA[${body}]]></content:encoded>
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
    console.log('FAIL watchdog — 探测总时长超 120s，强制退出');
    app.exit(1);
  }, 120000);

  try {
    const FeedParser = require('../src/main/FeedParser');
    const { AppStore } = require('../src/main/AppStore');
    const { registerIPCHandlers } = require('../src/main/ipc');

    const parsed = FeedParser.parse(Buffer.from(sampleRSS(), 'utf8'), 'https://example.com/phase3-bugfix/feed.xml');
    const store = new AppStore(userData);
    const feed = store.feedsRepo.insertFeed({
      accountID: 'local-default',
      title: parsed.title,
      siteURL: parsed.siteURL,
      feedURL: 'https://example.com/phase3-bugfix/feed.xml',
    });
    store._applyParsedEntries(feed, parsed.entries);
    const item = store.listItems({ kind: 'feed', feedID: feed.id })[0];
    if (!item) throw new Error('样本条目缺失');

    const win = new BrowserWindow({
      show: false, width: 1500, height: 940,
      webPreferences: {
        preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    registerIPCHandlers(store, win);
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    // gotcha：executeJavaScript 的 rejection 会变成空 {}，注入 IIFE 内一律自行 try/catch 返回 e.message
    const run = async (js) => {
      try { return await win.webContents.executeJavaScript(js, true); }
      catch (e) { return { ok: false, error: 'executeJavaScript-rejected: ' + String((e && e.message) || e) }; }
    };
    await sleep(4500); // boot：reloadAll + 首屏渲染（show:false 下 rAF 可能不跑，一律 setTimeout 等待）

    const boot = await run(`(() => { try {
      return { ok: !!window.__robinReader && !!window.robin, rows: document.querySelectorAll('.entry-row').length };
    } catch (e) { return { ok: false, error: e.message }; } })()`);
    check('boot 应用启动、IPC 就绪、列表渲染', boot.ok && boot.rows >= 1, JSON.stringify(boot));

    await run(`(async () => { try { await window.__robinReader.open(${JSON.stringify(item.id)}); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } })()`);
    await sleep(1200);

    // ── B13：_wrapRange 同节点选区不得溢出到节点末尾 ──
    // 三段分别构造三种边界；每段是单一文本节点（渲染期无 nj-t 句子 span）
    const wrap = await run(`(() => { try {
      const reader = window.__robinReader;
      const paras = [...document.querySelectorAll('.reader-article p')].filter((p) => /^[ABC]段。/.test(p.textContent || ''));
      if (paras.length !== 3) return { ok: false, why: 'paras', count: paras.length };
      const probe = (p, s, e, tag) => {
        const tn = p.firstChild;
        if (!tn || tn.nodeType !== Node.TEXT_NODE) return { ok: false, why: 'no-text-node:' + tag };
        const original = tn.textContent;
        const range = document.createRange();
        range.setStart(tn, s);
        range.setEnd(tn, e);
        const selected = original.slice(s, e);
        const marks = reader._wrapRange(range, (m) => { m.classList.add('nj-hl'); m.dataset.hlId = 'diag-b13-' + tag; });
        const after = {
          ok: true, tag, selected, marks: marks.length,
          markText: marks.length === 1 ? marks[0].textContent : null,
          paraText: p.textContent,
          nextIsTail: marks.length === 1 && marks[0].nextSibling && marks[0].nextSibling.nodeType === Node.TEXT_NODE
            ? marks[0].nextSibling.textContent : null,
          prevIsHead: marks.length === 1 && marks[0].previousSibling && marks[0].previousSibling.nodeType === Node.TEXT_NODE
            ? marks[0].previousSibling.textContent : null,
        };
        range.detach();
        return after;
      };
      return {
        ok: true,
        a: probe(paras[0], 40, 52, 'a'),   // 段中选词组：两侧都留文本（回归核心）
        b: probe(paras[1], 40, paras[1].firstChild.textContent.length, 'b'), // 段中选到末尾
        c: probe(paras[2], 0, 12, 'c'),    // 段首选到段中
      };
    } catch (e) { return { ok: false, error: e.message }; } })()`);

    const ca = wrap.a || {};
    check('b13a 段中选区 mark==选区、不溢出到节点末尾、段落文本零丢失',
      wrap.ok && ca.marks === 1 && ca.markText === ca.selected
      && ca.nextIsTail !== null && ca.nextIsTail.length > 0
      && ca.prevIsHead !== null && ca.prevIsHead.length > 0
      && (ca.prevIsHead + ca.markText + ca.nextIsTail) === ca.paraText,
      JSON.stringify({ selected: ca.selected, markLen: (ca.markText || '').length, nextLen: (ca.nextIsTail || '').length, prevLen: (ca.prevIsHead || '').length, intact: ca.prevIsHead !== undefined && (ca.prevIsHead + ca.markText + ca.nextIsTail) === ca.paraText }));

    const cb = wrap.b || {};
    // 选区到节点末尾：不产生尾部 split，mark.nextSibling 为 null（或空串）都算无残余
    check('b13b 段中选到节点末尾：包到末尾、无尾部残余、段落文本零丢失',
      wrap.ok && cb.marks === 1 && cb.markText === cb.selected && !cb.nextIsTail
      && cb.prevIsHead !== null && (cb.prevIsHead + cb.markText) === cb.paraText,
      JSON.stringify({ markLen: (cb.markText || '').length, nextLen: (cb.nextIsTail || '').length, intact: (cb.prevIsHead + cb.markText) === cb.paraText }));

    const cc = wrap.c || {};
    // 选区从节点头开始：不产生头部 split，mark.previousSibling 为 null（或空串）都算无前缀
    check('b13c 段首选到段中：前缀不包裹、尾部保留、段落文本零丢失',
      wrap.ok && cc.marks === 1 && cc.markText === cc.selected && !cc.prevIsHead
      && cc.nextIsTail !== null && cc.nextIsTail.length > 0
      && (cc.markText + cc.nextIsTail) === cc.paraText,
      JSON.stringify({ markLen: (cc.markText || '').length, nextLen: (cc.nextIsTail || '').length, intact: (cc.markText + cc.nextIsTail) === cc.paraText }));

    // ── B20：灯箱点击/Esc 关闭都必须注销 document keydown 监听 ──
    const lightbox = await run(`(async () => { try {
      const reader = window.__robinReader;
      // monkey-patch 计数 document 上的 keydown 注册/注销（只统计本探针窗口期内）
      const counters = { add: 0, remove: 0 };
      const rawAdd = document.addEventListener.bind(document);
      const rawRemove = document.removeEventListener.bind(document);
      document.addEventListener = function (type, fn, opts) { if (type === 'keydown') counters.add += 1; return rawAdd(type, fn, opts); };
      document.removeEventListener = function (type, fn, opts) { if (type === 'keydown') counters.remove += 1; return rawRemove(type, fn, opts); };
      const restore = () => { document.addEventListener = rawAdd; document.removeEventListener = rawRemove; };
      const IMG = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
      try {
        // 路径 1：点击关闭
        reader._showLightbox(IMG, 'diag1');
        let box = document.querySelector('.nj-lightbox.is-active');
        if (!box) return { ok: false, why: 'no-lightbox-1', counters };
        box.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 120));
        const closedByClick = !document.querySelector('.nj-lightbox');
        // 路径 2：Esc 关闭
        reader._showLightbox(IMG, 'diag2');
        box = document.querySelector('.nj-lightbox.is-active');
        if (!box) return { ok: false, why: 'no-lightbox-2', counters };
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise((r) => setTimeout(r, 120));
        const closedByEsc = !document.querySelector('.nj-lightbox');
        return { ok: true, counters, closedByClick, closedByEsc };
      } finally {
        document.querySelector('.nj-lightbox')?.remove(); // 兜底清理
        restore();
      }
    } catch (e) { return { ok: false, error: e.message }; } })()`);

    check('b20 灯箱点击与 Esc 关闭均注销 keydown 监听（add==remove，两路径都能关闭）',
      lightbox.ok && lightbox.closedByClick === true && lightbox.closedByEsc === true
      && lightbox.counters.add >= 2 && lightbox.counters.add === lightbox.counters.remove,
      JSON.stringify(lightbox));

    code = results.every(Boolean) ? 0 : 1;
    console.log(code === 0 ? 'PHASE3 BUGFIX PROBE: ALL PASSED' : 'PHASE3 BUGFIX PROBE: FAILED');
  } catch (err) {
    console.error('HARNESS ERROR:', err && (err.stack || err.message || err));
    code = 1;
  }
  clearTimeout(watchdog);
  app.exit(code);
}).catch((err) => { console.error(err); app.exit(1); });
