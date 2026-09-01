'use strict';
/**
 * RobinRead（知更）— 站点 → feed 自动发现
 *
 * 给一个站点 URL（博客首页/域名），找出它可用的 RSS/Atom/JSON Feed：
 * 1. 抓首页 HTML，解析 <link rel="alternate"> 指向的 feed；
 * 2. 常见路径猜测（/feed、/atom.xml、/feed.xml 等，站点子目录与域名根两轮）；
 * 3. 每个候选直接抓取并 FeedParser.parse 验证（至少 1 条 entry 才算成功）。
 *
 * 消费方：AI 探索（ExploreService）与 addFeed 的发现回退（用户粘贴博客首页即可订阅）。
 * 返回 { ok, feedURL, parsed } —— parsed 为已解析结果，调用方无需二次抓取。
 */
const FeedParser = require('./FeedParser');

const UA = { 'User-Agent': 'Mozilla/5.0 RobinRead', Accept: 'text/html,application/xhtml+xml,application/xml,*/*' };
const GUESS_PATHS = ['/feed', '/rss', '/atom.xml', '/feed.xml', '/index.xml', '/rss.xml', '/feed/', '/blog/feed', '/?feed=rss2'];
const MAX_CANDIDATES = 8;

// 可注入的抓取实现：main.js 注入 electron net.fetch（走系统代理）后，
// 被墙站点经代理可达；未注入时回退 Node 全局 fetch（直连）。
let netFetchImpl = null;
function useNetFetch(fn) { netFetchImpl = fn; }

async function fetchBuffer(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const doFetch = netFetchImpl || fetch;
    const res = await doFetch(url, { headers: UA, signal: controller.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { buf: Buffer.from(await res.arrayBuffer()), finalURL: res.url || url };
  } finally {
    clearTimeout(timer);
  }
}

/** 从首页 HTML 提取 <link rel="alternate"> 的 feed 地址。 */
function extractAlternateLinks(html, baseURL) {
  const out = [];
  for (const tag of String(html).match(/<link\b[^>]*>/gi) || []) {
    if (!/rel\s*=\s*["']?alternate/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!href) continue;
    const type = (tag.match(/type\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    const lower = type.toLowerCase();
    if (type && !(lower.includes('rss') || lower.includes('atom') || lower.includes('feed'))) continue;
    try { out.push(new URL(href[1], baseURL).href); } catch (_) { /* 非法跳过 */ }
  }
  return out;
}

/** 抓取并解析一个候选 feed；成功返回解析结果，失败返回 null。 */
async function tryParse(feedURL, timeoutMs = 12000) {
  try {
    const { buf } = await fetchBuffer(feedURL, timeoutMs);
    const parsed = FeedParser.parse(buf, feedURL);
    if (!parsed || !Array.isArray(parsed.entries) || parsed.entries.length === 0) return null;
    return { feedURL, parsed };
  } catch (_) {
    return null;
  }
}

/**
 * 站点级 feed 发现。siteURL 可以是博客首页、带路径的页面或直接的 feed 地址。
 * 返回 { ok, feedURL, parsed } 或 { ok:false }。
 */
async function discoverFeed(siteURL) {
  const target = String(siteURL || '').trim();
  if (!/^https?:\/\//i.test(target)) return { ok: false };

  // 直接就是 feed 地址的最快路径
  const direct = await tryParse(target, 12000);
  if (direct) return { ok: true, ...direct };

  const candidates = [];
  let finalURL = target;
  try {
    const { buf, finalURL: resolved } = await fetchBuffer(target, 15000);
    finalURL = resolved;
    candidates.push(...extractAlternateLinks(buf.toString('utf8'), resolved));
  } catch (_) { /* 首页抓不到就只试路径猜测 */ }

  let root;
  try { root = new URL(finalURL); } catch (_) { return { ok: false }; }
  for (const p of GUESS_PATHS) {
    candidates.push(root.origin + p);
    try { candidates.push(new URL(p.replace(/^\//, ''), finalURL).href); } catch (_) { /* 跳过 */ }
  }

  const seen = new Set();
  const ordered = [];
  for (const c of candidates) {
    const key = c.toLowerCase();
    if (!seen.has(key)) { seen.add(key); ordered.push(c); }
  }
  for (const candidate of ordered.slice(0, MAX_CANDIDATES)) {
    const hit = await tryParse(candidate, 12000);
    if (hit) return { ok: true, ...hit };
  }
  return { ok: false };
}

module.exports = { discoverFeed, extractAlternateLinks, useNetFetch };
