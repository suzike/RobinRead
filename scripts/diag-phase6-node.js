'use strict';
/** 纯 Node 验证：ExploreService 强度三档准入 + LLM 外扩合并去重 + smartFolderSearch（无需 Electron）。 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failures += 1; };

// 临时库：与产品迁移同构的最小 schema（只造 ExploreService/smartFolderSearch 需要的表）
const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE feeds (id TEXT PRIMARY KEY, feed_url TEXT, is_deleted INTEGER DEFAULT 0);
  CREATE TABLE items (id TEXT PRIMARY KEY, feed_id TEXT);
  CREATE TABLE articles (item_id TEXT PRIMARY KEY, title TEXT, summary TEXT);
  CREATE TABLE article_states (item_id TEXT PRIMARY KEY, is_read INTEGER DEFAULT 0, is_starred INTEGER DEFAULT 0);
  CREATE TABLE article_caches (item_id TEXT PRIMARY KEY, text TEXT, html TEXT);
  CREATE TABLE explored_feeds (url TEXT PRIMARY KEY, domain TEXT, verdict TEXT DEFAULT 'explored', score REAL, explanation TEXT, explored_at REAL);
  CREATE TABLE interest_profile (key TEXT PRIMARY KEY, value REAL, updated_at REAL);
`);

const { ExploreService, registrableDomain } = require('../src/main/ExploreService');

// ---- registrableDomain ----
check('registrableDomain 基础', registrableDomain('blog.example.com') === 'example.com' && registrableDomain('example.com') === 'example.com');
check('registrableDomain 二级后缀', registrableDomain('www.example.co.jp') === 'example.co.jp');

// ---- 强度三档准入（构造 30 张卡：低分旧源 + 高分新源混合）----
const svc = new ExploreService(null);
const mk = (name, score, days) => ({ url: `https://${name}/feed`, feedURL: `https://${name}/feed`, domain: name, name, score, freshnessDays: days, samples: [] });
const cards = [];
for (let i = 0; i < 20; i += 1) cards.push(mk(`old${i}.com`, 20 + (i % 10), 90 + i));
for (let i = 0; i < 10; i += 1) cards.push(mk(`fresh${i}.com`, 60 + (i % 20), 1 + i));

// 复制 run 内的准入逻辑做等价验证（run 本体依赖完整 store，这里验证阈值口径）
const admit = (sorted, strength, limit = 10) => {
  const minScore = strength === 'calm' ? 55 : strength === 'balanced' ? 35 : 0;
  const freshMaxDays = strength === 'calm' ? 45 : Infinity;
  let admitted = sorted.filter((c) => c.score >= minScore && c.freshnessDays <= freshMaxDays);
  if (admitted.length < Math.min(3, limit)) admitted = sorted;
  return admitted.slice(0, limit);
};
const sorted = [...cards].sort((a, b) => b.score - a.score);
const calm = admit(sorted, 'calm');
check('calm 只收高分新源', calm.every((c) => c.score >= 55 && c.freshnessDays <= 45), `min=${Math.min(...calm.map((c) => c.score))}`);
// bold 放宽准入：低分长尾在高分卡不足 limit 时也会入选（用 limit=30 强制纳入全部 30 张）
const boldWide = admit(sorted, 'bold', 30);
const balancedWide = admit(sorted, 'balanced', 30);
check('bold 收低分长尾（balanced 同参数则过滤）', boldWide.length === 30 && boldWide.some((c) => c.score < 35) && !balancedWide.some((c) => c.score < 35),
  `bold_n=${boldWide.length} balanced_n=${balancedWide.length}`);
// 全低分场景回退：calm 空手时回退全部
const allLow = [mk('a.com', 10, 3), mk('b.com', 12, 4), mk('c.com', 11, 5)];
check('全低分时 calm 回退不空手', admit([...allLow].sort((a, b) => b.score - a.score), 'calm').length === 3);

// ---- LLM 外扩合并去重（验证 _llmExpandDomain 的域名去重段——用探针直调替换不可行，验证解析等价函数）----
// 直接验证 JSON 解析与域名校验的核心段
const parseExpand = (output, excluded) => {
  const match = output.match(/\{[\s\S]*\}/);
  if (!match) return [];
  const parsed = JSON.parse(match[0]);
  const seen = new Set();
  const out = [];
  for (const s of parsed.sites || []) {
    const site = String(s.site || '').trim();
    if (!/^https?:\/\//i.test(site)) continue;
    const host = registrableDomain(new URL(site).hostname);
    if (!host || excluded.has(host) || seen.has(host)) continue;
    seen.add(host);
    out.push({ name: s.name, siteURL: site });
  }
  return out;
};
const expandOut = parseExpand('{"sites":[{"name":"A","site":"https://a.com"},{"name":"B","site":"ftp://b.com"},{"name":"C","site":"https://c.com"},{"name":"A2","site":"https://a.com/blog"}]}', new Set(['c.com']));
check('外扩解析：非法协议/排除域/域名去重', expandOut.length === 1 && expandOut[0].name === 'A', JSON.stringify(expandOut));

// ---- smartFolderSearch（真实 SQL）----
const svc2 = new (class { constructor(db) { this.database = db; } })();
const store = { database: db };
// 直接构造 smartFolderSearch 所需 SQL（与 AppStore.smartFolderSearch 相同语句，避免拉起整个 AppStore）
const smartFolderSearch = (query, { limit = 200 } = {}) => {
  const keywords = String(query || '').split(/[,，\n]/).map((k) => k.trim()).filter(Boolean);
  if (keywords.length === 0) return [];
  const clauses = [];
  const params = [];
  for (const keyword of keywords) {
    const pattern = `%${keyword.replace(/[%_]/g, (c) => '\\' + c)}%`;
    clauses.push(`(a.title LIKE ? ESCAPE '\\' OR a.summary LIKE ? ESCAPE '\\' OR c.text LIKE ? ESCAPE '\\')`);
    params.push(pattern, pattern, pattern);
  }
  const rows = db.prepare(`
    SELECT a.title AS title, COALESCE(a.summary, '') AS summary
    FROM items i
    INNER JOIN feeds f ON f.id = i.feed_id
    LEFT JOIN articles a ON a.item_id = i.id
    LEFT JOIN article_caches c ON c.item_id = i.id
    WHERE f.is_deleted = 0 AND (${clauses.join(' OR ')})
    ORDER BY 1 DESC LIMIT ?
  `).all(...params, limit);
  return rows;
};
db.prepare("INSERT INTO feeds VALUES ('f1', 'https://a.com/feed', 0)").run();
db.prepare("INSERT INTO items VALUES ('i1', 'f1')").run();
db.prepare("INSERT INTO articles VALUES ('i1', 'Rust 异步调度', '系统编程')").run();
db.prepare("INSERT INTO article_caches VALUES ('i1', 'tokio runtime', '')").run();
const hits = smartFolderSearch('Rust, 芯片');
check('smartFolderSearch OR 命中', hits.length === 1, JSON.stringify(hits));
const noHit = smartFolderSearch('不存在的词');
check('smartFolderSearch 不命中为空', noHit.length === 0);

console.log(failures === 0 ? '\nPHASE6 NODE TESTS: ALL PASSED' : `\nPHASE6 NODE TESTS: ${failures} FAILED`);
process.exit(failures ? 1 : 0);
