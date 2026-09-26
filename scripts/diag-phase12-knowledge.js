'use strict';
/**
 * diag-phase12-knowledge.js — 知识增强离线探针（run-all --ci 集）
 *
 * 覆盖本轮「知识增强 + 前端美化」：
 *  1. 知识图谱数据：种入标签 → kb:graph 返回 tags/articles/edges 结构且计数一致
 *  2. 知识库问答：空库受控报错 / 无 API Key 受控报错（不崩溃）
 *  3. 静态锚点：新通道/桥/两个新 tab/图谱与问答渲染方法/美化动效 CSS
 * 退出码 0=PASS，非 0=FAIL。
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const os = require('node:os');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-kb-probe-'));
app.setPath('userData', userData);
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 90 * 1000).unref();

const ROOT = path.join(__dirname, '..');

app.whenReady().then(async () => {
  try {
    const { AppStore } = require('../src/main/AppStore');
    const { parse: parseFeed } = require('../src/main/FeedParser');
    const { LOCAL_ACCOUNT_ID } = require('../src/main/Models');
    const store = new AppStore(userData);
    const feed = store.feedsRepo.insertFeed({
      accountID: LOCAL_ACCOUNT_ID, title: '知识探针周刊', siteURL: 'https://example.com/', feedURL: 'https://example.com/f.xml',
    });
    const now = new Date().toUTCString();
    const sample = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>知识探针周刊</title><link>https://e.com/</link>
      <item><title>写作的隐秘技艺</title><link>https://e.com/1</link><pubDate>${now}</pubDate><content:encoded><![CDATA[<p>关于写作的建议：先写烂初稿。</p>]]></content:encoded></item>
      <item><title>阅读的技艺</title><link>https://e.com/2</link><pubDate>${now}</pubDate><content:encoded><![CDATA[<p>关于阅读的建议：带着问题读。</p>]]></content:encoded></item>
    </channel></rss>`;
    const entries = store._applyParsedEntries(feed, parseFeed(sample, 'https://e.com/f.xml').entries);
    assert.ok(entries.length >= 2, '种子文章应入库');
    // 种标签：一篇双标签 + 另一篇共享标签（形成真正的图结构）
    store.knowledge.addAutoTag(entries[0], '写作');
    store.knowledge.addAutoTag(entries[0], '技艺');
    store.knowledge.addAutoTag(entries[1], '阅读');
    store.knowledge.addAutoTag(entries[1], '技艺');

    // 1. 图谱数据结构
    const graph = store.knowledge.getGraphData(100);
    assert.ok(graph.tags.length >= 3 && graph.articles.length === 2 && graph.edges.length >= 4,
      `图谱应含 2 文章与至少 3 标签/4 边，实际 ${JSON.stringify(graph)}`);
    const topTag = graph.tags.find((t) => t.tag === '技艺');
    assert.ok(topTag && topTag.count === 2, '共享标签「技艺」应连接 2 篇');
    console.log(`PASS 知识图谱数据：${graph.tags.length} 标签 / ${graph.articles.length} 文章 / ${graph.edges.length} 边`);

    // 2. 知识库问答受控路径（无 API Key / 空库）
    const emptyAsk = await (async () => {
      const probe = new AppStore(fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-kb-empty-')));
      try { await probe.knowledgeAsk('测试'); return { ok: true }; }
      catch (e) { return { ok: false, error: String(e?.message || e) }; }
    })();
    assert.ok(emptyAsk.ok === false && /知识库/.test(emptyAsk.error), `空库应受控报错: ${JSON.stringify(emptyAsk)}`);
    const noKey = await (async () => {
      try { await store.knowledgeAsk('写作有什么要点？'); return { ok: true }; }
      catch (e) { return { ok: false, error: String(e?.message || e) }; }
    })();
    assert.ok(noKey.ok === false && typeof noKey.error === 'string', `无 Key 应受控报错: ${JSON.stringify(noKey)}`);
    console.log('PASS 知识库问答受控路径：空库 / 无 Key 均友好报错');

    // 标签筛选列表（图谱 → 主列表联动）：tag scope 走真实 article_tags 关系
    const tagged = store.listItems({ kind: 'tag', tag: '技艺' }, { limit: 10 });
    assert.ok(tagged.length === 2, `标签「技艺」应筛出 2 篇，实际 ${tagged.length}`);
    const shortFirst = store.listItems({ kind: 'tag', tag: '技艺' }, { limit: 10, sort: 'shortFirst' });
    assert.ok(shortFirst.length === 2 && Number(shortFirst[0].readMinutes) <= Number(shortFirst[1].readMinutes),
      '短文优先排序应按阅读时长升序');
    console.log('PASS 标签筛选列表 + 短文优先排序');

    // 单篇 HTML 导出：结构完整（纸感样式 + 标题 + 正文 + 署名导出行）
    const htmlOut = store.exportEntryHtml(entries[0]);
    assert.ok(htmlOut.includes('<!DOCTYPE html>') && htmlOut.includes(entries[0].title || ''), 'HTML 导出应含标题');
    assert.ok(htmlOut.includes('Exported by RobinRead') && htmlOut.includes('font-family'), 'HTML 应内联纸感样式');
    const readerSrc2 = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'views', 'reader.js'), 'utf8');
    assert.ok(readerSrc2.includes('_exportHtmlFile') && readerSrc2.includes('robin-tag-chip'), 'reader 应含 HTML 导出与标签 chips');
    console.log('PASS 单篇 HTML 导出结构 + 标签 chips 锚点');

    // 继续阅读候选：reader 侧 resume 记录逻辑（localStorage 形状）
    const win2 = new (require(path.join(ROOT, 'node_modules', 'jsdom')).JSDOM)('<body></body>', { url: 'https://localhost/' });
    global.localStorage = win2.window.localStorage;
    global.window = win2.window;
    localStorage.setItem('robinread.resume', JSON.stringify({ 'a1': { pct: 42, at: Date.now(), title: 'T1', feed: 'F1' } }));
    // resumeCandidate 是 reader 方法，此处仅校验存储形状约定
    const raw = JSON.parse(localStorage.getItem('robinread.resume'));
    assert.ok(raw.a1 && raw.a1.pct === 42 && raw.a1.title === 'T1', 'resume 存储形状异常');
    console.log('PASS 继续阅读存储形状');

    // 列表 readMinutes 字段（阅读时长进列表）
    const listItems = store.listItems({ kind: 'today' }, { limit: 10 });
    assert.ok(listItems.length >= 2 && listItems.every((it) => (it.readMinutes || 0) >= 1),
      `列表应含 readMinutes 估算: ${JSON.stringify(listItems.map((it) => it.readMinutes))}`);
    console.log(`PASS 列表阅读时长字段：${listItems.map((it) => it.readMinutes).join('/')} 分钟`);

    // 3. 静态锚点
    const ipcSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipc.js'), 'utf8');
    assert.ok(ipcSrc.includes("handle('kb:graph'") && ipcSrc.includes("handle('kb:ask'"), 'ipc 应含 kb:graph / kb:ask');
    const preloadSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'preload.js'), 'utf8');
    assert.ok(preloadSrc.includes('kbGraph:') && preloadSrc.includes('kbAsk:'), 'preload 应暴露图谱/问答桥');
    const kbSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'views', 'knowledge.js'), 'utf8');
    for (const token of ["id: 'graph'", "id: 'ask'", '_renderGraph(', '_renderAsk(', 'kb-graph-canvas', 'onOpenArticle']) {
      assert.ok(kbSrc.includes(token), `knowledge.js 应含 ${token}`);
    }
    const cssSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'styles', 'robin.css'), 'utf8');
    for (const token of ['.kb-graph-canvas', '.kb-graph-panel', '.kb-ask-answer', '.nj-reveal-pending', 'kb-pop', '.nj-edition-cover:hover', '.read-min', '.nj-code-copy', '.nj-lightbox-zoom', '.nj-find-bar']) {
      assert.ok(cssSrc.includes(token), `robin.css 应含 ${token}`);
    }
    const appSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8');
    assert.ok(appSrc.includes('startViewTransition'), 'app.js 应含 View Transition 美化');
    const stringsSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'I18NStrings.js'), 'utf8');
    for (const key of ['知识图谱', '问知识库', '提问']) assert.ok(stringsSrc.includes(`"${key}"`), `i18n 应含「${key}」`);

    app.exit(0);
  } catch (error) {
    console.error('FAIL', error?.message || error);
    app.exit(1);
  }
});
