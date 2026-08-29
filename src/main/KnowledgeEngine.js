'use strict';
/**
 * RobinRead Windows — 知识引擎
 * 知识管理与生长系统（高亮/笔记/复习/标签/统计/收藏集/智能文件夹/连接/导出）
 */
const { plainText } = require('./Models');
const { LLMService } = require('./LLMService');

class KnowledgeEngine {
  constructor(store) {
    this.store = store;
    this.llm = new LLMService();
    this._ensureTables();
  }

  _ensureTables() {
    this.store.database.exec(`
      CREATE TABLE IF NOT EXISTS highlights (
        id TEXT PRIMARY KEY NOT NULL, item_id TEXT NOT NULL, text TEXT NOT NULL,
        color TEXT DEFAULT 'yellow', note TEXT, paragraph_id TEXT,
        start_offset INTEGER, end_offset INTEGER, created_at REAL NOT NULL,
        FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY NOT NULL, item_id TEXT NOT NULL, content TEXT NOT NULL,
        tags TEXT, linked_notes TEXT, created_at REAL NOT NULL, updated_at REAL NOT NULL,
        FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS review_queue (
        id TEXT PRIMARY KEY NOT NULL, item_id TEXT NOT NULL, highlight_id TEXT,
        ease_factor REAL DEFAULT 2.5, interval_days INTEGER DEFAULT 1, repetitions INTEGER DEFAULT 0,
        next_review_at REAL NOT NULL, last_reviewed_at REAL,
        FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS smart_folders (
        id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, query TEXT NOT NULL,
        filters TEXT, sort_by TEXT DEFAULT 'date', created_at REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS article_tags (
        item_id TEXT NOT NULL, tag TEXT NOT NULL, source TEXT DEFAULT 'auto',
        PRIMARY KEY(item_id, tag), FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS reading_stats (
        date TEXT PRIMARY KEY NOT NULL, articles_read INTEGER DEFAULT 0,
        articles_starred INTEGER DEFAULT 0, highlights_made INTEGER DEFAULT 0,
        notes_created INTEGER DEFAULT 0, ai_summaries_generated INTEGER DEFAULT 0,
        reading_time_minutes REAL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, description TEXT, created_at REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS collection_items (
        collection_id TEXT NOT NULL, item_id TEXT NOT NULL, added_at REAL NOT NULL,
        PRIMARY KEY(collection_id, item_id),
        FOREIGN KEY(collection_id) REFERENCES collections(id) ON DELETE CASCADE,
        FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS ai_quality_scores (
        item_id TEXT PRIMARY KEY NOT NULL, rule_score INTEGER, ai_score REAL,
        ai_reasoning TEXT, ai_keywords TEXT, ai_reading_level TEXT,
        is_technical INTEGER DEFAULT 0, scored_at REAL NOT NULL,
        FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
      );
    `);
    // 2026-08 批注锚点升级：高亮/笔记带重锚定上下文（prefix/suffix/quote），
    // 正文重渲染（翻译包裹/原文重排/换 contentHash）后仍可精确定位
    this._addColumnIfMissing('highlights', 'anchor', 'TEXT');
    this._addColumnIfMissing('notes', 'anchor', 'TEXT');
  }

