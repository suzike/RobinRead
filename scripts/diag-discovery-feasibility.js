'use strict';
/**
 * RobinRead（知更）诊断脚本 — 「AI 探索优质订阅源」可行性验证
 *
 * 验证目标：AI 探索管线最难的一环 —— 「站点 URL → 发现可用 feed → 提取健康度元数据」
 * 全管线在纯 Node 环境跑通（不启动 Electron），复用产品真实解析器：
 *   - src/main/FeedParser.js      （RSS/RDF/Atom/JSON Feed 解析 + 多编码探测 decodeBuffer）
 *   - src/main/Models.js          （plainText 正文纯文本化，供平均长度统计）
 *
 * 管线（与《AI 探索》方案中的「验证管线」步骤 1-2 一一对应）：
 *   1) 抓站点首页（双 UA 策略：APP_UA → 浏览器 UA，同 FeedService.fetchFeed 的重试语义）
 *   2) Feed 自动发现：HTML <link rel="alternate" type~=(rss|atom|feed+json)> + <a> 指向 .xml/.rss/.atom
 *   3) 常见路径猜测（相对 base 与 host 根各一轮）：/feed /rss /atom.xml /feed.xml /index.xml /rss.xml …
 *   4) 候选并发验证：fetch → FeedParser.parse → 条目数>0 才算成功
 *   5) 元数据：条数 / 最新发布时间 / 更新频率(中位间隔) / 平均正文字符数 / 全文vs摘要 / 语言(CJK占比)
 *
 * 运行：node scripts/diag-discovery-feasibility.js
 * 代理：外网样本需 HTTPS_PROXY=http://127.0.0.1:7897（node fetch 默认不走代理，
 *       显式用 undici ProxyAgent 作 dispatcher；国内直连样本不设代理变量也能出结果）。
 */

const path = require('node:path');
const FeedParser = require('../src/main/FeedParser');
const { plainText } = require('../src/main/Models');

// undici 是仓库传递依赖（node_modules/undici），用它的 fetch+ProxyAgent 才能带代理；
// 直接把 npm undici 的 ProxyAgent 塞给全局 fetch 会因内部 brand check 失败。
const undici = (() => { try { return require('undici'); } catch (_) { return null; } })();
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
const dispatcher = PROXY && undici ? new undici.ProxyAgent(PROXY) : undefined;
const doFetch = (url, options = {}) => {
  if (dispatcher) return undici.fetch(url, { ...options, dispatcher });
  return fetch(url, options);
};

const APP_UA = 'RobinRead/2.0 (+personal RSS reader)';               // 与 FeedService.js:17 一致
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const PAGE_TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 12_000;
const MAX_CANDIDATES_PER_SITE = 7;

// 待验证站点：前 5 个国内直连可得（保证不设代理也有产出），最后 1 个为外网代理样本
const SITES = [
  { name: '阮一峰的网络日志', url: 'https://www.ruanyifeng.com/blog/' },
  { name: '少数派',           url: 'https://sspai.com/' },
  { name: '小众软件',         url: 'https://www.appinn.com/' },
  { name: '云风的博客',       url: 'https://blog.codingnow.com/' },
  { name: '爱范儿',           url: 'https://www.ifanr.com/' },
  { name: 'Simon Willison',  url: 'https://simonwillison.net/', proxyOnly: true },
];

// MARK: - 步骤 1：抓页面（双 UA，30s→15s 超时收敛）

