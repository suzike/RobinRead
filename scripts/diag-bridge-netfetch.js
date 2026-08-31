'use strict';
/** 验证：FeedService 切换 net.fetch 后，被屏蔽的公众号桥经系统代理可达。 */
const path = require('node:path');
const fs = require('node:fs');
const { app, session } = require('electron');

const userData = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'robinread-bridge-'));
app.setPath('userData', userData);

app.whenReady().then(async () => {
  const FeedService = require('../src/main/FeedService');
  // 与 main.js 相同的注入
  FeedService.useNetFetch((url, options) => require('electron').net.fetch(url, options));

  // 0) 系统代理状态（判别用户 Clash 是否系统代理模式）
  try {
    const proxy = await session.defaultSession.resolveProxy('https://wechat2rss.bestblogs.dev/feed/x.xml');
    console.log('[proxy] resolveProxy →', proxy || '(DIRECT)');
  } catch (e) { console.log('[proxy] resolveProxy 失败:', e.message); }

  const testURL = 'https://wechat2rss.bestblogs.dev/feed/70169da59e7e342ec7b63c90351b224b50cf7cb7.xml';
  const t0 = Date.now();
  try {
    const result = await FeedService.fetchFeed({ feedURL: testURL }, { force: true });
    const elapsed = Math.round((Date.now() - t0) / 1000);
    console.log(`PASS 桥经 net.fetch 可达 (${elapsed}s) — 标题:「${result.parsed.title}」条目=${result.parsed.entries.length}`);
  } catch (err) {
    console.log(`FAIL 桥经 net.fetch 不可达 — ${String(err.message || err).slice(0, 100)} (${Math.round((Date.now() - t0) / 1000)}s)`);
  }
  app.exit(0);
});
