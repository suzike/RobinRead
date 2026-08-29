'use strict';
/**
 * RobinRead Windows — 自进化引擎（EvolutionEngine）
 *
 * 让工具从「静态订阅器」进化成「会学习的阅读助手」：
 * - 源健康监测：抓取成功率 / 连续失败 / 死源标记 / 信息产出率
 * - 阅读行为：读 / 星标 / 高亮 / 跳过 的持久化行为流
 * - 兴趣画像：从行为中学习标签权重与源偏好（TF 加权，含时间衰减）
 * - AI 反馈闭环：对 AI 回答点赞 / 点踩，累积可信度与偏好
 * - 个性化推荐：基于画像的「你可能喜欢」与「今日必读」
 * - 自诊断：数据库完整性 / 死源 / 未读堆积 / AI 配置健康度
 * - 未读堆积预警与信息密度统计
 */
const { nowSeconds, uuid } = require('./Models');

class EvolutionEngine {
  constructor(store) {
    this.store = store;
    this._ensureTables();
  }

  _ensureTables() {
    this.store.database.exec(`
      CREATE TABLE IF NOT EXISTS feed_health (
        feed_id TEXT PRIMARY KEY NOT NULL,
        fetch_success_count INTEGER DEFAULT 0,
        fetch_failure_count INTEGER DEFAULT 0,
        consecutive_failures INTEGER DEFAULT 0,
        last_success_at REAL,
        last_failure_at REAL,
        last_error TEXT,
        entry_count INTEGER DEFAULT 0,
        is_dead INTEGER DEFAULT 0,
        FOREIGN KEY(feed_id) REFERENCES feeds(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS reading_behavior (
        id TEXT PRIMARY KEY NOT NULL,
        item_id TEXT NOT NULL,
        feed_id TEXT,
        action TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        created_at REAL NOT NULL,
        FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_behavior_item ON reading_behavior(item_id);
      CREATE INDEX IF NOT EXISTS idx_behavior_feed ON reading_behavior(feed_id);
      CREATE TABLE IF NOT EXISTS ai_feedback (
        id TEXT PRIMARY KEY NOT NULL,
        item_id TEXT,
        kind TEXT NOT NULL,
        rating INTEGER NOT NULL,
        comment TEXT,
        created_at REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS interest_profile (
        key TEXT PRIMARY KEY NOT NULL,
        value REAL NOT NULL,
        updated_at REAL NOT NULL
      );
    `);
  }

  // ── 源健康 ────────────────────────────────────────────────

  /** 记录一次抓取结果。 */
  recordFetch({ feedID, ok, error = null, entryCount = 0 }) {
    const now = nowSeconds();
    const prev = this.store.database.prepare('SELECT * FROM feed_health WHERE feed_id = ?').get(feedID);
    if (ok) {
      const consecutive = 0;
      this.store.database.prepare(`
        INSERT INTO feed_health (feed_id, fetch_success_count, fetch_failure_count, consecutive_failures, last_success_at, last_error, entry_count, is_dead)
        VALUES (?, 1, 0, 0, ?, NULL, ?, 0)
        ON CONFLICT(feed_id) DO UPDATE SET
          fetch_success_count = fetch_success_count + 1,
          consecutive_failures = 0,
          last_success_at = excluded.last_success_at,
          last_error = NULL,
          entry_count = excluded.entry_count,
          is_dead = 0
      `).run(feedID, now, entryCount);
    } else {
      const prevConsecutive = prev ? (prev.consecutive_failures || 0) : 0;
      const consecutive = prevConsecutive + 1;
      const isDead = consecutive >= 5 ? 1 : (prev ? prev.is_dead : 0);
      this.store.database.prepare(`
        INSERT INTO feed_health (feed_id, fetch_success_count, fetch_failure_count, consecutive_failures, last_failure_at, last_error, entry_count, is_dead)
        VALUES (?, 0, 1, ?, ?, ?, 0, ?)
        ON CONFLICT(feed_id) DO UPDATE SET
          fetch_failure_count = fetch_failure_count + 1,
          consecutive_failures = excluded.consecutive_failures,
          last_failure_at = excluded.last_failure_at,
          last_error = excluded.last_error,
          is_dead = excluded.is_dead
      `).run(feedID, consecutive, now, String(error || '').slice(0, 300), isDead);
    }
  }

  /** 全部源的当前健康状态（含标题/URL）。 */
  healthSnapshot() {
    const rows = this.store.database.prepare(`
      SELECT h.*, f.title, f.feed_url
      FROM feed_health h LEFT JOIN feeds f ON f.id = h.feed_id
      ORDER BY h.is_dead DESC, h.consecutive_failures DESC
    `).all();
    return rows.map((r) => ({
      feedID: r.feed_id,
      title: r.title || r.feed_url || r.feed_id,
      url: r.feed_url,
      successCount: r.fetch_success_count || 0,
      failureCount: r.fetch_failure_count || 0,
      consecutiveFailures: r.consecutive_failures || 0,
      lastSuccessAt: r.last_success_at,
      lastFailureAt: r.last_failure_at,
      lastError: r.last_error,
      entryCount: r.entry_count || 0,
      isDead: Boolean(r.is_dead),
      reliability: this._reliability(r),
    }));
  }