async function fetchBuffer(url, { headers = {}, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  for (const ua of [APP_UA, BROWSER_UA]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url, {
        headers: { 'User-Agent': ua, Accept: '*/*', ...headers },
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!res.ok) continue; // 换下一个 UA（同 FeedService 的 403 换 UA 重试语义）
      return { ok: true, status: res.status, buffer: Buffer.from(await res.arrayBuffer()), finalURL: res.url || url };
    } catch (_) {
      // 网络层失败：换 UA 重试一次
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false };
}

// MARK: - 步骤 2：Feed 自动发现（HTML head link rel=alternate）

function autodiscover(html, baseURL) {
  const found = [];
  const push = (href) => {
    if (!href) return;
    try { found.push(new URL(href, baseURL).toString()); } catch (_) { /* 非法 href 丢弃 */ }
  };
  // link 标签：type 含 rss/atom/feed+json，或 rel=alternate/service.feed
  const linkRe = /<link\b[^>]*>/gi;
  for (const tag of html.match(linkRe) || []) {
    if (!/(rss|atom|feed\+json)/i.test(tag)) continue;
    const attrs = Object.fromEntries([...tag.matchAll(/(\w[\w:-]*)\s*=\s*"([^"]*)"|(\w[\w:-]*)\s*=\s*'([^']*)'/g)]
      .map((m) => [m[1] || m[3], m[2] || m[4]]));
    if (/alternate|service\.feed/i.test(attrs.rel || '') || /(rss|atom|feed\+json)/i.test(attrs.type || '')) {
      push(attrs.href);
    }
  }
  // 次级信号：<a href> 直指 .xml/.rss/.atom（部分站点不用 link 标签）
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*"([^"]*\.(?:xml|rss|atom))"[^>]*>/gi)) push(m[1]);
  return [...new Set(found)];
}

// MARK: - 步骤 3：常见路径猜测（相对 base 与 host 根各一轮）

const GUESS_RELATIVE = ['atom.xml', 'feed.xml', 'index.xml', 'rss.xml', 'feed.atom', 'rss2.xml', 'feed/'];
const GUESS_ROOT = ['/feed', '/feed/', '/rss', '/rss.xml', '/atom.xml', '/feed.xml', '/index.xml'];

function guessCandidates(pageURL) {
  const out = [];
  const add = (u) => { try { const s = new URL(u).toString(); if (!out.includes(s)) out.push(s); } catch (_) {} };
  for (const rel of GUESS_RELATIVE) add(new URL(rel, pageURL).toString());
  const { origin } = new URL(pageURL);
  for (const p of GUESS_ROOT) add(origin + p);
  return out;
}

// MARK: - 步骤 4：候选验证（fetch → FeedParser.parse → 条目>0）

