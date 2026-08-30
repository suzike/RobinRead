'use strict';
/**
 * RobinRead（知更）— FreshRSS / Google Reader API 客户端与认证
 *
 * - ReaderAPIClient.swift（URL 规范化、请求包装、401 重登、分页）
 * - ReaderAPIAuthenticator.swift（ClientLogin、写 Token）
 */
const { ReaderAPIError } = require('./ReaderAPIError');

class ReaderAPIAuthenticator {
  constructor() {
    this.cachedAuthToken = null;
    this.cachedWriteToken = null;
  }

  invalidateAuth() {
    this.cachedAuthToken = null;
    this.cachedWriteToken = null;
  }

  async login(endpointURL, username, password) {
    const loginURL = `${canonicalBaseURL(endpointURL)}/accounts/ClientLogin`;
    const body = new URLSearchParams({ Email: username, Passwd: password, output: 'json' }).toString();

    const { response } = await fetchWithTimeout(loginURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    }, 20000);
    const responseText = (await readBody(response)).toString('utf8');

    if (response.status !== 200) {
      this.invalidateAuth();
      if (response.status === 401 || response.status === 403) throw new ReaderAPIError('invalidCredentials');
      const snippet = responseText.slice(0, 200);
      if (/badauthentication/i.test(snippet)) throw new ReaderAPIError('invalidCredentials');
      throw new ReaderAPIError('httpError', response.status, snippet);
    }

    let extractedAuth = null;
    for (const line of responseText.split(/\r?\n/)) {
      const parts = line.split('=');
      if (parts.length === 2 && parts[0].trim() === 'Auth') {
        extractedAuth = parts[1].trim();
        break;
      }
    }
    if (!extractedAuth) {
      try {
        const json = JSON.parse(responseText);
        if (json && typeof json.Auth === 'string') extractedAuth = json.Auth;
      } catch (_) { /* 非键值对也非 JSON */ }
    }
    if (!extractedAuth) {
      if (/badauthentication/i.test(responseText)) throw new ReaderAPIError('invalidCredentials');
      throw new ReaderAPIError('decodingError', 'Auth token not found in ClientLogin response');
    }

    this.cachedAuthToken = extractedAuth;
    this.cachedWriteToken = null;
    return extractedAuth;
  }

  async ensureWriteToken(endpointURL, username, password) {
    if (this.cachedWriteToken) return this.cachedWriteToken;
    const authToken = this.cachedAuthToken
      || (await this.login(endpointURL, username, password));

    const tokenURL = `${canonicalBaseURL(endpointURL)}/reader/api/0/token`;
    let { response } = await fetchWithTimeout(tokenURL, {
      method: 'GET',
      headers: { Authorization: `GoogleLogin auth=${authToken}` },
    }, 20000);

    if (response.status === 401 || response.status === 403) {
      this.invalidateAuth();
      const newAuth = await this.login(endpointURL, username, password);
      ({ response } = await fetchWithTimeout(tokenURL, {
        method: 'GET',
        headers: { Authorization: `GoogleLogin auth=${newAuth}` },
      }, 20000));
    }

    if (response.status !== 200) {
      response.finish();
      throw new ReaderAPIError('writeTokenUnavailable');
    }
    const text = (await readBody(response)).toString('utf8').trim();
    if (!text) throw new ReaderAPIError('writeTokenUnavailable');
    this.cachedWriteToken = text;
    return text;
  }
}

function canonicalBaseURL(rawURL) {
  let urlString = String(rawURL).trim();
  while (urlString.endsWith('/')) urlString = urlString.slice(0, -1);
  if (urlString.endsWith('/api/greader.php') || urlString.endsWith('/p/api/greader.php')) {
    return urlString;
  }
  return `${urlString}/api/greader.php`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    // 超时保护延伸到响应体消费完成：readBody() 读完响应后调用 finish() 解除；
    // 原先只保护到响应头，响应体读取卡死时会永久挂起。
    response.finish = () => clearTimeout(timer);
    return response;
  } catch (err) {
    clearTimeout(timer);
    if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
      throw new ReaderAPIError('networkError', '连接超时');
    }
    throw err;
  }
}

