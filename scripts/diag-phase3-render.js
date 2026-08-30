'use strict';
/**
 * diag-phase3-render.js — 阶段三渲染增强端到端探测（代码高亮 / 多图画廊行 / KaTeX 公式）
 *
 * 与生产一致的 boot（参照 diag-phase1-renderer.js 骨架）：独立临时 userData（os.tmpdir 隔离）
 * + 真实 registerIPCHandlers + show:false 窗口 + backgroundThrottling:false 加载 src/renderer/index.html；
 * 本地注入样本 RSS（>500 plainLen，不触发补全抓取，全确定性），另起本地 HTTP 服务器提供
 * /img-red.png（4x4 PNG，http URL 可通过入库 sanitizer 的 safeRemoteURL 白名单）。
 *
 * ⚠️ 已知边界（如实覆盖）：入库 sanitizer（ArticleExtractCore，禁改文件）会剥掉 class 属性，
 * 因此 RSS 链路的 <code> 拿不到 language-* 标注——渲染层对无标注块做保守 auto 高亮
 * （highlightAuto + relevance 门槛）。语言类精确高亮（断言 a）通过白盒注入 reader.html 验证
 * 渲染管线门控本身（_render 与线上同一条代码路径）。
 *
 * 覆盖：
 *   a  language-js 代码块被 hljs 高亮（span.hljs-keyword / hljs-string 存在；白盒注入管线）
 *   b  无标注 pre>code：单行块原样不动；多行代码块保守 auto 着色且文本保留
 *   c  连续两个纯图 <p> 被包进 .nj-img-row，img 保留 nj-img 类且点击可开灯箱（真实入库链路）
 *   d  图文混排（img 与文本同块）不误归组
 *   e  KaTeX：含 $$E=mc^2$$ 的文章渲染出 .katex 节点；普通文章零 katex 开销（不注入 link/script）
 *   f  既有链路不回归：批注锚点 [data-nj-id] 正常、高亮重放（_applyHighlights → mark.nj-hl）正常
 *   +  幂等：同一文章重开（二次 _render）不产生重复画廊行 / 双重高亮
 *
 * 幂等：全部数据落在一次性临时目录；本地端口随机；退出码 0=全 PASS，1=有 FAIL。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { app, BrowserWindow } = require('electron');

// 必须在 app ready 前 require：ipc.js 顶层注册 robin-icon 特权 scheme（与生产 main.js 相同路径）
require('../src/main/ipc');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-phase3-render-'));
app.setPath('userData', userData);

// 4x4 红色 PNG（本地 http 服务返回；非 1x1 不会被跟踪像素清理删掉）
const IMG_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR42mP8z8BQz4AFMGETDBoYRgBHWj93WjRMdAAAAABJRU5ErkJggg==',
  'base64',
);
const imgServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
  res.end(IMG_PNG);
});

function sampleRSS(port) {
  const img = `http://127.0.0.1:${port}/img-red.png`;
  const iso = (ms) => new Date(ms).toUTCString();
  const now = Date.now();
  const articleA = `
<h2>代码高亮</h2>
<p>这一段足够长的中文正文用来确保条目自带正文超过补全抓取的阈值，让端到端探测完全确定、不依赖任何外部网络与站点行为，正文长度需要稳定超过渲染器的补全抓取门槛。</p>
<pre><code>plain code no annotation: if (x > 1) { doThing(); }</code></pre>
<pre><code>const total = compute(3, 4);
function compute(a, b) {
  return a * b + 1; // multi-line demo
}</code></pre>
<h2>画廊</h2>
<p><img src="${img}" alt=""/></p>
<p><img src="${img}" alt=""/></p>
<p>这是图文混排段落，图片 <img src="${img}" alt=""/> 与文字同在一段，不应被归组。这一段之后还有足够长的正文用来满足抓取门槛判定，渲染层会把图片与文字共同所在的段落保持原样。</p>`;
  const articleB = `
<h2>质能方程</h2>
<p>这一段足够长的中文正文用来确保条目自带正文超过补全抓取的阈值，让端到端探测完全确定、不依赖任何外部网络与站点行为，正文长度需要稳定超过渲染器的补全抓取门槛。</p>
<p>物理学中最著名的公式：$$E = mc^2$$，它揭示了质量与能量的关系。</p>
<p>勾股定理写作 \\(a^2 + b^2 = c^2\\)，是几何学的基础。这一段之后还有足够长的正文用来满足抓取门槛判定，行内公式与块级公式应当分别渲染。</p>`;
  const articleC = `
<h2>普通文章</h2>
<p>这一段足够长的中文正文用来确保条目自带正文超过补全抓取的阈值，让端到端探测完全确定、不依赖任何外部网络与站点行为，正文长度需要稳定超过渲染器的补全抓取门槛。</p>
<p>这一篇没有任何公式与代码块，用来断言渲染层对普通文章零 KaTeX 开销。之后继续补充正文长度以满足抓取门槛，普通文章不应注入任何 vendor 资源。</p>`;
  const item = (title, body) => `
    <item>
      <title>${title}</title>
      <link>https://example.com/phase3/${encodeURIComponent(title)}</link>
      <pubDate>${iso(now)}</pubDate>
      <description>阶段三探测样本。</description>
      <content:encoded><![CDATA[${body}]]></content:encoded>
    </item>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>阶段三探测周刊</title>
    <link>https://example.com/phase3</link>
    ${item('渲染增强样本：代码与画廊', articleA)}
    ${item('公式样本：质能方程', articleB)}
    ${item('普通样本：无公式文章', articleC)}
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
    await new Promise((resolve, reject) => { imgServer.once('error', reject); imgServer.listen(0, '127.0.0.1', resolve); });
    const port = imgServer.address().port;

    const FeedParser = require('../src/main/FeedParser');
    const { AppStore } = require('../src/main/AppStore');
    const { registerIPCHandlers } = require('../src/main/ipc');

    const parsed = FeedParser.parse(Buffer.from(sampleRSS(port), 'utf8'), 'https://example.com/phase3/feed.xml');
    const store = new AppStore(userData);
    const feed = store.feedsRepo.insertFeed({
      accountID: 'local-default',
      title: parsed.title,
      siteURL: parsed.siteURL,
      feedURL: 'https://example.com/phase3/feed.xml',
    });
    store._applyParsedEntries(feed, parsed.entries);
    const items = store.listItems({ kind: 'feed', feedID: feed.id });
    const idOf = (t) => (items.find((i) => i.title === t) || {}).id || '';
    const idA = idOf('渲染增强样本：代码与画廊');
    const idB = idOf('公式样本：质能方程');
    const idC = idOf('普通样本：无公式文章');
    if (!idA || !idB || !idC) throw new Error(`样本条目缺失: A=${idA} B=${idB} C=${idC}`);

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
    const open = async (id, wait = 1200) => {
      await run(`(async () => { try { await window.__robinReader.open(${JSON.stringify(id)}); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } })()`);
      await sleep(wait);
    };
    await sleep(4500); // boot：reloadAll + 首屏渲染（show:false 下 rAF 可能不跑，一律 setTimeout 等待）

    // ── 0. boot 断言 ──
    const boot = await run(`(() => { try {
      return { ok: !!window.__robinReader && !!window.robin, rows: document.querySelectorAll('.entry-row').length };
    } catch (e) { return { ok: false, error: e.message }; } })()`);
    check('boot 应用启动、IPC 就绪、列表渲染 3 条', boot.ok && boot.rows >= 3, JSON.stringify(boot));

    // ── 1. e-1 普通文章零 KaTeX 开销（必须最先测：此刻从未打开过含公式文章） ──
    await open(idC, 800);
    const zeroOverhead = await run(`(() => { try {
      return {
        ok: true,
        katexGlobal: typeof window.katex !== 'undefined',
        katexNodes: document.querySelectorAll('.katex').length,
        injectedCss: !!document.querySelector('link[data-nj-katex-css]'),
        injectedJs: !!document.querySelector('script[src*="katex"]'),
      };
    } catch (e) { return { ok: false, error: e.message }; } })()`);
    check('e1 普通文章零 KaTeX 开销（无 .katex 节点、未注入 css/js、无全局 katex）',
      zeroOverhead.ok && !zeroOverhead.katexGlobal && zeroOverhead.katexNodes === 0 && !zeroOverhead.injectedCss && !zeroOverhead.injectedJs,
      JSON.stringify(zeroOverhead));

    // ── 2. e-2 含公式文章渲染出 .katex（动态加载 vendor，轮询最多 20s） ──
    await open(idB, 400);
    let katexResult = null;
    for (let i = 0; i < 40; i += 1) {
      katexResult = await run(`(() => { try {
        const nodes = document.querySelectorAll('.katex');
        return { ok: true, count: nodes.length, display: document.querySelectorAll('.nj-katex-display .katex').length,
                 hasMc: nodes.length > 0 && /mc/i.test(nodes[0].textContent || '') };
      } catch (e) { return { ok: false, error: e.message }; } })()`);
      if (katexResult.ok && katexResult.count >= 2) break;
      await sleep(500);
    }
    check('e2 含 $$…$$ 与 \\(…\\) 的文章渲染出 .katex 节点（display + inline ≥2）',
      katexResult?.ok && katexResult.count >= 2 && katexResult.display >= 1,
      JSON.stringify(katexResult));

    // ── 3. 打开文章 A（真实入库链路）：b/c/d/f 断言 ──
    await open(idA, 1500);

    // b. 无标注代码块：单行原样不动；多行代码保守 auto 着色
    const plain = await run(`(() => { try {
      const codes = [...document.querySelectorAll('.reader-article pre > code')];
      const oneline = codes.find((c) => (c.textContent || '').includes('plain code no annotation'));
      const multiline = codes.find((c) => (c.textContent || '').includes('function compute'));
      if (!oneline || !multiline) return { ok: false, why: 'missing-blocks', total: codes.length };
      return {
        ok: true,
        onelineText: oneline.textContent,
        onelineTouched: oneline.dataset.njHighlighted === '1' || oneline.querySelectorAll('[class*="hljs"]').length > 0,
        autoHighlighted: multiline.dataset.njAutoHighlighted === '1' && multiline.classList.contains('hljs'),
        autoKeyword: multiline.querySelectorAll('.hljs-keyword').length,
        multilineText: multiline.textContent,
      };
    } catch (e) { return { ok: false, error: e.message }; } })()`);
    check('b1 单行无标注块保守不动（原样、无 hljs 节点）',
      plain.ok && plain.onelineText.includes('plain code no annotation') && plain.onelineTouched === false,
      JSON.stringify({ text: plain.onelineText, touched: plain.onelineTouched }));
    check('b2 多行无标注块被保守 auto 高亮（hljs 类 + keyword 节点，文本完整保留）',
      plain.ok && plain.autoHighlighted === true && plain.autoKeyword >= 1 && plain.multilineText.includes('return a * b + 1'),
      JSON.stringify({ auto: plain.autoHighlighted, kw: plain.autoKeyword }));

    // c. 连续两个纯图 <p> 包进 .nj-img-row + 灯箱（等 data 解码/网络图加载）
    let gallery = { ok: false, why: 'not-run' };
    for (let i = 0; i < 20; i += 1) {
      gallery = await run(`(async () => { try {
        const row = document.querySelector('.nj-img-row');
        if (!row) return { ok: false, why: 'no-row' };
        const imgs = row.querySelectorAll('img');
        if (imgs.length !== 2) return { ok: false, why: 'img-count', count: imgs.length };
        const decorated = [...imgs].every((i) => i.classList.contains('nj-img'));
        const ready = [...imgs].every((i) => i.complete && i.naturalWidth > 0);
        if (!ready) return { ok: false, why: 'imgs-not-decoded' };
        imgs[0].click();
        await new Promise((r) => setTimeout(r, 250));
        const lightbox = document.querySelector('.nj-lightbox.is-active');
        const opened = !!lightbox && !!lightbox.querySelector('.nj-lightbox-img');
        document.querySelector('.nj-lightbox')?.remove(); // 清理，避免污染后续断言
        return { ok: true, count: imgs.length, decorated, opened };
      } catch (e) { return { ok: false, error: e.message }; } })()`);
      if (gallery.ok) break;
      await sleep(500);
    }
    check('c 连续两个纯图 <p> 包进 .nj-img-row（2 张、带 nj-img 装饰），点击打开灯箱',
      gallery.ok && gallery.count === 2 && gallery.decorated && gallery.opened === true, JSON.stringify(gallery));

    // d. 图文混排不误归组
    const mixed = await run(`(() => { try {
      const p = [...document.querySelectorAll('.reader-article p')].find((el) => (el.textContent || '').includes('图文混排段落'));
      if (!p) return { ok: false, why: 'no-mixed-p' };
      return { ok: true, inRow: !!p.closest('.nj-img-row'), rowTotal: document.querySelectorAll('.nj-img-row').length,
               imgInP: p.querySelectorAll('img').length };
    } catch (e) { return { ok: false, error: e.message }; } })()`);
    check('d 图文混排段不进画廊行（closest(.nj-img-row)=null，全页画廊行仅 1 组）',
      mixed.ok && mixed.inRow === false && mixed.rowTotal === 1 && mixed.imgInP === 1,
      JSON.stringify(mixed));

    // f. 既有链路：批注锚点 + 高亮重放
    const anchors = await run(`(() => { try {
      return { ok: true, count: document.querySelectorAll('[data-nj-id]').length,
               preAnchored: !!document.querySelector('pre[data-nj-id]') };
    } catch (e) { return { ok: false, error: e.message }; } })()`);
    check('f1 批注锚点正常（[data-nj-id] ≥ 6，pre 也被标注）',
      anchors.ok && anchors.count >= 6 && anchors.preAnchored, JSON.stringify(anchors));

    const replay = await run(`(() => { try {
      const reader = window.__robinReader;
      reader.highlights = [{ id: 'diag-hl-1', text: '图文混排段落', color: 'yellow', paragraphID: null }];
      reader._applyHighlights();
      const marks = document.querySelectorAll('mark.nj-hl[data-hl-id="diag-hl-1"]');
      return { ok: true, marks: marks.length, text: marks[0] ? marks[0].textContent : '' };
    } catch (e) { return { ok: false, error: e.message }; } })()`);
    check('f2 高亮重放正常（_applyHighlights 包出 mark.nj-hl）',
      replay.ok && replay.marks >= 1 && replay.text.includes('图文混排段落'), JSON.stringify(replay));

    // ── 4. 断言 a：语言类精确高亮（白盒注入 reader.html 走同一条 _render 管线） ──
    // 说明：入库 sanitizer（禁改）剥 class，RSS 链路无 language-*；此处验证渲染管线门控本身
    const langHl = await run(`(async () => { try {
      const reader = window.__robinReader;
      reader.html = '<h2>hl</h2><pre><code class="language-js">const greeting = "hello";\\nfunction add(a, b) {\\n  return a + b;\\n}</code></pre>';
      reader._render();
      await new Promise((r) => setTimeout(r, 200));
      const code = document.querySelector('.reader-article pre > code.language-js');
      if (!code) return { ok: false, why: 'no-code' };
      const keywords = [...code.querySelectorAll('.hljs-keyword')].map((k) => k.textContent);
      const strings = code.querySelectorAll('.hljs-string').length;
      return { ok: true, marked: code.dataset.njHighlighted, keywords, strings };
    } catch (e) { return { ok: false, error: e.message }; } })()`);
    check('a language-js 代码块被精确高亮（hljs-keyword 含 const/function，hljs-string 存在）',
      langHl.ok && langHl.marked === '1' && langHl.keywords.includes('const') && langHl.keywords.includes('function') && langHl.strings >= 1,
      JSON.stringify(langHl));

    // ── 5. 幂等：重开 A（二次 _render）不产生重复画廊行 / 双重高亮 ──
    await open(idA, 1500);
    const idempotent = await run(`(() => { try {
      return { ok: true, rows: document.querySelectorAll('.nj-img-row').length,
               autoKw: document.querySelectorAll('pre > code[data-nj-auto-highlighted] .hljs-keyword').length,
               bareText: [...document.querySelectorAll('pre > code')].some((c) => (c.textContent || '').includes('plain code no annotation')) };
    } catch (e) { return { ok: false, error: e.message }; } })()`);
    check('幂等：重开同一文章画廊行仍 1 组、auto 高亮重建、无标注单行块仍原样',
      idempotent.ok && idempotent.rows === 1 && idempotent.autoKw >= 1 && idempotent.bareText === true,
      JSON.stringify(idempotent));

    code = results.every(Boolean) ? 0 : 1;
    console.log(code === 0 ? 'PHASE3 RENDER PROBE: ALL PASSED' : 'PHASE3 RENDER PROBE: FAILED');
  } catch (err) {
    console.error('HARNESS ERROR:', err && (err.stack || err.message || err));
    code = 1;
  }
  clearTimeout(watchdog);
  try { imgServer.close(); } catch (_) { /* 退出时无所谓 */ }
  app.exit(code);
}).catch((err) => { console.error(err); app.exit(1); });
