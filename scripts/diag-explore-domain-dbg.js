'use strict';
/** 调试：复现「领域词探索全部失败」——统计候选匹配数、逐个验证结果。 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app } = require('electron');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-explore-dbg-'));
app.setPath('userData', userData);

app.whenReady().then(async () => {
  const { AppStore } = require('../src/main/AppStore');
  const POOL = require('../src/main/data/feed-pool.json');
  const store = new AppStore(userData);

  const domain = 'agent';
  const matched = POOL.sources.filter((s) => {
    const hay = `${s.name} ${s.desc || ''} ${(s.tags || []).join(' ')} ${s.category || ''}`.toLowerCase();
    let host = '';
    try { host = new URL(s.feedURL || s.siteURL).hostname; } catch (_) {}
    return hay.includes(domain) || host.includes(domain);
  });
  console.log(`[dbg] 领域词「${domain}」匹配候选: ${matched.length} / ${POOL.sources.length}`);
  for (const m of matched.slice(0, 20)) {
    console.log(`   - ${m.name} | ${m.feedURL} | tags=${(m.tags || []).join('/')}`);
  }

  // 画像标签（冷启动应为空）
  const profile = store.evolution.interestProfile();
  console.log('[dbg] 画像 topTags:', (profile.tags || []).slice(0, 5).map((t) => t.tag || t).join(',') || '(空)');

  // 跑真实 run（basic 模式，避开 LLM 费用；AI 规划只影响排序不影响成败）
  const run = await store.explore.run({ mode: 'basic', domain, limit: 10 });
  console.log(`[dbg] run 结果: cards=${(run.cards || []).length} note=${run.note || '-'}`);
  for (const c of run.cards || []) console.log(`   ✓ ${c.name} score=${c.score}`);

  // 单独验证前 5 个匹配候选看失败原因分布
  const FeedDiscovery = require('../src/main/FeedDiscovery');
  const FeedParser = require('../src/main/FeedParser');
  for (const m of matched.slice(0, 5)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let status = '';
    let entries = 0;
    try {
      const res = await fetch(m.feedURL, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 RobinRead' } });
      status = `HTTP ${res.status}`;
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        try {
          const p = FeedParser.parse(buf, m.feedURL);
          entries = (p.entries || []).length;
        } catch (e) { status += ' parse:' + String(e.message).slice(0, 40); }
      }
    } catch (e) { status = 'fetch:' + String(e.message || e).slice(0, 40); }
    finally { clearTimeout(timer); }
    console.log(`   [验证] ${m.name} → ${status} entries=${entries}`);
  }

  app.exit(0);
});
