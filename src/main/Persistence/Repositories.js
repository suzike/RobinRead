'use strict';
/**
 * RobinRead（知更）— 数据仓库层
 *
 * AccountRepository / FeedRepository / ArticleRepository /
 * ArticleStateRepository / CacheRepository / AIArtifactRepository
 */
const { uuid, nowSeconds } = require('../Models');

function feedRowToFeed(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountID: row.account_id,
    externalID: row.external_id ?? null,
    title: row.title,
    siteURL: row.site_url ?? null,
    feedURL: row.feed_url,
    etag: row.etag ?? null,
    lastModified: row.last_modified ?? null,
    lastRefreshedAt: row.last_refreshed_at ?? null,
    isDeleted: Number(row.is_deleted) === 1,
    updatedAt: row.updated_at,
    storedIconURL: row.stored_icon_url ?? null,
    sortOrder: row.sort_order ?? 0,
  };
}

function entryRowToEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountID: row.account_id,
    externalID: row.external_id,
    feedID: row.feed_id,
    title: row.title ?? '',
    author: row.author ?? null,
    url: row.url ?? null,
    publishedAt: row.published_at ?? null,
    summary: row.summary ?? '',
    contentHTML: row.content_html ?? null,
    isRead: Number(row.is_read ?? 0) === 1,
    isStarred: Number(row.is_starred ?? 0) === 1,
    updatedAt: row.updated_at,
    dateArrived: row.date_arrived ?? row.created_at,
  };
}

class AccountRepository {
  constructor(db) { this.db = db; }

  ensureLocalAccount() {
    const existing = this.db.prepare("SELECT * FROM accounts WHERE id = 'local-default'").get();
    if (existing) return accountRowToAccount(existing);
    const now = nowSeconds();
    this.db.prepare(`
      INSERT INTO accounts (id, type, display_name, endpoint_url, username, is_enabled, created_at, updated_at)
      VALUES ('local-default', 'local', ?, NULL, NULL, 1, ?, ?)
    `).run('本机', now, now);
    return accountRowToAccount(this.db.prepare("SELECT * FROM accounts WHERE id = 'local-default'").get());
  }

  listAccounts() {
    return this.db.prepare('SELECT * FROM accounts ORDER BY created_at ASC').all().map(accountRowToAccount);
  }

  enabledAccounts() {
    return this.db.prepare('SELECT * FROM accounts WHERE is_enabled = 1 ORDER BY created_at ASC').all().map(accountRowToAccount);
  }