/** 消费响应体（与 fetch 同一 controller，读取期间超时持续有效）。 */
async function readBody(response) {
  try {
    return Buffer.from(await response.arrayBuffer());
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
      throw new ReaderAPIError('networkError', '响应读取超时');
    }
    throw err;
  } finally {
    if (typeof response.finish === 'function') response.finish();
  }
}

class ReaderAPIClient {
  constructor({ endpointURL, username, accountID, credentialStore }) {
    this.endpointURL = endpointURL;
    this.username = username;
    this.accountID = accountID;
    this.credentialStore = credentialStore;
    this.authenticator = new ReaderAPIAuthenticator();
  }

  get canonicalBase() {
    return canonicalBaseURL(this.endpointURL);
  }

  async getPassword() {
    const password = await this.credentialStore.freshRSSPassword(this.accountID);
    if (!password) throw new ReaderAPIError('invalidCredentials');
    return password;
  }

  async validateCredentials(passwordOverride = null) {
    const password = passwordOverride ?? (await this.getPassword());
    await this.authenticator.login(this.endpointURL, this.username, password);
  }

  async _performRequest(buildRequest, { allowRetryOnAuthError = true } = {}) {
    const password = await this.getPassword();
    let authToken = this.authenticator.cachedAuthToken;
    if (!authToken) {
      authToken = await this.authenticator.login(this.endpointURL, this.username, password);
    }

    const request = buildRequest(authToken);
    let { response } = await fetchWithTimeout(request.url, request, 30000);
    let data = await readBody(response);

    if ((response.status === 401 || response.status === 403) && allowRetryOnAuthError) {
      // 登录会话过期，重试一次
      this.authenticator.invalidateAuth();
      const newAuth = await this.authenticator.login(this.endpointURL, this.username, password);
      const retryReq = buildRequest(newAuth);
      ({ response } = await fetchWithTimeout(retryReq.url, retryReq, 30000));
      data = await readBody(response);
      if (response.status === 401 || response.status === 403) throw new ReaderAPIError('invalidCredentials');
      if (!response.ok) {
        throw new ReaderAPIError('httpError', response.status, data.subarray(0, 200).toString('utf8'));
      }
      return { data, response };
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new ReaderAPIError('invalidCredentials');
      throw new ReaderAPIError('httpError', response.status, data.subarray(0, 200).toString('utf8'));
    }
    return { data, response };
  }

  async _getJSON(buildRequest) {
    const { data } = await this._performRequest(buildRequest);
    try {
      return JSON.parse(data.toString('utf8'));
    } catch (err) {
      throw new ReaderAPIError('decodingError', err.message);
    }
  }

  // MARK: - Subscriptions & Folders

  async fetchSubscriptions() {
    const decoded = await this._getJSON((authToken) => ({
      url: `${this.canonicalBase}/reader/api/0/subscription/list?output=json`,
      method: 'GET',
      headers: { Authorization: `GoogleLogin auth=${authToken}` },
    }));
    const subscriptions = decoded?.subscriptions;
    if (!Array.isArray(subscriptions)) throw new ReaderAPIError('decodingError', 'subscription/list');
    return subscriptions.map((sub) => ({
      id: sub.id,
      title: sub.title,
      categories: (sub.categories || []).map((c) => ({ id: c.id, label: c.label })),
      url: sub.url ?? null,
      htmlUrl: sub.htmlUrl ?? null,
      iconUrl: sub.iconUrl ?? null,
    }));
  }

