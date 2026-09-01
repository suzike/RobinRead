'use strict';
/** 调试：用用户真实数据副本跑 AI 探索（只读复制正库，不触碰正在运行的应用）。
 *  注入 net.fetch（系统代理），与 main.js 生产行为一致；_validateCandidate 逐步骤插桩。 */
const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

const PROD = path.join(process.env.APPDATA, 'RobinRead');
const userData = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'robinread-real-'));
fs.mkdirSync(path.join(userData, 'credentials'), { recursive: true });
for (const f of ['library.db', 'preferences.json', 'Local State']) {
  try { fs.copyFileSync(path.join(PROD, f), path.join(userData, f)); } catch (_) {}
}
try { fs.copyFileSync(path.join(PROD, 'credentials', 'ai-api-key.bin'), path.join(userData, 'credentials', 'ai-api-key.bin')); } catch (_) {}
app.setPath('userData', userData);

const LOG = path.join(__dirname, 'explore-real-dbg.log');
const T0 = Date.now();
const log = (m) => { const line = '[' + Math.round((Date.now() - T0) / 1000) + 's] ' + m; console.log(line); fs.appendFileSync(LOG, line + '\n'); };
process.on('uncaughtException', (e) => { log('UNCAUGHT: ' + ((e && e.stack) || e)); });
process.on('unhandledRejection', (e) => { log('UNHANDLED: ' + ((e && e.stack) || e)); });
setTimeout(() => { log('WATCHDOG 退出'); app.exit(3); }, 6 * 60 * 1000).unref();

app.whenReady().then(async () => {
  log('whenReady fired');
  const { AppStore } = require('../src/main/AppStore');
  const FeedDiscovery = require('../src/main/FeedDiscovery');
  const FeedParser = require('../src/main/FeedParser');
  log('constructing AppStore…');
  const store = new AppStore(userData);
  log('AppStore constructed, hasAIKey=' + store.hasAIAPIKey());
  log('订阅源 ' + store.feedsRepo.allFeeds().filter((f) => !f.isDeleted).length + ' 条');

  // 注入：与 main.js 相同的 net.fetch（走系统代理）
  const netFetch = (url, options) => require('electron').net.fetch(url, options);
  store.explore.setNetFetch(netFetch);
  FeedDiscovery.useNetFetch(netFetch);

  // 注入有效性自检：google 直连必挂、net.fetch 必通
  try {
    const r = await netFetch('https://www.google.com');
    log('注入自检 net.fetch(google): HTTP ' + r.status);
    try { await r.arrayBuffer(); } catch (_) {}
  } catch (e) { log('注入自检 net.fetch(google) ERR: ' + ((e && e.message) || e)); }

  // 插桩版 _validateCandidate：逐步骤记录真实失败点
  store.explore._validateCandidate = async function (candidate) {
    let feedURL = candidate.feedURL;
    let parsed = null;
    try {
      const got = await this._httpGet(feedURL, { timeoutMs: 40000 });
      parsed = FeedParser.parse(got.buf, feedURL);
      log('    [step1] ' + candidate.name + ' feed(' + (feedURL || '空') + ') → ' + parsed.entries.length + ' 条');
    } catch (e) {
      log('    [step1] ' + candidate.name + ' feed(' + (feedURL || '空') + ') → ERR ' + String((e && e.message) || e).slice(0, 90));
    }
    if ((!parsed || !parsed.entries || !parsed.entries.length) && candidate.siteURL) {
      try {
        const disc = await FeedDiscovery.discoverFeed(candidate.siteURL);
        log('    [step2] ' + candidate.name + ' discover(' + candidate.siteURL + ') → ok=' + (disc && disc.ok) + ' ' + ((disc && disc.feedURL) || (disc && disc.error) || ''));
        if (disc && disc.ok) { feedURL = disc.feedURL; parsed = disc.parsed; }
      } catch (e) {
        log('    [step2] ' + candidate.name + ' discover → ERR ' + String((e && e.message) || e).slice(0, 90));
      }
    }
    if (!parsed || !parsed.entries || !parsed.entries.length) return null;
    try { return this._scoreCandidate(candidate, feedURL, parsed); }
    catch (e) { log('    [step3] ' + candidate.name + ' score → THROW ' + String((e && e.stack) || e).split('\n')[0]); return null; }
  };

  const run = await store.explore.run({
    mode: 'ai', domain: 'agent', limit: 10,
    seenDomains: [],
    onProgress: (p) => log('  验证 ' + (p.ok ? '✓' : '✗') + ' ' + p.name),
  });
  log('run → cards=' + (run.cards || []).length + ' mode=' + run.mode + ' note=' + (run.note || '-'));
  for (const c of run.cards || []) log('  ✓ ' + c.name + ' | ' + c.domain + ' | score=' + c.score);

  log('DONE');
  app.exit(0);
});