  account(accountID) {
    return accountRowToAccount(this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountID));
  }

  insertFreshRSSAccount({ displayName, endpointURL, username }) {
    const id = `freshrss-${uuid()}`;
    const now = nowSeconds();
    this.db.prepare(`
      INSERT INTO accounts (id, type, display_name, endpoint_url, username, is_enabled, created_at, updated_at)
      VALUES (?, 'freshRSS', ?, ?, ?, 1, ?, ?)
    `).run(id, displayName || 'FreshRSS', endpointURL, username, now, now);
    return this.account(id);
  }

  setEnabled(accountID, isEnabled) {
    this.db.prepare('UPDATE accounts SET is_enabled = ?, updated_at = ? WHERE id = ?')
      .run(isEnabled ? 1 : 0, nowSeconds(), accountID);
  }

  deleteAccount(accountID) {
    this.db.prepare('DELETE FROM accounts WHERE id = ?').run(accountID);
  }

  getSyncState(accountID) {
    const row = this.db.prepare('SELECT * FROM account_sync_state WHERE account_id = ?').get(accountID);
    if (!row) {
      return {
        accountID,
        initialSyncCompleted: false,
        lastSyncStartedAt: null,
        lastSyncCompletedAt: null,
        lastFullReconcileAt: null,
        lastArticleFetchAt: null,
        consecutiveFailureCount: 0,
        lastError: null,
      };
    }
    return {
      accountID: row.account_id,
      initialSyncCompleted: Number(row.initial_sync_completed) === 1,
      lastSyncStartedAt: row.last_sync_started_at,
      lastSyncCompletedAt: row.last_sync_completed_at,
      lastFullReconcileAt: row.last_full_reconcile_at,
      lastArticleFetchAt: row.last_article_fetch_at,
      consecutiveFailureCount: row.consecutive_failure_count,
      lastError: row.last_error,
    };
  }

  upsertSyncState(accountID, mutate) {
    const current = this.getSyncState(accountID);
    const next = { ...current, ...mutate(current) };
    this.db.prepare(`
      INSERT INTO account_sync_state (
        account_id, initial_sync_completed, last_sync_started_at, last_sync_completed_at,
        last_full_reconcile_at, last_article_fetch_at, consecutive_failure_count, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        initial_sync_completed = excluded.initial_sync_completed,
        last_sync_started_at = excluded.last_sync_started_at,
        last_sync_completed_at = excluded.last_sync_completed_at,
        last_full_reconcile_at = excluded.last_full_reconcile_at,
        last_article_fetch_at = excluded.last_article_fetch_at,
        consecutive_failure_count = excluded.consecutive_failure_count,
        last_error = excluded.last_error
    `).run(
      accountID,
      next.initialSyncCompleted ? 1 : 0,
      next.lastSyncStartedAt,
      next.lastSyncCompletedAt,
      next.lastFullReconcileAt,
      next.lastArticleFetchAt,
      next.consecutiveFailureCount,
      next.lastError
    );
  }
}

function accountRowToAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    displayName: row.display_name,
    endpointURL: row.endpoint_url,
    username: row.username,
    isEnabled: Number(row.is_enabled) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class FeedRepository {
  constructor(db) { this.db = db; }

  feeds(accountID) {
    return this.db.prepare(
      'SELECT * FROM feeds WHERE account_id = ? AND is_deleted = 0 ORDER BY sort_order ASC, title ASC'
    ).all(accountID).map(feedRowToFeed);
  }

  allFeeds() {
    return this.db.prepare(
      'SELECT * FROM feeds WHERE is_deleted = 0 ORDER BY sort_order ASC, title ASC'
    ).all().map(feedRowToFeed);
  }

  feed(feedID) {
    return feedRowToFeed(this.db.prepare('SELECT * FROM feeds WHERE id = ?').get(feedID));
  }

  feedByURL(accountID, feedURL) {
    return feedRowToFeed(this.db.prepare(
      'SELECT * FROM feeds WHERE account_id = ? AND feed_url = ? AND is_deleted = 0'
    ).get(accountID, feedURL));
  }

  feedByExternalID(accountID, externalID) {
    return feedRowToFeed(this.db.prepare(
      'SELECT * FROM feeds WHERE account_id = ? AND external_id = ?'
    ).get(accountID, externalID));
  }

  insertFeed({ accountID, externalID = null, title, siteURL = null, feedURL, storedIconURL = null }) {
    const id = uuid();
    const now = nowSeconds();
    this.db.prepare(`
      INSERT INTO feeds (id, account_id, external_id, title, site_url, feed_url, updated_at, stored_icon_url, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(id, accountID, externalID, title || '未命名订阅', siteURL, feedURL, now, storedIconURL);
    return this.feed(id);
  }

  updateFeed(feedID, mutate) {
    const current = this.feed(feedID);
    if (!current) return null;
    const next = { ...current, ...mutate(current) };
    this.db.prepare(`
      UPDATE feeds SET title = ?, site_url = ?, etag = ?, last_modified = ?,
        last_refreshed_at = ?, is_deleted = ?, updated_at = ?, stored_icon_url = ?, sort_order = ?
      WHERE id = ?
    `).run(
      next.title, next.siteURL, next.etag, next.lastModified,
      next.lastRefreshedAt, next.isDeleted ? 1 : 0, nowSeconds(), next.storedIconURL, next.sortOrder,
      feedID
    );
    return this.feed(feedID);
  }

  deleteFeed(feedID) {
    this.db.prepare('DELETE FROM feeds WHERE id = ?').run(feedID);
  }

  setFeedFolder(feedID, folderID) {
    this.db.prepare('DELETE FROM feed_folders WHERE feed_id = ?').run(feedID);
    if (folderID != null) {
      this.db.prepare('INSERT OR IGNORE INTO feed_folders (feed_id, folder_id) VALUES (?, ?)').run(feedID, folderID);
    }
  }

  folders(accountID) {
    return this.db.prepare(
      'SELECT * FROM folders WHERE account_id = ? AND is_deleted = 0 ORDER BY sort_order ASC, name ASC'
    ).all(accountID).map(folderRowToFolder);
  }

  folderByName(accountID, name) {
    return folderRowToFolder(this.db.prepare(
      'SELECT * FROM folders WHERE account_id = ? AND name = ? AND is_deleted = 0'
    ).get(accountID, name));
  }

  folder(folderID) {
    return folderRowToFolder(this.db.prepare('SELECT * FROM folders WHERE id = ?').get(folderID));
  }

  ensureFolder(accountID, name, externalID = null) {
    const existing = externalID ? this.db.prepare(
      'SELECT * FROM folders WHERE account_id = ? AND external_id = ?'
    ).get(accountID, externalID) : null;
    if (existing) return folderRowToFolder(existing);
    const byName = this.folderByName(accountID, name);
    if (byName) return byName;
    const id = uuid();
    this.db.prepare(`
      INSERT INTO folders (id, account_id, external_id, name, sort_order, is_deleted, updated_at)
      VALUES (?, ?, ?, ?, 0, 0, ?)
    `).run(id, accountID, externalID, name, nowSeconds());
    return this.folder(id);
  }

  renameFolder(folderID, newName) {
    this.db.prepare('UPDATE folders SET name = ?, updated_at = ? WHERE id = ?').run(newName, nowSeconds(), folderID);
  }

  deleteFolder(folderID) {
    this.db.prepare('DELETE FROM feed_folders WHERE folder_id = ?').run(folderID);
    this.db.prepare('DELETE FROM folders WHERE id = ?').run(folderID);
  }

  folderIDsWithFeeds(accountID) {
    const rows = this.db.prepare(`
      SELECT DISTINCT fo.id AS folder_id
      FROM folders fo
      INNER JOIN feed_folders ff ON ff.folder_id = fo.id
      INNER JOIN feeds f ON f.id = ff.feed_id
      WHERE fo.account_id = ? AND fo.is_deleted = 0 AND f.is_deleted = 0
      ORDER BY fo.sort_order ASC, fo.name ASC
    `).all(accountID);
    return rows.map((row) => row.folder_id);
  }

  feedIDsInFolder(folderID) {
    return this.db.prepare(`
      SELECT f.id FROM feeds f
      INNER JOIN feed_folders ff ON ff.feed_id = f.id
      WHERE ff.folder_id = ? AND f.is_deleted = 0
      ORDER BY f.sort_order ASC, f.title ASC
    `).all(folderID).map((row) => row.id);
  }
}

function folderRowToFolder(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountID: row.account_id,
    externalID: row.external_id,
    name: row.name,
    sortOrder: row.sort_order,
    isDeleted: Number(row.is_deleted) === 1,
    updatedAt: row.updated_at,
  };
}

class ArticleRepository {
  constructor(db) { this.db = db; }

  /** UPSERT 一篇文章（items + articles + article_states）。 */
  upsertEntry(entry) {
    const now = nowSeconds();
    return this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO items (id, account_id, external_id, feed_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
      `).run(entry.id, entry.accountID, entry.externalID || entry.id, entry.feedID,
        entry.dateArrived ?? now, now);

      this.db.prepare(`
        INSERT INTO articles (item_id, title, author, url, published_at, summary, content_html, content_updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id) DO UPDATE SET
          title = excluded.title,
          author = excluded.author,
          url = excluded.url,
          published_at = excluded.published_at,
          summary = excluded.summary,
          content_updated_at = excluded.content_updated_at
      `).run(
        entry.id, entry.title || '未命名文章', entry.author ?? null, entry.url ?? null,
        entry.publishedAt ?? null, entry.summary ?? '', entry.contentHTML ?? null, now
      );
      // 注意：content_html 不在 DO UPDATE 中覆盖 —— 保留本地较新正文。

      this.db.prepare(`
        INSERT INTO article_states (item_id, is_read, is_starred, date_arrived, updated_at)
        VALUES (?, 0, 0, ?, ?)
        ON CONFLICT(item_id) DO NOTHING
      `).run(entry.id, entry.dateArrived ?? now, now);

      return entry.id;
    });
  }

  updateContentHTML(itemID, contentHTML) {
    this.db.prepare('UPDATE articles SET content_html = ?, content_updated_at = ? WHERE item_id = ?')
      .run(contentHTML, nowSeconds(), itemID);
  }

  entry(entryID) {
    return entryRowToEntry(this.db.prepare(`
      SELECT i.id, i.account_id, i.external_id, i.feed_id, i.created_at, i.updated_at,
             a.title, a.author, a.url, a.published_at, a.summary, a.content_html,
             COALESCE(s.is_read, 0) AS is_read, COALESCE(s.is_starred, 0) AS is_starred,
             COALESCE(s.date_arrived, i.created_at) AS date_arrived
      FROM items i
      LEFT JOIN articles a ON a.item_id = i.id
      LEFT JOIN article_states s ON s.item_id = i.id
      WHERE i.id = ?
    `).get(entryID));
  }

  entriesForFeed(feedID) {
    return this.db.prepare(`
      SELECT i.id, i.account_id, i.external_id, i.feed_id, i.created_at, i.updated_at,
             a.title, a.author, a.url, a.published_at, a.summary, a.content_html,
             COALESCE(s.is_read, 0) AS is_read, COALESCE(s.is_starred, 0) AS is_starred,
             COALESCE(s.date_arrived, i.created_at) AS date_arrived
      FROM items i
      LEFT JOIN articles a ON a.item_id = i.id
      LEFT JOIN article_states s ON s.item_id = i.id
      WHERE i.feed_id = ?
      ORDER BY COALESCE(a.published_at, i.created_at) DESC
    `).all(feedID).map(entryRowToEntry);
  }

  knownExternalIDs(accountID) {
    const rows = this.db.prepare('SELECT external_id FROM items WHERE account_id = ?').all(accountID);
    return new Set(rows.map((row) => row.external_id));
  }

  externalIDToItemID(accountID) {
    const rows = this.db.prepare('SELECT id, external_id FROM items WHERE account_id = ?').all(accountID);
    const map = new Map();
    for (const row of rows) map.set(row.external_id, row.id);
    return map;
  }

  deleteEntriesForFeed(feedID) {
    this.db.prepare('DELETE FROM items WHERE feed_id = ?').run(feedID);
  }

  countForFeed(feedID) {
    return this.db.prepare('SELECT COUNT(*) AS c FROM items WHERE feed_id = ?').get(feedID).c;
  }
}

