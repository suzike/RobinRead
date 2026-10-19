'use strict';
/**
 * RobinRead（知更）— 事件聚类去重服务（F21）
 *
 * 同一新闻被多源重复报道时自动聚合成「事件」簇，列表事件模式按簇分组看全景。
 *
 * 聚类引擎（增量式，入库钩子异步驱动）：
 * - 新条目与近 EVENT_WINDOW_DAYS 天条目算标题 bigram Jaccard（复用 F13 同款分词基建）；
 *   ≥ EVENT_THRESHOLD 即视为同题报道，并入该条目所在簇；
 * - 候选粗筛禁全表逐篇 Jaccard：显著词 LIKE 标题（extractKeywords）OR 同源，发布时间
 *   新者优先采样截 EVENT_CANDIDATE_CAP，内存精排（SimilarService._coarseCandidates 同构）；
 * - 首次命中时才建簇（单源独报不成事件）：簇初始成员 = {新条目, 命中条目}，
 *   代表条目 = 发布最早成员；后续并入若出现更早成员则代表随之迁移；
 * - member_count 冗余存簇行（事件卡「N 源」徽标直读）；条目删除随 items 级联清
 *   cluster_id，簇行由 summaries 惰性回收（实际成员 < 2 即删）。
 *
 * 并发与安全：
 * - 入库钩子（AppStore._applyParsedEntries 事务提交后）只登记 ID，聚类计算在
 *   setTimeout 后台合批让出执行，绝不阻塞灌文主路径；异常单篇吞掉不外溢；
 * - 单飞（_draining 互斥），flush() 供探针确定性等待队列清空。
 *
 * 无网络路；注入缝（探针离线化）：_nowImpl（时间窗固定）。
 */
const { i18n } = require('./I18N');
const { uuid, nowSeconds } = require('./Models');
const { extractKeywords } = require('./lib/keywords');
const { bigrams, jaccard } = require('./SimilarService');

const EVENT_THRESHOLD = 0.55;     // 标题 bigram Jaccard 并簇阈值（同 F13 渲染层口径）
const EVENT_WINDOW_DAYS = 7;      // 事件回看窗口：7 天外的旧闻不再并簇
const EVENT_CANDIDATE_CAP = 400;  // 粗筛候选上限（内存精排 N 侧约束）
const EVENT_KEYWORD_POOL = 4;     // 粗筛显著词个数
const TITLE_SLICE = 200;          // 参与分词的标题长度
const MEMBER_CAP = 50;            // summaries 单簇返回成员上限（全景卡展开用）
const DRAIN_BATCH = 4;            // 后台合批：单轮处理条目数（批间让出事件循环）
// R120.7 真实库实证：50/批在 3.7 万篇库上单批同步 6.6s（候选 LIKE 粗筛×50 中途不让行）；
// 8/批实测残余 ~1.1s（8×140ms）仍可感知；4/批压回 ~500ms——聚类纯后台，不赶时间。
const DRAIN_DELAY_MS = 50;        // 入库钩子登记 → 开始聚类的延迟（合攒同批灌文）
const REBUILD_CAP = 2000;         // 批量补跑单次扫描条目上限（近窗口最新优先）

// MARK: - 服务

class EventClusterService {
  constructor(store) {
    this.store = store;
    this.counters = { clustered: 0, joined: 0, created: 0, skipped: 0, errors: 0, pruned: 0 };
    this._pending = new Set();   // 待聚类 entryID（入库钩子登记）
    this._drainTimer = null;
    this._draining = false;
    this._nowImpl = null;        // 注入缝：时间（探针固定 7 天窗口）
  }

  now() {
    return this._nowImpl ? this._nowImpl() : nowSeconds();
  }

  // MARK: 入库钩子（异步、不阻塞灌文主路径）

  /** 灌文事务提交后登记新条目 ID；后台合批增量聚类（单飞）。 */
  noteNewEntries(entryIDs) {
    for (const id of (Array.isArray(entryIDs) ? entryIDs : [])) {
      if (id) this._pending.add(String(id));
    }
    if (!this._pending.size || this._drainTimer) return;
    this._drainTimer = setTimeout(() => {
      this._drainTimer = null;
      this._drain().catch(() => { /* 后台聚类失败静默：下轮补跑 */ });
    }, DRAIN_DELAY_MS);
  }

