'use strict';
/**
 * RobinRead（知更）— 应用业务中枢
 *
 * - 侧栏/时间线状态投影（query-first）
 * - Feed 刷新（手动/启动/定时）
 * - FreshRSS 账户同步（初始化 + 增量 + 未读/星标对账 + outbox 回放）
 * - AI 产物编排（摘要、上下文缓存、划词解释/提问、双语翻译）
 * - 偏好（主题/字号/语言/刷新/LLM 配置）
 */
const { EventEmitter } = require('node:events');
const path = require('node:path');
const {
  AccountRepository, FeedRepository, ArticleRepository, ArticleStateRepository,
  CacheRepository, AIArtifactRepository,
} = require('./Persistence/Repositories');
const { LibraryDatabase, PreferenceStore, PreferenceKey } = require('./Persistence/LibraryDatabase');
const { TimelineQueryService } = require('./Persistence/TimelineQueryService');
const { CredentialStore } = require('./Account/CredentialStore');
const { fetchFeed } = require('./FeedService');
const OPMLService = require('./OPMLService');
const ArticleExtractor = require('./ArticleExtractor');
const { LLMService, LLMServiceError, ArticleChunker } = require('./LLMService');
const { ReaderAPIClient, ReaderAPIAuthenticator, canonicalBaseURL, fetchWithTimeout } = require('./FreshRSS/FreshRSSClient');
const { KnowledgeEngine } = require('./KnowledgeEngine');
const { EvolutionEngine } = require('./EvolutionEngine');
const { AihotService } = require('./AihotService');
const { ReaderAPIError } = require('./FreshRSS/ReaderAPIError');
const {
  defaultLLMConfiguration, deepSeekLLMConfiguration, plainText, stableDigest,
  AIArtifactKind, LOCAL_ACCOUNT_ID, refreshIntervalSeconds, uuid, nowSeconds,
  shouldShowSummary,
} = require('./Models');
const { i18n } = require('./I18N');

const DEFAULT_TIMELINE_LIMIT = 100;
const TRANSLATION_PROMPT_VERSION = 2;
const MAX_PARAGRAPHS_PER_TRANSLATION_BATCH = 8; // 逐句双语：句级单元更短，批次适当加大
const MAX_CHARACTERS_PER_TRANSLATION_BATCH = 1600;

class AppStore extends EventEmitter {
  constructor(userDataPath) {
    super();
    this.setMaxListeners(50);

    this.database = new LibraryDatabase(path.join(userDataPath, 'library.db'));
    this.preferences = new PreferenceStore();
    this.credentials = new CredentialStore();

    this.accounts = new AccountRepository(this.database);
    this.feedsRepo = new FeedRepository(this.database);
    this.articlesRepo = new ArticleRepository(this.database);
    this.statesRepo = new ArticleStateRepository(this.database);
    this.cachesRepo = new CacheRepository(this.database);
    this.artifactsRepo = new AIArtifactRepository(this.database);
    this.timeline = new TimelineQueryService(this.database);

    this.llm = new LLMService();
    this.knowledge = new KnowledgeEngine(this);
    this.evolution = new EvolutionEngine(this);
    this.aihot = new AihotService();
    this.apiClients = new Map(); // accountID -> ReaderAPIClient
    this.refreshStatus = { state: 'idle' };
    this.syncStatus = new Map(); // accountID -> {state, message}
    this.aiStatus = new Map(); // key -> {state, message}
    this.activeAICancellers = new Map();
    this.lastRefreshOutcome = null;
    this._refreshTimer = null;
    this._outboxTimer = null;
    this._retainedUnreadIDs = new Set(); // 未读会话保留
    this._retainedStarredIDs = new Set();

    // 本机账户始终存在
    this.accounts.ensureLocalAccount();

    this.llmConfiguration = this._loadLLMConfiguration();
    const language = this.preferences.get(PreferenceKey.appLanguage, 'zh');
    i18n.setLanguage(language === 'en' ? 'en' : 'zh');

    this._scheduleAutoRefresh();
    this._scheduleOutboxDrain();
    this._repairArticleData();
    this._repairAihotArticles();
    this._cleanupDuplicates();
    this._repairAggregatorMeta();
  }

  /**
   * 已入库数据一次性修复（幂等，用偏好标记只跑一次）：
   * 1) 微信/公众号文章 url 的 `&amp;` 实体未解码 → mid/idx/sn 参数丢失 →「打开原文」跳微信。
   */
  _repairArticleData() {
    try {
      if (this.preferences.get('RobinRead.repair.articleData', false)) return;
      const fixed = this.database.prepare(
        "UPDATE articles SET url = REPLACE(url, '&amp;', '&') WHERE url LIKE '%&amp;%'"
      ).run();
      this.preferences.set('RobinRead.repair.articleData', true);
      if (fixed.changes > 0) console.log(`[repair] url 实体解码 ${fixed.changes} 条`);
    } catch (e) {
      console.error('[repair] article data repair failed:', e);
    }
  }

  /**
   * AIHOT 文章兜底重抓（健壮、幂等）：早期版本把 AIHOT 文章 url 从 item 页换成了真实原文
   * （那时误判 item 页为 SPA 空壳），曾删除旧文章等待刷新重抓——但删除后若刷新未触发会导致
   * 「精选/日报」空列表。现在改为：只要某个 AIHOT feed 文章数为 0，就主动触发该 feed 重抓。
   */
  _repairAihotArticles() {
    try {
      const feedIDs = this.database.prepare(
        "SELECT id FROM feeds WHERE feed_url LIKE '%aihot%'"
      ).all().map((r) => r.id);
      const countStmt = this.database.prepare('SELECT COUNT(*) AS n FROM items WHERE feed_id = ?');
      const emptyFeeds = feedIDs.filter((fid) => countStmt.get(fid).n === 0);
      if (emptyFeeds.length === 0) return;
      // 空 feed 主动重抓（异步，不阻塞构造；失败静默，下次启动再试）。
      // 先清 etag/last_modified 缓存——否则 fetchFeed 带旧 etag 得到 304 notModified，不会重抓。
      const clearEtag = this.database.prepare('UPDATE feeds SET etag = NULL, last_modified = NULL WHERE id = ?');
      for (const fid of emptyFeeds) {
        clearEtag.run(fid);
        this.refreshFeed(fid).catch(() => {});
      }
    } catch (e) {
      console.error('[repair] aihot repopulate failed:', e);
    }
  }

  /** 清理重复条目（独立标记，幂等）：同 feed 同规范化 url 保留最早一条，其余级联删除。 */
  _cleanupDuplicates() {
    try {
      if (this.preferences.get('RobinRead.repair.duplicates', false)) return;
      let dupRemoved = 0;
      const dupGroups = this.database.prepare(`
        SELECT i.feed_id, REPLACE(a.url, '&amp;', '&') AS norm_url
        FROM items i INNER JOIN articles a ON a.item_id = i.id
        WHERE a.url IS NOT NULL
        GROUP BY i.feed_id, norm_url HAVING COUNT(*) > 1
      `).all();
      const delItem = this.database.prepare('DELETE FROM items WHERE id = ?');
      for (const g of dupGroups) {
        const rows = this.database.prepare(`
          SELECT i.id FROM items i INNER JOIN articles a ON a.item_id = i.id
          WHERE i.feed_id = ? AND REPLACE(a.url, '&amp;', '&') = ?
          ORDER BY i.created_at ASC, i.id ASC
        `).all(g.feed_id, g.norm_url);
        for (let k = 1; k < rows.length; k++) {
          delItem.run(rows[k].id);
          dupRemoved += 1;
        }
      }
      this.preferences.set('RobinRead.repair.duplicates', true);
      if (dupRemoved > 0) console.log(`[repair] 清理重复条目 ${dupRemoved} 条`);
    } catch (e) {
      console.error('[repair] duplicate cleanup failed:', e);
    }
  }

  /** 已入库 hnrss 等聚合源元信息 content → 友好卡片（独立标记，幂等）。 */
  _repairAggregatorMeta() {
    try {
      if (this.preferences.get('RobinRead.repair.aggregatorMeta', false)) return;
      const { transformAggregatorMeta } = require('./FeedParser');
      const rows = this.database.prepare(
        "SELECT item_id, content_html FROM articles WHERE content_html LIKE '%Article URL:%' AND content_html LIKE '%Comments URL:%'"
      ).all();
      const updHtml = this.database.prepare('UPDATE articles SET content_html = ? WHERE item_id = ?');
      const updSummary = this.database.prepare('UPDATE articles SET summary = ? WHERE item_id = ?');
      let fixed = 0;
      for (const r of rows) {
        const meta = transformAggregatorMeta(r.content_html);
        if (!meta) continue;
        updHtml.run(meta.html || r.content_html, r.item_id);
        if (meta.summary) updSummary.run(meta.summary, r.item_id);
        fixed += 1;
      }
      this.preferences.set('RobinRead.repair.aggregatorMeta', true);
      if (fixed > 0) console.log(`[repair] 聚合源元信息转卡片 ${fixed} 条`);
    } catch (e) {
      console.error('[repair] aggregator meta repair failed:', e);
    }
  }

  // MARK: - 事件

  _emitState() {
    this.emit('state:changed', this.snapshot());
  }

  snapshot() {
    const startOfDay = this._startOfDayTimestamp();
    const enabledAccounts = this.accounts.enabledAccounts();
    const accountIDs = enabledAccounts.map((a) => a.id);
    let sidebarCounts = { allUnread: 0, todayUnread: 0, starred: 0, unreadByFeed: {}, unreadByFolder: {} };
    for (const id of accountIDs) {
      const counts = this.timeline.fetchSidebarCounts(id, startOfDay);
      sidebarCounts = mergeCounts(sidebarCounts, counts);
    }

    return {
      accounts: enabledAccounts,
      allAccounts: this.accounts.listAccounts(),
      sidebarCounts,
      refreshStatus: this.refreshStatus,
      syncStatus: Object.fromEntries(this.syncStatus),
      lastRefreshOutcome: this.lastRefreshOutcome,
      preferences: this.preferencesSnapshot(),
      startOfDay,
    };
  }

  preferencesSnapshot() {
    return {
      appTheme: this.preferences.get(PreferenceKey.appTheme, 'system'),
      articleFontSize: this.preferences.get(PreferenceKey.articleFontSize, 17),
      refreshInterval: this.preferences.get(PreferenceKey.refreshInterval, 'manual'),
      refreshOnLaunch: this.preferences.get(PreferenceKey.refreshOnLaunch, true),
      appLanguage: this.preferences.get(PreferenceKey.appLanguage, 'zh'),
      aiOutputLanguage: this.preferences.get(PreferenceKey.aiOutputLanguage, null),
      automaticallyGenerateSummary: this.llmConfiguration.automaticallyGenerateSummary,
      windowBounds: this.preferences.get(PreferenceKey.windowBounds, null),
      sidebarWidth: this.preferences.get(PreferenceKey.sidebarWidth, 240),
      readerLayout: this.readerLayout(),
      filterRules: this.filterRules(),
      listWidth: this.preferences.get(PreferenceKey.listWidth, 340),
    };
  }