class ArticleStateRepository {
  constructor(db) { this.db = db; }

  setRead(itemID, isRead) {
    const now = nowSeconds();
    this.db.prepare(`
      INSERT INTO article_states (item_id, is_read, is_starred, date_arrived, updated_at)
      VALUES (?, ?, 0, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET is_read = excluded.is_read, updated_at = excluded.updated_at
    `).run(itemID, isRead ? 1 : 0, now, now);
  }

  setStarred(itemID, isStarred) {
    const now = nowSeconds();
    this.db.prepare(`
      INSERT INTO article_states (item_id, is_read, is_starred, date_arrived, updated_at)
      VALUES (?, 0, ?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET is_starred = excluded.is_starred, updated_at = excluded.updated_at
    `).run(itemID, isStarred ? 1 : 0, now, now);
  }

  /** 将 outbox 队列写入待同步状态（ FreshRSS 账户）。 */
  enqueueOutbox(accountID, itemID, stateKey, desiredValue) {
    this.db.prepare(`
      INSERT INTO article_state_outbox (account_id, item_id, state_key, desired_value, revision, updated_at, attempt_count)
      VALUES (?, ?, ?, ?, 1, ?, 0)
      ON CONFLICT(account_id, item_id, state_key) DO UPDATE SET
        desired_value = excluded.desired_value,
        revision = revision + 1,
        updated_at = excluded.updated_at
    `).run(accountID, itemID, stateKey, desiredValue ? 1 : 0, nowSeconds());
  }