  /** 探针确定性：等待挂起队列与在途合批全部清空。 */
  async flush() {
    while (this._pending.size || this._draining || this._drainTimer) {
      await new Promise((r) => setTimeout(r, 8));
    }
  }

  async _drain() {
    if (this._draining) return;
    this._draining = true;
    try {
      while (this._pending.size) {
        const batch = [...this._pending].slice(0, DRAIN_BATCH);
        for (const id of batch) this._pending.delete(id);
        for (const id of batch) {
          try {
            this.clusterEntry(id);
          } catch (_) {
            this.counters.errors += 1; // 单篇异常不拖死整批
          }
        }
        await new Promise((r) => setTimeout(r, 0)); // 批间让出事件循环
      }
    } finally {
      this._draining = false;
    }
  }

  // MARK: 增量聚类核心

  /**
   * 单条目增量聚类：与近 7 天条目算标题 bigram Jaccard，命中并入其簇（或建新簇），
   * 未命中静默跳过（独报不成事件，待后来者命中时一并建簇）。幂等：已有归属直接跳过。
   * @returns {{ clusterID: string|null, action: 'joined'|'created'|'skip' }}
   */
  clusterEntry(entryID) {
    const id = String(entryID || '');
    if (!id) return { clusterID: null, action: 'skip' };
    const db = this.store.database;
    const self = db.prepare(`
      SELECT i.id AS id, i.feed_id AS feed_id, i.cluster_id AS clusterID,
             IFNULL(a.title, '') AS title,
             COALESCE(a.published_at, i.created_at) AS publishedAt
      FROM items i
      INNER JOIN articles a ON a.item_id = i.id
      WHERE i.id = ?
    `).get(id);
    if (!self || !String(self.title || '').trim()) {
      this.counters.skipped += 1;
      return { clusterID: null, action: 'skip' };
    }
    if (self.clusterID) {
      this.counters.skipped += 1; // 已有归属：幂等重入直接跳过
      return { clusterID: self.clusterID, action: 'skip' };
    }
    const selfGrams = bigrams(String(self.title).slice(0, TITLE_SLICE));
    const candidates = this._coarseCandidates(self);
    let best = null;
    for (const cand of candidates) {
      const score = jaccard(selfGrams, bigrams(String(cand.title || '').slice(0, TITLE_SLICE)));
      if (score >= EVENT_THRESHOLD && (!best || score > best.score
        || (score === best.score && String(cand.id) < String(best.row.id)))) {
        best = { score, row: cand };
      }
    }
    if (!best) {
      this.counters.clustered += 1;
      return { clusterID: null, action: 'skip' }; // 独报：不建簇（首个命中者到来时一并建）
    }
    const clusterID = this._joinCluster(best.row.clusterID, self, best.row);
    this.counters.clustered += 1;
    return { clusterID, action: best.row.clusterID ? 'joined' : 'created' };
  }

  /**
   * 并簇：目标簇已存在 → 写 membership + 维护代表/计数；目标无簇（候选是独报）→
   * 新建簇，初始成员 = {新条目, 命中条目}，代表 = 发布较早者。返回簇 ID。
   */
  _joinCluster(existingClusterID, self, hit) {
    const db = this.store.database;
    const now = nowSeconds();
    if (existingClusterID) {
      // 两语句包单事务（批 A 审查 P2-1：语句间崩溃会留陈旧计数/代表）
      db.transaction(() => {
        db.prepare('UPDATE items SET cluster_id = ? WHERE id = ?').run(existingClusterID, self.id);
        db.prepare(`
          UPDATE event_clusters SET
            member_count = (SELECT COUNT(*) FROM items WHERE cluster_id = event_clusters.id),
            representative_item_id = (
              SELECT i.id FROM items i INNER JOIN articles a ON a.item_id = i.id
              WHERE i.cluster_id = event_clusters.id
              ORDER BY COALESCE(a.published_at, i.created_at) ASC, i.id ASC LIMIT 1
            ),
            title = (
              SELECT IFNULL(a.title, '') FROM items i INNER JOIN articles a ON a.item_id = i.id
              WHERE i.cluster_id = event_clusters.id
              ORDER BY COALESCE(a.published_at, i.created_at) ASC, i.id ASC LIMIT 1
            ),
            updated_at = ?
          WHERE id = ?
        `).run(now, existingClusterID);
      })();
      this.counters.joined += 1;
      return existingClusterID;
    }
    // 候选尚未成簇：新建（代表 = 发布较早成员）
    const clusterID = uuid();
    const repFirst = (Number(hit.publishedAt) || 0) <= (Number(self.publishedAt) || 0);
    const rep = repFirst ? hit : self;
    db.transaction(() => {
      db.prepare('INSERT INTO event_clusters (id, representative_item_id, title, member_count, created_at, updated_at) VALUES (?, ?, ?, 2, ?, ?)')
        .run(clusterID, rep.id, String(rep.title || '').slice(0, TITLE_SLICE), now, now);
      db.prepare('UPDATE items SET cluster_id = ? WHERE id IN (?, ?)').run(clusterID, self.id, hit.id);
    });
    this.counters.created += 1;
    return clusterID;
  }

