'use strict';
/**
 * RobinRead Windows — Timeline 投影查询服务
 *
 * 1:1 移植自 macOS版 TimelineQueryService.swift：
 * - 纯 SQL 聚合与关联投影，不物化全量 content_html / article_caches / ai_artifacts
 * - SidebarCounts / fetchListItems / fetchAdjacentItem
 */
const { feedIconURL } = require('../Models');

function rowToListItem(row) {
  return {
    id: row.entry_id,
    feedID: row.feed_id,
    accountID: row.account_id || 'local-default',
    accountType: row.account_type || 'local',
    accountDisplayName: row.account_display_name || 'Local',
    title: row.title ?? '',
    url: row.url ?? null,
    summaryPreview: String(row.summary ?? '').slice(0, 240),
    sourceTitle: row.feed_title ?? '',
    publishedAt: row.published_at ?? null,
    isRead: Number(row.is_read ?? 0) === 1,
    isStarred: Number(row.is_starred ?? 0) === 1,
    isLater: Number(row.is_later ?? 0) === 1,
    feedIconURL: feedIconURL({
      storedIconURL: row.stored_icon_url ?? null,
      siteURL: row.site_url ?? null,
      feedURL: row.feed_url ?? '',
    }),
  };
}

const LIST_SELECT = `
  SELECT
      i.id AS entry_id,
      i.feed_id AS feed_id,
      i.account_id AS account_id,
      COALESCE(acc.type, 'local') AS account_type,
      COALESCE(acc.display_name, 'Local') AS account_display_name,
      COALESCE(a.title, '') AS title,
      a.url AS url,
      COALESCE(a.summary, '') AS summary,
      f.title AS feed_title,
      f.stored_icon_url AS stored_icon_url,
      f.site_url AS site_url,
      f.feed_url AS feed_url,
      a.published_at AS published_at,
      COALESCE(s.is_read, 0) AS is_read,
      COALESCE(s.is_starred, 0) AS is_starred,
      COALESCE(s.is_later, 0) AS is_later
  FROM items i
  INNER JOIN feeds f ON f.id = i.feed_id
  LEFT JOIN accounts acc ON acc.id = i.account_id
  LEFT JOIN articles a ON a.item_id = i.id
  LEFT JOIN article_states s ON s.item_id = i.id
`;

class TimelineQueryService {
  constructor(database) {
    this.database = database;
  }

  fetchSidebarCounts(accountID, startOfDayTimestamp) {
    const params = [];
    let accountWhere = 'AND (acc.is_enabled = 1 OR acc.id IS NULL)';
    if (accountID != null) {
      accountWhere = 'AND i.account_id = ?';
      params.push(accountID);
    }

    const allUnread = this.database.prepare(`
      SELECT COUNT(*) AS c
      FROM items i
      INNER JOIN article_states s ON s.item_id = i.id
      INNER JOIN feeds f ON f.id = i.feed_id
      LEFT JOIN accounts acc ON acc.id = i.account_id
      WHERE f.is_deleted = 0 AND s.is_read = 0 ${accountWhere};
    `).get(...params).c;

    const todayParams = [...params, startOfDayTimestamp];
    const todayUnread = this.database.prepare(`
      SELECT COUNT(*) AS c
      FROM items i
      INNER JOIN article_states s ON s.item_id = i.id
      INNER JOIN articles a ON a.item_id = i.id
      INNER JOIN feeds f ON f.id = i.feed_id
      LEFT JOIN accounts acc ON acc.id = i.account_id
      WHERE f.is_deleted = 0 AND s.is_read = 0 ${accountWhere}
        AND (a.published_at >= ? OR (a.published_at IS NULL AND i.created_at >= ?));
    `).get(...todayParams, ...todayParams.slice(-1)).c;

    const starred = this.database.prepare(`
      SELECT COUNT(*) AS c
      FROM items i
      INNER JOIN article_states s ON s.item_id = i.id
      INNER JOIN feeds f ON f.id = i.feed_id
      LEFT JOIN accounts acc ON acc.id = i.account_id
      WHERE f.is_deleted = 0 AND s.is_starred = 1 ${accountWhere};
    `).get(...params).c;

    // 稍后读队列计数（与已读/收藏独立的第三状态，短期待办）
    const laterCount = this.database.prepare(`
      SELECT COUNT(*) AS c
      FROM items i
      INNER JOIN article_states s ON s.item_id = i.id
      INNER JOIN feeds f ON f.id = i.feed_id
      LEFT JOIN accounts acc ON acc.id = i.account_id
      WHERE f.is_deleted = 0 AND s.is_later = 1 ${accountWhere};
    `).get(...params).c;

    const unreadByFeed = {};
    for (const row of this.database.prepare(`
      SELECT i.feed_id AS feed_id, COUNT(*) AS unread_count
      FROM items i
      INNER JOIN article_states s ON s.item_id = i.id
      INNER JOIN feeds f ON f.id = i.feed_id
      LEFT JOIN accounts acc ON acc.id = i.account_id
      WHERE f.is_deleted = 0 AND s.is_read = 0 ${accountWhere}
      GROUP BY i.feed_id;
    `).all(...params)) {
      unreadByFeed[row.feed_id] = row.unread_count;
    }

    const unreadByFolder = {};
    for (const row of this.database.prepare(`
      SELECT fo.account_id AS account_id, fo.name AS folder_name, COUNT(DISTINCT i.id) AS unread_count
      FROM items i
      INNER JOIN article_states s ON s.item_id = i.id
      INNER JOIN feeds f ON f.id = i.feed_id
      INNER JOIN feed_folders ff ON ff.feed_id = f.id
      INNER JOIN folders fo ON fo.id = ff.folder_id
      LEFT JOIN accounts acc ON acc.id = i.account_id
      WHERE f.is_deleted = 0 AND fo.is_deleted = 0 AND s.is_read = 0 ${accountWhere}
      GROUP BY fo.account_id, fo.name;
    `).all(...params)) {
      unreadByFolder[`${row.account_id}::${row.folder_name}`] = row.unread_count;
      unreadByFolder[row.folder_name] = row.unread_count;
    }

    return { allUnread, todayUnread, starred, laterCount, unreadByFeed, unreadByFolder };
  }