  _startOfDayTimestamp() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return start.getTime() / 1000;
  }

  // MARK: - 侧栏 / 时间线

  sidebarStructure() {
    const accounts = this.accounts.enabledAccounts();
    const result = [];
    for (const account of accounts) {
      const allFeeds = this.feedsRepo.feeds(account.id);
      const byID = new Map(allFeeds.map((f) => [f.id, f]));
      const folders = this.feedsRepo.folders(account.id).map((folder) => {
        const feedIDs = this.feedsRepo.feedIDsInFolder(folder.id);
        return {
          ...folder,
          feedIDs,
          feeds: feedIDs.map((id) => byID.get(id)).filter(Boolean),
        };
      });
      const inFolders = new Set();
      for (const folder of folders) {
        for (const id of folder.feedIDs) inFolders.add(id);
      }
      const rootFeeds = allFeeds.filter((f) => !inFolders.has(f.id));
      result.push({
        account,
        folders,
        rootFeeds,
        rootFeedIDs: rootFeeds.map((f) => f.id),
        allFeeds,
      });
    }
    return result;
  }

  // MARK: - 信噪评分与过滤（降噪引擎）

  filterRules() {
    return {
      minScore: Number(this.preferences.get('RobinRead.minScore', 1)) || 1,
      blockKeywords: String(this.preferences.get('RobinRead.blockKeywords', '') || '')
        .split(/[\n,，]/).map((s) => s.trim()).filter(Boolean),
      boostKeywords: String(this.preferences.get('RobinRead.boostKeywords', '') || '')
        .split(/[\n,，]/).map((s) => s.trim()).filter(Boolean),
      personalization: Math.max(0, Math.min(3, Number(this.preferences.get('RobinRead.personalization', 2)) || 0)),
    };
  }

  setFilterRules(patch) {
    if (patch.minScore != null) {
      this.preferences.set('RobinRead.minScore', Math.max(1, Math.min(5, Number(patch.minScore) || 1)));
    }
    if (patch.blockKeywords != null) this.preferences.set('RobinRead.blockKeywords', String(patch.blockKeywords));
    if (patch.boostKeywords != null) this.preferences.set('RobinRead.boostKeywords', String(patch.boostKeywords));
    if (patch.personalization != null) {
      this.preferences.set('RobinRead.personalization', Math.max(0, Math.min(3, Number(patch.personalization) || 0)));
    }
    this._emitState();
    return this.filterRules();
  }

  /** 对列表项统一打分并按阈值过滤（叠加兴趣画像 boost）。 */
  _applyScoring(items) {
    const rules = this.filterRules();
    // 个性化关闭（强度 0）时跳过画像 boost
    const interestTags = rules.personalization > 0 ? this._interestTagSet() : [];
    const tagByItem = interestTags.length ? this._tagMapForItems(items) : null;
    return items
      .map((item) => ({ ...item, score: this._scoreEntry(item, interestTags, tagByItem, rules.personalization) }))
      .filter((item) => item.score >= rules.minScore);
  }

  /** 兴趣画像标签集合（供打分 boost 用，懒缓存 60s）。 */
  _interestTagSet() {
    if (this._interestCache && Date.now() - this._interestCache.at < 60000) {
      return this._interestCache.tags;
    }
    let tags = [];
    try {
      const profile = this.evolution.interestProfile();
      tags = (profile.tags || []).map((t) => t.tag);
    } catch (_) { /* 画像不可用时降级为无 boost */ }
    this._interestCache = { tags, at: Date.now() };
    return tags;
  }

  /** 批量取 items 的标签映射（itemID → [tags]）。 */
  _tagMapForItems(items) {
    const ids = items.map((i) => i.id);
    if (!ids.length) return new Map();
    const ph = ids.map(() => '?').join(',');
    const rows = this.database.prepare(`SELECT item_id, tag FROM article_tags WHERE item_id IN (${ph})`).all(...ids);
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.item_id)) map.set(r.item_id, []);
      map.get(r.item_id).push(r.tag);
    }
    return map;
  }

  /** 启发式评分 1-5：标题党扣分、长度加分、关键词规则、兴趣标签 boost。 */
  _scoreEntry(item, interestTags = [], tagByItem = null, personalization = 0) {
    const rules = this.filterRules();
    const title = String(item.title || '');
    const summary = String(item.summaryPreview || '');
    let score = 3;

    // 标题党特征
    const clickbait = /(!|！){2,}|震惊|惊呆|不看你后悔|重磅!!|速看|疯传|逆天了/.test(title)
      || (/^\d+个/.test(title) && title.length < 14);
    if (clickbait) score -= 2;
    else if (/(!!|！！)/.test(title)) score -= 1;

    // 内容充实度
    if (summary.length > 400) score += 1;
    else if (summary.length > 200) score += 0.5;
    if (title.length > 12 && !clickbait) score += 0.5;

    // 用户关键词规则
    const haystack = title + ' ' + summary;
    for (const keyword of rules.boostKeywords) {
      if (keyword && haystack.includes(keyword)) { score += 1; break; }
    }
    for (const keyword of rules.blockKeywords) {
      if (keyword && haystack.includes(keyword)) { return 0; } // 屏蔽词：直接归零，必被阈值滤除
    }

    // 兴趣标签 boost（自进化：命中画像标签的文章浮到更靠前；强度可控）
    if (tagByItem && interestTags.length && personalization > 0) {
      const itemTags = tagByItem.get(item.id) || [];
      const hits = itemTags.filter((t) => interestTags.includes(t)).length;
      if (hits > 0) score += Math.min(1.5, hits * 0.5 * personalization);
    }

    return Math.max(1, Math.min(5, Math.round(score)));
  }

  /** 规范化 scope（today 需要 startOfDay；渲染层可以省略）。 */
  _normalizedScope(scope) {
    if (scope && scope.kind === 'today' && scope.startOfDay == null) {
      return { ...scope, startOfDay: this._startOfDayTimestamp() };
    }
    return scope;
  }

  listItems(scope, { limit = DEFAULT_TIMELINE_LIMIT, offset = 0, retainingIDs = [] } = {}) {
    scope = this._normalizedScope(scope);
    const enabledAccounts = this.accounts.enabledAccounts();
    if (enabledAccounts.length === 0) return [];
    if (enabledAccounts.length === 1) {
      return this._applyScoring(this.timeline.fetchListItems({
        accountID: enabledAccounts[0].id,
        scope, limit, offset, retainingIDs,
      }));
    }
    // 多账户：先按账户分别取再合并排序
    const merged = [];
    for (const account of enabledAccounts) {
      merged.push(...this.timeline.fetchListItems({ accountID: account.id, scope, limit, offset: 0, retainingIDs }));
    }
    merged.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
    return this._applyScoring(merged.slice(offset, offset + limit));
  }

  entry(entryID) {
    return this.articlesRepo.entry(entryID);
  }

  feed(feedID) {
    return this.feedsRepo.feed(feedID);
  }

  adjacentItem(scope, currentItemID, direction) {
    scope = this._normalizedScope(scope);
    const enabledAccounts = this.accounts.enabledAccounts();
    for (const account of enabledAccounts) {
      const item = this.timeline.fetchAdjacentItem({
        accountID: account.id,
        scope,
        currentItemID,
        direction,
        retainingIDs: direction === 'next' ? this._retainedUnreadIDs : this._retainedStarredIDs,
      });
      if (item) return item;
    }
    return null;
  }

  // MARK: - Feed 管理

  async addFeed(urlText, folder = null) {
    const trimmed = (urlText || '').trim();
    if (!trimmed) throw new Error(i18n.localized('请输入订阅地址。'));
    let feedURL = trimmed;
    if (!/^https?:\/\//i.test(feedURL)) feedURL = `https://${feedURL}`;
    try { new URL(feedURL); } catch (_) {
      throw new Error(i18n.localized('此地址不是可识别的 RSS、Atom 或 JSON Feed。'));
    }

    const existing = this.feedsRepo.feedByURL(LOCAL_ACCOUNT_ID, feedURL);
    if (existing) throw new Error(i18n.localized('这个订阅已经存在。'));

    // 订阅源数量门控（免费版上限；会员无限。覆盖手动添加/商店订阅全部路径）
    if (this.accountGate) {
      const gate = this.accountGate.canAddFeeds(this.feedsRepo.allFeeds().length);
      if (!gate.ok) throw gate.error;
    }

    const result = await fetchFeed({ feedURL });
    if (result.notModified) throw new Error(i18n.localized('Feed 内容格式不完整。'));

    let folderID = null;
    if (folder && folder.trim()) {
      folderID = this.feedsRepo.ensureFolder(LOCAL_ACCOUNT_ID, folder.trim()).id;
    }

    const feed = this.feedsRepo.insertFeed({
      accountID: LOCAL_ACCOUNT_ID,
      title: result.parsed.title,
      siteURL: result.parsed.siteURL,
      feedURL,
      storedIconURL: result.parsed.iconURL,
    });
    if (folderID) this.feedsRepo.setFeedFolder(feed.id, folderID);

    this._applyParsedEntries(feed, result.parsed.entries);
    this.feedsRepo.updateFeed(feed.id, (f) => ({ ...f, lastRefreshedAt: nowSeconds() }));
    this._emitState();
    return this.feedsRepo.feed(feed.id);
  }

  _applyParsedEntries(feed, parsedEntries) {
    const cutoff = nowSeconds() - 90 * 24 * 3600; // 90 天保留窗口
    let newUnread = [];
    const toPrefetch = [];
    for (const parsed of parsedEntries) {
      const publishedAt = parsed.publishedAt ?? nowSeconds();
      if (publishedAt < cutoff) continue;
      const entryID = `local:${feed.id}:${stableDigest(parsed.id)}`;
      const existing = this.articlesRepo.entry(entryID);
      if (existing) continue;
      // 按规范化 url 兜底去重：wechat2rss 等源无稳定 guid（stable 落到 url），
      // url 实体解码前后（&amp; vs &）会生成不同 digest → 同一篇重复入库。
      if (parsed.url && this._entryExistsByURL(feed.id, parsed.url)) continue;
      this.articlesRepo.upsertEntry({
        id: entryID,
        accountID: feed.accountID,
        externalID: entryID,
        feedID: feed.id,
        title: parsed.title,
        author: parsed.author,
        url: parsed.url,
        publishedAt,
        summary: parsed.summary,
        contentHTML: parsed.contentHTML,
        dateArrived: nowSeconds(),
      });
      // 自动打标签（喂给兴趣画像，零 LLM 成本）
      try { this.knowledge.autoTagEntry(entryID, parsed.title, parsed.summary); } catch (_) { /* 忽略 */ }
      newUnread.push(entryID);
      // AIHOT 聚合站：标记待预抓 item 页完整内容（打开时秒出，不用等抓取）
      if (parsed.url && /^https?:\/\/aihot\.virxact\.com\/items\//i.test(parsed.url)) {
        toPrefetch.push(entryID);
      }
    }
    if (newUnread.length > 200) newUnread = newUnread.slice(0, 200);
    // 后台预抓 AIHOT item 页（异步串行，不阻塞刷新；失败静默）
    if (toPrefetch.length) this._prefetchArticles(toPrefetch);
    return newUnread;
  }

  /** 后台预抓 AIHOT 文章 item 页完整内容（并发 3 + 跳过已有缓存 + 失败静默）。 */
  _prefetchArticles(entryIDs) {
    const concurrency = 3;
    let cursor = 0;
    const worker = async () => {
      while (cursor < entryIDs.length) {
        const id = entryIDs[cursor++];
        if (this.cachesRepo.cache(id)) continue; // 已有缓存跳过
        try { await this.extractArticle(id); } catch (_) { /* 单篇失败不影响其余 */ }
      }
    };
    const workers = Array.from({ length: Math.min(concurrency, entryIDs.length) }, () => worker());
    Promise.all(workers).catch(() => {});
  }

  /** 同 feed 下是否已存在相同（规范化）url 的文章——url 是聚合源的稳定身份标识。 */
  _entryExistsByURL(feedID, url) {
    const normalized = String(url || '').replace(/&amp;/gi, '&');
    if (!normalized) return false;
    const row = this.database.prepare(`
      SELECT 1 FROM articles a INNER JOIN items i ON i.id = a.item_id
      WHERE i.feed_id = ? AND REPLACE(a.url, '&amp;', '&') = ? LIMIT 1
    `).get(feedID, normalized);
    return !!row;
  }

  deleteFeeds(feedIDs) {
    for (const feedID of feedIDs) {
      this.articlesRepo.deleteEntriesForFeed(feedID);
      this.feedsRepo.deleteFeed(feedID);
    }
    this._emitState();
  }

  setFeedFolder(feedIDs, folderName) {
    for (const feedID of feedIDs) {
      const feed = this.feedsRepo.feed(feedID);
      if (!feed) continue;
      if (folderName == null || folderName === '') {
        this.feedsRepo.setFeedFolder(feedID, null);
      } else {
        const folder = this.feedsRepo.ensureFolder(feed.accountID, folderName);
        this.feedsRepo.setFeedFolder(feedID, folder.id);
      }
    }
    this._pruneEmptyFolders();
    this._emitState();
  }

  _pruneEmptyFolders() {
    for (const account of this.accounts.listAccounts()) {
      for (const folder of this.feedsRepo.folders(account.id)) {
        const feedIDs = this.feedsRepo.feedIDsInFolder(folder.id);
        if (feedIDs.length === 0) this.feedsRepo.deleteFolder(folder.id);
      }
    }
  }

  addFolder(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    this.feedsRepo.ensureFolder(LOCAL_ACCOUNT_ID, trimmed);
    this._emitState();
  }

  renameFolder(folderID, newName) {
    this.feedsRepo.renameFolder(folderID, (newName || '').trim());
    this._emitState();
  }

  deleteFolder(folderID) {
    // 文件夹内的订阅移回根层级
    this.feedsRepo.setFeedFolder;
    for (const feedID of this.feedsRepo.feedIDsInFolder(folderID)) {
      this.feedsRepo.setFeedFolder(feedID, null);
    }
    this.feedsRepo.deleteFolder(folderID);
    this._emitState();
  }

  importOPML(data) {
    const urls = OPMLService.importURLs(data);
    const existing = new Set(this.feedsRepo.allFeeds().map((f) => f.feedURL));
    // 免费版按剩余额度截断导入；已达上限直接拒绝（会员无限）
    let capacity = Infinity;
    if (this.accountGate) {
      const gate = this.accountGate.canAddFeeds(this.feedsRepo.allFeeds().length);
      if (!gate.ok) throw gate.error;
      if (!gate.unlimited) capacity = Math.max(0, gate.limit - this.feedsRepo.allFeeds().length);
    }
    let added = 0;
    for (const url of urls) {
      if (existing.has(url)) continue;
      if (added >= capacity) break;
      this.feedsRepo.insertFeed({ accountID: LOCAL_ACCOUNT_ID, title: url, feedURL: url });
      added += 1;
    }
    this._emitState();
    return { total: urls.length, added, limited: added < urls.length };
  }

  exportOPML() {
    const all = [];
    for (const account of this.accounts.listAccounts()) {
      all.push(...this.feedsRepo.feeds(account.id));
    }
    return OPMLService.exportOPML(all);
  }

  // MARK: - 阅读状态

  markRead(entryID, read = true) {
    this.statesRepo.setRead(entryID, read);
    if (read) this.knowledge.bumpRead();
    const entry = this.articlesRepo.entry(entryID);
    if (entry && entry.accountID !== LOCAL_ACCOUNT_ID) {
      this.statesRepo.enqueueOutbox(entry.accountID, entryID, 'read', read);
      this._scheduleOutboxDrain(1500);
    }
    if (read) this._retainedUnreadIDs.add(entryID);
    if (entry) this.evolution.recordBehavior({ itemID: entryID, feedID: entry.feedID, action: read ? 'read' : 'skip' });
    this._emitState();
  }

  toggleStar(entryID) {
    const entry = this.articlesRepo.entry(entryID);
    if (!entry) return;
    const next = !entry.isStarred;
    this.statesRepo.setStarred(entryID, next);
    if (next) this._retainedStarredIDs.add(entryID);
    if (entry.accountID !== LOCAL_ACCOUNT_ID) {
      this.statesRepo.enqueueOutbox(entry.accountID, entryID, 'starred', next);
      this._scheduleOutboxDrain(1500);
    }
    this.evolution.recordBehavior({ itemID: entryID, feedID: entry.feedID, action: next ? 'star' : 'skip' });
    this._emitState();
    return next;
  }

  markAllRead(scope) {
    scope = this._normalizedScope(scope);
    const items = this.listItems(scope, { limit: 5000 });
    const entryIDs = [];
    const byAccount = new Map();
    for (const item of items) {
      if (item.isRead) continue;
      entryIDs.push(item.id);
      if (!byAccount.has(item.accountID)) byAccount.set(item.accountID, []);
      byAccount.get(item.accountID).push(item.id);
    }
    for (const entryID of entryIDs) this.statesRepo.setRead(entryID, true);
    for (const [accountID, ids] of byAccount) {
      if (accountID === LOCAL_ACCOUNT_ID) continue;
      for (const id of ids) this.statesRepo.enqueueOutbox(accountID, id, 'read', true);
    }
    if (byAccount.size > 0 && [...byAccount.keys()].some((id) => id !== LOCAL_ACCOUNT_ID)) {
      this._scheduleOutboxDrain(1500);
    }
    this._emitState();
    return entryIDs.length;
  }

  // MARK: - 正文提取

  articleContent(entryID) {
    const entry = this.articlesRepo.entry(entryID);
    if (!entry) return null;
    const cache = this.cachesRepo.cache(entryID);
    const sourceText = entry.contentHTML ? plainText(entry.contentHTML) : plainText(entry.summary || '');
    if (cache) {
      // 坏缓存自愈：缓存正文明显短于 RSS 原文（旧版把站点拦截壳写进了缓存）时，
      // 丢弃缓存回退 RSS 原文，并清掉脏行，避免「正文永远显示壳」
      const sourceLen = entry.contentHTML ? plainText(entry.contentHTML).length : 0;
      const cacheLen = cache.html ? plainText(cache.html).length : 0;
      if (sourceLen > 400 && cacheLen > 0 && cacheLen < sourceLen * 0.4) {
        this.cachesRepo.deleteCache(entryID);
      } else {
        return {
          html: cache.html,
          text: cache.text,
          fromCache: true,
        };
      }
    }
    // RSS content 直接白名单消毒（Readability 是为「完整网页」设计的，会误判
    // 已是正文片段的 RSS content 并把完整正文精简成几行——不在这里用它）。
    const html = entry.contentHTML ? ArticleExtractor.sanitizedHTML(entry.contentHTML, entry.url) : null;
    return {
      html,
      text: sourceText,
      fromCache: false,
      needsExtraction: ArticleExtractor.needsExtraction(entry),
    };
  }

  async extractArticle(entryID) {
    const entry = this.articlesRepo.entry(entryID);
    if (!entry || !entry.url) return null;
    const cache = await ArticleExtractor.extract(entry.url);
    cache.entryID = entryID;
    // 抓取质量守门：抓回正文明显短于现有正文（多为站点拦截壳/登录页）时不落库——
    // 壳一旦写进 article_caches 会无条件覆盖，之后每次打开都拿到壳，正文不可恢复
    const existing = this.cachesRepo.cache(entryID);
    const existingLen = Math.max(
      entry.contentHTML ? plainText(entry.contentHTML).length : 0,
      existing?.html ? plainText(existing.html).length : 0,
    );
    const gotLen = cache.html ? plainText(cache.html).length : 0;
    const isShell = existingLen > 400 && gotLen > 0 && gotLen < existingLen * 0.4;
    if (!isShell) {
      this.cachesRepo.saveCache(cache);
      this._emitState();
    }
    return cache;
  }

  /** 单源刷新（侧栏右键「刷新此源」）。 */
  async refreshFeed(feedID) {
    const feed = this.feedsRepo.feed(feedID);
    if (!feed) throw new Error('feed not found');
    if (feed.accountID !== LOCAL_ACCOUNT_ID) {
      await this.syncFreshRSS(feed.accountID, { origin: 'manual' });
      return { synced: true };
    }
    const { fetchFeed } = require('./FeedService');
    const result = await fetchFeed(feed);
    if (result.notModified) {
      this.feedsRepo.updateFeed(feedID, (f) => ({ ...f, lastRefreshedAt: nowSeconds() }));
      return { newEntries: 0 };
    }
    const newIDs = this._applyParsedEntries(feed, result.parsed.entries);
    this.feedsRepo.updateFeed(feedID, (f) => ({
      ...f,
      title: result.parsed.title || f.title,
      siteURL: result.parsed.siteURL ?? f.siteURL,
      storedIconURL: result.parsed.iconURL ?? f.storedIconURL,
      etag: result.etag,
      lastModified: result.lastModified,
      lastRefreshedAt: nowSeconds(),
    }));
    this._emitState();
    return { newEntries: newIDs.length };
  }

  /** 全文搜索：标题/摘要/作者 + 正文内容（article_caches.text）。 */
  fullTextSearch(query, { limit = 60 } = {}) {
    const trimmed = String(query || '').trim();
    if (!trimmed) return [];
    const pattern = `%${trimmed.replace(/[%_]/g, (c) => '\\' + c)}%`;
    const rows = this.database.prepare(`
      SELECT
          i.id AS entry_id, i.feed_id AS feed_id, i.account_id AS account_id,
          COALESCE(acc.type, 'local') AS account_type,
          COALESCE(acc.display_name, 'Local') AS account_display_name,
          COALESCE(a.title, '') AS title, a.url AS url,
          COALESCE(a.summary, '') AS summary,
          f.title AS feed_title, f.stored_icon_url AS stored_icon_url,
          f.site_url AS site_url, f.feed_url AS feed_url,
          a.published_at AS published_at,
          COALESCE(s.is_read, 0) AS is_read, COALESCE(s.is_starred, 0) AS is_starred,
          COALESCE(c.text, '') AS body_text
      FROM items i
      INNER JOIN feeds f ON f.id = i.feed_id
      LEFT JOIN accounts acc ON acc.id = i.account_id
      LEFT JOIN articles a ON a.item_id = i.id
      LEFT JOIN article_states s ON s.item_id = i.id
      LEFT JOIN article_caches c ON c.item_id = i.id
      WHERE f.is_deleted = 0
        AND (a.title LIKE ? ESCAPE '\\' OR a.summary LIKE ? ESCAPE '\\' OR a.author LIKE ? ESCAPE '\\' OR c.text LIKE ? ESCAPE '\\')
      ORDER BY COALESCE(a.published_at, i.created_at) DESC
      LIMIT ?
    `).all(pattern, pattern, pattern, pattern, limit);
    const { rowToListItem } = require('./Persistence/TimelineQueryService');
    return rows.map((row) => {
      const item = rowToListItem(row);
      const snippet = this._snippet(row.body_text, trimmed);
      // 正文命中时用片段作为摘要预览，让搜索上下文更直观
      if (snippet && !item.summaryPreview) item.summaryPreview = snippet;
      return { ...item, snippet };
    });
  }

  _snippet(text, query) {
    if (!text) return '';
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx < 0) return text.slice(0, 120);
    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, idx + query.length + 80);
    return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
  }

  /** 全局搜索：标题/摘要/作者 LIKE。 */
  searchEntries(query, { limit = 80 } = {}) {
    const trimmed = String(query || '').trim();
    if (!trimmed) return [];
    const pattern = `%${trimmed.replace(/([%_])/g, '\$1')}%`;
    const rows = this.database.prepare(`
      SELECT
          i.id AS entry_id, i.feed_id AS feed_id, i.account_id AS account_id,
          COALESCE(acc.type, 'local') AS account_type,
          COALESCE(acc.display_name, 'Local') AS account_display_name,
          COALESCE(a.title, '') AS title, a.url AS url,
          COALESCE(a.summary, '') AS summary,
          f.title AS feed_title, f.stored_icon_url AS stored_icon_url,
          f.site_url AS site_url, f.feed_url AS feed_url,
          a.published_at AS published_at,
          COALESCE(s.is_read, 0) AS is_read, COALESCE(s.is_starred, 0) AS is_starred
      FROM items i
      INNER JOIN feeds f ON f.id = i.feed_id
      LEFT JOIN accounts acc ON acc.id = i.account_id
      LEFT JOIN articles a ON a.item_id = i.id
      LEFT JOIN article_states s ON s.item_id = i.id
      WHERE f.is_deleted = 0
        AND (a.title LIKE ? ESCAPE '' OR a.summary LIKE ? ESCAPE '' OR a.author LIKE ? ESCAPE '')
      ORDER BY COALESCE(a.published_at, i.created_at) DESC
      LIMIT ?
    `).all(pattern, pattern, pattern, limit);
    const { rowToListItem } = require('./Persistence/TimelineQueryService');
    return rows.map(rowToListItem);
  }

  /** 今日 AI 简报：汇总今天（或最近）文章标题与摘要，流式生成。 */
  /** 本地日期键（YYYY-MM-DD，日报缓存按天）。 */
  _digestDateKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** 当日已生成的简报缓存（秒开），跨天自动失效。v2 为结构化版本。 */
  cachedTodayDigest() {
    const key = `RobinRead.digest.v2.${this._digestDateKey()}`;
    return this.preferences.get(key, null);
  }

  _saveTodayDigest(content, itemCount, entryRefs = []) {
    const date = this._digestDateKey();
    const key = `RobinRead.digest.v2.${date}`;
    // 只保留当天的缓存：清掉更早日期的 digest 键
    const latestDate = this.preferences.get('RobinRead.digest.latestDate', null);
    if (latestDate && latestDate !== date) {
      this.preferences.remove(`RobinRead.digest.${latestDate}`);
      this.preferences.remove(`RobinRead.digest.v2.${latestDate}`);
    }
    this.preferences.set('RobinRead.digest.latestDate', date);
    this.preferences.set(key, { date, content, items: itemCount, entryRefs, at: nowSeconds() });
  }

  async generateTodayDigest(onDelta) {
    const { config, apiKey } = this._requireAIReady();
    const items = this.listItems({ kind: 'today' }, { limit: 40 });
    let source = items;
    if (source.length === 0) source = this.listItems({ kind: 'unread' }, { limit: 30 });
    if (source.length === 0) throw new Error(i18n.localized('今天还没有可汇总的文章。'));

    const lines = source.slice(0, 40).map((item, index) => {
      const preview = String(item.summaryPreview || '').replace(/\s+/g, ' ').slice(0, 160);
      return `${index + 1}. ${item.title}${preview ? ' — ' + preview : ''}`;
    });
    // 提示词 v2：结构化主题分组 + [n] 来源编号标注（渲染端把 [n] 变为可点击跳转的来源芯片）
    const prompt = `以下是信息流中的 ${lines.length} 篇文章（每篇前的编号即其来源编号）：\n${lines.join('\n')}\n\n请生成今日中文科技简报，严格输出以下 Markdown 结构（不要添加结构之外的标题）：\n## 总览\n一两句话概括今日整体动态。\n## 主题：<名称>\n3-6 个主题小节，每节 2-4 条要点，每条以「- 」开头、一句加粗短语 + 一句说明，并在该条末尾标注来源编号，如 [3]。同一主题可引多篇。\n## 值得深读\n一条最值得完整阅读的文章：一句推荐理由 + 来源编号。\n只基于给定文章，禁止编造。`;
    const content = await this.llm.complete({
      prompt,
      system: `你是一位顶级中文科技编辑，为读者产出高质量、信息密度高的每日简报。输出为简体中文 Markdown，遵循用户给定的结构；来源编号必须只使用文章列表中真实存在的编号。`,
      configuration: config,
      apiKey,
      onDelta,
      forceDisableReasoning: true,
      overrideTemperature: 0.2,
    });
    // 来源引用表：编号 → 文章（渲染端点击跳转）
    const entryRefs = source.slice(0, 40).map((item, index) => ({ n: index + 1, id: item.id, title: item.title }));
    this._saveTodayDigest(content, source.length, entryRefs);

    const entry = {
      id: 'digest:today',
      accountID: LOCAL_ACCOUNT_ID,
      feedID: 'digest',
      title: i18n.localized('今日 AI 简报'),
      author: null, url: null,
      publishedAt: nowSeconds(),
      summary: content.slice(0, 400),
      contentHTML: `<h2>${i18n.localized('今日 AI 简报')}</h2>${escapeHtmlminimal(content).split('\n').map((l) => `<p>${l}</p>`).join('')}`,
      isRead: false, isStarred: false, updatedAt: nowSeconds(),
    };
    return { content, items: source.length, entryRefs, entry };
  }

  /**
   * 数据管家：每日一次的轻量维护。
   * - 清理孤儿 AI 产物（文章已删除后残留的摘要/翻译/划词解析）
   * - 清理过期正文缓存（45 天前的网页提取结果）
   * - 行为流封顶（保留最近 5000 条，兴趣画像足够）
   */
  housekeeping() {
    const dateKey = 'RobinRead.housekeeping.date';
    const today = new Date().toISOString().slice(0, 10);
    if (this.preferences.get(dateKey, null) === today) return;
    this.preferences.set(dateKey, today);
    try {
      const before = {
        artifacts: this.database.prepare('SELECT COUNT(*) c FROM ai_artifacts').get().c,
        caches: this.database.prepare('SELECT COUNT(*) c FROM article_caches').get().c,
      };
      this.database.exec(`
        DELETE FROM ai_artifacts WHERE item_id NOT IN (SELECT id FROM items)
          AND updated_at < strftime('%s','now','-7 days');
        DELETE FROM article_caches WHERE item_id NOT IN (SELECT id FROM items)
          OR fetched_at < strftime('%s','now','-45 days');
        DELETE FROM reading_behavior WHERE id IN (
          SELECT id FROM reading_behavior ORDER BY created_at DESC LIMIT -1 OFFSET 5000
        );
      `);
      const after = {
        artifacts: this.database.prepare('SELECT COUNT(*) c FROM ai_artifacts').get().c,
        caches: this.database.prepare('SELECT COUNT(*) c FROM article_caches').get().c,
      };
      if (before.artifacts !== after.artifacts || before.caches !== after.caches) {
        console.log(`[RobinRead] 数据管家：AI 产物 ${before.artifacts}→${after.artifacts}，正文缓存 ${before.caches}→${after.caches}`);
      }
    } catch (err) {
      console.warn('[RobinRead] 数据管家执行失败：', err.message);
    }
  }

  // MARK: - 刷新

  async refresh(origin = 'manual') {
    if (this.refreshStatus.state === 'refreshing') return;
    this.refreshStatus = { state: 'refreshing' };
    this._emitState();
    this.housekeeping(); // 刷新前顺手做每日维护（内部有当日节流）

    const enabledAccounts = this.accounts.enabledAccounts();
    let updatedFeeds = 0;
    let failedFeeds = 0;
    const newUnreadEntries = [];

    try {
      for (const account of enabledAccounts) {
        if (account.type === 'local') {
          const feeds = this.feedsRepo.feeds(account.id);
          const results = await Promise.allSettled(feeds.map((feed) => this._refreshLocalFeed(feed)));
          for (const result of results) {
            if (result.status === 'fulfilled') {
              updatedFeeds += 1;
              newUnreadEntries.push(...result.value);
            } else {
              failedFeeds += 1;
            }
          }
        } else if (account.type === 'freshRSS') {
          try {
            await this.syncFreshRSS(account.id, { origin });
            updatedFeeds += 1;
          } catch (err) {
            failedFeeds += 1;
            this.syncStatus.set(account.id, { state: 'failed', message: errorMessage(err) });
          }
        }
      }

      this.lastRefreshOutcome = {
        origin,
        updatedFeedCount: updatedFeeds,
        failedFeedCount: failedFeeds,
        newUnreadCount: newUnreadEntries.length,
        finishedAt: nowSeconds(),
      };
      this.refreshStatus = {
        state: 'completed',
        updatedFeeds,
        finishedAt: nowSeconds(),
      };
    } catch (err) {
      this.refreshStatus = { state: 'failed', message: errorMessage(err), finishedAt: nowSeconds() };
    }
    this._emitState();
  }

  async _refreshLocalFeed(feed) {
    let result;
    try {
      result = await fetchFeed(feed);
    } catch (err) {
      this.evolution.recordFetch({ feedID: feed.id, ok: false, error: err?.message || String(err) });
      throw err;
    }
    if (result.notModified) {
      this.feedsRepo.updateFeed(feed.id, (f) => ({
        ...f, etag: result.etag ?? f.etag, lastModified: result.lastModified ?? f.lastModified, lastRefreshedAt: nowSeconds(),
      }));
      this.evolution.recordFetch({ feedID: feed.id, ok: true, entryCount: 0 });
      return [];
    }
    const newIDs = this._applyParsedEntries(feed, result.parsed.entries);
    this.feedsRepo.updateFeed(feed.id, (f) => ({
      ...f,
      title: (result.parsed.title || f.title),
      siteURL: result.parsed.siteURL ?? f.siteURL,
      storedIconURL: result.parsed.iconURL ?? f.storedIconURL,
      etag: result.etag,
      lastModified: result.lastModified,
      lastRefreshedAt: nowSeconds(),
    }));
    this.evolution.recordFetch({ feedID: feed.id, ok: true, entryCount: (result.parsed.entries || []).length });
    return newIDs.map((id) => this.articlesRepo.entry(id)).filter(Boolean);
  }

  _scheduleAutoRefresh() {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
    const raw = this.preferences.get(PreferenceKey.refreshInterval, 'manual');
    const seconds = refreshIntervalSeconds(raw);
    if (seconds) {
      this._refreshTimer = setInterval(() => {
        this.refresh('scheduled').catch(() => { /* 状态已在内部记录 */ });
      }, seconds * 1000);
    }
  }

  setRefreshInterval(rawValue) {
    this.preferences.set(PreferenceKey.refreshInterval, rawValue);
    this._scheduleAutoRefresh();
    this._emitState();
  }

  setRefreshOnLaunch(enabled) {
    this.preferences.set(PreferenceKey.refreshOnLaunch, Boolean(enabled));
    this._emitState();
  }

  // MARK: - FreshRSS 账户

  async addFreshRSSAccount({ displayName, endpointURL, username, password }) {
    const canonical = canonicalBaseURL(endpointURL);
    // 先验证凭据（一次性 Authenticator，不落地）
    const probe = new ReaderAPIAuthenticator();
    await probe.login(endpointURL, username, password);

    const account = this.accounts.insertFreshRSSAccount({ displayName, endpointURL: canonical, username });
    this.credentials.setFreshRSSPassword(account.id, password);
    this._getClient(account.id, account);
    this._emitState();
    // 后台执行初始同步
    this.syncFreshRSS(account.id, { origin: 'accountAdded' }).catch(() => { /* 状态已记录 */ });
    return account;
  }

  removeAccount(accountID) {
    this.credentials.deleteFreshRSSPassword(accountID);
    this.accounts.deleteAccount(accountID);
    this.apiClients.delete(accountID);
    this._emitState();
  }

  setAccountEnabled(accountID, isEnabled) {
    this.accounts.setEnabled(accountID, Boolean(isEnabled));
    this._emitState();
  }

  _getClient(accountID, account = null) {
    if (!this.apiClients.has(accountID)) {
      const acc = account || this.accounts.account(accountID);
      if (!acc) return null;
      this.apiClients.set(accountID, new ReaderAPIClient({
        endpointURL: acc.endpointURL,
        username: acc.username,
        accountID: acc.id,
        credentialStore: this.credentials,
      }));
    }
    return this.apiClients.get(accountID);
  }

  async validateFreshRSSCredentials(endpointURL, username, password) {
    const probe = new ReaderAPIAuthenticator();
    await probe.login(endpointURL, username, password);
  }

  /** FreshRSS 同步：订阅列表 + 增量文章 + 未读/星标对账 + outbox 回放。 */
  async syncFreshRSS(accountID, { origin = 'manual' } = {}) {
    const account = this.accounts.account(accountID);
    if (!account || account.type !== 'freshRSS') return;
    const client = this._getClient(accountID, account);
    if (!client) return;

    this.syncStatus.set(accountID, { state: 'syncing', message: null });
    this._emitState();
    const syncState = this.accounts.getSyncState(accountID);

    try {
      this.accounts.upsertSyncState(accountID, (s) => ({ ...s, lastSyncStartedAt: nowSeconds() }));

      // 1. 订阅列表同步
      const subscriptions = await client.fetchSubscriptions();
      this._reconcileSubscriptions(accountID, subscriptions);

      // 2. 文章内容（首启全量 recent，后续增量）
      const knownIDs = this.articlesRepo.knownExternalIDs(accountID);
      const idMap = this.articlesRepo.externalIDToItemID(accountID);
      let items = [];
      if (!syncState.initialSyncCompleted) {
        const recent = await client.fetchRecentStreamContents(200);
        items = recent;
      } else {
        const incremental = await client.fetchIncrementalStreamContents({
          sinceTimestamp: syncState.lastArticleFetchAt,
          knownLocalExternalIDs: knownIDs,
        });
        items = incremental.items;
      }
      this._applyReaderItems(accountID, items, idMap);

      // 3. 未读/星标对账
      const unreadSet = await client.fetchAllUnreadItemIDs();
      const starredSet = await client.fetchAllStarredItemIDs();
      this._reconcileStates(accountID, unreadSet.ids, starredSet.ids);

      this.accounts.upsertSyncState(accountID, (s) => ({
        ...s,
        initialSyncCompleted: true,
        lastSyncCompletedAt: nowSeconds(),
        lastArticleFetchAt: nowSeconds(),
        consecutiveFailureCount: 0,
        lastError: null,
      }));

      // 4. 回放本地变更
      await this._drainOutbox(accountID);

      this.syncStatus.set(accountID, { state: 'completed', message: null, finishedAt: nowSeconds() });
    } catch (err) {
      this.accounts.upsertSyncState(accountID, (s) => ({
        ...s,
        consecutiveFailureCount: s.consecutiveFailureCount + 1,
        lastError: errorMessage(err),
      }));
      this.syncStatus.set(accountID, { state: 'failed', message: errorMessage(err), finishedAt: nowSeconds() });
    }
    this._emitState();
  }

  _reconcileSubscriptions(accountID, subscriptions) {
    const byExternal = new Map();
    for (const sub of subscriptions) {
      byExternal.set(sub.id, sub);
      const existing = this.feedsRepo.feedByExternalID(accountID, sub.id);
      if (existing) {
        this.feedsRepo.updateFeed(existing.id, (f) => ({
          ...f,
          title: sub.title || f.title,
          siteURL: sub.htmlUrl ?? f.siteURL,
          feedURL: sub.url ?? f.feedURL,
          storedIconURL: sub.iconUrl ?? f.storedIconURL,
        }));
      } else {
        this.feedsRepo.insertFeed({
          accountID,
          externalID: sub.id,
          title: sub.title || sub.id,
          siteURL: sub.htmlUrl,
          feedURL: sub.url || sub.htmlUrl || sub.id,
          storedIconURL: sub.iconUrl,
        });
      }
      // 分类 → folders
      for (const category of sub.categories || []) {
        if (!category.label) continue;
        const folder = this.feedsRepo.ensureFolder(accountID, category.label, category.id);
        const feed = this.feedsRepo.feedByExternalID(accountID, sub.id);
        if (feed) this.feedsRepo.setFeedFolder(feed.id, folder.id);
      }
    }
    // 远端已删除的订阅 → 本地软删
    for (const feed of this.feedsRepo.feeds(accountID)) {
      if (feed.externalID && !byExternal.has(feed.externalID)) {
        this.feedsRepo.updateFeed(feed.id, (f) => ({ ...f, isDeleted: true }));
      }
    }
  }

  _applyReaderItems(accountID, items, idMap) {
    for (const item of items) {
      if (!item.id) continue;
      const existingItemID = idMap.get(item.id);
      const itemID = existingItemID ?? `gr:${stableDigest(item.id)}`;
      const feed = this._feedForReaderItem(accountID, item);
      if (!feed) continue;

      const publishedAt = item.published ?? item.updated ?? (item.timestampMS ?? item.crawlTimeMS) ?? nowSeconds();
      const contentHTML = item.contentHTML ?? item.summaryContent ?? null;
      const summary = contentHTML ? plainText(contentHTML).slice(0, 600) : '';
      this.articlesRepo.upsertEntry({
        id: itemID,
        accountID,
        externalID: item.id,
        feedID: feed.id,
        title: item.title || '未命名文章',
        author: item.author,
        url: item.canonicalURL ?? item.alternateURL,
        publishedAt,
        summary,
        contentHTML,
        dateArrived: (item.crawlTimeMS ?? publishedAt),
      });
    }
  }

  _feedForReaderItem(accountID, item) {
    if (item.originStreamID) {
      const feed = this.feedsRepo.feedByExternalID(accountID, item.originStreamID);
      if (feed) return feed;
    }
    if (item.originHTMLUrl || item.originTitle) {
      const feeds = this.feedsRepo.feeds(accountID);
      const byURL = item.originHTMLUrl ? feeds.find((f) => f.siteURL === item.originHTMLUrl || f.feedURL === item.originHTMLUrl) : null;
      if (byURL) return byURL;
      if (item.originTitle) {
        const byTitle = feeds.find((f) => f.title === item.originTitle);
        if (byTitle) return byTitle;
      }
    }
    return null;
  }

  _reconcileStates(accountID, unreadExternalIDs, starredExternalIDs) {
    const idMap = this.articlesRepo.externalIDToItemID(accountID);
    const unreadSet = new Set();
    const starredSet = new Set();
    for (const ext of unreadExternalIDs) {
      const local = idMap.get(ext);
      if (local) unreadSet.add(local);
    }
    for (const ext of starredExternalIDs) {
      const local = idMap.get(ext);
      if (local) starredSet.add(local);
    }

    const rows = this.database.prepare(`
      SELECT i.id, i.external_id, COALESCE(s.is_read, 0) AS is_read, COALESCE(s.is_starred, 0) AS is_starred
      FROM items i LEFT JOIN article_states s ON s.item_id = i.id
      WHERE i.account_id = ?
    `).all(accountID);

    for (const row of rows) {
      const shouldRead = row.is_read === 1 || !unreadSet.has(row.id);
      const shouldStar = starredSet.has(row.id);
      if (row.is_read !== (shouldRead ? 1 : 0)) this.statesRepo.setRead(row.id, shouldRead);
      if (row.is_starred !== (shouldStar ? 1 : 0)) this.statesRepo.setStarred(row.id, shouldStar);
    }
  }

  // MARK: - Outbox

  _scheduleOutboxDrain(delayMs = 4000) {
    if (this._outboxTimer) return;
    this._outboxTimer = setTimeout(() => {
      this._outboxTimer = null;
      for (const account of this.accounts.enabledAccounts()) {
        if (account.type !== 'freshRSS') continue;
        this._drainOutbox(account.id).catch(() => { /* 重试由退避控制 */ });
      }
    }, delayMs);
  }

  async _drainOutbox(accountID) {
    const client = this._getClient(accountID);
    if (!client) return;
    const idMap = this.articlesRepo.externalIDToItemID(accountID);
    const reverseMap = new Map();
    for (const [ext, local] of idMap) reverseMap.set(local, ext);

    const entries = this.statesRepo.readyOutboxEntries(accountID);
    for (const entry of entries) {
      const externalID = reverseMap.get(entry.itemID);
      if (!externalID) {
        this.statesRepo.markOutboxAttempt(accountID, entry.itemID, entry.stateKey, null);
        continue;
      }
      try {
        if (entry.stateKey === 'read') {
          await client.markRead([externalID], entry.desiredValue);
        } else {
          await client.markStarred([externalID], entry.desiredValue);
        }
        this.statesRepo.markOutboxAttempt(accountID, entry.itemID, entry.stateKey, null);
      } catch (err) {
        this.statesRepo.markOutboxAttempt(accountID, entry.itemID, entry.stateKey, errorMessage(err));
      }
    }
  }

  // MARK: - AI 编排

  _loadLLMConfiguration() {
    const stored = this.preferences.get(PreferenceKey.llmConfiguration, null);
    if (stored) {
      // 合并缺省，保持向后兼容
      return { ...defaultLLMConfiguration(), ...stored };
    }
    return defaultLLMConfiguration();
  }

  llmConfigurationSnapshot() {
    const outputLanguage = this.preferences.get(PreferenceKey.aiOutputLanguage, null);
    return { ...this.llmConfiguration, targetLanguage: outputLanguage || this.llmConfiguration.targetLanguage };
  }

  setLLMConfiguration(patch) {
    this.llmConfiguration = { ...this.llmConfiguration, ...patch };
    if (patch.targetLanguage != null) {
      this.preferences.set(PreferenceKey.aiOutputLanguage, patch.targetLanguage);
    }
    this.preferences.set(PreferenceKey.llmConfiguration, this.llmConfiguration);
    this._emitState();
  }

  setAIAPIKey(key) {
    this.credentials.setAIAPIKey(String(key ?? ''));
    this._emitState();
  }

  // MARK: - 多服务商管理（llmProviders）

  _loadProviders() {
    const stored = this.preferences.get('RobinRead.llmProviders', null);
    if (Array.isArray(stored) && stored.length) return stored;
    // 默认：当前配置迁移为 DeepSeek 服务商
    return [{
      id: 'prov-deepseek',
      name: this.llmConfiguration.providerName || 'DeepSeek',
      baseURL: this.llmConfiguration.baseURL || 'https://api.deepseek.com',
      model: this.llmConfiguration.model || 'deepseek-v4-flash',
      models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    }];
  }

  providersSnapshot() {
    const providers = this._loadProviders();
    const activeId = this.preferences.get('RobinRead.activeProviderId', providers[0].id);
    // 迁移：激活服务商的连接信息与 llmConfiguration 保持同步
    return { providers, activeProviderId: providers.some((p) => p.id === activeId) ? activeId : providers[0].id };
  }

  _saveProviders(providers, activeProviderId = null) {
    this.preferences.set('RobinRead.llmProviders', providers);
    if (activeProviderId) this.preferences.set('RobinRead.activeProviderId', activeProviderId);
    this._emitState();
    return this.providersSnapshot();
  }

  addProvider({ name, baseURL, model, models = [] }) {
    const providers = this._loadProviders();
    const id = `prov-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    providers.push({ id, name: name || '自定义', baseURL: baseURL || '', model: model || '', models });
    return this._saveProviders(providers);
  }

  updateProvider(id, patch) {
    const providers = this._loadProviders();
    const idx = providers.findIndex((p) => p.id === id);
    if (idx < 0) return this.providersSnapshot();
    providers[idx] = { ...providers[idx], ...patch };
    const snap = this._saveProviders(providers);
    // 激活中的服务商：同步到连接配置
    if (snap.activeProviderId === id) this._applyActiveProvider(providers[idx]);
    return snap;
  }

  removeProvider(id) {
    const providers = this._loadProviders();
    if (providers.length <= 1) throw new Error(i18n.localized('至少保留一个服务商。'));
    const idx = providers.findIndex((p) => p.id === id);
    if (idx < 0) return this.providersSnapshot();
    providers.splice(idx, 1);
    let activeId = this.preferences.get('RobinRead.activeProviderId', null);
    if (activeId === id) activeId = providers[0].id;
    const snap = this._saveProviders(providers, activeId);
    this._applyActiveProvider(providers.find((p) => p.id === snap.activeProviderId));
    return snap;
  }

  setActiveProvider(id) {
    const providers = this._loadProviders();
    const target = providers.find((p) => p.id === id);
    if (!target) return this.providersSnapshot();
    const snap = this._saveProviders(providers, id);
    this._applyActiveProvider(target);
    return snap;
  }

  /** 把服务商连接信息写入当前 LLM 配置（激活动作的落地）。 */
  _applyActiveProvider(provider) {
    if (!provider) return;
    this.llmConfiguration = {
      ...this.llmConfiguration,
      providerName: provider.name,
      baseURL: provider.baseURL,
      model: provider.model,
    };
    this.preferences.set(PreferenceKey.llmConfiguration, this.llmConfiguration);
    this._emitState();
  }

  hasAIAPIKey() {
    return Boolean(this.credentials.aiAPIKey());
  }

  async testAIConnection() {
    const config = this.llmConfigurationSnapshot();
    const apiKey = this.credentials.aiAPIKey();
    await this.llm.test(config, apiKey);
    return { ok: true, model: config.model, provider: config.providerName };
  }

  _requireAIReady() {
    const apiKey = this.credentials.aiAPIKey();
    if (!apiKey) throw new LLMServiceError('missingAPIKey');
    return { config: this.llmConfigurationSnapshot(), apiKey };
  }

  _entrySourceText(entry, cache) {
    if (cache && cache.text && cache.text.length >= 120) return cache.text;
    return entry.contentHTML ? plainText(entry.contentHTML) : plainText(entry.summary || '');
  }

  async generateSummary(entryID, { onDelta = null } = {}) {
    const entry = this.articlesRepo.entry(entryID);
    if (!entry) throw new Error('entry not found');
    const { config, apiKey } = this._requireAIReady();
    const cache = this.cachesRepo.cache(entryID);
    const text = this._entrySourceText(entry, cache);
    const contentHash = stableDigest(text);

    const key = `summary:${entryID}`;
    if (this.activeAICancellers.has(key)) throw new LLMServiceError('requestInProgress');
    const canceller = createCanceller();
    this.activeAICancellers.set(key, canceller);
    this.aiStatus.set(key, { state: 'generating' });
    this.emit('ai:status', { key, state: 'generating' });

    try {
      const artifact = {
        id: uuid(),
        accountID: entry.accountID,
        itemID: entryID,
        subjectKey: `summary:${entryID}`,
        kind: AIArtifactKind.summary,
        contentHash,
        model: config.model,
        targetLanguage: config.targetLanguage,
        promptVersion: 1,
        content: '',
        segments: [],
        isComplete: false,
      };
      this.artifactsRepo.saveArtifact(artifact);

      const content = await this.llm.summary(text, config, apiKey, async (delta) => {
        if (canceller.cancelled) throw new Error('cancelled');
        artifact.content += delta;
        this.emit('ai:delta', { key, entryID, kind: 'summary', delta, content: artifact.content });
      });

      artifact.content = content;
      artifact.isComplete = true;
      this.artifactsRepo.saveArtifact(artifact);
      this.aiStatus.set(key, { state: 'completed' });
      this.emit('ai:status', { key, state: 'completed' });
      // 记录 AI 动作 + 从摘要内容补打标签（强化兴趣画像）
      try {
        this.evolution.recordBehavior({ itemID: entryID, feedID: entry.feedID, action: 'ai' });
        this.knowledge.autoTagEntry(entryID, entry.title, content.slice(0, 500));
      } catch (_) { /* 忽略 */ }
      return artifact;
    } catch (err) {
      this.aiStatus.set(key, { state: 'failed', message: errorMessage(err) });
      this.emit('ai:status', { key, state: 'failed', message: errorMessage(err) });
      throw err;
    } finally {
      this.activeAICancellers.delete(key);
    }
  }

  existingSummary(entryID) {
    const entry = this.articlesRepo.entry(entryID);
    if (!entry) return null;
    const cache = this.cachesRepo.cache(entryID);
    const text = this._entrySourceText(entry, cache);
    const contentHash = stableDigest(text);
    return this.artifactsRepo.anyLatestArtifact({ itemID: entryID, kind: AIArtifactKind.summary, contentHash });
  }

  /**
   * 文章研读产物（一键精读 deepRead / 高质量摘要 richSummary）的统一生成管线：
   * 互斥 + 流式推送 + ai_artifacts 缓存 + 行为记录。kind 决定 LLM 方法与产物类型。
   */
  async _generateArticleWork(entryID, kind) {
    const entry = this.articlesRepo.entry(entryID);
    if (!entry) throw new Error('entry not found');
    const { config, apiKey } = this._requireAIReady();
    const cache = this.cachesRepo.cache(entryID);
    const text = this._entrySourceText(entry, cache);
    const contentHash = stableDigest(text);
    if (!text || !text.trim()) throw new Error(i18n.localized('文章暂无正文内容。'));

    const key = `${kind}:${entryID}`;
    if (this.activeAICancellers.has(key)) throw new LLMServiceError('requestInProgress');
    const canceller = createCanceller();
    this.activeAICancellers.set(key, canceller);
    this.aiStatus.set(key, { state: 'generating' });
    this.emit('ai:status', { key, state: 'generating' });

    try {
      const artifact = {
        id: uuid(),
        accountID: entry.accountID,
        itemID: entryID,
        subjectKey: `${kind}:${entryID}`,
        kind,
        contentHash,
        model: config.model,
        targetLanguage: config.targetLanguage,
        promptVersion: 1,
        content: '',
        segments: [],
        isComplete: false,
      };
      this.artifactsRepo.saveArtifact(artifact);

      const llmCall = kind === AIArtifactKind.deepRead
        ? (onDelta) => this.llm.deepRead(text, config, apiKey, onDelta)
        : (onDelta) => this.llm.richSummary(text, config, apiKey, onDelta);
      const content = await llmCall(async (delta) => {
        if (canceller.cancelled) throw new Error('cancelled');
        artifact.content += delta;
        this.emit('ai:delta', { key, entryID, kind, delta, content: artifact.content });
      });

      artifact.content = content;
      artifact.isComplete = true;
      this.artifactsRepo.saveArtifact(artifact);
      this.aiStatus.set(key, { state: 'completed' });
      this.emit('ai:status', { key, state: 'completed' });
      try {
        this.evolution.recordBehavior({ itemID: entryID, feedID: entry.feedID, action: 'ai' });
        this.knowledge.autoTagEntry(entryID, entry.title, content.slice(0, 500));
      } catch (_) { /* 忽略 */ }
      return artifact;
    } catch (err) {
      this.aiStatus.set(key, { state: 'failed', message: errorMessage(err) });
      this.emit('ai:status', { key, state: 'failed', message: errorMessage(err) });
      throw err;
    } finally {
      this.activeAICancellers.delete(key);
    }
  }

  /** 一键精读（中文深读笔记）。 */
  async deepRead(entryID) {
    return this._generateArticleWork(entryID, AIArtifactKind.deepRead);
  }

  /** 高质量中文摘要。 */
  async richSummary(entryID) {
    return this._generateArticleWork(entryID, AIArtifactKind.richSummary);
  }

  /** 研读产物缓存读取（秒开）。 */
  existingArticleWork(entryID, kind) {
    const entry = this.articlesRepo.entry(entryID);
    if (!entry) return null;
    const cache = this.cachesRepo.cache(entryID);
    const text = this._entrySourceText(entry, cache);
    const contentHash = stableDigest(text);
    return this.artifactsRepo.anyLatestArtifact({ itemID: entryID, kind, contentHash });
  }

  summaryKeyInfo(entryID) {
    const entry = this.articlesRepo.entry(entryID);
    if (!entry) return { contentHash: '' };
    const cache = this.cachesRepo.cache(entryID);
    const text = this._entrySourceText(entry, cache);
    return { contentHash: stableDigest(text) };
  }

  async ensureArticleContext(entryID) {
    const { config, apiKey } = this._requireAIReady();
    const entry = this.articlesRepo.entry(entryID);
    if (!entry) throw new Error('entry not found');
    const cache = this.cachesRepo.cache(entryID);
    const text = this._entrySourceText(entry, cache);
    const contentHash = stableDigest(text);

    const existing = this.artifactsRepo.latestArtifact({
      itemID: entryID, kind: AIArtifactKind.articleContext, contentHash,
      model: config.model, targetLanguage: config.targetLanguage,
    });
    if (existing && existing.isComplete) return existing.content;

    const memo = await this.llm.articleContext(text, config, apiKey);
    const artifact = {
      id: uuid(),
      accountID: entry.accountID,
      itemID: entryID,
      subjectKey: `context:${entryID}`,
      kind: AIArtifactKind.articleContext,
      contentHash,
      model: config.model,
      targetLanguage: config.targetLanguage,
      content: memo,
      segments: [],
      isComplete: true,
    };
    this.artifactsRepo.saveArtifact(artifact);
    return memo;
  }

  async explainSelection({ entryID, selection, localContext = '' }) {
    const { config, apiKey } = this._requireAIReady();
    const articleContext = await this.ensureArticleContext(entryID);
    return this.llm.explainSelection({
      selection, localContext, articleContext, configuration: config, apiKey,
      onDelta: null,
    });
  }

  async askSelection({ entryID, selection, question, localContext = '' }) {
    const { config, apiKey } = this._requireAIReady();
    const articleContext = await this.ensureArticleContext(entryID);
    return this.llm.askSelection({
      selection, question, localContext, articleContext, configuration: config, apiKey,
    });
  }

  async translateSelection({ entryID, selection }) {
    const { config, apiKey } = this._requireAIReady();
    return this.llm.translate(selection, config, apiKey);
  }

  // MARK: - AIHot 本地状态（收藏 / 已读 / 关注关键词）+ AI 深读

  _aihotState() {
    return {
      favorites: this.preferences.get('RobinRead.aihot.favorites', []),
      readIDs: this.preferences.get('RobinRead.aihot.readIDs', []),
      keywords: this.preferences.get('RobinRead.aihot.keywords', []),
    };
  }

  aihotSnapshot() { return this._aihotState(); }

  aihotToggleFavorite(item) {
    if (!item?.key) return this._aihotState();
    const favorites = this.preferences.get('RobinRead.aihot.favorites', []);
    const idx = favorites.findIndex((f) => f.key === item.key);
    if (idx >= 0) favorites.splice(idx, 1);
    else favorites.unshift({
      key: item.key,
      title: item.title || '',
      summary: item.summary || '',
      meta: item.meta || '',
      originalURL: item.originalURL || null,
      storyURL: item.storyURL || null,
      savedAt: Date.now(),
    });
    this.preferences.set('RobinRead.aihot.favorites', favorites.slice(0, 200));
    return this._aihotState();
  }

  aihotMarkRead(ids) {
    const read = new Set(this.preferences.get('RobinRead.aihot.readIDs', []));
    for (const id of ids || []) read.add(id);
    // 只保留最近 500 条，避免无限增长
    this.preferences.set('RobinRead.aihot.readIDs', [...read].slice(-500));
    return this._aihotState();
  }

  aihotSetKeywords(keywords) {
    const list = String(keywords || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
    this.preferences.set('RobinRead.aihot.keywords', list);
    return this._aihotState();
  }

  /** AI 深读：结合热点上下文生成中文深度解读（Markdown）。 */
  async aihotDeepRead({ title, context }) {
    const { config, apiKey } = this._requireAIReady();
    const prompt = `热点话题：${String(title || '').slice(0, 200)}\n\n背景材料（多源聚合/AI 摘要）：\n${String(context || '').slice(0, 6000)}`;
    const system = `你是一位资深科技媒体主编。请基于给定材料，用简体中文为读者写一篇结构化深度解读：
## 一句话结论
## 背景与来龙去脉
## 关键信息点（3-6 条，每条一行加粗要点 + 一两句展开）
## 值得关注的后续
只使用材料中的事实，不编造；材料不足时明确说明。整体控制在 500 字内，使用 Markdown。`;
    return this.llm.complete({
      prompt, system, configuration: config, apiKey,
      forceDisableReasoning: true,
      overrideTemperature: 0.3,
    });
  }

  /** 双语翻译：段落批量，带 artifact 缓存与渐进回放。 */
  async generateBilingual(entryID, html, { onSegment = null } = {}) {    const entry = this.articlesRepo.entry(entryID);
    if (!entry) throw new Error('entry not found');
    const { config, apiKey } = this._requireAIReady();

    const key = `bilingual:${entryID}`;
    if (this.activeAICancellers.has(key)) throw new LLMServiceError('requestInProgress');
    const canceller = createCanceller();
    this.activeAICancellers.set(key, canceller);
    this.aiStatus.set(key, { state: 'generating' });
    this.emit('ai:status', { key, state: 'generating' });

    try {
      const paragraphs = ArticleExtractor.readerParagraphs(html, entry.title);
      const segments = [];
      const cacheArtifact = this.artifactsRepo.anyLatestArtifact({
        itemID: entryID, kind: AIArtifactKind.bilingual, contentHash: stableDigest(html),
      });
      const doneIDs = new Set((cacheArtifact?.segments || []).map((s) => s.id));

      const pending = paragraphs.filter((p) => !doneIDs.has(p.id) && p.original.length > 0);
      let batch = [];
      let batchChars = 0;

      const flushBatch = async () => {
        if (!batch.length) return;
        const inputs = batch.map((p) => p.original);
        let translations;
        try {
          translations = await this.llm.translateBatch(inputs, config, apiKey);
        } catch (_) {
          translations = [];
          for (const input of inputs) {
            translations.push(await this.llm.translate(input, config, apiKey));
          }
        }
        batch.forEach((paragraph, index) => {
          const segment = { id: paragraph.id, original: paragraph.original, translation: translations[index] ?? '' };
          segments.push(segment);
          if (onSegment) onSegment(segment);
        });
        batch = [];
        batchChars = 0;
      };

      for (const paragraph of pending) {
        if (canceller.cancelled) throw new Error('cancelled');
        if (paragraph.original.length > MAX_CHARACTERS_PER_TRANSLATION_BATCH) {
          await flushBatch();
          const translation = await this.llm.translate(paragraph.original, config, apiKey);
          const segment = { id: paragraph.id, original: paragraph.original, translation };
          segments.push(segment);
          if (onSegment) onSegment(segment);
          continue;
        }
        if (batch.length >= MAX_PARAGRAPHS_PER_TRANSLATION_BATCH || batchChars + paragraph.original.length > MAX_CHARACTERS_PER_TRANSLATION_BATCH) {
          await flushBatch();
        }
        batch.push(paragraph);
        batchChars += paragraph.original.length;
      }
      await flushBatch();

      const allSegments = [...(cacheArtifact?.segments || []), ...segments];
      const artifact = {
        id: cacheArtifact?.id ?? uuid(),
        accountID: entry.accountID,
        itemID: entryID,
        subjectKey: `bilingual:${entryID}`,
        kind: AIArtifactKind.bilingual,
        contentHash: stableDigest(html),
        model: config.model,
        targetLanguage: config.targetLanguage,
        promptVersion: TRANSLATION_PROMPT_VERSION,
        content: '',
        segments: allSegments,
        isComplete: pending.length === 0,
      };
      this.artifactsRepo.saveArtifact(artifact);
      this.aiStatus.set(key, { state: 'completed' });
      this.emit('ai:status', { key, state: 'completed' });
      return artifact;
    } catch (err) {
      this.aiStatus.set(key, { state: 'failed', message: errorMessage(err) });
      this.emit('ai:status', { key, state: 'failed', message: errorMessage(err) });
      throw err;
    } finally {
      this.activeAICancellers.delete(key);
    }
  }

  /** 双语翻译：按视口段落 ID 批量翻译。 */
  async translateBilingualParagraphs({ entryID, html, paragraphIDs }) {
    const entry = this.articlesRepo.entry(entryID);
    if (!entry) throw new Error('entry not found');
    const { config, apiKey } = this._requireAIReady();

    const key = `bilingual:${entryID}`;
    if (this.activeAICancellers.has(key)) throw new LLMServiceError('requestInProgress');
    const canceller = createCanceller();
    this.activeAICancellers.set(key, canceller);
    this.aiStatus.set(key, { state: 'generating' });
    this.emit('ai:status', { key, state: 'generating' });

    try {
      const paragraphs = ArticleExtractor.readerParagraphs(html, entry.title);
      const wanted = paragraphIDs
        .map((id) => paragraphs.find((p) => p.id === id))
        .filter(Boolean);
      if (wanted.length === 0) return [];

      const contentHash = stableDigest(html);
      const cacheArtifact = this.artifactsRepo.anyLatestArtifact({
        itemID: entryID, kind: AIArtifactKind.bilingual, contentHash,
      });
      const doneIDs = new Set((cacheArtifact?.segments || []).map((s) => s.id));
      const pending = wanted.filter((p) => !doneIDs.has(p.id));
      // 缓存命中也要返回：否则渲染端拿不到译文会把整批记为失败（两轮后永久跳过）
      const cachedHits = wanted
        .filter((p) => doneIDs.has(p.id))
        .map((p) => (cacheArtifact?.segments || []).find((s) => s.id === p.id))
        .filter(Boolean);
      if (pending.length === 0) return cachedHits;

      // 批大小限制（8 段 / 1600 字符）
      let batch = [];
      let batchChars = 0;
      const newSegments = [];

      const flushBatch = async () => {
        if (!batch.length) return;
        const inputs = batch.map((p) => p.original);
        let translations;
        try {
          translations = await this.llm.translateBatch(inputs, config, apiKey);
        } catch (_) {
          translations = [];
          for (const input of inputs) {
            translations.push(await this.llm.translate(input, config, apiKey));
          }
        }
        batch.forEach((paragraph, index) => {
          const segment = { id: paragraph.id, original: paragraph.original, translation: translations[index] ?? '' };
          newSegments.push(segment);
        });
        batch = [];
        batchChars = 0;
      };

      for (const paragraph of pending) {
        if (canceller.cancelled) throw new Error('cancelled');
        if (paragraph.original.length > MAX_CHARACTERS_PER_TRANSLATION_BATCH) {
          await flushBatch();
          const translation = await this.llm.translate(paragraph.original, config, apiKey);
          newSegments.push({ id: paragraph.id, original: paragraph.original, translation });
          continue;
        }
        if (batch.length >= MAX_PARAGRAPHS_PER_TRANSLATION_BATCH
          || batchChars + paragraph.original.length > MAX_CHARACTERS_PER_TRANSLATION_BATCH) {
          await flushBatch();
        }
        batch.push(paragraph);
        batchChars += paragraph.original.length;
      }
      await flushBatch();

      const allSegments = [...(cacheArtifact?.segments || []), ...newSegments];
      const artifact = {
        id: cacheArtifact?.id ?? uuid(),
        accountID: entry.accountID,
        itemID: entryID,
        subjectKey: `bilingual:${entryID}`,
        kind: AIArtifactKind.bilingual,
        contentHash,
        model: config.model,
        targetLanguage: config.targetLanguage,
        promptVersion: TRANSLATION_PROMPT_VERSION,
        content: '',
        segments: allSegments,
        isComplete: newSegments.length > 0 && pending.length === newSegments.length,
      };
      this.artifactsRepo.saveArtifact(artifact);
      this.aiStatus.set(key, { state: 'completed' });
      this.emit('ai:status', { key, state: 'completed' });
      return [...cachedHits, ...newSegments];
    } catch (err) {
      this.aiStatus.set(key, { state: 'failed', message: errorMessage(err) });
      this.emit('ai:status', { key, state: 'failed', message: errorMessage(err) });
      throw err;
    } finally {
      this.activeAICancellers.delete(key);
    }
  }

  /** 单段流式翻译（视口渐进展示）。 */
  async translateParagraphStreaming({ entryID, html, paragraphID, onDelta }) {
    const entry = this.articlesRepo.entry(entryID);
    if (!entry) throw new Error('entry not found');
    const { config, apiKey } = this._requireAIReady();
    const paragraphs = ArticleExtractor.readerParagraphs(html, entry.title);
    const paragraph = paragraphs.find((p) => p.id === paragraphID);
    if (!paragraph) throw new Error('paragraph not found');
    const translation = await this.llm.translate(paragraph.original, config, apiKey, onDelta);

    const contentHash = stableDigest(html);
    const cacheArtifact = this.artifactsRepo.anyLatestArtifact({
      itemID: entryID, kind: AIArtifactKind.bilingual, contentHash,
    });
    const segments = [...(cacheArtifact?.segments || []), { id: paragraphID, original: paragraph.original, translation }];
    this.artifactsRepo.saveArtifact({
      id: cacheArtifact?.id ?? uuid(),
      accountID: entry.accountID,
      itemID: entryID,
      subjectKey: `bilingual:${entryID}`,
      kind: AIArtifactKind.bilingual,
      contentHash,
      model: config.model,
      targetLanguage: config.targetLanguage,
      promptVersion: TRANSLATION_PROMPT_VERSION,
      content: '',
      segments,
      isComplete: false,
    });
    return translation;
  }

  cachedBilingual(entryID, html) {
    const artifact = this.artifactsRepo.anyLatestArtifact({
      itemID: entryID, kind: AIArtifactKind.bilingual, contentHash: stableDigest(html),
    });
    return artifact && artifact.segments.length > 0 ? artifact : null;
  }

  /** 划词解释（含锚点持久化）。 */
  async explainSelection({ entryID, selection, localContext, anchor = null, onDelta }) {
    const { config, apiKey } = this._requireAIReady();
    const articleContext = await this.ensureArticleContext(entryID);
    const content = await this.llm.explainSelection({
      selection, localContext, articleContext, configuration: config, apiKey,
      onDelta: onDelta ? (delta) => onDelta(delta) : null,
    });
    this._saveSelectionArtifact(entryID, selection, anchor, content, config);
    return content;
  }

  async askSelection({ entryID, selection, question, localContext, anchor = null, history = null, onDelta }) {
    const { config, apiKey } = this._requireAIReady();
    const articleContext = await this.ensureArticleContext(entryID);
    const content = await this.llm.askSelection({
      selection, question, localContext, articleContext, configuration: config, apiKey,
      history,
      onDelta: onDelta ? (delta) => onDelta(delta) : null,
    });
    this._saveSelectionArtifact(entryID, selection, anchor, content, config);
    return content;
  }

  async translateSelection({ entryID, selection, onDelta }) {
    const { config, apiKey } = this._requireAIReady();
    return this.llm.translate(selection, config, apiKey, onDelta ? (delta) => onDelta(delta) : null);
  }

  _saveSelectionArtifact(entryID, selection, anchor, content, config) {
    const entry = this.articlesRepo.entry(entryID);
    if (!entry) return;
    const cache = this.cachesRepo.cache(entryID);
    const text = this._entrySourceText(entry, cache);
    this.artifactsRepo.saveArtifact({
      id: uuid(),
      accountID: entry.accountID,
      itemID: entryID,
      subjectKey: `selection:${entryID}:${stableDigest(selection)}`,
      kind: AIArtifactKind.selectionExplanation,
      contentHash: stableDigest(text),
      model: config.model,
      targetLanguage: config.targetLanguage,
      content,
      segments: [],
      selectionText: selection,
      selectionArticleHash: stableDigest(text),
      selectionAnchor: anchor,
      isComplete: true,
    });
  }

  /** 已保存的划词注释（重载阅读器时恢复锚点图标）。 */
  selectionAnnotations(entryID) {
    const entry = this.articlesRepo.entry(entryID);
    if (!entry) return [];
    const cache = this.cachesRepo.cache(entryID);
    const articleHash = stableDigest(this._entrySourceText(entry, cache));
    const rows = this.database.prepare(
      'SELECT * FROM ai_artifacts WHERE item_id = ? AND kind = ? AND selection_article_hash = ? AND is_deleted = 0 AND content != \'\' ORDER BY updated_at DESC'
    ).all(entryID, AIArtifactKind.selectionExplanation, articleHash);
    return rows.map((row) => ({
      id: row.id,
      selection: row.selection_text,
      content: row.content,
      anchor: row.selection_anchor_json ? JSON.parse(row.selection_anchor_json) : null,
    }));
  }

  cancelAI(key) {
    const canceller = this.activeAICancellers.get(key);
    if (canceller) canceller.cancelled = true;
  }

  /** 订阅排序（侧栏拖拽 / onMove）。 */
  reorderFeeds(orderedIDs) {
    orderedIDs.forEach((feedID, index) => {
      this.database.prepare('UPDATE feeds SET sort_order = ? WHERE id = ?').run(index, feedID);
    });
    this._emitState();
  }

  /** 账户同步状态表（设置页展示）。 */
  accountSyncStates() {
    const result = {};
    for (const account of this.accounts.listAccounts()) {
      result[account.id] = this.accounts.getSyncState(account.id);
    }
    return result;
  }

  // MARK: - 偏好

  setAppTheme(theme) {
    this.preferences.set(PreferenceKey.appTheme, ['system', 'light', 'dark'].includes(theme) ? theme : 'system');
    this._emitState();
  }

  readerLayout() {
    return {
      fontFamily: this.preferences.get('RobinRead.readerFontFamily', 'serif'),
      pageWidth: this.preferences.get('RobinRead.readerPageWidth', 'standard'),
      lineHeight: this.preferences.get('RobinRead.readerLineHeight', 'standard'),
      listDensity: this.preferences.get('RobinRead.listDensity', 'comfortable'),
      translateMode: this.preferences.get('RobinRead.translateMode', 'off'),
      // 默认关闭：文章打开不自动翻译，由用户手动触发（设置里可开启自动精读）
      autoTranslateEnglish: this.preferences.get('RobinRead.autoTranslateEnglish', false) === true,
    };
  }

  setReaderLayout(patch) {
    const allowed = {
      fontFamily: ['serif', 'sans'],
      pageWidth: ['narrow', 'standard', 'wide'],
      lineHeight: ['compact', 'standard', 'loose'],
      listDensity: ['compact', 'comfortable'],
      translateMode: ['off', 'bilingual', 'zh'],
      autoTranslateEnglish: [true, false],
    };
    for (const [key, value] of Object.entries(patch || {})) {
      if (key === 'autoTranslateEnglish') {
        this.preferences.set('RobinRead.autoTranslateEnglish', Boolean(value));
        continue;
      }
      if (allowed[key] && allowed[key].includes(value)) {
        this.preferences.set(`RobinRead.${key === 'fontFamily' ? 'readerFontFamily' : key === 'pageWidth' ? 'readerPageWidth' : key === 'lineHeight' ? 'readerLineHeight' : key}`, value);
      }
    }
    this._emitState();
    return this.readerLayout();
  }

  setArticleFontSize(size) {
    const clamped = Math.min(26, Math.max(12, Number(size) || 17));
    this.preferences.set(PreferenceKey.articleFontSize, clamped);
    this._emitState();
  }

  setAppLanguage(language) {
    const normalized = language === 'en' ? 'en' : 'zh';
    this.preferences.set(PreferenceKey.appLanguage, normalized);
    i18n.setLanguage(normalized);
    this._emitState();
  }

  setWindowBounds(bounds) {
    this.preferences.set(PreferenceKey.windowBounds, bounds);
  }

  setColumnWidths({ sidebarWidth, listWidth }) {
    if (sidebarWidth) this.preferences.set(PreferenceKey.sidebarWidth, sidebarWidth);
    if (listWidth) this.preferences.set(PreferenceKey.listWidth, listWidth);
  }
}

function mergeCounts(a, b) {
  const unreadByFeed = { ...a.unreadByFeed };
  for (const [k, v] of Object.entries(b.unreadByFeed)) unreadByFeed[k] = (unreadByFeed[k] || 0) + v;
  const unreadByFolder = { ...a.unreadByFolder };
  for (const [k, v] of Object.entries(b.unreadByFolder)) unreadByFolder[k] = (unreadByFolder[k] || 0) + v;
  return {
    allUnread: a.allUnread + b.allUnread,
    todayUnread: a.todayUnread + b.todayUnread,
    starred: a.starred + b.starred,
    unreadByFeed,
    unreadByFolder,
  };
}

function escapeHtmlminimal(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function createCanceller() {
  return { cancelled: false };
}

function errorMessage(err) {
  if (!err) return 'Unknown error';
  if (err instanceof ReaderAPIError) return err.displayMessage;
  if (err instanceof LLMServiceError) return err.message;
  if (err.name === 'AbortError') return i18n.localized('网络请求超时。');
  return err.message || String(err);
}

module.exports = { AppStore, errorMessage, DEFAULT_TIMELINE_LIMIT };
