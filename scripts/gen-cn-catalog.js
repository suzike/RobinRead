'use strict';
/**
 * gen-cn-catalog.js — 一次性生成商店中文源新批次（跑完保留，产物已提交）
 *
 * 从 src/main/data/feed-pool.json（探索候选池快照，1920 条）筛选中文源，
 * 生成 src/renderer/views/feed-store-cn.js：`export const CATALOG_CN = [...]`。
 *
 * 规则：
 *   - lang = 'zh'，且有 desc 或 tags
 *   - 去重：与现有 CATALOG（feed-store / extra / extra2）URL 不同；
 *     与 wechat-accounts.js 桥接目录不同（公众号走搜索卡，避免双入口）；
 *     批内 URL / 注册域 / 名称三重去重（域名级防 feedburner 镜像等语义重复）
 *   - 取 120 条左右，rank 从 320 起（与既有各文件 rank 段不冲突）
 *   - cat 按 tags 映射到现有 12 分类：AI → ai、前端 → fe、安全 → sec、
 *     具体语言 → lang、其余（编程/生活/随笔等）→ cn
 *   - name 用简介字段（desc），lang 固定 'zh'
 *
 * 断言：输出条数 ≥ 100，退出码反映成败。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const POOL_PATH = path.join(ROOT, 'src', 'main', 'data', 'feed-pool.json');
const OUT_PATH = path.join(ROOT, 'src', 'renderer', 'views', 'feed-store-cn.js');
const CATALOG_FILES = [
  path.join(ROOT, 'src', 'renderer', 'views', 'feed-store.js'),
  path.join(ROOT, 'src', 'renderer', 'views', 'feed-store-extra.js'),
  path.join(ROOT, 'src', 'renderer', 'views', 'feed-store-extra2.js'),
];
const WECHAT_FILE = path.join(ROOT, 'src', 'renderer', 'views', 'wechat-accounts.js');

const TARGET = 120;
const RANK_START = 320;

/** 注册域（末两段），与主进程 ExploreService.registrableDomain 同口径的简化版。 */
function registrableDomain(hostname) {
  const parts = String(hostname || '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const twoLevelTLD = /^(co|com|org|net|gov|edu)\.[a-z]{2}$/.test(parts.slice(-2).join('.'));
  return parts.slice(twoLevelTLD ? -3 : -2).join('.');
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch (_) { return ''; }
}

/** 从 ESM 目录源码里提取 url: '...' / url: "..." 字段（渲染层文件是 ESM，直接 require 不可行）。 */
function extractURLs(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const out = new Set();
  for (const m of src.matchAll(/\burl:\s*(['"])([^'"]+)\1/g)) out.add(m[2]);
  return out;
}

/** tags → 现有 12 分类。 */
function mapCategory(tags) {
  const hit = (re) => tags.some((t) => re.test(t));
  if (hit(/AI|人工智能|机器学习|深度学习|LLM|GPT|AIGC|大模型|算法/i)) return 'ai';
  if (hit(/Agent|智能体|LLM 应用/i)) return 'agent';
  if (hit(/前端|CSS|JavaScript|^JS$|React|Vue|Web|HTML|Node/i)) return 'fe';
  if (hit(/安全|渗透|漏洞|黑客|隐私/i)) return 'sec';
  if (hit(/Python|Java|^Go$|Rust|C\+\+|PHP|Swift|Kotlin|编程语言|TypeScript/i)) return 'lang';
  return 'cn';
}

function main() {
  const pool = JSON.parse(fs.readFileSync(POOL_PATH, 'utf8'));

  // 现有目录 URL / 注册域 / 桥接目录 URL
  const existingURLs = new Set();
  const existingDomains = new Set();
  for (const file of CATALOG_FILES) {
    for (const url of extractURLs(file)) {
      existingURLs.add(url);
      const d = registrableDomain(hostOf(url));
      if (d) existingDomains.add(d);
    }
  }
  const bridgeURLs = extractURLs(WECHAT_FILE);

  const takenURLs = new Set();
  const takenDomains = new Set();
  const takenNames = new Set();
  const picked = [];

  for (const s of pool.sources || []) {
    if (picked.length >= TARGET) break;
    if (s.lang !== 'zh') continue;
    const desc = String(s.desc || '').trim();
    const tags = Array.isArray(s.tags) ? s.tags.filter((t) => t && String(t).trim()).map((t) => String(t).trim()) : [];
    if (!desc && tags.length === 0) continue;
    const feedURL = String(s.feedURL || '').trim();
    if (!/^https?:\/\//.test(feedURL)) continue;
    // 桥接域名一律跳过（公众号统一走搜索卡 / 自建桥）
    if (/wechat2rss\.bestblogs\.dev|hub\.slarker\.me|rsshub\./i.test(hostOf(feedURL))) continue;
    // 与现有目录 / 桥接目录 URL 重复
    if (existingURLs.has(feedURL) || bridgeURLs.has(feedURL)) continue;
    // 域名级去重（与现有目录、批内）
    const domain = registrableDomain(hostOf(feedURL));
    if (!domain || existingDomains.has(domain) || takenDomains.has(domain)) continue;
    // 名称（取简介字段）与批内去重
    const name = (desc || s.name || '').trim().replace(/\s+/g, ' ');
    if (!name || name.length > 42 || /^https?:\/\//.test(name)) continue;
    if (takenNames.has(name)) continue;

    takenURLs.add(feedURL);
    takenDomains.add(domain);
    takenNames.add(name);
    picked.push({
      rank: RANK_START + picked.length,
      cat: mapCategory(tags),
      lang: 'zh',
      name,
      url: feedURL,
      desc: desc || name,
      tags: tags.slice(0, 3),
    });
  }

  // 断言：条数与治理约束
  if (picked.length < 100) {
    console.error(`FAIL: 仅筛出 ${picked.length} 条（要求 ≥100）`);
    process.exit(1);
  }
  const urls = new Set(picked.map((e) => e.url));
  const ranks = new Set(picked.map((e) => e.rank));
  if (urls.size !== picked.length || ranks.size !== picked.length) {
    console.error('FAIL: 批内 URL/rank 存在重复');
    process.exit(1);
  }
  for (const e of picked) {
    if (existingURLs.has(e.url)) { console.error(`FAIL: 与现有目录重复 ${e.url}`); process.exit(1); }
  }

  const lines = [];
  lines.push('\'use strict\';');
  lines.push('/**');
  lines.push(' * 订阅源商店 · 中文源新批次（由 scripts/gen-cn-catalog.js 从 src/main/data/feed-pool.json 生成，勿手改）');
  lines.push(` * 生成时间：${new Date().toISOString()} · ${picked.length} 条 · rank ${RANK_START} 起 · 全部 lang='zh'`);
  lines.push(' */');
  lines.push('export const CATALOG_CN = [');
  for (const e of picked) {
    const tags = e.tags.map((tg) => `'${tg.replace(/'/g, "\\'")}'`).join(', ');
    lines.push(`  { rank: ${e.rank}, cat: '${e.cat}', lang: 'zh', name: '${e.name.replace(/'/g, "\\'")}', url: '${e.url}', desc: '${e.desc.replace(/'/g, "\\'")}', tags: [${tags}] },`);
  }
  lines.push('];');
  fs.writeFileSync(OUT_PATH, lines.join('\n') + '\n', 'utf8');

  const byCat = {};
  for (const e of picked) byCat[e.cat] = (byCat[e.cat] || 0) + 1;
  console.log(`OK: 生成 ${picked.length} 条 → ${path.relative(ROOT, OUT_PATH)}`);
  console.log(`分类分布: ${JSON.stringify(byCat)}`);
  console.log(`样例: ${JSON.stringify(picked.slice(0, 3), null, 2)}`);
}

main();