  _scopeClauses(accountID, scope, retainingIDs) {
    const where = ['f.is_deleted = 0'];
    const params = [];
    if (accountID != null) {
      where.push('i.account_id = ?');
      params.push(accountID);
    } else {
      where.push('(acc.is_enabled = 1 OR acc.id IS NULL)');
    }

    switch (scope.kind) {
      case 'all':
        break;
      case 'today':
        where.push('(a.published_at >= ? OR (a.published_at IS NULL AND i.created_at >= ?))');
        params.push(scope.startOfDay, scope.startOfDay);
        break;
      case 'unread':
        if (!retainingIDs || retainingIDs.size === 0) {
          where.push('s.is_read = 0');
        } else {
          const ids = [...retainingIDs];
          where.push(`(s.is_read = 0 OR i.id IN (${ids.map(() => '?').join(',')}))`);
          params.push(...ids);
        }
        break;
      case 'starred':
        if (!retainingIDs || retainingIDs.size === 0) {
          where.push('s.is_starred = 1');
        } else {
          const ids = [...retainingIDs];
          where.push(`(s.is_starred = 1 OR i.id IN (${ids.map(() => '?').join(',')}))`);
          params.push(...ids);
        }
        break;
      case 'later':
        // 稍后读队列：retainingIDs 模式照抄 unread（移出队列的行默认消失，保留集例外）
        if (!retainingIDs || retainingIDs.size === 0) {
          where.push('s.is_later = 1');
        } else {
          const laterRetained = [...retainingIDs];
          where.push(`(s.is_later = 1 OR i.id IN (${laterRetained.map(() => '?').join(',')}))`);
          params.push(...laterRetained);
        }
        break;
      case 'feed':
        where.push('i.feed_id = ?');
        params.push(scope.feedID);
        break;
      case 'feeds':
        if (!scope.feedIDs || scope.feedIDs.length === 0) {
          where.push('1 = 0');
        } else {
          where.push(`i.feed_id IN (${scope.feedIDs.map(() => '?').join(',')})`);
          params.push(...scope.feedIDs);
        }
        break;
      case 'folder':
        where.push('i.account_id = ?');
        where.push(`i.feed_id IN (
            SELECT ff.feed_id
            FROM feed_folders ff
            INNER JOIN folders fo ON fo.id = ff.folder_id
            WHERE fo.account_id = ? AND fo.name = ? AND fo.is_deleted = 0
        )`);
        params.push(scope.accountID, scope.accountID, scope.folderName);
        break;
      default:
        break;
    }
    return { where, params };
  }

  fetchListItems({ accountID = null, scope, retainingIDs = [], limit = null, offset = 0, sort = 'time' }) {
    const { where, params } = this._scopeClauses(accountID, scope, retainingIDs);
    const orderPrefix = sort === 'unreadFirst' ? 's.is_read ASC, ' : '';
    let sql = `${LIST_SELECT} WHERE ${where.join(' AND ')}
      ORDER BY ${orderPrefix}COALESCE(a.published_at, i.created_at) DESC, i.id DESC`;
    if (limit != null) {
      sql += ` LIMIT ${Number(limit)} OFFSET ${Number(offset)}`;
    }
    return this.database.prepare(sql).all(...params).map(rowToListItem);
  }

  fetchAdjacentItem({ accountID = null, scope, currentItemID, direction, retainingIDs = [] }) {
    const curRow = this.database.prepare(`
      SELECT COALESCE(a.published_at, i.created_at) AS sort_time
      FROM items i
      LEFT JOIN articles a ON a.item_id = i.id
      WHERE i.id = ?
      LIMIT 1;
    `).get(currentItemID);
    if (!curRow || curRow.sort_time == null) return null;

    const { where, params } = this._scopeClauses(accountID, scope, retainingIDs);

    if (direction === 'next') {
      where.push('(COALESCE(a.published_at, i.created_at) < ? OR (COALESCE(a.published_at, i.created_at) = ? AND i.id < ?))');
      params.push(curRow.sort_time, curRow.sort_time, currentItemID);
    } else {
      where.push('(COALESCE(a.published_at, i.created_at) > ? OR (COALESCE(a.published_at, i.created_at) = ? AND i.id > ?))');
      params.push(curRow.sort_time, curRow.sort_time, currentItemID);
    }

    const orderClause = direction === 'next'
      ? 'ORDER BY COALESCE(a.published_at, i.created_at) DESC, i.id DESC'
      : 'ORDER BY COALESCE(a.published_at, i.created_at) ASC, i.id ASC';

    const row = this.database.prepare(`
      ${LIST_SELECT}
      WHERE ${where.join(' AND ')}
      ${orderClause}
      LIMIT 1;
    `).get(...params);
    return row ? rowToListItem(row) : null;
  }
}

module.exports = { TimelineQueryService, rowToListItem };