  readyOutboxEntries(accountID, limit = 200) {
    return this.db.prepare(`
      SELECT * FROM article_state_outbox
      WHERE account_id = ? AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY updated_at ASC
      LIMIT ?
    `).all(accountID, nowSeconds(), limit).map(outboxRowToRecord);
  }

  markOutboxAttempt(accountID, itemID, stateKey, error) {
    if (error) {
      this.db.prepare(`
        UPDATE article_state_outbox
        SET attempt_count = attempt_count + 1, next_attempt_at = ?, last_error = ?
        WHERE account_id = ? AND item_id = ? AND state_key = ?
      `).run(nowSeconds() + Math.min(3600, 30 * (2 ** Math.min(6, 1))), error, accountID, itemID, stateKey);
    } else {
      this.db.prepare(`
        DELETE FROM article_state_outbox
        WHERE account_id = ? AND item_id = ? AND state_key = ?
      `).run(accountID, itemID, stateKey);
    }
  }

  outboxCount(accountID) {
    return this.db.prepare('SELECT COUNT(*) AS c FROM article_state_outbox WHERE account_id = ?').get(accountID).c;
  }
}

function outboxRowToRecord(row) {
  return {
    accountID: row.account_id,
    itemID: row.item_id,
    stateKey: row.state_key,
    desiredValue: Number(row.desired_value) === 1,
    revision: row.revision,
    updatedAt: row.updated_at,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
  };
}

class CacheRepository {
  constructor(db) { this.db = db; }

  cache(itemID) {
    const row = this.db.prepare('SELECT * FROM article_caches WHERE item_id = ?').get(itemID);
    if (!row) return null;
    let imageURLs = [];
    try { imageURLs = JSON.parse(row.image_urls_json || '[]'); } catch (_) { imageURLs = []; }
    return {
      entryID: row.item_id,
      text: row.text,
      html: row.html ?? null,
      imageURLs,
      fetchedAt: row.fetched_at,
      sourceURL: row.source_url ?? null,
      isSanitized: Number(row.is_sanitized) === 1,
    };
  }

  saveCache(cache) {
    this.db.prepare(`
      INSERT INTO article_caches (item_id, text, html, image_urls_json, fetched_at, source_url, is_sanitized)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET
        text = excluded.text,
        html = excluded.html,
        image_urls_json = excluded.image_urls_json,
        fetched_at = excluded.fetched_at,
        source_url = excluded.source_url,
        is_sanitized = excluded.is_sanitized
    `).run(
      cache.entryID, cache.text, cache.html ?? null,
      JSON.stringify(cache.imageURLs || []), cache.fetchedAt ?? nowSeconds(),
      cache.sourceURL ?? null, cache.isSanitized ? 1 : 0
    );
  }

  deleteCache(itemID) {
    this.db.prepare('DELETE FROM article_caches WHERE item_id = ?').run(itemID);
  }
}

class AIArtifactRepository {
  constructor(db) { this.db = db; }

