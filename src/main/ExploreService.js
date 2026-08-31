'use strict';
/**
 * RobinRead（知更）— AI 探索（订阅源发现）
 *
 * 流程：兴趣画像/领域 → 候选池预筛 → LLM 规划（可选）→ 并发验证（feed 发现 +
 * 解析 + 元数据）→ 评分取 Top N → 卡片数据；解释按卡生成（LLMService.explainFeed）；
 * 反馈（订阅/不感兴趣）写回 explored_feeds 与兴趣画像。
 *
 * 红线：未通过本地验证的候选永不展示；LLM 只出候选（幻觉率 28-47%，实测研究），
 * 结论一律以本地抓取结果为准。验证抓取是本地行为，不消耗 AI token。
 */
const path = require('node:path');
const FeedDiscovery = require('./FeedDiscovery');
const FeedParser = require('./FeedParser');
const { plainText } = require('./Models');
const KnowledgeEngine = require('./KnowledgeEngine');

const POOL = require(path.join(__dirname, 'data', 'feed-pool.json'));

const VALIDATE_CONCURRENCY = 4;
const VALIDATE_TIMEOUT_MS = 12000;
const CANDIDATE_DEADLINE_MS = 40000; // 单候选总预算（含站点→feed 发现）
const PLANNING_POOL_SLICE = 80;
const SAMPLES_PER_CARD = 3;
const EXPAND_COUNT = 12;

function nowSeconds() { return Date.now() / 1000; }

async function fetchFeedBuffer(url, timeoutMs = VALIDATE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 RobinRead', Accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, application/json' },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function parseFeedBuffer(buf, url) {
  return FeedParser.parse(buf, url);
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch (_) { return ''; }
}