  _reliability(r) {
    const total = (r.fetch_success_count || 0) + (r.fetch_failure_count || 0);
    if (total === 0) return 1.0;
    return Number((r.fetch_success_count / total).toFixed(3));
  }

  deadFeeds() {
    return this.healthSnapshot().filter((h) => h.isDead);
  }

  // ── 阅读行为与兴趣画像 ────────────────────────────────────

  /** 记录一次行为。action: read / star / highlight / skip / note / ai */
  recordBehavior({ itemID, feedID = null, action, weight = 1.0 }) {
    const allowed = ['read', 'star', 'highlight', 'skip', 'note', 'ai', 'review'];
    if (!allowed.includes(action)) action = 'read';
    const id = uuid();
    this.store.database.prepare(`
      INSERT INTO reading_behavior (id, item_id, feed_id, action, weight, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, itemID, feedID, action, weight, nowSeconds());

    // 同步更新兴趣画像：标签权重
    const tags = this.store.database.prepare('SELECT tag FROM article_tags WHERE item_id = ?').all(itemID);
    const boost = { read: 1, star: 2, highlight: 2.5, note: 2, skip: -1, ai: 1.5, review: 2 }[action] || 1;
    for (const { tag } of tags) {
      this._bumpInterest(tag, boost * weight);
    }
    // 源偏好
    if (feedID) {
      const feedBoost = { read: 0.6, star: 1.5, highlight: 1.5, note: 1.2, skip: -0.8, ai: 1, review: 1.2 }[action] || 0.5;
      this._bumpInterest(`feed:${feedID}`, feedBoost * weight);
    }
    // 使 AppStore 的兴趣标签缓存失效（否则打分 boost 会滞后 60s）
    if (this.store._interestCache) this.store._interestCache.at = 0;
    return id;
  }

  _bumpInterest(key, delta) {
    const prev = this.store.database.prepare('SELECT value FROM interest_profile WHERE key = ?').get(key);
    const next = Math.max(-20, Math.min(50, (prev ? prev.value : 0) + delta));
    this.store.database.prepare(`
      INSERT INTO interest_profile (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, next, nowSeconds());
  }

  /** 兴趣画像：标签权重 + 源偏好，按时间衰减。 */
  interestProfile() {
    const raw = this.store.database.prepare('SELECT * FROM interest_profile ORDER BY value DESC').all();
    const now = nowSeconds();
    const HALF_LIFE = 30 * 86400; // 30 天半衰期
    const tags = [];
    const feeds = [];
    for (const r of raw) {
      const age = Math.max(0, now - (r.updated_at || now));
      const decayed = r.value * Math.pow(0.5, age / HALF_LIFE);
      if (r.key.startsWith('feed:')) {
        feeds.push({ feedID: r.key.slice(5), weight: Number(decayed.toFixed(3)) });
      } else {
        tags.push({ tag: r.key, weight: Number(decayed.toFixed(3)) });
      }
    }
    return {
      tags: tags.filter((t) => t.weight > 0).sort((a, b) => b.weight - a.weight).slice(0, 20),
      feeds: feeds.filter((f) => f.weight > 0).sort((a, b) => b.weight - a.weight).slice(0, 15),
      allTags: tags.sort((a, b) => b.weight - a.weight),
    };
  }

  /** 基于画像推荐「你可能喜欢」的文章（未读 + 命中兴趣标签）。 */
  recommendArticles(limit = 8) {
    const profile = this.interestProfile();
    const topTags = profile.tags.map((t) => t.tag);
    if (!topTags.length) return [];
    const placeholders = topTags.map(() => '?').join(',');
    const rows = this.store.database.prepare(`
      SELECT DISTINCT i.id, a.title, a.summary, f.title as feed_title,
        COALESCE(s.is_read, 0) as is_read, COALESCE(s.is_starred, 0) as is_starred,
        i.created_at
      FROM article_tags at
      INNER JOIN items i ON i.id = at.item_id
      LEFT JOIN articles a ON a.item_id = i.id
      LEFT JOIN feeds f ON f.id = i.feed_id
      LEFT JOIN article_states s ON s.item_id = i.id
      WHERE at.tag IN (${placeholders}) AND COALESCE(s.is_read, 0) = 0
      ORDER BY i.created_at DESC LIMIT ?
    `).all(...topTags, limit);
    // 命中兴趣标签越多越靠前
    const tagSet = new Set(topTags);
    const scored = rows.map((r) => {
      const itemTags = this.store.database.prepare('SELECT tag FROM article_tags WHERE item_id = ?').all(r.id).map((t) => t.tag);
      const hits = itemTags.filter((t) => tagSet.has(t)).length;
      return { ...r, interestHits: hits };
    }).sort((a, b) => b.interestHits - a.interestHits || (b.created_at - a.created_at));
    return scored.slice(0, limit);
  }

  // ── AI 反馈闭环 ──────────────────────────────────────────

  recordFeedback({ itemID = null, kind, rating, comment = null }) {
    const id = uuid();
    this.store.database.prepare(`
      INSERT INTO ai_feedback (id, item_id, kind, rating, comment, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, itemID, kind, Math.max(-1, Math.min(1, Number(rating) || 0)), comment, nowSeconds());
    return id;
  }

  feedbackSummary() {
    const total = this.store.database.prepare('SELECT COUNT(*) as n FROM ai_feedback').get().n;
    const likes = this.store.database.prepare('SELECT COUNT(*) as n FROM ai_feedback WHERE rating > 0').get().n;
    const dislikes = this.store.database.prepare('SELECT COUNT(*) as n FROM ai_feedback WHERE rating < 0').get().n;
    const byKind = this.store.database.prepare(`
      SELECT kind, COUNT(*) as n, SUM(CASE WHEN rating > 0 THEN 1 ELSE 0 END) as likes
      FROM ai_feedback GROUP BY kind
    `).all();
    return { total, likes, dislikes, byKind };
  }

  // ── 自诊断 ────────────────────────────────────────────────

  diagnose() {
    const checks = [];
    const db = this.store.database;

    // 1. 数据库完整性
    try {
      const integrity = db.prepare('PRAGMA integrity_check').get();
      checks.push({ id: 'db-integrity', ok: integrity && integrity.integrity_check === 'ok', detail: integrity?.integrity_check });
    } catch (err) {
      checks.push({ id: 'db-integrity', ok: false, detail: String(err.message || err) });
    }

    // 2. 死源
    const dead = this.deadFeeds();
    checks.push({ id: 'dead-feeds', ok: dead.length === 0, detail: `${dead.length} 个失效源`, data: dead.map((d) => d.title) });

    // 3. 未读堆积
    const unread = this._countUnread();
    const unreadWarn = unread > 300 ? 'warn' : unread > 500 ? 'critical' : 'ok';
    checks.push({ id: 'unread-backlog', ok: unreadWarn === 'ok', detail: `${unread} 篇未读`, level: unreadWarn });

    // 4. AI 配置
    const hasKey = this.store.hasAIAPIKey ? this.store.hasAIAPIKey() : false;
    const llm = this.store.llmConfigurationSnapshot ? this.store.llmConfigurationSnapshot() : {};
    checks.push({ id: 'ai-config', ok: Boolean(hasKey && llm.model), detail: hasKey ? `模型 ${llm.model || '未设置'}` : '未配置 API Key' });

    // 5. 源总数
    const feedCount = this.store.feedsRepo ? this.store.feedsRepo.allFeeds().length : 0;
    checks.push({ id: 'feed-count', ok: feedCount > 0, detail: `${feedCount} 个订阅源` });

    return {
      overall: checks.filter((c) => c.ok).length + ' / ' + checks.length,
      okCount: checks.filter((c) => c.ok).length,
      total: checks.length,
      checks,
      deadFeeds: dead,
      unreadCount: unread,
      feedCount,
    };
  }

  _countUnread() {
    try {
      return this.store.database.prepare('SELECT COUNT(*) as n FROM article_states WHERE is_read = 0').get().n;
    } catch (_) { return 0; }
  }

  // ── 信息密度统计 ──────────────────────────────────────────

  densityByFeed(days = 14) {
    const since = nowSeconds() - days * 86400;
    return this.store.database.prepare(`
      SELECT f.id as feed_id, f.title, COUNT(i.id) as entry_count
      FROM feeds f
      LEFT JOIN items i ON i.feed_id = f.id AND i.created_at >= ?
      GROUP BY f.id ORDER BY entry_count DESC
    `).all(since).map((r) => ({ feedID: r.feed_id, title: r.title, entryCount: r.entry_count }));
  }

  densityByDay(days = 14) {
    const since = nowSeconds() - days * 86400;
    const rows = this.store.database.prepare(`
      SELECT date(i.created_at, 'unixepoch', 'localtime') as day, COUNT(*) as n
      FROM items i WHERE i.created_at >= ? GROUP BY day ORDER BY day
    `).all(since);
    return rows.map((r) => ({ day: r.day, count: r.n }));
  }
}

module.exports = { EvolutionEngine };
