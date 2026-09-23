'use strict';
/** 诊断：全量并发刷新的逐源失败明细（与生产 refresh 同构：Promise.allSettled + fetchFeed）。 */
const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

const PROD = path.join(process.env.APPDATA, 'RobinRead');
const userData = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'robinread-wxfail-'));
fs.mkdirSync(path.join(userData, 'credentials'), { recursive: true });
for (const f of ['library.db', 'preferences.json', 'Local State']) {
  try { fs.copyFileSync(path.join(PROD, f), path.join(userData, f)); } catch (_) {}
}
app.setPath('userData', userData);
const T0 = Date.now();
const log = (m) => console.log('[' + Math.round((Date.now() - T0) / 1000) + 's] ' + m);
setTimeout(() => { log('WATCHDOG'); app.exit(3); }, 6 * 60 * 1000).unref();

app.whenReady().then(async () => {
  const { AppStore } = require('../src/main/AppStore');
  const { fetchFeed } = require('../src/main/FeedService');
  const { net } = require('electron');
  const netFetch = (url, options) => net.fetch(url, options);
  require('../src/main/FeedService').useNetFetch(netFetch);
  require('../src/main/FeedDiscovery').useNetFetch(netFetch);
  const store = new AppStore(userData);

  const feeds = store.feedsRepo.allFeeds().filter((f) => !f.isDeleted);
  log('开始全量并发刷新 ' + feeds.length + ' 个源（与生产同构）');
  const results = await Promise.allSettled(feeds.map(async (feed) => {
    const t = Date.now();
    try {
      await fetchFeed(feed, { force: true });
      return { feed, ok: true, ms: Date.now() - t };
    } catch (e) {
      throw Object.assign(new Error(String((e && e.message) || e).slice(0, 110)), { feed, ms: Date.now() - t });
    }
  }));
  const fails = results.filter((r) => r.status === 'rejected').map((r) => r.reason);
  log(`完成：成功=${results.length - fails.length} 失败=${fails.length}`);
  for (const err of fails) {
    log(`  ✗ ${err.feed.title} [${err.ms}ms] ${err.message}`);
  }
  log('DONE');
  app.exit(0);
});
