'use strict';
/**
 * AI 探索后端探测：basic 模式真实验证（本地池→发现→解析→评分）+
 * explored_feeds 排除闭环 + healthByFeedURL + addFeed 发现回退 + 无 key 时 explain 报错。
 * 需要真实网络（访问池内中文博客，直连可达）。幂等，退出码反映成败。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app } = require('electron');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-explore-'));
app.setPath('userData', userData);

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
    const store = new AppStore(userData);

    // 预置一个已订阅源：阮一峰（真实站点，池内存在同域候选 → 验证域名排除）
    const feed = store.feedsRepo.insertFeed({
      accountID: LOCAL_ACCOUNT_ID, title: '阮一峰', siteURL: 'https://ruanyifeng.com',
      feedURL: 'https://www.ruanyifeng.com/blog/atom.xml',
    });
    const parsed = parseFeed(`<?xml version="1.0"?><rss version="2.0"><channel><title>t</title><item><title>x</title><link>https://ruanyifeng.com/1</link></item></channel></rss>`, 'https://www.ruanyifeng.com/blog/atom.xml');
    store._applyParsedEntries(feed, parsed.entries);

    // 1) basic 探索（真实验证；阮一峰域名应被排除）
    const t0 = Date.now();
    const run = await store.explore.run({ mode: 'basic', limit: 6, excludeDomains: [] });
    const cards = run.cards || [];
    check('basic 探索返回卡片', cards.length >= 3 && cards.length <= 6, `n=${cards.length} elapsed=${Date.now() - t0}ms note=${run.note || '-'}`);
    check('卡片结构完整（name/feedURL/score/samples）',
      cards.every((c) => c.feedURL && c.name && typeof c.score === 'number' && Array.isArray(c.samples)),
      JSON.stringify(cards[0] ? { name: cards[0].name, score: cards[0].score, samples: cards[0].samples.length, interval: cards[0].intervalDays, chars: cards[0].avgChars } : {}));
    check('评分区间合法', cards.every((c) => c.score >= 0 && c.score <= 100));
    const domains = cards.map((c) => c.domain); console.log('[卡片明细]', cards.map((c) => c.domain + '|' + c.name.slice(0, 14)).join(' ; '));
    check('已订阅域名被排除', !domains.some((d) => d.includes('ruanyifeng')), domains.join(','));

    // 2) explored_feeds 落库
    const explored = store.database.prepare('SELECT COUNT(*) c FROM explored_feeds').get().c;
    check('explored_feeds 落库', explored >= cards.length, `rows=${explored}`);

    // 3) 拒绝一张卡 → 再次探索不再出现该域名
    const rejected = cards[0];
    store.explore.dismiss({ url: rejected.feedURL, reason: 'rejected' });
    const run2 = await store.explore.run({ mode: 'basic', limit: 10, excludeDomains: [] });
    check('拒绝后域名被排除', !(run2.cards || []).some((c) => c.domain === rejected.domain),
      `rejected=${rejected.domain} run2=${(run2.cards || []).length}`);

    // 4) 负向反馈写回画像
    const profile = store.evolution.interestProfile();
    const domainKey = profile.tags ? 'check-below' : '';
    const dbKey = store.database.prepare("SELECT value FROM interest_profile WHERE key LIKE 'domain:%' ORDER BY value ASC LIMIT 1").get();
    check('负向反馈写入画像', Boolean(dbKey), dbKey ? `key=${dbKey.key} value=${dbKey.value}` : 'none');

    // 5) healthByFeedURL（空映射合法：预置源未经刷新，feed_health 无记录）
    const health = store.healthByFeedURL();
    check('healthByFeedURL 返回对象', typeof health === 'object', `keys=${Object.keys(health).length}`);

    // 6) 无 key 时 explain 应干净报错
    let explainError = null;
    try { await store.explore.explain({ url: rejected.feedURL, name: rejected.name, samples: rejected.samples }); } catch (err) { explainError = err.message; }
    check('无 key 时 explain 干净报错', Boolean(explainError), `err=${explainError}`);

    // 7) addFeed 发现回退：粘贴博客首页（非 feed 地址）也能订阅（用未预置的站点）
    let added = null;
    try { added = await store.addFeed('https://blog.codingnow.com/'); } catch (err) { added = { error: err.message }; }
    check('addFeed 发现回退（贴首页可订阅）', added && !added.error && Boolean(added.feedURL),
      JSON.stringify(added ? { feedURL: added.feedURL, title: added.title, error: added.error } : added));
  } catch (err) {
    check('unexpected-error', false, err.stack || err.message);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length === 0 ? 'EXPLORE BACKEND PROBE: ALL PASSED' : `EXPLORE BACKEND PROBE: ${failed.length} FAILED`);
  app.exit(failed.length === 0 ? 0 : 1);
});
