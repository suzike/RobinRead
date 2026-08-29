'use strict';
/**
 * RobinRead Windows — AIHOT 服务（热点榜 / 故事时间线）
 *
 * 封装 aihot.virxact.com 公开只读 API（无需 Key）：
 * - GET /api/v1/hot-topics        多源热点话题
 * - GET /api/v1/stories/{publicId} 事件故事 + AI 摘要 + 时间线
 * - GET /api/v1/selected/snapshot  精选快照
 *
 * 数据在 main 进程抓取（避免渲染层跨域），带超时与缓存。
 */
const AIHOT_BASE = 'https://aihot.virxact.com';
const UA = 'RobinRead/2.0 (+personal RSS reader)';

class AihotService {
  constructor() {
    this._cache = new Map(); // key -> { data, at }
    this._ttl = 5 * 60 * 1000; // 5 分钟缓存
  }

  async _getJSON(path, { ttl = this._ttl } = {}) {
    const cached = this._cache.get(path);
    if (cached && Date.now() - cached.at < ttl) return cached.data;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(AIHOT_BASE + path, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      this._cache.set(path, { data, at: Date.now() });
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 热点榜：多源热点话题（rank/sourceCount/sourceNames）。 */
  async hotTopics() {
    const raw = await this._getJSON('/api/v1/hot-topics');
    return (raw.items || []).map((it) => ({
      rank: it.rank,
      id: it.id,
      title: it.title,
      source: it.source?.name || '',
      sourceCount: it.sourceCount || 0,
      sourceNames: it.sourceNames || [],
      latestAt: it.latestAt || null,
      originalURL: it.links?.original || null,
      storyURL: it.links?.story || null,
    }));
  }

  /** 故事时间线：单事件的覆盖时间线 + AI 摘要。 */
  async story(publicId) {
    const raw = await this._getJSON(`/api/v1/stories/${encodeURIComponent(publicId)}`);
    const story = raw.story || raw;
    return {
      publicId: story.publicId,
      title: story.title,
      status: story.status,
      sourceCount: story.sourceCount || 0,
      reportCount: story.reportCount || 0,
      firstReportAt: story.firstReportAt || null,
      latestAt: story.latestAt || null,
      digest: story.digest || '',
      links: story.links || {},
      reports: (story.reports || []).map((r) => ({
        id: r.id,
        title: r.title,
        summary: r.summary,
        source: r.source,
        publishedAt: r.publishedAt,
        links: r.links || {},
      })),
      storyline: (story.storyline || []).map((n) => ({
        publicId: n.publicId,
        title: n.title,
        relation: n.relation,
      })),
      related: (story.related || []).map((n) => ({
        publicId: n.publicId,
        title: n.title,
        relation: n.relation,
      })),
    };
  }

  /** 精选快照（分页，取一页）。 */
  async selected(limit = 30) {
    const raw = await this._getJSON(`/api/v1/selected/snapshot?limit=${limit}`);
    return (raw.items || []).map((it) => ({
      id: it.id,
      title: it.title,
      summary: it.summary || '',
      source: it.source?.name || '',
      category: it.category || '',
      score: it.score ?? null,
      reason: it.reason || '',
      originalURL: it.links?.original || null,
      publishedAt: it.publishedAt || null,
    }));
  }

  /** AI 日报（最新一期：分节中文简报）。 */
  async daily() {
    const raw = await this._getJSON('/api/v1/dailies/latest');
    return this._mapDaily(raw);
  }

  /** 日报归档索引（近 N 期：date/leadTitle）。 */
  async dailies(limit = 30) {
    const raw = await this._getJSON(`/api/v1/dailies?limit=${limit}`);
    return (raw.items || []).map((it) => ({
      date: it.date || '',
      leadTitle: it.leadTitle || '',
      generatedAt: it.generatedAt || null,
    }));
  }

  /** 按日期取某期日报。 */
  async dailyByDate(date) {
    const raw = await this._getJSON(`/api/v1/dailies/${encodeURIComponent(date)}`);
    return this._mapDaily(raw);
  }

  _mapDaily(raw) {
    const report = raw.report || raw;
    return {
      date: report.date || '',
      lead: report.lead || '',
      sections: (report.sections || []).map((s) => ({
        title: s.title || '',
        items: (s.items || s.entries || []).map((it) => ({
          title: it.title || '',
          summary: it.summary || it.description || '',
          url: it.url || it.link || (it.links && (it.links.original || it.links.aihot)) || null,
        })),
      })),
      flashes: (report.flashes || []).map((f) => ({
        title: f.title || '',
        summary: f.summary || '',
        url: f.url || (f.links && (f.links.original || f.links.aihot)) || null,
      })),
      generatedAt: report.generatedAt || null,
    };
  }

  /**
   * 万能条目流：mode=selected，支持时间窗（24h/72h/7d/30d）与服务端搜索 q。
   * 返回与 selected() 相同形状的条目（含 publishedAt/score/reason）。
   */
  async items({ window = '7d', q = null, limit = 50 } = {}) {
    const params = new URLSearchParams({ mode: 'selected', limit: String(limit) });
    if (window) params.set('window', window);
    if (q) params.set('q', q);
    const raw = await this._getJSON(`/api/v1/items?${params.toString()}`);
    return (raw.items || []).map((it) => this._mapSelectedItem(it));
  }

  /** 精选快照分页（数千条全量归档）：page 为上一页返回的 nextPage。 */
  async selectedPage({ limit = 50, page = null } = {}) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (page) params.set('page', page);
    const raw = await this._getJSON(`/api/v1/selected/snapshot?${params.toString()}`);
    return {
      items: (raw.items || []).map((it) => this._mapSelectedItem(it)),
      hasMore: Boolean(raw.hasMore),
      nextPage: raw.nextPage || null,
      cursor: raw.cursor || null,
    };
  }

  _mapSelectedItem(it) {
    return {
      id: it.id,
      title: it.title || '',
      originalTitle: it.originalTitle || '',
      summary: it.summary || '',
      source: it.source?.name || it.source || '',
      category: it.category || '',
      score: it.score ?? null,
      reason: it.reason || '',
      originalURL: it.links?.original || it.url || null,
      publishedAt: it.publishedAt || null,
    };
  }

  /**
   * 模型排行榜：抓取 /leaderboard 页面并解析（无公开 API，HTML 结构稳定）。
   * 行结构：<a class="lb-row" href="/leaderboard/{slug}"> 内含 rank/模型名/厂商/评分/上线日/输入输出价格。
   * 缓存 15 分钟。
   */
  async leaderboard() {
    const cached = this._cache.get('/leaderboard');
    if (cached && Date.now() - cached.at < 15 * 60 * 1000) return cached.data;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${AIHOT_BASE}/leaderboard`, {
        headers: { 'User-Agent': UA, Accept: 'text/html' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const models = [];
      const rowRe = /<a class="lb-row"[^>]*href="\/leaderboard\/([a-z0-9-]+)"[\s\S]*?<\/a>/gi;
      let row;
      while ((row = rowRe.exec(html)) !== null) {
        const block = row[0];
        const pick = (re) => {
          const m = block.match(re);
          return m ? m[1].trim() : '';
        };
        const priceMatches = [...block.matchAll(/<small>(输入|输出)<\/small><strong>([^<]+)<\/strong>/g)];
        const prices = {};
        for (const pm of priceMatches) prices[pm[1]] = pm[2].trim();
        const name = pick(/<span class="lb-model-copy"><strong>([^<]+)<\/strong>/);
        if (!name) continue;
        models.push({
          slug: row[1],
          rank: Number(pick(/lb-rank[^"]*"[^>]*><b>(\d+)<\/b>/)) || models.length + 1,
          name,
          vendor: pick(/<span class="lb-model-copy"><strong>[^<]+<\/strong><small>([^<]+)<\/small>/),
          score: pick(/<span class="lb-score"[^>]*><strong>([\d.]+)<\/strong>/),
          releaseDate: pick(/<span class="lb-release-date"[^>]*>[\s\S]*?<strong>([^<]+)<\/strong>/),
          completeness: (block.match(/aria-label="评测完整度 ([\d.]+)%"/) || [])[1] || '',
          inputPrice: prices['输入'] || '',
          outputPrice: prices['输出'] || '',
          logoURL: (block.match(/src="(\/model-providers\/[^"]+)"/) || [])[1]
            ? `${AIHOT_BASE}${block.match(/src="(\/model-providers\/[^"]+)"/)[1]}`
            : '',
          detailURL: `${AIHOT_BASE}/leaderboard/${row[1]}`,
        });
      }
      if (models.length === 0) throw new Error('leaderboard parse empty');
      this._cache.set('/leaderboard', { data: models, at: Date.now() });
      return models;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 抓取并提取任意 URL 的正文（AIHot 原文应用内精读）。 */
  async extractURL(url) {
    const ArticleExtractor = require('./ArticleExtractor');
    const result = await ArticleExtractor.extract(url);
    return { html: result.html, text: result.text, title: '', sourceURL: result.sourceURL };
  }
}

module.exports = { AihotService };