async function verifyCandidate(url) {
  const res = await fetchBuffer(url, { headers: { Accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, application/json' } });
  if (!res.ok) return { ok: false, url, reason: 'fetch-failed' };
  try {
    const parsed = FeedParser.parse(res.buffer, url);
    if (!parsed.entries || parsed.entries.length === 0) return { ok: false, url, reason: 'empty-entries' };
    return { ok: true, url, parsed };
  } catch (err) {
    return { ok: false, url, reason: `parse: ${err.kind || err.message}` };
  }
}

// MARK: - 步骤 5：健康度元数据

function cjkRatio(text) {
  const cjk = (String(text).match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (String(text).match(/[a-zA-Z]/g) || []).length;
  const total = cjk + latin;
  return total === 0 ? 0 : cjk / total;
}

function buildMetadata(parsed) {
  const entries = parsed.entries;
  const times = entries.map((e) => e.publishedAt).filter(Boolean).sort((a, b) => b - a);
  const latest = times[0] ? new Date(times[0] * 1000) : null;
  // 更新频率：最新 10 条有日期条目的中位间隔（天）
  let cadenceDays = null;
  if (times.length >= 3) {
    const gaps = [];
    for (let i = 1; i < Math.min(times.length, 10); i++) gaps.push((times[i - 1] - times[i]) / 86400);
    gaps.sort((a, b) => a - b);
    cadenceDays = gaps[Math.floor(gaps.length / 2)];
  }
  // 平均正文长度（contentHTML 优先，summary 兜底；HTML→纯文本）
  const lengths = entries.slice(0, 20).map((e) => plainText(e.contentHTML || e.summary || '').trim().length);
  const avgLen = Math.round(lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length));
  const fullText = avgLen >= 800; // 经验阈值：摘要型源通常 <300 字符
  const lang = cjkRatio(entries.slice(0, 10).map((e) => `${e.title} ${e.summary}`).join(' ')) > 0.15 ? '中文' : 'EN';
  return {
    entryCount: entries.length,
    latest,
    cadenceDays,
    avgLen,
    fullText,
    lang,
    feedTitle: parsed.title,
    preview: entries.slice(0, 3).map((e) => e.title),
  };
}

// MARK: - 主流程

async function exploreSite(site) {
  const record = { name: site.name, url: site.url, steps: [], feed: null, meta: null, error: null };
  const page = await fetchBuffer(site.url, { headers: { Accept: 'text/html,application/xhtml+xml' }, timeoutMs: PAGE_TIMEOUT_MS });
  if (!page.ok) { record.error = 'homepage-fetch-failed'; return record; }
  record.steps.push(`首页 OK（${Math.round(page.buffer.length / 1024)}KB）`);

  const html = page.buffer.toString('utf8');
  const candidates = [...autodiscover(html, page.finalURL), ...guessCandidates(page.finalURL)]
    .filter((u, i, arr) => arr.indexOf(u) === i)
    // 同路径 https 优先于 http（自动发现可能给出 http 版，验证都通过时优先安全端点）
    .sort((a, b) => Number(a.startsWith('http:')) - Number(b.startsWith('http:')))
    .slice(0, MAX_CANDIDATES_PER_SITE);
  record.steps.push(`候选 ${candidates.length} 个（自动发现优先 → 路径猜测），并发验证中…`);

  const results = await Promise.all(candidates.map((c) => verifyCandidate(c).catch(() => ({ ok: false, url: c, reason: 'thrown' }))));
  for (const r of results) record.steps.push(`  ${r.ok ? '✓' : '✗'} ${r.url}${r.ok ? '' : ` — ${r.reason}`}`);

  const winner = results.find((r) => r.ok);
  if (!winner) { record.error = 'no-valid-feed'; return record; }
  record.feed = winner.url;
  record.meta = buildMetadata(winner.parsed);
  return record;
}

function fmtDate(d) { return d ? d.toISOString().slice(0, 10) : '—'; }

async function main() {
  console.log(`RobinRead「AI 探索订阅源」可行性验证 — node ${process.version}`);
  console.log(`代理: ${PROXY || '未设置（仅国内直连样本可产出）'}\n`);
  const rows = [];
  for (const site of SITES) {
    const t0 = Date.now();
    const rec = await exploreSite(site);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n== ${rec.name}  <${rec.url}>  (${secs}s)`);
    for (const s of rec.steps) console.log(`   ${s}`);
    if (rec.error) { console.log(`   结果: 失败 — ${rec.error}`); rows.push({ 站点: rec.name, 语言: '—', 条数: '—', 最新发布: '—', 更新间隔: '—', 平均正文: '—', 全文或摘要: '—' }); continue; }
    const m = rec.meta;
    console.log(`   结果: ✓ 「${m.feedTitle}」 ${rec.feed}`);
    console.log(`   预览: ${m.preview.join(' | ')}`);
    rows.push({
      站点: rec.name,
      语言: m.lang,
      条数: m.entryCount,
      最新发布: fmtDate(m.latest),
      更新间隔: m.cadenceDays == null ? '—' : `≈${m.cadenceDays.toFixed(1)}天`,
      平均正文: `${m.avgLen}字`,
      全文或摘要: m.fullText ? '全文' : '摘要',
    });
  }

  console.log('\n────────── 汇总（站点 → 可用 feed → 元数据）──────────');
  console.table(rows);
  const okCount = rows.filter((r) => r.语言 !== '—').length;
  console.log(`结论: ${okCount}/${SITES.length} 个站点完成「URL→feed→元数据」全管线验证。`);
}

main().catch((err) => { console.error('诊断脚本异常:', err); process.exit(1); });
