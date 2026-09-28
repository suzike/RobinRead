'use strict';
/**
 * gen-tidings-catalog.js — 从 Tidings RSS 目录（github.com/fuxiaoai/tidings-rss，CC0）
 * 生成订阅商店「Tidings 专题」目录数据。
 *
 * 用法：
 *   node scripts/gen-tidings-catalog.js <feeds.json 路径>
 *   （feeds.json 可从仓库 data/feeds.json 获取；缺省读 .tmp-tidings-feeds.json）
 *
 * 输出：src/renderer/views/feed-store-tidings.js
 *   export const CATALOG_TIDINGS = [{ rank, cat, lang, name, url, site, desc, tags, updated }]
 *
 * 收纳策略：URL 全局唯一；每源归入最具体专题包（top200 优先）；
 * 大包（blogs/engineering/ai/news/videos/podcasts/chinese）按 latest_item_at 新鲜度截断。
 */
const fs = require('node:fs');
const path = require('node:path');

const input = process.argv[2] || '.tmp-tidings-feeds.json';
const outPath = path.join(__dirname, '..', 'src', 'renderer', 'views', 'feed-store-tidings.js');

/** 专题定义：id（商店 cat）→ packs 匹配 + 收纳上限 + 中文标签 + hue。 */
const TOPICS = [
  { cat: 't-top200', packs: ['top200'], cap: 999, label: 'Tidings 精选 200', hue: 45 },
  { cat: 't-weeklies', packs: ['weeklies'], cap: 999, label: 'Tidings · 技术周刊', hue: 130 },
  { cat: 't-wechat', packs: ['wechat'], cap: 999, label: 'Tidings · 公众号', hue: 115 },
  { cat: 't-company', packs: ['company-tech'], cap: 999, label: 'Tidings · 大厂技术', hue: 210 },
  { cat: 't-ai', packs: ['ai'], cap: 36, label: 'Tidings · AI 前沿', hue: 262 },
  { cat: 't-security', packs: ['security'], cap: 999, label: 'Tidings · 安全', hue: 5 },
  { cat: 't-techmedia', packs: ['tech-media'], cap: 999, label: 'Tidings · 科技媒体', hue: 96 },
  { cat: 't-news', packs: ['news'], cap: 24, label: 'Tidings · 新闻', hue: 200 },
  { cat: 't-research', packs: ['research'], cap: 999, label: 'Tidings · 科研', hue: 265 },
  { cat: 't-videos', packs: ['videos'], cap: 24, label: 'Tidings · 视频', hue: 330 },
  { cat: 't-podcasts', packs: ['podcasts'], cap: 24, label: 'Tidings · 播客', hue: 285 },
  { cat: 't-communities', packs: ['communities'], cap: 999, label: 'Tidings · 技术社区', hue: 20 },
  { cat: 't-blogs', packs: ['blogs'], cap: 40, label: 'Tidings · 独立博客', hue: 160 },
  { cat: 't-engineering', packs: ['engineering'], cap: 36, label: 'Tidings · 工程实践', hue: 142 },
];
// 专题归属优先级：垂直专题包优先（各专题页满员），top200 兜住其余精品，工程最后兜底
const PRIORITY = ['weeklies', 'wechat', 'company-tech', 'security', 'tech-media', 'research', 'communities', 'ai', 'news', 'videos', 'podcasts', 'blogs', 'top200', 'engineering'];

const j = JSON.parse(fs.readFileSync(input, 'utf8'));
const buckets = new Map(TOPICS.map((t) => [t.cat, []]));
const seen = new Set();

for (const f of j.feeds) {
  const url = f.feed_url;
  if (!url || seen.has(url)) continue;
  const packs = (f.packs || []).filter((p) => p !== 'all' && p !== 'chinese');
  packs.sort((a, b) => PRIORITY.indexOf(a) - PRIORITY.indexOf(b));
  const pack = packs[0];
  if (!pack) continue;
  const topic = TOPICS.find((t) => t.packs.includes(pack));
  if (!topic) continue;
  const bucket = buckets.get(topic.cat);
  if (bucket.length >= topic.cap) continue;
  seen.add(url);
  const lang = String(f.language || 'en').startsWith('zh') ? 'zh' : 'en';
  const kindBadge = f.kind === 'video' ? '视频' : f.kind === 'podcast' ? '播客' : '';
  const descParts = [];
  if (f.description && !/订阅源$/.test(f.description)) descParts.push(f.description);
  if (kindBadge) descParts.push(kindBadge);
  const tags = [f.category, kindBadge, lang === 'zh' ? '中文' : 'EN'].filter(Boolean);
  bucket.push({
    name: f.title,
    url,
    site: f.site_url || '',
    desc: descParts.join(' · ') || `${f.category || '订阅源'}（Tidings 三轮解析验证）`,
    tags,
    lang,
    updated: f.latest_item_at || '',
  });
}

// 各专题内按新鲜度排序 + rank（基数 1000+：避开商店 TOP3 徽章判定与既有 rank 空间）
let rank = 1001;
const entries = [];
for (const topic of TOPICS) {
  const bucket = (buckets.get(topic.cat) || []).sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  for (const e of bucket) {
    entries.push({ rank: rank++, cat: topic.cat, ...e });
  }
}

const js = `'use strict';
/**
 * feed-store-tidings.js — 订阅商店「Tidings 专题」目录（自动生成，勿手改）
 * 数据源：github.com/fuxiaoai/tidings-rss（CC0）data/feeds.json
 * 再生成：node scripts/gen-tidings-catalog.js <feeds.json>
 * 生成时间：${new Date().toISOString().slice(0, 10)}；目录版本：${j.version || 1}（校验 ${j.validation?.parser_passed || '?'} 源）
 */
export const CATALOG_TIDINGS = [
${entries.map((e) => `  { rank: ${e.rank}, cat: '${e.cat}', lang: '${e.lang}', name: ${JSON.stringify(e.name)}, url: ${JSON.stringify(e.url)}, site: ${JSON.stringify(e.site)}, desc: ${JSON.stringify(e.desc)}, tags: ${JSON.stringify(e.tags)}, updated: ${JSON.stringify(e.updated)} },`).join('\n')}
];
export const TIDINGS_TOPICS = [
${TOPICS.map((t) => `  { id: '${t.cat}', label: ${JSON.stringify(t.label)}, hue: ${t.hue} },`).join('\n')}
];
`;
fs.writeFileSync(outPath, js);
const perCat = {};
for (const e of entries) perCat[e.cat] = (perCat[e.cat] || 0) + 1;
console.log(`written ${outPath}`);
console.log(`entries ${entries.length}; per cat:`, JSON.stringify(perCat));
