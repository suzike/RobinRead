'use strict';
/**
 * 构建候选源池快照（构建期脚本，产物随包内置，运行期零网络依赖）。
 *
 * 数据源：
 * 1. timqian/chinese-independent-blogs（MIT）— 中文独立博客表格（jsdelivr 直连可达）
 * 2. plenaryapp/awesome-rss-feeds（CC0）— 41 个分类 OPML（GitHub raw 需代理/镜像）
 * 3. ooh.directory sitemap — 英文独立博客站点页（无 feed 地址，探索时再做 feed 发现）
 *
 * 输出：src/main/data/feed-pool.json  { generatedAt, sources: [{name, siteURL, feedURL, lang, category, desc}] }
 * 重跑：node scripts/build-feed-pool.js（可设 HTTPS_PROXY 走代理）
 */
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'src', 'main', 'data', 'feed-pool.json');
const PROXY = process.env.HTTPS_PROXY || process.env.HTTPS_PROXY || '';

async function makeFetcher() {
  if (!PROXY) return (url) => fetch(url);
  try {
    const { ProxyAgent, fetch: undiciFetch } = await import('undici');
    const agent = new ProxyAgent(PROXY);
    return (url) => undiciFetch(url, { dispatcher: agent });
  } catch (_) {
    return (url) => fetch(url);
  }
}

async function fetchText(fetcher, url, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** 源 1：中文独立博客表格。行格式：Feed 单元格 | 简介 | site | tags。 */
function parseChineseBlogs(markdown) {
  const sources = [];
  const seen = new Set();
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 5) continue;
    const feedMatch = cells[1].match(/\((https?:\/\/[^)\s]+)\)/);
    const feedURL = feedMatch ? feedMatch[1] : null;
    if (!feedURL || !/^https?:\/\//i.test(feedURL)) continue; // None / 非链接行跳过
    const desc = cells[2].replace(/\[|\]/g, '').trim();
    const siteMatch = cells[3].match(/\((https?:\/\/[^)\s]+)\)/) || cells[3].match(/(https?:\/\/[^\s|]+)/);
    const siteURL = siteMatch ? siteMatch[1] : null;
    const name = desc || (siteURL ? new URL(siteURL).hostname : feedURL);
    const key = feedURL.replace(/\/+$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({
      name: name.slice(0, 80),
      siteURL,
      feedURL,
      lang: 'zh',
      category: 'blog',
      desc: cells[2].includes('[') ? '' : desc,
      tags: (cells[4] || '').split(/[;；,，]/).map((t) => t.trim()).filter(Boolean).slice(0, 4),
    });
  }
  return sources;
}

/** 源 2：awesome-rss-feeds 分类 OPML。 */
function parseOPML(text, category) {
  const sources = [];
  const seen = new Set();
  const re = /<outline[^>]*type="rss"[^>]*>/gi;
  for (const tag of text.match(re) || []) {
    const textM = tag.match(/text="([^"]*)"/);
    const xmlM = tag.match(/xmlUrl="([^"]*)"/);
    const htmlM = tag.match(/htmlUrl="([^"]*)"/);
    if (!xmlM) continue;
    const feedURL = xmlM[1].replace(/&amp;/g, '&');
    const key = feedURL.replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(feedURL) || seen.has(key)) continue;
    seen.add(key);
    sources.push({
      name: (textM ? textM[1] : '').slice(0, 80) || new URL(feedURL).hostname,
      siteURL: htmlM ? htmlM[1].replace(/&amp;/g, '&') : null,
      feedURL,
      lang: 'en',
      category: category.toLowerCase().slice(0, 24),
      desc: '',
      tags: [],
    });
  }
  return sources;
}

async function main() {
  const fetcher = await makeFetcher();
  const all = [];
  const stats = {};

  // 1) 中文独立博客
  try {
    const md = await fetchText(fetcher, 'https://cdn.jsdelivr.net/gh/timqian/chinese-independent-blogs@master/README.md');
    const cn = parseChineseBlogs(md);
    stats['chinese-independent-blogs'] = cn.length;
    all.push(...cn);
  } catch (err) {
    console.warn('[pool] 中文博客源失败：', err.message);
    stats['chinese-independent-blogs'] = 0;
  }

  // 2) awesome-rss-feeds 分类 OPML（GitHub contents API 取规范下载地址；需代理可达）
  let opmlFiles = [];
  let opmlOK = 0;
  try {
    const index = await fetchText(fetcher, 'https://api.github.com/repos/plenaryapp/awesome-rss-feeds/contents/recommended/with_category');
    opmlFiles = (JSON.parse(index) || [])
      .filter((f) => f.name.endsWith('.opml'))
      .map((f) => ({ name: f.name, url: f.download_url }));
  } catch (_) { /* API 失败则跳过该源 */ }
  for (const file of opmlFiles) {
    const category = file.name.replace(/\.opml$/, '');
    try {
      const text = await fetchText(fetcher, file.url, 15000);
      const items = parseOPML(text, category);
      if (items.length) { all.push(...items); opmlOK += 1; stats[`opml:${category}`] = items.length; }
    } catch (_) { /* 单文件失败跳过 */ }
  }
  stats['opmlCategoriesLoaded'] = opmlOK;

  // 去重（feedURL 归一化）与产出
  const seen = new Set();
  const sources = all.filter((s) => {
    const key = s.feedURL.replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    count: sources.length,
    stats,
    sources,
  }, null, 1), 'utf8');
  console.log(`[pool] 生成 ${OUT}`);
  console.log(`[pool] 总条目 ${sources.length}，中文 ${sources.filter((s) => s.lang === 'zh').length}，英文 ${sources.filter((s) => s.lang !== 'zh').length}`);
  console.log(`[pool] 分类 Top：${Object.entries(stats).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}=${v}`).join(', ')}`);
}

main().catch((err) => { console.error('[pool] FAILED', err); process.exit(1); });