  /**
   * 粗筛（SQL 级，禁全表逐篇 Jaccard）：近 7 天 AND（显著词 LIKE 标题 ∨ 同源），
   * 发布时间新者优先采样，截 EVENT_CANDIDATE_CAP。
   */
  _coarseCandidates(self) {
    const db = this.store.database;
    const keywords = extractKeywords(String(self.title || ''), EVENT_KEYWORD_POOL);
    const where = ['f.is_deleted = 0', 'i.id != ?',
      `COALESCE(a.published_at, i.created_at) >= ?`];
    const params = [self.id, this.now() - EVENT_WINDOW_DAYS * 86400];
    const ors = ['i.feed_id = ?'];
    params.push(self.feed_id);
    for (const kw of keywords) {
      const like = `%${kw.replace(/([%_\\])/g, '\\$1')}%`;
      ors.push(`IFNULL(a.title, '') LIKE ? ESCAPE '\\'`);
      params.push(like);
    }
    where.push(`(${ors.join(' OR ')})`);
    return db.prepare(`
      SELECT i.id AS id, i.cluster_id AS clusterID, IFNULL(a.title, '') AS title,
             COALESCE(a.published_at, i.created_at) AS publishedAt
      FROM items i
      INNER JOIN feeds f ON f.id = i.feed_id
      INNER JOIN articles a ON a.item_id = i.id
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(a.published_at, i.created_at) DESC, i.id DESC
      LIMIT ${EVENT_CANDIDATE_CAP}
    `).all(...params);
  }

  // MARK: 批量补跑（命令：对近窗口存量补聚类）

  /**
   * 对近 windowDays 天存量条目按发布时间升序补跑增量聚类（幂等：已有归属跳过）。
   * @returns {{ scanned, clustered, windowDays }}
   */
  rebuild({ windowDays = EVENT_WINDOW_DAYS } = {}) {
    const days = Math.max(1, Math.min(Number(windowDays) || EVENT_WINDOW_DAYS, 90));
    const rows = this.store.database.prepare(`
      SELECT i.id AS id
      FROM items i
      INNER JOIN feeds f ON f.id = i.feed_id
      INNER JOIN articles a ON a.item_id = i.id
      WHERE f.is_deleted = 0 AND COALESCE(a.published_at, i.created_at) >= ?
      ORDER BY COALESCE(a.published_at, i.created_at) ASC, i.id ASC
      LIMIT ${REBUILD_CAP}
    `).all(this.now() - days * 86400);
    const before = this.counters.created + this.counters.joined;
    for (const row of rows) {
      try { this.clusterEntry(row.id); } catch (_) { this.counters.errors += 1; }
    }
    return {
      scanned: rows.length,
      clustered: this.counters.created + this.counters.joined - before,
      windowDays: days,
    };
  }

  // MARK: 事件卡载荷（列表事件模式渲染面）