  latestArtifact({ itemID = null, subjectKey = null, kind, contentHash, model, targetLanguage }) {
    let sql = `SELECT * FROM ai_artifacts WHERE kind = ? AND content_hash = ? AND model = ? AND target_language = ? AND is_deleted = 0`;
    const params = [kind, contentHash, model, targetLanguage];
    if (itemID != null) {
      sql += ' AND item_id = ?';
      params.push(itemID);
    } else if (subjectKey != null) {
      sql += ' AND subject_key = ?';
      params.push(subjectKey);
    } else {
      return null;
    }
    sql += ' ORDER BY updated_at DESC LIMIT 1';
    return artifactRowToArtifact(this.db.prepare(sql).get(...params));
  }

  /** 不校验 model/language 的可用缓存（用于展示已生成产物）。 */
  anyLatestArtifact({ itemID = null, subjectKey = null, kind, contentHash }) {
    let sql = `SELECT * FROM ai_artifacts WHERE kind = ? AND content_hash = ? AND is_deleted = 0 AND is_complete = 1`;
    const params = [kind, contentHash];
    if (itemID != null) {
      sql += ' AND item_id = ?';
      params.push(itemID);
    } else if (subjectKey != null) {
      sql += ' AND subject_key = ?';
      params.push(subjectKey);
    } else {
      return null;
    }
    sql += ' ORDER BY updated_at DESC LIMIT 1';
    return artifactRowToArtifact(this.db.prepare(sql).get(...params));
  }

  saveArtifact(artifact) {
    const now = nowSeconds();
    this.db.prepare(`
      INSERT INTO ai_artifacts (
        id, account_id, item_id, subject_key, kind, content_hash, model, target_language,
        prompt_version, content, segments_json, selection_text, selection_article_hash,
        selection_anchor_json, is_complete, is_deleted, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        segments_json = excluded.segments_json,
        is_complete = excluded.is_complete,
        updated_at = excluded.updated_at
    `).run(
      artifact.id, artifact.accountID ?? null, artifact.itemID ?? null, artifact.subjectKey,
      artifact.kind, artifact.contentHash, artifact.model, artifact.targetLanguage,
      artifact.promptVersion ?? 1, artifact.content ?? '',
      JSON.stringify(artifact.segments || []), artifact.selectionText ?? null,
      artifact.selectionArticleHash ?? null,
      artifact.selectionAnchor ? JSON.stringify(artifact.selectionAnchor) : null,
      artifact.isComplete ? 1 : 0,
      artifact.createdAt ?? now, now
    );
  }

  markDeleted(artifactID) {
    this.db.prepare('UPDATE ai_artifacts SET is_deleted = 1, updated_at = ? WHERE id = ?').run(nowSeconds(), artifactID);
  }

  markAllDeletedForItem(itemID, kinds) {
    const placeholders = kinds.map(() => '?').join(',');
    this.db.prepare(
      `UPDATE ai_artifacts SET is_deleted = 1, updated_at = ? WHERE item_id = ? AND kind IN (${placeholders})`
    ).run(nowSeconds(), itemID, ...kinds);
  }
}

function artifactRowToArtifact(row) {
  if (!row) return null;
  let segments = [];
  try { segments = JSON.parse(row.segments_json || '[]'); } catch (_) { segments = []; }
  let selectionAnchor = null;
  if (row.selection_anchor_json) {
    try { selectionAnchor = JSON.parse(row.selection_anchor_json); } catch (_) { selectionAnchor = null; }
  }
  return {
    id: row.id,
    accountID: row.account_id ?? null,
    itemID: row.item_id ?? null,
    subjectKey: row.subject_key,
    kind: row.kind,
    contentHash: row.content_hash,
    model: row.model,
    targetLanguage: row.target_language,
    promptVersion: row.prompt_version,
    content: row.content,
    segments,
    selectionText: row.selection_text ?? null,
    selectionArticleHash: row.selection_article_hash ?? null,
    selectionAnchor,
    isComplete: Number(row.is_complete) === 1,
    isDeleted: Number(row.is_deleted) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  AccountRepository,
  FeedRepository,
  ArticleRepository,
  ArticleStateRepository,
  CacheRepository,
  AIArtifactRepository,
  feedRowToFeed,
  entryRowToEntry,
  artifactRowToArtifact,
};
