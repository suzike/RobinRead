const { app } = require('electron');
const sites = [
  'https://huggingface.co/blog',
  'https://lilianweng.github.io/',
  'https://machinelearningmastery.com/blog/',
  'https://www.kdnuggets.com/',
  'https://thegradient.pub/',
];
app.whenReady().then(async () => {
  const FeedDiscovery = require('../src/main/FeedDiscovery');
  const { net } = require('electron');
  FeedDiscovery.useNetFetch((u, o) => net.fetch(u, o));
  for (const s of sites) {
    const t0 = Date.now();
    try {
      const r = await FeedDiscovery.discoverFeed(s);
      console.log(`${s} → ok=${r.ok} feed=${r.feedURL || '-'} entries=${r.parsed ? r.parsed.entries.length : 0} (${Date.now() - t0}ms)`);
    } catch (e) {
      console.log(`${s} → ERR ${(e && e.message || e).slice(0, 120)} (${Date.now() - t0}ms)`);
    }
  }
  app.exit(0);
});
setTimeout(() => { console.log('WATCHDOG'); app.exit(3); }, 150 * 1000).unref();
