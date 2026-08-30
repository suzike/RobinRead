'use strict';
/**
 * 阶段三探测：PreparedArticle LRU + 相邻文章预取。
 * 断言：(a) 同 entryID 二次取 reader 载荷命中 LRU；(b) 容量 12 插入序淘汰；
 * (c) markRead/toggleStar 后命中缓存的载荷 isRead/isStarred 已刷新；
 * (d) extractArticle 成功写缓存后该 entry 被逐出、重组装含新正文；
 * (e) 'app:reader' 经 ipcMain 调用返回结构与字段名不变；(f) 相邻预取入 LRU 且预抓用 prefetch 优先级。
 * 附加：refresh()/refreshFeed() 清空 LRU、TTL 过期。临时文件，验证后可保留为回归。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, ipcMain } = require('electron');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-phase3-'));
app.setPath('userData', userData);

const longBody = (tag) => `<p>${'正文段落'.repeat(140)}【${tag}】超导量子比特的表面码纠错需要超出阈值的物理错误率，这段正文足够长（纯文本 > 500 字）以避免触发网页提取。</p>`;
const t = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600 * 1000).toUTCString();
const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>阶段三探测源</title><link>https://example.com/p3</link>
<item><title>第一篇：量子纠错</title><link>https://example.com/p3/1</link><pubDate>${t(1)}</pubDate>
<description>d1</description><content:encoded><![CDATA[${longBody('甲甲甲')}]]></content:encoded></item>
<item><title>第二篇：Rust 异步</title><link>https://example.com/p3/2</link><pubDate>${t(2)}</pubDate>
<description>d2</description><content:encoded><![CDATA[${longBody('乙乙乙')}]]></content:encoded></item>
<item><title>第三篇：io_uring</title><link>https://example.com/p3/3</link><pubDate>${t(3)}</pubDate>
<description>d3</description><content:encoded><![CDATA[${longBody('丙丙丙')}]]></content:encoded></item>
<item><title>第四篇：eBPF</title><link>https://example.com/p3/4</link><pubDate>${t(4)}</pubDate>
<description>d4</description><content:encoded><![CDATA[${longBody('丁丁丁')}]]></content:encoded></item>
<item><title>第五篇：WebGPU</title><link>https://example.com/p3/5</link><pubDate>${t(5)}</pubDate>
<description>d5</description><content:encoded><![CDATA[${longBody('戊戊戊')}]]></content:encoded></item>
<item><title>第六篇：短文待提取</title><link>https://example.com/p3/6</link><pubDate>${t(6)}</pubDate>
<description>d6</description><content:encoded><![CDATA[<p>短文。</p>]]></content:encoded></item>
</channel></rss>`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };
  try {
    // 正文提取打桩：不依赖网络，记录调用（url/priority），返回可区分版本的大正文
    const ExtractorModule = require('../src/main/ArticleExtractor');
    const realExtract = ExtractorModule.extract;
    let extractSeq = 0;
    const extractCalls = [];
    ExtractorModule.extract = async (url, options = {}) => {
      extractSeq += 1;
      extractCalls.push({ url, priority: options.priority || 'user', seq: extractSeq });
      const filler = `网页提取版本 extracted-v${extractSeq} `;
      return {
        entryID: '',
        text: filler.repeat(120),
        html: `<p>${filler.repeat(120)}</p>`,
        imageURLs: [],
        fetchedAt: Math.floor(Date.now() / 1000),
        sourceURL: url,
        isSanitized: true,
      };
    };

    const { AppStore } = require('../src/main/AppStore');
    const { parse: parseFeed } = require('../src/main/FeedParser');
    const { LOCAL_ACCOUNT_ID } = require('../src/main/Models');
    const store = new AppStore(userData);
    const lru = store._preparedLRU;
    const stats = () => lru.stats();
    check('store 暴露 _preparedLRU.stats()', typeof stats === 'function' && stats().capacity === 12,
      JSON.stringify(stats()));

    const feed = store.feedsRepo.insertFeed({
      accountID: LOCAL_ACCOUNT_ID, title: '阶段三探测源', siteURL: 'https://example.com/p3',
      feedURL: 'https://example.com/p3/feed.xml',
    });
    const parsed = parseFeed(SAMPLE, 'https://example.com/p3/feed.xml');
    const ids = store._applyParsedEntries(feed, parsed.entries);
    check('样本入库 6 篇', ids.length === 6, `ids=${ids.length}`);
    const [e1, e2, e3, e4, e5, e6] = ids; // e1 最新 → e6 最旧（e6 短文 needsExtraction）

    // ---- (a) LRU 命中：同一 entryID 连续两次取 reader 载荷 ----
    const s0 = stats();
    const ta = Date.now();
    const p1 = store.readerArticle(e3);
    const ms1 = Date.now() - ta;
    const s0b = stats();
    check('a1 首次取载荷为 miss（组装）', p1 && p1.entry.id === e3 && s0b.misses === s0.misses + 1 && s0b.hits === s0.hits,
      `misses ${s0.misses}->${s0b.misses} ms=${ms1}`);
    await wait(300); // 等预取落袋
    const tb = Date.now();
    const p2 = store.readerArticle(e3);
    const ms2 = Date.now() - tb;
    const s1 = stats();
    check('a2 第二次命中 LRU（hits+1、零重组装）', s1.hits === s0b.hits + 1 && s1.misses === s0b.misses,
      `hits ${s0b.hits}->${s1.hits} ms=${ms2} stats=${JSON.stringify(s1)}`);
    check('a3 命中载荷内容一致', p2.content.html === p1.content.html && p2.summary === p1.summary,
      `htmlEq=${p2.content.html === p1.content.html}`);

    // ---- (f) 相邻预取：取 e3 后，其前后（e2/e4）已在 LRU ----
    check('f1 相邻文章已预取入 LRU', lru.has(e2) && lru.has(e4),
      `keys=${lru.keys().join(',')} prefetchStored=${s1.prefetchStored}`);

    // ---- (c) markRead / toggleStar：不逐出载荷，命中返回前刷新 isRead/isStarred ----
    store.markRead(e3, true);
    const p3 = store.readerArticle(e3);
    const s2 = stats();
    check('c1 markRead 后命中载荷 isRead 已刷新', p3.entry.isRead === true && s2.hits === s1.hits + 1 && s2.misses === s1.misses,
      `isRead=${p3.entry.isRead} hits ${s1.hits}->${s2.hits}`);
    store.toggleStar(e3);
    const p3b = store.readerArticle(e3);
    check('c2 toggleStar 后命中载荷 isStarred 已刷新', p3b.entry.isStarred === true, `isStarred=${p3b.entry.isStarred}`);

    // ---- (b) 容量 12 插入序淘汰（直接驱动 LRU，排除预取噪声）----
    const realSched = store._scheduleAdjacentPrefetch.bind(store);
    store._scheduleAdjacentPrefetch = () => {}; // 暂关预取，容量断言才确定性
    lru.clear();
    for (let i = 0; i < 12; i++) lru.set(`k${i}`, { v: i });
    lru.get('k0'); // 刷新 k0 新近度 → 最旧变 k1
    const sB0 = stats();
    lru.set('k12', { v: 12 });
    const sB1 = stats();
    check('b1 超容淘汰最旧（k1 出、k0/k12 留、size=12）',
      sB1.size === 12 && !lru.has('k1') && lru.has('k0') && lru.has('k12') && sB1.evicted === sB0.evicted + 1,
      `size=${sB1.size} evicted ${sB0.evicted}->${sB1.evicted}`);
    store._scheduleAdjacentPrefetch = realSched;
    lru.clear();

    // ---- (d) extractArticle 成功写缓存 → 逐出 → 重组装含新正文；(f2) 预抓 priority=prefetch ----
    store._prefetchExtractTried.clear();
    const p4 = store.readerArticle(e5); // e5 相邻为 e4/e6；e6 短文 → 触发预抓
    check('d1 打开 e5 组装（RSS 原文，非缓存）', p4 && p4.content.fromCache === false, `fromCache=${p4?.content?.fromCache}`);
    await wait(400);
    const pfCalls6 = extractCalls.filter((c) => c.url === 'https://example.com/p3/6');
    const pfCall = pfCalls6[0];
    check('f2 预抓正文使用 priority=prefetch', pfCall && pfCall.priority === 'prefetch',
      JSON.stringify(extractCalls));
    check('d2 提取成功写缓存后 e6 载荷被逐出', store.cachesRepo.cache(e6) != null && !lru.has(e6),
      `dbCache=${store.cachesRepo.cache(e6) != null} inLRU=${lru.has(e6)}`);
    const p5 = store.readerArticle(e6); // 重组装：应含提取正文
    check('d3 重组装含新正文（fromCache=true, 预抓版本）',
      p5.content.fromCache === true && String(p5.content.html).includes(`extracted-v${pfCall.seq}`),
      `fromCache=${p5.content.fromCache} html=${String(p5.content.html).slice(0, 40)}…`);
    const beforeUser = extractCalls.length;
    await store.extractArticle(e6); // 用户路径（priority=user）
    const userCall = extractCalls[extractCalls.length - 1];
    check('d4 用户提取同样逐出（下次重组装新版本）', !lru.has(e6) && extractCalls.length === beforeUser + 1
      && userCall.priority === 'user', `calls=${extractCalls.length}`);
    const p6 = store.readerArticle(e6);
    check('d5 再次取含用户新正文', String(p6.content.html).includes(`extracted-v${userCall.seq}`),
      `html=${String(p6.content.html).slice(0, 40)}…`);

    // ---- (e) 'app:reader' 经 ipcMain 直调：返回结构与字段名不变 ----
    const { registerIPCHandlers } = require('../src/main/ipc');
    const fakeWin = { isDestroyed: () => true, webContents: { send: () => {} }, on: () => {} };
    registerIPCHandlers(store, fakeWin);
    // Electron 37 把 invoke handler 存在私有 Map（老版本叫 _handlers，37 叫 _invokeHandlers）
    const handlersMap = ipcMain._invokeHandlers || ipcMain._handlers;
    if (!handlersMap || typeof handlersMap.get !== 'function') {
      check('e1 ipcMain handler 表可用', false, 'no _invokeHandlers/_handlers');
    } else {
      const handler = handlersMap.get('app:reader');
      check('e1 app:reader handler 已注册', typeof handler === 'function');
      const res = await handler({}, e3);
      const direct = store.readerArticle(e3);
      const ipcKeys = Object.keys(res.data || {}).sort().join(',');
      const directKeys = Object.keys(direct || {}).sort().join(',');
      check('e2 返回结构字段名不变 {entry,feed,content,summary,annotations}',
        res.ok === true && ipcKeys === 'annotations,content,entry,feed,summary' && ipcKeys === directKeys,
        `ipc=[${ipcKeys}] direct=[${directKeys}]`);
      const d = res.data;
      check('e3 字段形态与旧实现一致', d.entry.id === e3 && d.feed.id === feed.id
        && d.feed.title === '阶段三探测源' && typeof d.content.fromCache === 'boolean'
        && 'html' in d.content && 'text' in d.content && Array.isArray(d.annotations)
        && (d.summary === null || typeof d.summary === 'object'),
        `entry=${d.entry.id} contentKeys=${Object.keys(d.content).join(',')} ann=${d.annotations.length}`);
      const missRes = await handler({}, 'local:nope:123');
      check('e4 不存在的条目返回 null（与旧行为一致）', missRes.ok === true && missRes.data === null,
        `ok=${missRes.ok} data=${missRes.data}`);
    }

    // ---- 附加：refresh() 完成清空 LRU ----
    store.readerArticle(e2);
    check('g1 refresh 前 LRU 非空', lru.keys().length > 0, `keys=${lru.keys().length}`);
    const realRefreshLocal = store._refreshLocalFeed.bind(store);
    store._refreshLocalFeed = async () => []; // 隔离网络
    await store.refresh('manual');
    check('g2 refresh() 完成后 LRU 清空', lru.keys().length === 0, `keys=${lru.keys().length}`);
    store._refreshLocalFeed = realRefreshLocal;

    // ---- 附加：refreshFeed() 新增文章路径清空 LRU ----
    const FeedService = require('../src/main/FeedService');
    const realFetchFeed = FeedService.fetchFeed;
    store.readerArticle(e2);
    FeedService.fetchFeed = async () => ({
      notModified: false, etag: null, lastModified: null,
      parsed: {
        title: '阶段三探测源', siteURL: 'https://example.com/p3',
        entries: [{ id: 'x-refresh-1', title: '刷新新增', url: 'https://example.com/p3/r1', publishedAt: Math.floor(Date.now() / 1000), summary: '', contentHTML: '<p>刷新新增内容。</p>' }],
      },
    });
    const rr = await store.refreshFeed(feed.id);
    check('h1 refreshFeed 新增文章后 LRU 清空', rr.newEntries === 1 && lru.keys().length === 0,
      `newEntries=${rr.newEntries} keys=${lru.keys().length}`);
    FeedService.fetchFeed = realFetchFeed;

    // ---- 附加：TTL 过期（单元级，短 TTL 验证）----
    const { PreparedArticleLRU } = require('../src/main/AppStore');
    const tiny = new PreparedArticleLRU(4, 30);
    tiny.set('a', { x: 1 });
    const hitTTL = tiny.get('a') != null;
    await wait(60);
    const secondGet = tiny.get('a');
    const sI = tiny.stats();
    check('i1 TTL 过期兜底（过期计 expired+miss）', hitTTL && secondGet === null && sI.expired === 1,
      `expired=${sI.expired} misses=${sI.misses}`);
  } catch (err) {
    check('unexpected-error', false, err.stack || err.message);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length === 0 ? 'PHASE3 LRU PROBE: ALL PASSED' : `PHASE3 LRU PROBE: ${failed.length} FAILED`);
  app.exit(failed.length === 0 ? 0 : 1);
});