  /** 幂等加列（旧库升级）。 */
  _addColumnIfMissing(table, column, type) {
    const cols = this.store.database.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === column)) {
      this.store.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }

  // MARK: - 高亮

  addHighlight({ itemID, text, color = 'yellow', note = null, paragraphID = null, startOffset = null, endOffset = null, anchor = null }) {
    const id = `hl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.store.database.prepare(
      'INSERT INTO highlights (id, item_id, text, color, note, paragraph_id, start_offset, end_offset, anchor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, itemID, text, color, note, paragraphID, startOffset, endOffset, anchor ? JSON.stringify(anchor) : null, Date.now() / 1000);
    this._bumpStat('highlights_made');
    this._recordAction(itemID, 'highlight');
    return this.getHighlight(id);
  }

  /** 记录知识动作到自进化引擎（喂给兴趣画像），失败静默。 */
  _recordAction(itemID, action) {
    try {
      const entry = this.store.articlesRepo.entry(itemID);
      this.store.evolution.recordBehavior({ itemID, feedID: entry?.feedID ?? null, action });
    } catch (_) { /* 忽略 */ }
  }
  _parseAnchor(raw) {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  }
  getHighlight(id) {
    const r = this.store.database.prepare('SELECT * FROM highlights WHERE id = ?').get(id);
    return r ? { id: r.id, itemID: r.item_id, text: r.text, color: r.color, note: r.note, paragraphID: r.paragraph_id, startOffset: r.start_offset, endOffset: r.end_offset, anchor: this._parseAnchor(r.anchor), createdAt: r.created_at } : null;
  }
  getHighlights(itemID) {
    return this.store.database.prepare('SELECT * FROM highlights WHERE item_id = ? ORDER BY created_at ASC').all(itemID)
      .map((r) => ({ id: r.id, itemID: r.item_id, text: r.text, color: r.color, note: r.note, paragraphID: r.paragraph_id, anchor: this._parseAnchor(r.anchor), createdAt: r.created_at }));
  }
  getAllHighlights(limit = 100) {
    return this.store.database.prepare(`
      SELECT h.id, h.item_id, h.text, h.color, h.note, h.created_at,
             a.title as article_title
      FROM highlights h LEFT JOIN articles a ON a.item_id = h.item_id
      ORDER BY h.created_at DESC LIMIT ?
    `).all(limit).map((r) => ({ id: r.id, itemID: r.item_id, text: r.text, color: r.color, note: r.note, articleTitle: r.article_title, createdAt: r.created_at }));
  }
  removeHighlight(id) { this.store.database.prepare('DELETE FROM highlights WHERE id = ?').run(id); }
  updateHighlight(id, { color, note }) {
    if (color !== undefined) this.store.database.prepare('UPDATE highlights SET color = ? WHERE id = ?').run(color, id);
    if (note !== undefined) this.store.database.prepare('UPDATE highlights SET note = ? WHERE id = ?').run(note, id);
    return this.getHighlight(id);
  }

  // MARK: - 笔记
  addNote({ itemID, content, tags = [], anchor = null }) {
    const id = `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now() / 1000;
    this.store.database.prepare('INSERT INTO notes (id, item_id, content, tags, linked_notes, anchor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, itemID, content, JSON.stringify(tags), '[]', anchor ? JSON.stringify(anchor) : null, now, now);
    this._bumpStat('notes_created');
    this._recordAction(itemID, 'note');
    return this.getNote(id);
  }
  getNote(id) {
    const r = this.store.database.prepare('SELECT * FROM notes WHERE id = ?').get(id);
    return r ? this._rowToNote(r) : null;
  }
  getNotes(itemID) {
    return this.store.database.prepare('SELECT * FROM notes WHERE item_id = ? ORDER BY updated_at DESC').all(itemID).map((r) => this._rowToNote(r));
  }
  getAllNotes(limit = 200) {
    return this.store.database.prepare(`
      SELECT n.id, n.item_id, n.content, n.tags, n.created_at, n.updated_at,
             a.title as article_title
      FROM notes n LEFT JOIN articles a ON a.item_id = n.item_id
      ORDER BY n.updated_at DESC LIMIT ?
    `).all(limit).map((r) => this._rowToNote(r));
  }
  updateNote(id, { content, tags }) {
    if (content !== undefined) this.store.database.prepare('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?').run(content, Date.now() / 1000, id);
    if (tags !== undefined) this.store.database.prepare('UPDATE notes SET tags = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(tags), Date.now() / 1000, id);
    return this.getNote(id);
  }
  deleteNote(id) { this.store.database.prepare('DELETE FROM notes WHERE id = ?').run(id); }
  _rowToNote(r) {
    let tags = []; try { tags = JSON.parse(r.tags || '[]'); } catch (_) {}
    return { id: r.id, itemID: r.item_id, content: r.content, tags, anchor: this._parseAnchor(r.anchor), articleTitle: r.article_title, createdAt: r.created_at, updatedAt: r.updated_at };
  }

  // MARK: - 间隔复习
  addToReview({ itemID, highlightID = null }) {
    const id = `rev-${Date.now()}`;
    this.store.database.prepare('INSERT OR REPLACE INTO review_queue (id, item_id, highlight_id, next_review_at) VALUES (?, ?, ?, ?)')
      .run(id, itemID, highlightID, Date.now() / 1000 + 86400);
    this._recordAction(itemID, 'review');
    return id;
  }
  getDueReviews() {
    return this.store.database.prepare(`
      SELECT rq.id, rq.item_id, rq.highlight_id, rq.repetitions, rq.interval_days, rq.ease_factor, rq.next_review_at,
             a.title as article_title, h.text as highlight_text
      FROM review_queue rq
      LEFT JOIN articles a ON a.item_id = rq.item_id
      LEFT JOIN highlights h ON h.id = rq.highlight_id
      WHERE rq.next_review_at <= ? ORDER BY rq.next_review_at ASC LIMIT 50
    `).all(Date.now() / 1000).map((r) => ({ id: r.id, itemID: r.item_id, articleTitle: r.article_title, highlightText: r.highlight_text, repetitions: r.repetitions, intervalDays: r.interval_days, easeFactor: r.ease_factor }));
  }
  reviewCard(id, quality) {
    const r = this.store.database.prepare('SELECT * FROM review_queue WHERE id = ?').get(id);
    if (!r) return;
    let ef = r.ease_factor, iv = r.interval_days, rep = r.repetitions;
    if (quality >= 3) { rep += 1; iv = rep <= 1 ? 1 : rep === 2 ? 3 : Math.round(iv * ef); }
    else { rep = 0; iv = 1; }
    ef = Math.max(1.3, ef + (0.1 - (5 - quality) * 0.08));
    this.store.database.prepare('UPDATE review_queue SET ease_factor=?, interval_days=?, repetitions=?, next_review_at=?, last_reviewed_at=? WHERE id=?')
      .run(ef, iv, rep, Date.now() / 1000 + iv * 86400, Date.now() / 1000, id);
  }
  removeFromReview(id) { this.store.database.prepare('DELETE FROM review_queue WHERE id = ?').run(id); }

  // MARK: - 智能文件夹
  createSmartFolder(name, query) {
    const id = `sf-${Date.now()}`;
    this.store.database.prepare('INSERT INTO smart_folders (id, name, query, created_at) VALUES (?, ?, ?, ?)').run(id, name, query, Date.now() / 1000);
    return { id, name, query };
  }
  listSmartFolders() { return this.store.database.prepare('SELECT * FROM smart_folders ORDER BY created_at DESC').all(); }
  deleteSmartFolder(id) { this.store.database.prepare('DELETE FROM smart_folders WHERE id = ?').run(id); }

  // MARK: - 标签
  getTags(limit = 100) { return this.store.database.prepare('SELECT tag, COUNT(*) as count FROM article_tags GROUP BY tag ORDER BY count DESC LIMIT ?').all(limit); }
  getItemTags(itemID) { return this.store.database.prepare('SELECT tag, source FROM article_tags WHERE item_id = ?').all(itemID); }

  /** 按标签取关联文章（真实的 article_tags 关系查询，非全文搜索）。 */
  entriesForTag(tag, limit = 30) {
    return this.store.database.prepare(`
      SELECT i.id, a.title, f.title AS feed_title FROM article_tags at
      INNER JOIN items i ON i.id = at.item_id
      LEFT JOIN articles a ON a.item_id = i.id
      LEFT JOIN feeds f ON f.id = i.feed_id
      WHERE at.tag = ?
      ORDER BY COALESCE(a.published_at, i.created_at) DESC
      LIMIT ?
    `).all(String(tag), Number(limit) || 30);
  }
  addManualTag(itemID, tag) { this.store.database.prepare('INSERT OR IGNORE INTO article_tags (item_id, tag, source) VALUES (?, ?, ?)').run(itemID, tag, 'manual'); }
  removeTag(itemID, tag) { this.store.database.prepare('DELETE FROM article_tags WHERE item_id = ? AND tag = ? AND source = ?').run(itemID, tag, 'manual'); }
  addAutoTag(itemID, tag) { this.store.database.prepare('INSERT OR IGNORE INTO article_tags (item_id, tag, source) VALUES (?, ?, ?)').run(itemID, tag, 'ai'); }

  /** 技术词库：从标题/摘要匹配高频技术主题（零 LLM 成本，喂给兴趣画像）。 */
  static TECH_TERMS = [
    ['LLM', /llm|大模型|大语言模型|language model/i],
    ['Agent', /agent|智能体|多智能体|multi.?agent/i],
    ['机器学习', /machine learning|机器学习|ml\b/i],
    ['深度学习', /deep learning|深度学习/i],
    ['RAG', /rag|retrieval.?augmented|检索增强/i],
    ['Transformer', /transformer|注意力机制/i],
    ['RLHF', /rlhf|强化学习|reinforcement learning/i],
    ['推理', /reasoning|推理|思维链|chain.?of.?thought/i],
    ['多模态', /multimodal|多模态|视觉语言/i],
    ['向量数据库', /vector database|向量数据库|embedding|向量/i],
    ['微调', /fine.?tuning|微调|lora/i],
    ['开源', /open.?source|开源/i],
    ['Python', /python/i],
    ['Rust', /rust\b|rust语言/i],
    ['TypeScript', /typescript|ts\b/i],
    ['JavaScript', /javascript|js\b/i],
    ['前端', /frontend|前端|react|vue|css/i],
    ['后端', /backend|后端|server|api/i],
    ['数据库', /database|数据库|postgres|mysql|sql/i],
    ['系统设计', /system design|系统设计|分布式/i],
    ['云原生', /cloud native|云原生|kubernetes|k8s|docker/i],
    ['安全', /security|安全|漏洞|vulnerability|cve/i],
    ['芯片', /chip|芯片|gpu|nvidia|半导体|semiconductor/i],
    ['数学', /math|数学|线性代数|概率/i],
    ['Simulink', /simulink/i],
    ['MATLAB', /matlab/i],
    ['创业', /startup|创业|融资|funding/i],
    ['产品', /product|产品|pm\b/i],
    ['工具', /tool|工具|cli|效率/i],
    ['方法论', /methodology|方法论|framework|思维模型/i],
  ];

  /** 给单篇文章打自动标签（source=ai），返回命中的标签列表。 */
  autoTagEntry(itemID, title = '', summary = '') {
    const haystack = `${title} ${summary}`;
    const hit = [];
    for (const [tag, re] of KnowledgeEngine.TECH_TERMS) {
      if (re.test(haystack)) {
        this.addAutoTag(itemID, tag);
        hit.push(tag);
        if (hit.length >= 6) break;
      }
    }
    return hit;
  }

  // MARK: - 收藏集
  createCollection(name, desc = '') {
    const id = `col-${Date.now()}`;
    this.store.database.prepare('INSERT INTO collections (id, name, description, created_at) VALUES (?, ?, ?, ?)').run(id, name, desc, Date.now() / 1000);
    return { id, name, description: desc };
  }
  updateCollection(id, { name, description }) {
    if (name !== undefined) this.store.database.prepare('UPDATE collections SET name = ? WHERE id = ?').run(name, id);
    if (description !== undefined) this.store.database.prepare('UPDATE collections SET description = ? WHERE id = ?').run(description, id);
    return this.listCollections().find((c) => c.id === id) || null;
  }
  listCollections() {
    return this.store.database.prepare('SELECT c.*, COUNT(ci.item_id) as item_count FROM collections c LEFT JOIN collection_items ci ON ci.collection_id = c.id GROUP BY c.id ORDER BY c.created_at DESC').all();
  }
  addToCollection(colID, itemID) { this.store.database.prepare('INSERT OR IGNORE INTO collection_items (collection_id, item_id, added_at) VALUES (?, ?, ?)').run(colID, itemID, Date.now() / 1000); }
  removeFromCollection(colID, itemID) { this.store.database.prepare('DELETE FROM collection_items WHERE collection_id = ? AND item_id = ?').run(colID, itemID); }
  getCollectionItems(colID) {
    return this.store.database.prepare(`
      SELECT i.id, a.title, a.summary, a.url, f.title as feed_title
      FROM collection_items ci INNER JOIN items i ON i.id = ci.item_id
      LEFT JOIN articles a ON a.item_id = i.id INNER JOIN feeds f ON f.id = i.feed_id
      WHERE ci.collection_id = ? ORDER BY ci.added_at DESC
    `).all(colID);
  }
  deleteCollection(id) {
    this.store.database.prepare('DELETE FROM collection_items WHERE collection_id = ?').run(id);
    this.store.database.prepare('DELETE FROM collections WHERE id = ?').run(id);
  }

  // MARK: - 统计
  _bumpStat(field) {
    const today = new Date().toISOString().slice(0, 10);
    this.store.database.prepare(`INSERT INTO reading_stats (date, ${field}) VALUES (?, 1) ON CONFLICT(date) DO UPDATE SET ${field} = ${field} + 1`).run(today);
  }
  bumpRead() { this._bumpStat('articles_read'); }
  bumpStarred() { this._bumpStat('articles_starred'); }
  bumpAISummary() { this._bumpStat('ai_summaries_generated'); }
  getStats(days = 30) {
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const daily = this.store.database.prepare('SELECT * FROM reading_stats WHERE date >= ? ORDER BY date').all(since);
    const totals = this.store.database.prepare('SELECT SUM(articles_read) as read, SUM(highlights_made) as highlights, SUM(notes_created) as notes, SUM(ai_summaries_generated) as ai FROM reading_stats WHERE date >= ?').get(since);
    let streak = 0;
    for (let i = daily.length - 1; i >= 0; i--) { if (daily[i].articles_read > 0 || daily[i].highlights_made > 0) streak++; else break; }
    return { daily, totals, streak };
  }

  // MARK: - 知识连接
  findRelated(itemID, limit = 5) {
    const tags = this.getItemTags(itemID).map((t) => t.tag);
    if (!tags.length) return [];
    const ph = tags.map(() => '?').join(',');
    return this.store.database.prepare(`
      SELECT DISTINCT i.id, a.title, f.title as feed_title FROM article_tags at
      INNER JOIN items i ON i.id = at.item_id LEFT JOIN articles a ON a.item_id = i.id
      INNER JOIN feeds f ON f.id = i.feed_id
      WHERE at.tag IN (${ph}) AND i.id != ? LIMIT ?
    `).all(...tags, itemID, limit);
  }

  // MARK: - 导出
  exportToMarkdown(itemID) {
    const e = this.store.articlesRepo.entry(itemID);
    if (!e) return null;
    const hls = this.getHighlights(itemID);
    const notes = this.getNotes(itemID);
    const tags = this.getItemTags(itemID);
    const feed = this.store.feed(e.feedID);
    let md = `---\ntitle: "${e.title}"\nsource: "${feed?.title || ''}"\nurl: "${e.url || ''}"\ntags: [${tags.map((t) => `"${t.tag}"`).join(',')}]\n---\n\n# ${e.title}\n\n`;
    if (hls.length) { md += '## Highlights\n\n'; for (const h of hls) { md += `> ${h.text}\n${h.note ? `\n**Note:** ${h.note}\n` : ''}\n`; } }
    if (notes.length) { md += '## Notes\n\n'; for (const n of notes) md += `${n.content}\n\n`; }
    md += `## Content\n\n${plainText(e.contentHTML || e.summary || '')}\n`;
    return md;
  }
  exportAllNotes() {
    const notes = this.getAllNotes(500);
    let md = `# RobinRead 知识库导出\n\n导出时间：${new Date().toLocaleString('zh-CN')}\n总计：${notes.length} 条\n\n---\n\n`;
    for (const n of notes) { const e = this.store.articlesRepo.entry(n.itemID); md += `## ${e?.title || n.itemID}\n\n${n.content}\n\n---\n\n`; }
    return md;
  }

  // MARK: - 双向链接（Zettelkasten 风格 [[链接]]）

  /** 解析笔记中的 [[链接]] 目标（笔记标题 / 笔记 id / 文章标题）。 */
  _extractWikiLinks(content) {
    const links = [];
    const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    let m;
    while ((m = re.exec(String(content || ''))) !== null) {
      links.push({ target: (m[1] || '').trim(), alias: (m[2] || '').trim() });
    }
    return links;
  }

  /** 更新笔记的双向链接索引（linked_notes 存 JSON）。 */
  refreshNoteLinks(noteID) {
    const note = this.getNote(noteID);
    if (!note) return [];
    const links = this._extractWikiLinks(note.content);
    const resolved = links.map((l) => ({ ...l, resolved: false, noteID: null, itemID: null }));
    // 解析到已有笔记（按标题）
    const allNotes = this.getAllNotes(1000);
    for (const link of resolved) {
      const target = allNotes.find((n) => n.id !== noteID && (n.content.includes(link.target) || link.target === n.id));
      if (target) { link.resolved = true; link.noteID = target.id; link.itemID = target.itemID; }
    }
    this.store.database.prepare('UPDATE notes SET linked_notes = ? WHERE id = ?').run(JSON.stringify(resolved), noteID);
    return resolved;
  }

  /** 反向链接：哪些笔记链接到了目标笔记/文章。 */
  backlinks(targetNoteID) {
    const all = this.getAllNotes(1000);
    const out = [];
    for (const n of all) {
      let parsed = [];
      try { parsed = JSON.parse(n.linked_notes || '[]'); } catch (_) {}
      for (const l of parsed) {
        if (l.noteID === targetNoteID || l.itemID === targetNoteID) {
          out.push({ fromNoteID: n.id, fromContent: n.content.slice(0, 80), itemID: n.itemID });
        }
      }
    }
    return out;
  }

  // MARK: - 每日回顾

  /** 聚合某日（默认今天）的高亮与笔记，生成回顾。 */
  dailyReview(dateStr = null) {
    const day = dateStr || new Date().toISOString().slice(0, 10);
    const start = Date.parse(day + 'T00:00:00Z') / 1000;
    const end = start + 86400;
    const highlights = this.store.database.prepare(`
      SELECT h.*, a.title as article_title FROM highlights h
      LEFT JOIN articles a ON a.item_id = h.item_id
      WHERE h.created_at >= ? AND h.created_at < ? ORDER BY h.created_at
    `).all(start, end);
    const notes = this.store.database.prepare(`
      SELECT n.*, a.title as article_title FROM notes n
      LEFT JOIN articles a ON a.item_id = n.item_id
      WHERE n.created_at >= ? AND n.created_at < ? ORDER BY n.created_at
    `).all(start, end);
    return { date: day, highlights, notes, total: highlights.length + notes.length };
  }

  // MARK: - Anki 导出

  /** 将复习队列导出为 Anki 可导入的 TSV（制表符分隔：正面\t背面）。 */
  exportAnki() {
    const queue = this.store.database.prepare(`
      SELECT rq.id, rq.item_id, rq.highlight_id, rq.repetitions, rq.interval_days,
             a.title as article_title, h.text as highlight_text
      FROM review_queue rq
      LEFT JOIN articles a ON a.item_id = rq.item_id
      LEFT JOIN highlights h ON h.id = rq.highlight_id
      ORDER BY rq.next_review_at
    `).all();
    const lines = [];
    for (const q of queue) {
      const front = q.highlight_text || q.article_title || q.item_id;
      const back = q.article_title || '';
      lines.push(`${String(front).replace(/\t/g, ' ')}\t${String(back).replace(/\t/g, ' ')}`);
    }
    return lines.join('\n');
  }

  // MARK: - 笔记全文搜索

  /** 在高亮与笔记内容里做关键词搜索（FTS-less，LIKE 实现，够用且零依赖）。 */
  searchKnowledge(query, { limit = 50 } = {}) {
    const q = String(query || '').trim();
    if (!q) return { highlights: [], notes: [] };
    const like = `%${q.replace(/[%_]/g, (c) => '\\' + c)}%`;
    const notes = this.store.database.prepare(`
      SELECT n.*, a.title as article_title FROM notes n
      LEFT JOIN articles a ON a.item_id = n.item_id
      WHERE n.content LIKE ? ESCAPE '\\' ORDER BY n.updated_at DESC LIMIT ?
    `).all(like, limit).map((r) => this._rowToNote(r));
    const highlights = this.store.database.prepare(`
      SELECT h.*, a.title as article_title FROM highlights h
      LEFT JOIN articles a ON a.item_id = h.item_id
      WHERE h.text LIKE ? ESCAPE '\\' OR h.note LIKE ? ESCAPE '\\'
      ORDER BY h.created_at DESC LIMIT ?
    `).all(like, like, limit).map((r) => ({ id: r.id, itemID: r.item_id, text: r.text, note: r.note, articleTitle: r.article_title, createdAt: r.created_at }));
    return { highlights, notes, total: highlights.length + notes.length };
  }

  // MARK: - 阅读热力图

  /** 最近 N 天每日活跃度（供日历热力图渲染）。 */
  readingHeatmap(days = 90) {
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const rows = this.store.database.prepare('SELECT * FROM reading_stats WHERE date >= ? ORDER BY date').all(since);
    const map = new Map();
    for (const r of rows) {
      map.set(r.date, {
        read: r.articles_read || 0,
        highlights: r.highlights_made || 0,
        notes: r.notes_created || 0,
        ai: r.ai_summaries_generated || 0,
        intensity: (r.articles_read || 0) + (r.highlights_made || 0) * 2 + (r.notes_created || 0) * 2 + (r.ai_summaries_generated || 0),
      });
    }
    return { days, map: Object.fromEntries(map) };
  }

  // MARK: - 知识看板

  /** 一屏总览：各类知识资产计数 + 近期活跃。 */
  dashboard() {
    const hl = this.store.database.prepare('SELECT COUNT(*) as n FROM highlights').get().n;
    const notes = this.store.database.prepare('SELECT COUNT(*) as n FROM notes').get().n;
    const review = this.store.database.prepare('SELECT COUNT(*) as n FROM review_queue').get().n;
    const due = this.store.database.prepare('SELECT COUNT(*) as n FROM review_queue WHERE next_review_at <= ?').get(Date.now() / 1000).n;
    const collections = this.store.database.prepare('SELECT COUNT(*) as n FROM collections').get().n;
    const tags = this.store.database.prepare('SELECT COUNT(DISTINCT tag) as n FROM article_tags').get().n;
    const streak = this.getStats(365).streak || 0;
    return { highlights: hl, notes, review, due, collections, tags, streak };
  }

  // MARK: - 多格式导出

  exportJSON() {
    const notes = this.getAllNotes(1000);
    const highlights = this.getAllHighlights(2000);
    return JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      noteCount: notes.length,
      highlightCount: highlights.length,
      notes,
      highlights,
    }, null, 2);
  }

  exportHTML() {
    const notes = this.getAllNotes(500);
    const highlights = this.getAllHighlights(500);
    const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let html = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>RobinRead 知识库导出</title>
      <style>body{font-family:system-ui,sans-serif;max-width:760px;margin:0 auto;padding:32px;line-height:1.7;color:#222}
      h1{font-size:1.6em} h2{font-size:1.25em;margin-top:2em;border-bottom:1px solid #ddd;padding-bottom:.3em}
      .hl{border-left:3px solid #617357;padding:6px 12px;margin:8px 0;background:#f6f2e7}
      .note{margin:8px 0;padding:8px 12px;background:#faf8f2;border-radius:6px}
      .src{color:#888;font-size:.85em}</style></head><body><h1>RobinRead 知识库导出</h1>
      <p>导出时间：${esc(new Date().toLocaleString('zh-CN'))} · 笔记 ${notes.length} 条 · 高亮 ${highlights.length} 条</p>`;
    if (notes.length) {
      html += '<h2>笔记</h2>';
      for (const n of notes) html += `<div class="note"><div class="src">${esc(n.articleTitle || '')}</div>${esc(n.content)}</div>`;
    }
    if (highlights.length) {
      html += '<h2>高亮</h2>';
      for (const h of highlights) html += `<div class="hl"><div class="src">${esc(h.articleTitle || '')}</div>${esc(h.text)}${h.note ? `<br><em>${esc(h.note)}</em>` : ''}</div>`;
    }
    html += '</body></html>';
    return html;
  }
}

module.exports = { KnowledgeEngine };
