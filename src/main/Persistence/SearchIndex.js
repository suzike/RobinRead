'use strict';
/**
 * RobinRead（知更）— FTS5 全文索引
 *
 * articles_fts 虚表（trigram 分词）索引 title/author/summary/正文缓存，
 * 支撑全文搜索的即时返回（原先四路 LIKE 全库扫描）。trigram 最小词元为
 * 3 个字符：<3 字符的查询（常见中文双字词）由搜索层回退 LIKE 路径。
 * 建表在 DatabaseMigrations 的 v4-articles-fts 中完成（FTS5 不可用时静默
 * 跳过，本模块的可用性探测会返回 false，写入与搜索全部退化为无操作/LIKE）。
 */
const availability = new WeakMap();

/** FTS 表是否存在（按 db 实例记忆；v4 迁移建表后整个进程生命周期内稳定）。 */
function ftsAvailable(db) {
  if (availability.has(db)) return availability.get(db);
  let ok = false;
  try {
    ok = !!db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='articles_fts'"
    ).get();
  } catch (_) { ok = false; }
  availability.set(db, ok);
  return ok;
}

/**
 * 元数据（标题/作者/摘要）变更后重建该条目索引行。正文取值优先级：
 * 已索引正文（缓存提取稿，由 syncCacheText 维护）> fallbackBody（RSS
 * content_html 的纯文本，尚未抓取全文缓存的条目靠它支撑正文搜索）。
 */
function syncEntry(db, itemID, title, author, summary, fallbackBody = null) {
  if (!ftsAvailable(db)) return;
  try {
    const prev = db.prepare('SELECT body FROM articles_fts WHERE item_id = ?').get(itemID);
    const body = (prev && prev.body) ? prev.body : (fallbackBody || '');
    db.prepare('DELETE FROM articles_fts WHERE item_id = ?').run(itemID);
    db.prepare(
      'INSERT INTO articles_fts (item_id, title, author, summary, body) VALUES (?, ?, ?, ?, ?)'
    ).run(itemID, title || '', author || '', summary || '', body);
  } catch (_) { /* 索引失败不影响主流程（搜索有 LIKE 回退） */ }
}

/** 正文缓存写入后更新索引行（行不存在时以空元数据先建，稍后 syncEntry 补全）。 */
function syncCacheText(db, itemID, text) {
  if (!ftsAvailable(db)) return;
  try {
    const prev = db.prepare('SELECT item_id FROM articles_fts WHERE item_id = ?').get(itemID);
    if (prev) {
      db.prepare('UPDATE articles_fts SET body = ? WHERE item_id = ?').run(text || '', itemID);
    } else {
      db.prepare(
        'INSERT INTO articles_fts (item_id, title, author, summary, body) VALUES (?, ?, ?, ?, ?)'
      ).run(itemID, '', '', '', text || '');
    }
  } catch (_) { /* 同上 */ }
}

/** 条目索引行删除（缓存清空时传空文本保留标题可搜，条目删除时整行移除）。 */
function removeItem(db, itemID) {
  if (!ftsAvailable(db)) return;
  try {
    db.prepare('DELETE FROM articles_fts WHERE item_id = ?').run(itemID);
  } catch (_) { /* 同上 */ }
}

/** 孤儿行清理（条目删除路径分散在级联/多处，由每日数据管家统一兜底）。 */
function sweepOrphans(db) {
  if (!ftsAvailable(db)) return 0;
  try {
    return db.prepare(
      'DELETE FROM articles_fts WHERE item_id NOT IN (SELECT item_id FROM articles)'
    ).run().changes;
  } catch (_) { return 0; }
}

module.exports = { ftsAvailable, syncEntry, syncCacheText, removeItem, sweepOrphans };