  /**
   * 簇摘要：代表条目 / 标题 / 成员数 / 去重源数 / 成员清单（发布升序，截 MEMBER_CAP）。
   * 顺带惰性回收实际成员 < 2 的死簇（条目删除后簇行残留）。未知 ID 静默忽略。
   */
  summaries(clusterIDs) {
    const ids = [...new Set((Array.isArray(clusterIDs) ? clusterIDs : [])
      .map((x) => String(x || '')).filter(Boolean))].slice(0, 200);
    if (!ids.length) return [];
    const db = this.store.database;
    const ph = ids.map(() => '?').join(',');
    // 惰性回收：真实成员 < 2 的簇（成员已随条目删除而流失）
    const dead = db.prepare(`
      SELECT c.id FROM event_clusters c
      WHERE c.id IN (${ph})
        AND (SELECT COUNT(*) FROM items WHERE cluster_id = c.id) < 2
    `).all(...ids).map((r) => r.id);
    if (dead.length) {
      const dph = dead.map(() => '?').join(',');
      db.transaction(() => {
        db.prepare(`UPDATE items SET cluster_id = NULL WHERE cluster_id IN (${dph})`).run(...dead);
        db.prepare(`DELETE FROM event_clusters WHERE id IN (${dph})`).run(...dead);
      });
      this.counters.pruned += dead.length;
    }
    const alive = ids.filter((id) => !dead.includes(id));
    if (!alive.length) return [];
    const aph = alive.map(() => '?').join(',');
    const clusters = new Map(db.prepare(`
      SELECT id, representative_item_id AS representativeItemID, title, member_count AS memberCount,
             created_at AS createdAt, updated_at AS updatedAt
      FROM event_clusters WHERE id IN (${aph})
    `).all(...alive).map((c) => [c.id, { ...c, sourceCount: 0, members: [] }]));
    const members = db.prepare(`
      SELECT i.cluster_id AS clusterID, i.id AS itemID,
             IFNULL(a.title, '') AS title, IFNULL(f.title, '') AS sourceTitle,
             COALESCE(a.published_at, i.created_at) AS publishedAt
      FROM items i
      INNER JOIN articles a ON a.item_id = i.id
      INNER JOIN feeds f ON f.id = i.feed_id
      WHERE i.cluster_id IN (${aph})
      ORDER BY COALESCE(a.published_at, i.created_at) ASC, i.id ASC
    `).all(...alive);
    const sources = new Map(); // clusterID -> Set(sourceTitle)
    for (const m of members) {
      const c = clusters.get(m.clusterID);
      if (!c) continue;
      if (c.members.length < MEMBER_CAP) c.members.push({
        itemID: m.itemID, title: m.title, sourceTitle: m.sourceTitle, publishedAt: m.publishedAt,
      });
      if (!sources.has(m.clusterID)) sources.set(m.clusterID, new Set());
      sources.get(m.clusterID).add(m.sourceTitle || m.itemID);
    }
    for (const [id, c] of clusters) c.sourceCount = sources.get(id)?.size || 0;
    return alive.map((id) => clusters.get(id)).filter(Boolean);
  }

  /** 事件簇总数（侧栏/诊断用；已回收死簇不计）。 */
  stats() {
    const row = this.store.database.prepare(`
      SELECT COUNT(*) AS clusters,
        COALESCE(SUM((SELECT COUNT(*) FROM items WHERE cluster_id = event_clusters.id)), 0) AS members
      FROM event_clusters
    `).get();
    return { ...this.counters, clusters: Number(row?.clusters || 0), members: Number(row?.members || 0),
      threshold: EVENT_THRESHOLD, windowDays: EVENT_WINDOW_DAYS, candidateCap: EVENT_CANDIDATE_CAP,
      pending: this._pending.size };
  }

  dispose() {
    if (this._drainTimer) {
      clearTimeout(this._drainTimer);
      this._drainTimer = null;
    }
    this._pending.clear();
  }
}

/** 阈值边界（探针直测）：标题对是否达并簇线。 */
function meetsThreshold(titleA, titleB, threshold = EVENT_THRESHOLD) {
  return jaccard(bigrams(String(titleA || '')), bigrams(String(titleB || ''))) >= threshold;
}

module.exports = {
  EventClusterService,
  meetsThreshold,
  LIMITS: {
    EVENT_THRESHOLD, EVENT_WINDOW_DAYS, EVENT_CANDIDATE_CAP, MEMBER_CAP, REBUILD_CAP,
  },
};
