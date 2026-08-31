'use strict';
/**
 * RobinRead（知更）— SQLite Schema 迁移
 *
 * 所有 Schema 变更必须通过本文件的版本迁移演进，禁止业务代码执行
 * ad-hoc 的 CREATE TABLE IF NOT EXISTS。
 */

const MIGRATIONS = [
  {
    id: 'v1-create-library-schema',
    up: (db) => {
      // 1. accounts (账号主表)
      db.exec(`
        CREATE TABLE accounts (
            id              TEXT PRIMARY KEY NOT NULL,
            type            TEXT NOT NULL,
            display_name    TEXT NOT NULL,
            endpoint_url    TEXT,
            username        TEXT,
            is_enabled      INTEGER NOT NULL DEFAULT 1,
            created_at      REAL NOT NULL,
            updated_at      REAL NOT NULL,

            CHECK (type IN ('local', 'freshRSS'))
        );
        CREATE INDEX idx_accounts_type ON accounts(type);
      `);

      // 2. folders (分类目录)
      db.exec(`
        CREATE TABLE folders (
            id              TEXT PRIMARY KEY NOT NULL,
            account_id      TEXT NOT NULL,
            external_id     TEXT,
            name            TEXT NOT NULL,
            sort_order      INTEGER NOT NULL DEFAULT 0,
            is_deleted      INTEGER NOT NULL DEFAULT 0,
            updated_at      REAL NOT NULL,

            FOREIGN KEY(account_id)
                REFERENCES accounts(id)
                ON DELETE CASCADE
        );
        CREATE INDEX idx_folders_account
        ON folders(account_id, is_deleted, sort_order, name);
        CREATE UNIQUE INDEX idx_folders_remote_identity
        ON folders(account_id, external_id)
        WHERE external_id IS NOT NULL;
      `);

      // 3. feeds (订阅源)
      db.exec(`
        CREATE TABLE feeds (
            id                  TEXT PRIMARY KEY NOT NULL,
            account_id          TEXT NOT NULL,
            external_id         TEXT,
            title               TEXT NOT NULL,
            site_url            TEXT,
            feed_url            TEXT NOT NULL,
            etag                TEXT,
            last_modified       TEXT,
            last_refreshed_at   REAL,
            is_deleted          INTEGER NOT NULL DEFAULT 0,
            updated_at          REAL NOT NULL,
            stored_icon_url     TEXT,
            sort_order          INTEGER NOT NULL DEFAULT 0,

            FOREIGN KEY(account_id)
                REFERENCES accounts(id)
                ON DELETE CASCADE
        );
        CREATE INDEX idx_feeds_account
        ON feeds(account_id, is_deleted, sort_order, title);
        CREATE INDEX idx_feeds_url
        ON feeds(account_id, feed_url);
        CREATE UNIQUE INDEX idx_feeds_remote_identity
        ON feeds(account_id, external_id)
        WHERE external_id IS NOT NULL;
      `);

      // 4. feed_folders (Feed 与 Folder 多对多关联)
      db.exec(`
        CREATE TABLE feed_folders (
            feed_id     TEXT NOT NULL,
            folder_id   TEXT NOT NULL,

            PRIMARY KEY(feed_id, folder_id),

            FOREIGN KEY(feed_id)
                REFERENCES feeds(id)
                ON DELETE CASCADE,
            FOREIGN KEY(folder_id)
                REFERENCES folders(id)
                ON DELETE CASCADE
        );
        CREATE INDEX idx_feed_folders_folder
        ON feed_folders(folder_id, feed_id);
      `);

      // 5. items (文章身份层)
      db.exec(`
        CREATE TABLE items (
            id              TEXT PRIMARY KEY NOT NULL,
            account_id      TEXT NOT NULL,
            external_id     TEXT NOT NULL,
            feed_id         TEXT NOT NULL,
            created_at      REAL NOT NULL,
            updated_at      REAL NOT NULL,

            FOREIGN KEY(account_id)
                REFERENCES accounts(id)
                ON DELETE CASCADE,
            FOREIGN KEY(feed_id)
                REFERENCES feeds(id)
                ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX idx_items_remote_identity
        ON items(account_id, external_id);
        CREATE INDEX idx_items_feed
        ON items(feed_id);
      `);

      // 6. articles (文章内容层)
      db.exec(`
        CREATE TABLE articles (
            item_id             TEXT PRIMARY KEY NOT NULL,
            title               TEXT NOT NULL,
            author              TEXT,
            url                 TEXT,
            published_at        REAL,
            summary             TEXT NOT NULL DEFAULT '',
            content_html        TEXT,
            content_updated_at  REAL NOT NULL,

            FOREIGN KEY(item_id)
                REFERENCES items(id)
                ON DELETE CASCADE
        );
        CREATE INDEX idx_articles_published
        ON articles(published_at DESC);
      `);

      // 7. article_states (文章已读/标星状态层)
      db.exec(`
        CREATE TABLE article_states (
            item_id          TEXT PRIMARY KEY NOT NULL,
            is_read          INTEGER NOT NULL DEFAULT 0,
            is_starred       INTEGER NOT NULL DEFAULT 0,
            date_arrived     REAL NOT NULL,
            updated_at       REAL NOT NULL,

            FOREIGN KEY(item_id)
                REFERENCES items(id)
                ON DELETE CASCADE
        );
        CREATE INDEX idx_article_states_unread
        ON article_states(is_read, item_id);
        CREATE INDEX idx_article_states_starred
        ON article_states(is_starred, item_id);
      `);

      // 8. article_state_outbox (待同步至远端的状态突变持久化队列)
      db.exec(`
        CREATE TABLE article_state_outbox (
            account_id          TEXT NOT NULL,
            item_id             TEXT NOT NULL,
            state_key           TEXT NOT NULL,
            desired_value       INTEGER NOT NULL,
            revision            INTEGER NOT NULL DEFAULT 1,
            updated_at          REAL NOT NULL,
            attempt_count       INTEGER NOT NULL DEFAULT 0,
            next_attempt_at     REAL,
            last_error          TEXT,

            PRIMARY KEY(account_id, item_id, state_key),

            FOREIGN KEY(account_id)
                REFERENCES accounts(id)
                ON DELETE CASCADE,
            FOREIGN KEY(item_id)
                REFERENCES items(id)
                ON DELETE CASCADE,

            CHECK(state_key IN ('read', 'starred'))
        );
        CREATE INDEX idx_article_state_outbox_ready
        ON article_state_outbox(account_id, next_attempt_at, updated_at);
      `);

      // 9. article_caches (文章网页提取正文缓存)
      db.exec(`
        CREATE TABLE article_caches (
            item_id             TEXT PRIMARY KEY NOT NULL,
            text                TEXT NOT NULL,
            html                TEXT,
            image_urls_json     TEXT,
            fetched_at          REAL NOT NULL,
            source_url          TEXT,
            is_sanitized        INTEGER NOT NULL DEFAULT 0,

            FOREIGN KEY(item_id)
                REFERENCES items(id)
                ON DELETE CASCADE
        );
      `);

      // 10. ai_artifacts (AI 摘要、全文翻译与划词解析产物)
      db.exec(`
        CREATE TABLE ai_artifacts (
            id                      TEXT PRIMARY KEY NOT NULL,
            account_id              TEXT,
            item_id                 TEXT,
            subject_key             TEXT NOT NULL,
            kind                    TEXT NOT NULL,
            content_hash            TEXT NOT NULL,
            model                   TEXT NOT NULL,
            target_language         TEXT NOT NULL,
            prompt_version          INTEGER NOT NULL DEFAULT 1,
            content                 TEXT NOT NULL DEFAULT '',
            segments_json           TEXT,
            selection_text          TEXT,
            selection_article_hash  TEXT,
            selection_anchor_json   TEXT,
            is_complete             INTEGER NOT NULL DEFAULT 0,
            is_deleted              INTEGER NOT NULL DEFAULT 0,
            created_at              REAL NOT NULL,
            updated_at              REAL NOT NULL,

            FOREIGN KEY(account_id)
                REFERENCES accounts(id)
                ON DELETE CASCADE,
            FOREIGN KEY(item_id)
                REFERENCES items(id)
                ON DELETE SET NULL
        );
        CREATE INDEX idx_ai_artifacts_article_lookup
        ON ai_artifacts(item_id, kind, content_hash, updated_at DESC);
        CREATE INDEX idx_ai_artifacts_subject_lookup
        ON ai_artifacts(subject_key, kind, content_hash, updated_at DESC);
      `);

      // 11. account_sync_state (账号同步进度与错误状态)
      db.exec(`
        CREATE TABLE account_sync_state (
            account_id                  TEXT PRIMARY KEY NOT NULL,
            initial_sync_completed      INTEGER NOT NULL DEFAULT 0,
            last_sync_started_at        REAL,
            last_sync_completed_at      REAL,
            last_full_reconcile_at      REAL,
            last_article_fetch_at       REAL,
            consecutive_failure_count   INTEGER NOT NULL DEFAULT 0,
            last_error                  TEXT,

            FOREIGN KEY(account_id)
                REFERENCES accounts(id)
                ON DELETE CASCADE
        );
      `);
    },
  },
  {
    id: 'v2-clean-local-account-sync-state',
    up: (db) => {
      db.exec(`DELETE FROM account_sync_state WHERE account_id = 'local-default';`);
    },
  },
  {
    id: 'v3-normalize-local-item-external-identity',
    up: (db) => {
      const exists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='items'"
      ).get();
      if (!exists) return;
      db.exec(`
        UPDATE items
        SET external_id = id
        WHERE account_id IN (
            SELECT id FROM accounts WHERE type = 'local'
        );
      `);
    },
  },

  {
    id: 'v4-articles-fts',
    up: (db) => {
      // FTS5 trigram 全文索引（即时全文搜索）。trigram 最小词元 3 字符，
      // 更短查询由搜索层回退 LIKE。FTS5/trigram 不可用的环境静默跳过建表，
      // SearchIndex.ftsAvailable 探测不到表即全程走 LIKE 路径。
      try {
        db.exec(`
          CREATE VIRTUAL TABLE articles_fts USING fts5(
              item_id UNINDEXED,
              title,
              author,
              summary,
              body,
              tokenize='trigram'
          );
        `);
      } catch (_) { /* FTS5 不可用：搜索保持 LIKE */ }
    },
  },

  {
    id: 'v5-explored-feeds',
    up: (db) => {
      // AI 探索（订阅源发现）：候选源的探索记录与反馈闭环
      db.exec(`
        CREATE TABLE IF NOT EXISTS explored_feeds (
            url          TEXT PRIMARY KEY NOT NULL,
            domain       TEXT,
            verdict      TEXT NOT NULL DEFAULT 'explored',
            score        REAL,
            explanation  TEXT,
            explored_at  REAL NOT NULL
        );
        CREATE INDEX idx_explored_feeds_domain ON explored_feeds(domain);
      `);
    },
  },
];

/** 应用所有未执行的迁移（等价 GRDB DatabaseMigrator.migrate）。 */
function runMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY NOT NULL,
    applied_at REAL NOT NULL
  );`);
  const applied = new Set(
    db.prepare('SELECT id FROM schema_migrations').all().map((row) => row.id)
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.exec('BEGIN');
    try {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(
        migration.id,
        Date.now() / 1000
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

module.exports = { runMigrations, MIGRATIONS };
