const { app } = require('electron');
app.whenReady().then(async () => {
  const { net } = require('electron');
  const FeedDiscovery = require('../src/main/FeedDiscovery');
  FeedDiscovery.useNetFetch((u, o) => net.fetch(u, o));

  // 1) 复现 _httpGet('') 的调用形态
  try {
    const r = await net.fetch('', { headers: { 'User-Agent': 'Mozilla/5.0 RobinRead' }, signal: AbortSignal.timeout(40000), redirect: 'follow' });
    console.log(`step1 net.fetch(''): HTTP ${r.status}`);
  } catch (e) {
    console.log(`step1 net.fetch(''): ERR ${(e && e.message || e).slice(0, 100)}`);
  }
  // 2) 紧接着的正常请求（探索流程中的下一个候选）
  const t2 = Date.now();
  try {
    const r = await net.fetch('https://huggingface.co/blog/feed.xml');
    console.log(`step2 hf feed: HTTP ${r.status} (${Date.now() - t2}ms)`);
  } catch (e) {
    console.log(`step2 hf feed: ERR ${(e && e.message || e).slice(0, 100)} (${Date.now() - t2}ms)`);
  }
  // 3) 完整发现流程
  const t3 = Date.now();
  try {
    const r = await FeedDiscovery.discoverFeed('https://huggingface.co/blog');
    console.log(`step3 discover: ok=${r.ok} entries=${r.parsed ? r.parsed.entries.length : 0} (${Date.now() - t3}ms)`);
  } catch (e) {
    console.log(`step3 discover: ERR ${(e && e.message || e).slice(0, 100)} (${Date.now() - t3}ms)`);
  }
  app.exit(0);
});
setTimeout(() => { console.log('WATCHDOG'); app.exit(3); }, 120 * 1000).unref();
