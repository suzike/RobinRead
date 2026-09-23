'use strict';
/** 诊断：应用环境内复现公众号刷新失败（单源 vs 全量并发），net.fetch 注入与生产一致。 */
const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

const PROD = path.join(process.env.APPDATA, 'RobinRead');
const userData = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'robinread-wxdiag-'));
fs.mkdirSync(path.join(userData, 'credentials'), { recursive: true });
for (const f of ['library.db', 'preferences.json', 'Local State']) {
  try { fs.copyFileSync(path.join(PROD, f), path.join(userData, f)); } catch (_) {}
}
try { fs.copyFileSync(path.join(PROD, 'credentials', 'ai-api-key.bin'), path.join(userData, 'credentials', 'ai-api-key.bin')); } catch (_) {}
app.setPath('userData', userData);

const T0 = Date.now();
const log = (m) => console.log('[' + Math.round((Date.now() - T0) / 1000) + 's] ' + m);
setTimeout(() => { log('WATCHDOG 退出'); app.exit(3); }, 8 * 60 * 1000).unref();

app.whenReady().then(async () => {
  const { AppStore } = require('../src/main/AppStore');
  const { net } = require('electron');
  const netFetch = (url, options) => net.fetch(url, options);
  require('../src/main/FeedService').useNetFetch(netFetch);
  require('../src/main/FeedDiscovery').useNetFetch(netFetch);
  const store = new AppStore(userData);

  const feeds = store.feedsRepo.allFeeds().filter((f) => !f.isDeleted);
  const wx = feeds.filter((f) => /wechat2rss/.test(f.feedURL));
  log(`订阅 ${feeds.length} 个，其中公众号桥 ${wx.length} 个`);

  // 1) 单源刷新（公众号其一）
  if (wx.length) {
    const t = Date.now();
    try {
      const r = await store.refreshFeed(wx[0].id);
      log(`单源「${wx[0].title}」→ newEntries=${r.newEntries} (${Date.now() - t}ms)`);
    } catch (e) {
      log(`单源「${wx[0].title}」→ 失败: ${String((e && e.message) || e).slice(0, 120)} (${Date.now() - t}ms)`);
    }
  }

  // 2) 全量刷新（与用户手动刷新同路径）
  const t2 = Date.now();
  try {
    await store.refresh('manual');
    const outcome = store.lastRefreshOutcome || {};
    log(`全量刷新 → 成功=${outcome.updatedFeedCount} 失败=${outcome.failedFeedCount} 新文章=${outcome.newUnreadCount} (${Date.now() - t2}ms)`);
  } catch (e) {
    log(`全量刷新 → 异常: ${String((e && e.stack) || e).slice(0, 200)} (${Date.now() - t2}ms)`);
  }

  // 3) 失败明细：逐源再刷一次公众号桥，记录具体报错
  for (const f of wx.slice(0, 4)) {
    const t = Date.now();
    try {
      await store.refreshFeed(f.id);
      log(`  ✓ ${f.title} (${Date.now() - t}ms)`);
    } catch (e) {
      log(`  ✗ ${f.title} → ${String((e && e.message) || e).slice(0, 140)} (${Date.now() - t}ms)`);
    }
  }
  log('DONE');
  app.exit(0);
});