  async fetchTags() {
    const decoded = await this._getJSON((authToken) => ({
      url: `${this.canonicalBase}/reader/api/0/tag/list?output=json`,
      method: 'GET',
      headers: { Authorization: `GoogleLogin auth=${authToken}` },
    }));
    const tags = decoded?.tags;
    if (!Array.isArray(tags)) throw new ReaderAPIError('decodingError', 'tag/list');
    return tags.map((tag) => ({ id: tag.id, sortid: tag.sortid ?? null }));
  }

  // MARK: - Stream Item IDs

  async _fetchItemIDsPage(queryItems, continuation, limit) {
    const params = [...queryItems, ['n', String(limit)], ['output', 'json']];
    if (continuation) params.push(['c', continuation]);
    const url = `${this.canonicalBase}/reader/api/0/stream/items/ids?${new URLSearchParams(params).toString()}`;
    const decoded = await this._getJSON((authToken) => ({
      url,
      method: 'GET',
      headers: { Authorization: `GoogleLogin auth=${authToken}` },
    }));
    const ids = (decoded.itemRefs || []).map((ref) => ref.id);
    return { ids, continuation: decoded.continuation ?? null };
  }

  async fetchAllUnreadItemIDs(maxTotal = 50000) {
    const query = [
      ['s', 'user/-/state/com.google/reading-list'],
      ['xt', 'user/-/state/com.google/read'],
    ];
    return this._fetchAllItemIDs(query, maxTotal);
  }

  async fetchAllStarredItemIDs(maxTotal = 50000) {
    const query = [['s', 'user/-/state/com.google/starred']];
    return this._fetchAllItemIDs(query, maxTotal);
  }

  async _fetchAllItemIDs(query, maxTotal) {
    const allIDs = [];
    let nextContinuation = null;
    let isExhausted = false;

    do {
      const { ids, continuation } = await this._fetchItemIDsPage(query, nextContinuation, 10000);
      allIDs.push(...ids);
      if (continuation && continuation !== nextContinuation) {
        if (allIDs.length < maxTotal) {
          nextContinuation = continuation;
        } else {
          nextContinuation = null;
          isExhausted = false;
        }
      } else {
        nextContinuation = null;
        isExhausted = true;
      }
    } while (nextContinuation != null);

    return { ids: new Set(allIDs), isComplete: isExhausted };
  }

  // MARK: - Stream Item Contents

