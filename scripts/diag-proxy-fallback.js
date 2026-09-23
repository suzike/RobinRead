'use strict';
/** 诊断：死代理场景（系统代理开、Clash 不在）下，net.fetch 直连回退是否救回公众号刷新。 */
const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

const PROD = path.join(process.env.APPDATA, 'RobinRead');
const userData = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'robinread-pxfallback-'));
fs.mkdirSync(path.join(userData, 'credentials'), { recursive: true });
for (const f of ['library.db', 'preferences.json', 'Local State']) {
  try { fs.copyFileSync(path.join(PROD, f), path.join(userData, f)); } catch (_) {}
}
// 实时库正被运行中的应用写入：WAL/SHM 必须一起拷，否则副本缺最新事务页可能卡死
for (const f of ['library.db-wal', 'library.db-shm']) {
  try { fs.copyFileSync(path.join(PROD, f), path.join(userData, f)); } catch (_) {}
}
app.setPath('userData', userData);
const T0 = Date.now();
const log = (m) => console.log('[' + Math.round((Date.now() - T0) / 1000) + 's] ' + m);
setTimeout(() => { log('WATCHDOG'); app.exit(3); }, 6 * 60 * 1000).unref();

// 与新 main.js 完全一致的回退包装
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
      log('  ↓ 连接级失败（' + message.slice(0, 60) + '）→ 直连重试');
      return await directSession.fetch(url, options);
    }
  };
}

app.whenReady().then(async () => {
  const { AppStore } = require('../src/main/AppStore');
  const { net } = require('electron');
  const BRIDGE = 'https://wechat2rss.bestblogs.dev/feed/ff621c3e98d6ae6fceb3397e57441ffc6ea3c17f.xml'; // 数字生命卡兹克

  // 1) 裸 net.fetch（旧行为）：走死代理 → 应当失败
  try {
    const r = await net.fetch(BRIDGE);
    log('旧行为（裸 net.fetch）: HTTP ' + r.status + '（代理竟可用？）');
    try { await r.arrayBuffer(); } catch (_) {}
  } catch (e) {
    log('旧行为（裸 net.fetch）: 失败 → ' + String((e && e.message) || e).slice(0, 70));
  }

  // 2) 回退包装：应直连成功
  const netFetch = makeNetFetch(net);
  try {
    const r = await netFetch(BRIDGE);
    const buf = await r.arrayBuffer();
    log('回退包装: HTTP ' + r.status + '，' + buf.byteLength + ' 字节');
  } catch (e) {
    log('回退包装: 仍失败 → ' + String((e && e.message) || e).slice(0, 70));
  }

  // 3) 完整刷新链路（生产同款注入 + 卡兹克源）
  const { FeedService } = require('../src/main/FeedService');
  FeedService.useNetFetch(netFetch);
  require('../src/main/FeedDiscovery').useNetFetch(netFetch);
  const store = new AppStore(userData);
  const feed = store.feedsRepo.allFeeds().find((f) => !f.isDeleted && /ff621c3e98d6ae6fceb3397e57441ffc6ea3c17f/.test(f.feedURL));
  if (!feed) { log('未找到卡兹克订阅'); app.exit(2); return; }
  const t = Date.now();
  try {
    const r = await store.refreshFeed(feed.id);
    log(`刷新「${feed.title}」→ newEntries=${r.newEntries} (${Date.now() - t}ms) ✓`);
  } catch (e) {
    log(`刷新「${feed.title}」→ 失败: ${String((e && e.message) || e).slice(0, 90)}`);
  }
  app.exit(0);
});