/** 可比较的站点身份：末两段注册域（news.ycombinator.com 与 blog.x.com 不同域，但 a.co.jp 类简化处理可接受）。 */
function registrableDomain(hostname) {
  const parts = String(hostname || '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const twoLevelTLD = /^(co|com|org|net|gov|edu)\.[a-z]{2}$/.test(parts.slice(-2).join('.'));
  return parts.slice(twoLevelTLD ? -3 : -2).join('.');
}

/** 用技术词库给文本打标签（与文章自动打标同源，零 LLM 成本）。 */
function tagText(text) {
  const haystack = String(text || '');
  const hit = [];
  for (const [tag, re] of KnowledgeEngine.TECH_TERMS) {
    if (re.test(haystack)) hit.push(tag);
  }
  return hit;
}

class ExploreService {
  constructor(store) {
    this.store = store;
  }

  /** 探索入口。mode: 'ai'（画像+LLM 规划+解释）| 'basic'（本地池+验证，无解释）。 */
  async run({ mode = 'ai', domain = null, excludeDomains = [], limit = 10, strength = 'balanced', onProgress = null } = {}) {
    const excluded = new Set((excludeDomains || []).map((d) => String(d || '').toLowerCase()).filter(Boolean));
    // 数据库侧排除：已订阅 + 历史探索（域名级，防御性兜底，渲染层已先行排除）
    for (const row of this.store.database.prepare('SELECT feed_url FROM feeds WHERE is_deleted = 0').all()) {
      const d = registrableDomain(hostOf(row.feed_url));
      if (d) excluded.add(d);
    }
    for (const row of this.store.database.prepare(
      "SELECT domain FROM explored_feeds WHERE domain IS NOT NULL AND (verdict IN ('rejected', 'subscribed') OR explored_at > ?)"
    ).all(nowSeconds() - 3 * 24 * 3600)) {
      // 拒绝/已订阅永久排除；普通「已探索」3 天内不重复（薄领域不至于被一次性榨干）
      excluded.add(row.domain);
    }

    const llmReady = this.store.hasAIAPIKey();
    const useAI = mode === 'ai' && llmReady;

    // 1) 候选预筛：池 → 排除集 →（可选领域过滤）→ 兴趣标签相关性预筛
    let candidates = POOL.sources.filter((s) => {
      const host = hostOf(s.feedURL || s.siteURL);
      const d = registrableDomain(host);
      if (!d || excluded.has(d)) return false;
      if (domain) {
        const q = String(domain).toLowerCase();
        const hay = `${s.name} ${s.desc || ''} ${(s.tags || []).join(' ')} ${s.category || ''}`.toLowerCase();
        if (!hay.includes(q) && !host.includes(q)) return false;
      }
      return true;
    });

    // 2) 挑选短名单：AI 模式用画像标签预筛 + LLM 规划；否则确定性多样化抽样
    const profile = this.store.evolution.interestProfile();
    const topTags = (profile.tags || []).slice(0, 5).map((t) => t.tag || t).filter(Boolean);
    let shortlist = [];
    let expanded = []; // LLM 按领域外扩的站点候选（池内覆盖不足时的关键补充）
    if (candidates.length > PLANNING_POOL_SLICE) {
      if (topTags.length) {
        const scored = candidates.map((c) => {
          const hay = `${c.name} ${c.desc || ''} ${(c.tags || []).join(' ')}`;
          return { c, n: tagText(hay).filter((t) => topTags.includes(t)).length };
        }).sort((a, b) => b.n - a.n);
        const relevant = scored.filter((x) => x.n > 0).map((x) => x.c);
        const rest = scored.filter((x) => x.n === 0).map((x) => x.c);
        candidates = [...relevant, ...rest]; // 相关优先，但保留长尾供探索
      }
      shortlist = this._diverseSlice(candidates, PLANNING_POOL_SLICE);
      if (useAI) {
        const picked = await this._llmShortlist(shortlist, topTags, domain).catch(() => null);
        if (picked && picked.length) {
          const byName = new Map(shortlist.map((c) => [`${c.name}|${c.feedURL}`, c]));
          const llmOrdered = picked.map((p) => byName.get(`${p.name}|${p.feedURL}`) || byName.get(`${p.name}`)).filter(Boolean);
          shortlist = [...llmOrdered, ...shortlist.filter((c) => !llmOrdered.includes(c))];
        }
        // 领域探索时池内匹配往往太窄（如「agent」全池仅 1 条）——让 LLM 外扩知名站点，
        // 与池内候选合并后统一走本地验证（站点→feed 发现→解析），验证不过不展示
        if (domain) {
          expanded = await this._llmExpandDomain(domain, excluded).catch(() => []);
        }
      }
    } else {
      shortlist = this._diverseSlice(candidates, PLANNING_POOL_SLICE);
      if (useAI && domain && candidates.length < 5) {
        expanded = await this._llmExpandDomain(domain, excluded).catch(() => []);
      }
    }
    for (const ex of expanded) shortlist.unshift(ex); // 外扩候选排最前优先验证
    if (shortlist.length === 0) {
      return {
        cards: [],
        note: domain
          ? `候选池中没有匹配「${domain}」的源${llmReady ? '，且 AI 外扩未能给出可用站点' : ''}。试试更宽泛的关键词`
          : '候选池为空',
      };
    }

    // 3) 并发验证与评分（LLM 规划排序仅影响验证顺序，不影响结论）
    // 每个候选 40s 硬预算：外扩候选要做「站点→feed 发现」，慢站点不许拖死整体
    const withDeadline = (p) => Promise.race([
      p,
      new Promise((resolve) => setTimeout(() => resolve(null), CANDIDATE_DEADLINE_MS)),
    ]);
    const cards = [];
    let stop = false;
    let cursor = 0;
    const worker = async () => {
      while (!stop && cursor < shortlist.length) {
        const candidate = shortlist[cursor++];
        const verdict = await withDeadline(this._validateCandidate(candidate).catch(() => null));
        onProgress?.({ name: candidate.name, ok: Boolean(verdict) });
        if (!verdict) continue;
        cards.push(verdict);
        if (cards.length >= Math.max(limit, 10)) stop = true; // 多验几张供评分排序
      }
    };
    await Promise.all(Array.from({ length: VALIDATE_CONCURRENCY }, () => worker()));

    const sorted = cards.sort((a, b) => b.score - a.score);
    // 探索风格三档：保守只收高分近期活跃源；大胆放宽门槛多看长尾
    const minScore = strength === 'calm' ? 55 : strength === 'balanced' ? 35 : 0;
    const freshMaxDays = strength === 'calm' ? 45 : Infinity;
    let admitted = sorted.filter((c) => c.score >= minScore && c.freshnessDays <= freshMaxDays);
    if (admitted.length < Math.min(3, limit)) admitted = sorted; // 过严导致空手时回退全部
    const top = admitted.slice(0, limit);
    // 4) 落 explored 记录（verdict=explored；订阅/拒绝时更新）
    const insert = this.store.database.prepare(
      'INSERT OR REPLACE INTO explored_feeds (url, domain, verdict, score, explanation, explored_at) VALUES (?, ?, ?, ?, NULL, ?)'
    );
    for (const card of top) {
      insert.run(card.feedURL, card.domain, 'explored', card.score, nowSeconds());
    }
    const note = top.length === 0
      ? `验证了 ${shortlist.length} 个候选源，均无法访问（可能已失效或当前网络受限）。试试更换关键词后重试`
      : null;
    return {
      cards: top.map(({ score, ...rest }) => ({ ...rest, score: Math.round(score) })),
      mode: useAI ? 'ai' : 'basic',
      note,
    };
  }

  /** 验证单个候选：feed 直连解析，失败且有站点地址则走自动发现；产出评分与样章。 */
  async _validateCandidate(candidate) {
    let feedURL = candidate.feedURL;
    let parsed = null;
    try {
      const buf = await fetchFeedBuffer(feedURL);
      parsed = parseFeedBuffer(buf, feedURL);
    } catch (_) { parsed = null; }
    if ((!parsed || !parsed.entries || !parsed.entries.length) && candidate.siteURL) {
      const disc = await FeedDiscovery.discoverFeed(candidate.siteURL).catch(() => null);
      if (disc && disc.ok) { feedURL = disc.feedURL; parsed = disc.parsed; }
    }
    if (!parsed || !parsed.entries || !parsed.entries.length) return null;
    return this._scoreCandidate(candidate, feedURL, parsed);
  }

  _scoreCandidate(candidate, feedURL, parsed) {
    const entries = parsed.entries || [];
    const times = entries.map((e) => e.published ?? e.dateArrived).filter((t) => Number.isFinite(t));
    const latest = times.length ? Math.max(...times) : null;
    const daysAgo = latest ? Math.max(0, (nowSeconds() - latest) / 86400) : 999;
    const intervals = [];
    const sorted = [...times].sort((a, b) => b - a);
    for (let i = 1; i < Math.min(sorted.length, 11); i += 1) intervals.push(Math.max(0.02, (sorted[i - 1] - sorted[i]) / 86400));
    intervals.sort((a, b) => a - b);
    const medianInterval = intervals.length ? intervals[Math.floor(intervals.length / 2)] : 999;
    const lengths = entries.map((e) => plainText(e.contentHTML || e.summaryContent || e.summary || '').length);
    const avgLen = lengths.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : 0;

    const freshness = Math.exp(-daysAgo / 30);
    const regularity = medianInterval <= 2 ? 1 : medianInterval <= 7 ? 0.9 : medianInterval <= 21 ? 0.7 : medianInterval <= 45 ? 0.4 : 0.1;
    const depth = Math.min(1, avgLen / 3000);
    const profile = this.store.evolution.interestProfile();
    const topTags = (profile.tags || []).slice(0, 5).map((t) => t.tag || t);
    let hitRate = 0.5;
    if (topTags.length) {
      const hits = entries.slice(0, 10).filter((e) => tagText(`${e.title || ''} ${plainText(e.contentHTML || e.summary || '').slice(0, 300)}`).some((t) => topTags.includes(t))).length;
      hitRate = Math.min(1, hits / Math.min(10, Math.max(1, entries.length)));
    }
    const language = /[\u4e00-\u9fff]/.test(entries[0]?.title || candidate.name) ? 1 : 0.3;
    const fullText = avgLen >= 800 ? 1 : 0.3;
    const size = Math.min(1, entries.length / 10);
    const score = 25 * freshness + 15 * regularity + 20 * depth + 15 * hitRate + 10 * language + 10 * fullText + 5 * size;

    const samples = entries.slice(0, SAMPLES_PER_CARD).map((e) => ({
      title: e.title || '',
      snippet: plainText(e.contentHTML || e.summaryContent || e.summary || '').replace(/\s+/g, ' ').slice(0, 140),
      link: e.url || null,
      publishedAt: e.published ?? null,
    }));
    const domain = registrableDomain(hostOf(feedURL));
    return {
      url: feedURL,
      feedURL,
      domain,
      name: parsed.title || candidate.name,
      lang: language === 1 ? 'zh' : 'en',
      category: candidate.category || 'blog',
      desc: candidate.desc || '',
      freshnessDays: Math.round(daysAgo),
      intervalDays: Math.round(medianInterval * 10) / 10,
      avgChars: avgLen,
      fullText: avgLen >= 800,
      entries: entries.length,
      samples,
      score: Math.max(0, Math.min(100, score)),
    };
  }

  /** 单卡解释生成（有持久化：重复打开不重复花钱）。 */
  async explain({ url, name, samples }) {
    const row = this.store.database.prepare('SELECT explanation FROM explored_feeds WHERE url = ?').get(url);
    if (row && row.explanation) return { explanation: row.explanation };
    const { config, apiKey } = this.store._requireAIReady();
    const profile = this.store.evolution.interestProfile();
    const tags = (profile.tags || []).slice(0, 5).map((t) => t.tag || t);
    const explanation = await this.store.llm.explainFeed({ name, url, samples, interestTags: tags }, config, apiKey);
    this.store.database.prepare('UPDATE explored_feeds SET explanation = ? WHERE url = ?').run(explanation, url);
    return { explanation };
  }

  /** 反馈：reason ∈ rejected（不感兴趣，画像负向+拉黑）| subscribed（已订阅）| ignored。 */
  dismiss({ url, reason = 'ignored' }) {
    const verdict = ['rejected', 'subscribed', 'ignored'].includes(reason) ? reason : 'ignored';
    this.store.database.prepare('UPDATE explored_feeds SET verdict = ? WHERE url = ?').run(verdict, url);
    if (verdict === 'rejected') {
      const domain = registrableDomain(hostOf(url));
      if (domain && typeof this.store.evolution.bumpInterestKey === 'function') {
        this.store.evolution.bumpInterestKey(`domain:${domain}`, -2);
      }
    }
    return { ok: true };
  }

  /** 确定性多样化抽样：语言优先（中文在前，匹配目标用户），组间轮流保证分类多样。 */
  _diverseSlice(list, n) {
    const bucket = {};
    for (const c of list) {
      const key = `${c.lang || 'x'}:${c.category || 'x'}`;
      (bucket[key] = bucket[key] || []).push(c);
    }
    const groups = Object.entries(bucket)
      .sort(([a], [b]) => (b.startsWith('zh') ? 1 : 0) - (a.startsWith('zh') ? 1 : 0))
      .map(([, v]) => v);
    const out = [];
    let i = 0;
    while (out.length < n) {
      let added = false;
      for (const g of groups) {
        if (i < g.length) { out.push(g[i]); added = true; if (out.length >= n) break; }
      }
      if (!added) break;
      i += 1;
    }
    return out;
  }

  /** LLM 规划：从短名单里挑最有探索价值的候选（仅排序建议，必须本地验证）。 */
  async _llmShortlist(shortlist, topTags, domain) {
    const { config, apiKey } = this.store._requireAIReady();
    const slice = shortlist.slice(0, PLANNING_POOL_SLICE).map((c, i) => `${i + 1}. ${c.name}${c.desc ? '：' + c.desc : ''}${(c.tags || []).length ? '［' + c.tags.join('/') + '］' : ''}`);
    const interest = topTags.length ? `用户兴趣标签：${topTags.join('、')}。` : (domain ? `用户想深入探索的领域：${domain}。` : '用户暂无画像，请保证领域多样性。');
    const output = await this.store.llm.complete({
      prompt: `候选订阅源列表：\n${slice.join('\n')}\n\n${interest}\n请从中挑出 ${Math.min(15, shortlist.length)} 个最值得探索的候选（可以全部来自列表，不要编造列表外的条目），按探索价值降序输出它们的编号与名称，JSON 格式：{"picked":[{"i":1,"name":"..."}]}`,
      system: 'You are a feed discovery planner. Pick candidates from the given list only. Respond with valid JSON only.',
      configuration: config,
      apiKey,
      forceDisableReasoning: true,
      overrideTemperature: 0.2,
    });
    const match = output.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    const picked = (parsed.picked || [])
      .map((p) => shortlist[(Number(p.i) || 0) - 1] || shortlist.find((c) => c.name === p.name))
      .filter(Boolean);
    return picked;
  }

  /**
   * LLM 域名外扩：领域词在池内覆盖不足时，让 LLM 提议该领域的知名站点/博客
   * （站点级 URL，不一定有 feed——验证管线会做「站点→feed 发现」兜底）。
   * 幻觉 URL 会在验证阶段自然淘汰，红线不变：验证不过不展示。
   */
  async _llmExpandDomain(domain, excluded) {
    const { config, apiKey } = this.store._requireAIReady();
    const excludedHint = excluded.size ? `以下域名已被用户订阅或探索过，不要重复提议：${[...excluded].slice(0, 40).join('、')}。` : '';
    const output = await this.store.llm.complete({
      prompt: `用户想在「${domain}」领域寻找值得用 RSS 订阅的内容源。请列出 ${EXPAND_COUNT} 个该领域公认有持续输出、值得订阅的网站/博客/期刊（优先官方博客与知名作者，站点需真实存在且大概率提供 RSS）。${excludedHint}\n严格输出 JSON：{"sites":[{"name":"站点名","site":"https://..."}]}`,
      system: 'You are a feed discovery scout. Propose real, well-known sites only. Respond with valid JSON only.',
      configuration: config,
      apiKey,
      forceDisableReasoning: true,
      overrideTemperature: 0.3,
    });
    const match = output.match(/\{[\s\S]*\}/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    const seen = new Set();
    const out = [];
    for (const s of parsed.sites || []) {
      const site = String(s.site || '').trim();
      if (!/^https?:\/\//i.test(site)) continue;
      const host = registrableDomain(hostOf(site));
      if (!host || excluded.has(host) || seen.has(host)) continue;
      seen.add(host);
      out.push({ name: String(s.name || host).slice(0, 80), siteURL: site, feedURL: '', lang: /[\u4e00-\u9fff]/.test(s.name || '') ? 'zh' : 'en', category: 'expanded', desc: '', tags: [domain] });
      if (out.length >= EXPAND_COUNT) break;
    }
    return out;
  }
}

// MARK: - 模块级工具（见顶部 fetchFeedBuffer / parseFeedBuffer）

module.exports = { ExploreService, registrableDomain, tagText };
