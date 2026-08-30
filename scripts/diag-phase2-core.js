'use strict';
/**
 * 阶段二核心探测：FTS5 全文索引（建表/实时索引/回填/搜索命中正文）+
 * 列表排序（unreadFirst）+ 状态推送节流。临时文件，验证后可保留为回归。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-phase2-'));
app.setPath('userData', userData);

const NOW = new Date().toUTCString();
const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>阶段二探测源</title><link>https://example.com/p2</link>
<item><title>第一篇：量子比特的纠错</title><link>https://example.com/p2/1</link><pubDate>${NOW}</pubDate>
<description>量子纠错概述</description>
<content:encoded><![CDATA[<p>超导量子比特的表面码纠错需要超出阈值的物理错误率，甲胄鱼这个词只出现在正文里。</p>]]></content:encoded></item>
<item><title>第二篇：Rust 异步运行时</title><link>https://example.com/p2/2</link><pubDate>${NOW}</pubDate>
<description>Rust async</description>
<content:encoded><![CDATA[<p> tokio 的工作窃取调度器与 io_uring 集成。</p>]]></content:encoded></item>
<item><title>第三篇：还未读的旧文</title><link>https://example.com/p2/3</link><pubDate>${NOW}</pubDate>
<description>旧文</description>
<content:encoded><![CDATA[<p>普通段落。</p>]]></content:encoded></item>
</channel></rss>`;

app.whenReady().then(async () => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };
  try {
    const { AppStore } = require('../src/main/AppStore');
    const { parse: parseFeed } = require('../src/main/FeedParser');
    const { LOCAL_ACCOUNT_ID } = require('../src/main/Models');
    const store2 = new AppStore(userData);
    const feed = store2.feedsRepo.insertFeed({
      accountID: LOCAL_ACCOUNT_ID, title: '阶段二探测源', siteURL: 'https://example.com/p2',
      feedURL: 'https://example.com/p2/feed.xml',
    });
    const parsed = parseFeed(SAMPLE, 'https://example.com/p2/feed.xml');
    const newIDs = store2._applyParsedEntries(feed, parsed.entries);
    check('样本入库 3 篇', newIDs.length === 3, `newIDs=${newIDs.length}`);

    // 实时索引已写入（不等回填）
    const ftsRows = store2.database.prepare('SELECT COUNT(*) c FROM articles_fts').get().c;
    check('FTS 行已实时索引', ftsRows >= 3, `rows=${ftsRows}`);

    // 正文独有词命中（标题/摘要都不含「甲胄鱼」）
    const bodyHit = store2.fullTextSearch('甲胄鱼这个词');
    check('FTS 正文命中（中文长词）', bodyHit.length === 1 && bodyHit[0].title.includes('量子比特'), `hits=${bodyHit.length}`);

    // 短查询回退 LIKE（2 字）
    const shortHit = store2.fullTextSearch('旧文');
    check('短查询 LIKE 回退命中', shortHit.length === 1, `hits=${shortHit.length}`);

    // 英文词
    const enHit = store2.fullTextSearch('tokio');
    check('FTS 英文词命中', enHit.length === 1, `hits=${enHit.length}`);

    // 排序：unreadFirst
    const items = store2.listItems({ kind: 'all' }, { limit: 50 });
    check('默认时间序 3 篇', items.length === 3, `n=${items.length}`);
    store2.markRead(items[0].id, true);
    const sorted = store2.listItems({ kind: 'all' }, { limit: 50, sort: 'unreadFirst' });
    check('unreadFirst 已读沉底', sorted[sorted.length - 1].id === items[0].id && sorted[0].isRead === false,
      `order=${sorted.map((s) => s.isRead ? 1 : 0).join(',')}`);

    // 推送节流：100ms 内连续 5 次 markRead → state:changed 至多 3 次
    let emits = 0;
    const counter = () => { emits += 1; };
    store2.on('state:changed', counter);
    const t0 = Date.now();
    for (const it of sorted) store2.markRead(it.id, true);
    await new Promise((r) => setTimeout(r, 250));
    store2.removeListener('state:changed', counter);
    check('推送节流（5 连发 ≤3 次推送）', emits <= 3, `emits=${emits} elapsed=${Date.now() - t0}ms`);

    // snapshot 携带增量字段
    const snap = store2.snapshot();
    check('snapshot 含修订号/签名/增量', Array.isArray(snap.entryChanges)
      && typeof snap.entryStateRev === 'number' && typeof snap.sidebarSignature === 'string',
      `rev=${snap.entryStateRev} changes=${snap.entryChanges.length}`);
  } catch (err) {
    check('unexpected-error', false, err.stack || err.message);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length === 0 ? 'PHASE2 CORE PROBE: ALL PASSED' : `PHASE2 CORE PROBE: ${failed.length} FAILED`);
  app.exit(failed.length === 0 ? 0 : 1);
});
