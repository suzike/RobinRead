'use strict';
/** 轻量验证：FeedService.fetchFeed（生产注入同款 wrapper）直接拉卡兹克桥，不经 AppStore。 */
const { app } = require('electron');
const T0 = Date.now();
const log = (m) => console.log('[' + Math.round((Date.now() - T0) / 1000) + 's] ' + m);
setTimeout(() => { log('WATCHDOG'); app.exit(3); }, 90 * 1000).unref();

function makeNetFetch(net) {
  let directSession = null;
  return async (url, options) => {
    try {
      return await net.fetch(url, options);
    } catch (err) {
      const message = String((err && err.message) || err);
      if (/^HTTP \d/.test(message)) throw err;
      if (!directSession) {
        const { session } = require('electron');
        directSession = session.fromPartition('robin-direct-fetch', { cache: false });
        await directSession.setProxy({ mode: 'direct' });
      }
      log('  ↓ ' + message.slice(0, 50) + ' → 直连重试');
      return await directSession.fetch(url, options);
    }
  };
}

app.whenReady().then(async () => {
  const { fetchFeed } = require('../src/main/FeedService');
  const { net } = require('electron');
  fetchFeed.useNetFetch ? null : null;
  require('../src/main/FeedService').useNetFetch(makeNetFetch(net));
  const feed = { feedURL: 'https://wechat2rss.bestblogs.dev/feed/ff621c3e98d6ae6fceb3397e57441ffc6ea3c17f.xml', etag: null, lastModified: null };
  const t = Date.now();
  try {
    const r = await fetchFeed(feed, { force: true });
    log(`fetchFeed → title=「${r.parsed.title}」 entries=${r.parsed.entries.length} (${Date.now() - t}ms) ✓`);
  } catch (e) {
    log('fetchFeed → 失败: ' + String((e && e.message) || e).slice(0, 100));
  }
  app.exit(0);
});
