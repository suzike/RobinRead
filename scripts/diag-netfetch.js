const { app } = require('electron');
const targets = [
  ['google', 'https://www.google.com'],
  ['openai-rss', 'https://openai.com/news/rss.xml'],
  ['hf-feed', 'https://huggingface.co/blog/feed.xml'],
  ['ruanyifeng', 'https://www.ruanyifeng.com/blog/atom.xml'],
];
app.whenReady().then(async () => {
  const { net } = require('electron');
  for (const [name, url] of targets) {
    for (const [tag, fn] of [['net.fetch', (u) => net.fetch(u)], ['global.fetch', (u) => fetch(u)]]) {
      const t0 = Date.now();
      try {
        const res = await fn(url);
        console.log(`${name} ${tag}: HTTP ${res.status} (${Date.now() - t0}ms)`);
        try { await res.arrayBuffer(); } catch (_) {}
      } catch (e) {
        console.log(`${name} ${tag}: ERR ${(e && e.message || e).slice(0, 80)} (${Date.now() - t0}ms)`);
      }
    }
  }
  app.exit(0);
});
setTimeout(() => { console.log('WATCHDOG'); app.exit(3); }, 90 * 1000).unref();