  async fetchItemContents(itemIDs) {
    if (itemIDs.length === 0) return [];
    const batchSize = 50;
    const allItems = [];
    for (let start = 0; start < itemIDs.length; start += batchSize) {
      const chunk = itemIDs.slice(start, start + batchSize);
      const body = new URLSearchParams();
      for (const id of chunk) body.append('i', id);
      const decoded = await this._getJSON((authToken) => ({
        url: `${this.canonicalBase}/reader/api/0/stream/items/contents?output=json`,
        method: 'POST',
        headers: {
          Authorization: `GoogleLogin auth=${authToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      }));
      const items = decoded?.items;
      if (!Array.isArray(items)) throw new ReaderAPIError('decodingError', 'stream/items/contents');
      allItems.push(...items.map(streamItemToModel));
    }
    return allItems;
  }

  async fetchStreamContentsPage({ streamID = 'user/-/state/com.google/reading-list', continuation = null, limit = 100, startTime = null } = {}) {
    const params = [['n', String(limit)], ['output', 'json']];
    if (continuation) params.push(['c', continuation]);
    if (startTime && startTime > 0) params.push(['ot', String(Math.floor(startTime))]);
    const url = `${this.canonicalBase}/reader/api/0/stream/contents/${streamID}?${new URLSearchParams(params).toString()}`;
    const decoded = await this._getJSON((authToken) => ({
      url,
      method: 'GET',
      headers: { Authorization: `GoogleLogin auth=${authToken}` },
    }));
    return {
      items: (decoded?.items || []).map(streamItemToModel),
      continuation: decoded?.continuation ?? null,
    };
  }

  async fetchIncrementalStreamContents({ sinceTimestamp = null, pageSize = 100, maxTotal = 10000, knownLocalExternalIDs = null } = {}) {
    const allItems = [];
    let nextContinuation = null;
    let reachedBoundary = false;
    const cutoff = sinceTimestamp != null ? Math.max(0, sinceTimestamp - 300) : null; // 5 分钟重叠窗口

    for (;;) {
      const { items, continuation } = await this.fetchStreamContentsPage({
        continuation: nextContinuation,
        limit: pageSize,
        startTime: cutoff,
      });
      allItems.push(...items);

      if (cutoff != null && knownLocalExternalIDs) {
        const hitKnownOld = items.some((item) => (
          item.published != null && item.published < cutoff && knownLocalExternalIDs.has(item.id)
        ));
        if (hitKnownOld) {
          reachedBoundary = true;
          break;
        }
      }

      if (!continuation || continuation === nextContinuation) {
        reachedBoundary = true;
        break;
      }
      if (allItems.length >= maxTotal) {
        reachedBoundary = false;
        break;
      }
      nextContinuation = continuation;
    }
    return { items: allItems, reachedBoundary };
  }

  async fetchRecentStreamContents(limit = 200) {
    const { items } = await this.fetchStreamContentsPage({ limit });
    return items;
  }

  // MARK: - State Mutations (edit-tag)

  async markRead(itemIDs, isRead) {
    const addTag = isRead ? 'user/-/state/com.google/read' : 'user/-/state/com.google/kept-unread';
    const removeTag = isRead ? null : 'user/-/state/com.google/read';
    await this._editTags(itemIDs, addTag, removeTag);
  }

  async markStarred(itemIDs, isStarred) {
    const addTag = isStarred ? 'user/-/state/com.google/starred' : null;
    const removeTag = isStarred ? null : 'user/-/state/com.google/starred';
    await this._editTags(itemIDs, addTag, removeTag);
  }

  async _editTags(itemIDs, addTag, removeTag) {
    const batchSize = 50;
    const password = await this.getPassword();
    for (let start = 0; start < itemIDs.length; start += batchSize) {
      const chunk = itemIDs.slice(start, start + batchSize);
      const writeToken = await this.authenticator.ensureWriteToken(this.endpointURL, this.username, password);

      const { data, response } = await this._performRequest((authToken) => {
        const body = new URLSearchParams();
        for (const id of chunk) body.append('i', id);
        if (addTag) body.append('a', addTag);
        if (removeTag) body.append('r', removeTag);
        body.append('T', writeToken);
        return {
          url: `${this.canonicalBase}/reader/api/0/edit-tag`,
          method: 'POST',
          headers: {
            Authorization: `GoogleLogin auth=${authToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        };
      });
      if (response.status !== 200) {
        throw new ReaderAPIError('httpError', response.status, data.subarray(0, 200).toString('utf8'));
      }
    }
  }
}

function streamItemToModel(item) {
  const alternate = (item.alternate || [])[0]?.href ?? null;
  const origin = item.origin || {};
  return {
    id: item.id,
    crawlTimeMS: item.crawlTimeMsec != null ? Number(item.crawlTimeMsec) / 1000 : null,
    timestampMS: item.timestampUsec != null ? Number(item.timestampUsec) / 1_000_000 : null,
    published: item.published ?? null,
    updated: item.updated ?? null,
    title: item.title ?? '',
    author: item.author ?? null,
    canonicalURL: (item.canonical || [])[0]?.href ?? alternate,
    alternateURL: alternate,
    summaryContent: item.summary?.content ?? null,
    contentHTML: item.content?.content ?? null,
    categories: item.categories || [],
    originStreamID: origin.streamId ?? null,
    originTitle: origin.title ?? null,
    originHTMLUrl: origin.htmlUrl ?? null,
  };
}

module.exports = { ReaderAPIClient, ReaderAPIAuthenticator, canonicalBaseURL, fetchWithTimeout };
