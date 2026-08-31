'use strict';
/**
 * diag-phase6-miniflux.js — 阶段六「Miniflux（Google Reader API）同步」端到端探测
 *
 * 与 selftest.js 同款 boot：独立临时 userData（os.tmpdir 隔离）+ 直接实例化 AppStore，
 * 不开窗口、不联网（仅连本机 mock 服务器）。node:http 起一个 mock Miniflux GReader
 * 服务器（127.0.0.1 随机端口），按 Miniflux 上游真实行为实现最小端点集：
 *   - POST /greader/accounts/ClientLogin：尊重 output=json（返回 JSON），否则键值对文本；
 *     凭据错误 → 401 + JSON 错误体（与上游 README 一致）
 *   - GET  /greader/reader/api/0/token → 纯文本写 token
 *   - GET  /greader/reader/api/0/subscription/list → {subscriptions:[...]}
 *   - GET  /greader/reader/api/0/stream/contents/user/-/state/com.google/reading-list
 *   - GET  /greader/reader/api/0/stream/items/ids（按 s/xt 区分未读/星标）
 *   - POST /greader/reader/api/0/stream/items/contents、/greader/reader/api/0/edit-tag
 *   - 鉴权：GET 校验 `Authorization: GoogleLogin auth=<token>`，POST 校验表单 T
 *     （上游 middleware.go：POST 不接受 Authorization 头，只认 T）
 *
 * 覆盖：
 *   a. canonicalBaseURL / normalizeMinifluxEndpoint 纯函数断言（FreshRSS 三条旧规则不回归）
 *   b. ClientLogin 键值对解析（Auth 值含 '=' 时按第一个 = 切分，fetch 打桩）
 *   c. validateFreshRSSCredentials：显式 /greader 地址、根域名 + miniflux 预设、
 *      错误密码 → invalidCredentials
 *   d. addFreshRSSAccount（根域名 + 预设归一化）+ syncFreshRSS 全链路：
 *      订阅/分类/文章落库、未读/星标对账、账户 endpointURL 归一化断言
 *   e. outbox 回放：markRead → GET token → POST edit-tag（T 校验）
 *   f. 服务器端 path 审计：全部请求路径以 /greader/ 开头，关键端点逐一命中
 *
 * 覆盖深度说明：fetchRecentStreamContents（首启全量）+ 未读/星标 items/ids 对账 +
 * edit-tag 写回放全部走到；fetchItemContents / 增量流（continuation 翻页）未在此探针覆盖。
 * 退出码 0=全 PASS，1=有 FAIL。
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { app } = require('electron');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-phase6-miniflux-'));
app.setPath('userData', userData);

// ---------- mock Miniflux GReader 服务器 ----------

const MF_USER = 'greader-user';
const MF_PASS = 'greader-pass-9137';
const AUTH_TOKEN = 'greader-user/0a1b2c3d4e5f60718293a4b5c6d7e8f9'; // 上游格式：username/HMAC-hex（含 / 不含 =）
const WRITE_TOKEN = 'mockwritetoken';

const NOW = Math.floor(Date.now() / 1000);
const FEED = {
  id: 'feed/1',
  title: 'Mock Weekly',
  categories: [{ id: 'user/-/label/Tech', label: 'Tech' }],
  url: 'https://example.com/rss',
  htmlUrl: 'https://example.com/',
  iconUrl: '',
};

function greaderItem(n, publishedAt) {
  const longID = `tag:google.com,2005:reader/item/00000000000000${n.toString(16).padStart(2, '0')}`;
  return {
    id: longID,
    crawlTimeMsec: String(publishedAt * 1000),
    timestampUsec: String(publishedAt * 1_000_000),
    published: publishedAt,
    updated: publishedAt,
    title: `Miniflux 探针第 ${n} 篇`,
    author: 'Mock Author',
    canonical: [{ href: `https://example.com/articles/${n}` }],
    alternate: [{ href: `https://example.com/articles/${n}` }],
    categories: ['user/-/state/com.google/reading-list', 'user/-/state/com.google/fresh'],
    origin: { streamId: FEED.id, title: FEED.title, htmlUrl: FEED.htmlUrl },
    summary: { content: `<p>第 ${n} 篇内容摘要（mock）</p>` },
  };
}
const ITEM1 = greaderItem(1, NOW - 3600); // 未读 + 星标
const ITEM2 = greaderItem(2, NOW - 7200); // 服务器侧已读 → 对账后本地应为已读

const UNREAD_IDS = [ITEM1.id];
const STARRED_IDS = [ITEM1.id];

const state = {
  hits: [], // { method, url }
  editTagCalls: [], // { ids, add, remove, T }
};

function sendJSON(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=UTF-8' });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=UTF-8' });
  res.end(text);
}

function handleRoute(req, res, url, form) {
  const { method } = req;
  const p = url.pathname;

  // ClientLogin：无鉴权；尊重 output=json（与上游 handler.go 一致）
  if (p === '/greader/accounts/ClientLogin' && method === 'POST') {
    if (form.get('Email') !== MF_USER || form.get('Passwd') !== MF_PASS) {
      sendJSON(res, 401, { error_message: 'access unauthorized' });
      return;
    }
    if (form.get('output') === 'json') {
      sendJSON(res, 200, { SID: AUTH_TOKEN, LSID: AUTH_TOKEN, Auth: AUTH_TOKEN });
    } else {
      sendText(res, 200, `SID=${AUTH_TOKEN}\nLSID=${AUTH_TOKEN}\nAuth=${AUTH_TOKEN}\n`);
    }
    return;
  }

  // 其余端点：GET 校验 GoogleLogin 头，POST 校验表单 T（上游 middleware.go 行为）
  if (p.startsWith('/greader/reader/api/0/')) {
    if (method === 'GET') {
      const header = req.headers.authorization || '';
      if (header !== `GoogleLogin auth=${AUTH_TOKEN}`) {
        sendText(res, 401, 'Unauthorized');
        return;
      }
    } else {
      if (form.get('T') !== WRITE_TOKEN) {
        sendText(res, 401, 'Unauthorized');
        return;
      }
    }

    if (p === '/greader/reader/api/0/token' && method === 'GET') {
      sendText(res, 200, WRITE_TOKEN);
      return;
    }
    if (p === '/greader/reader/api/0/subscription/list' && method === 'GET') {
      sendJSON(res, 200, { subscriptions: [FEED] });
      return;
    }
    if (p === '/greader/reader/api/0/tag/list' && method === 'GET') {
      sendJSON(res, 200, { tags: [{ id: 'user/-/label/Tech', sortid: 'TE' }] });
      return;
    }
    if (p === '/greader/reader/api/0/stream/items/ids') {
      const s = url.searchParams.get('s') || '';
      const refs = (s.includes('starred') ? STARRED_IDS : UNREAD_IDS).map((id) => ({ id }));
      sendJSON(res, 200, { itemRefs: refs, continuation: null });
      return;
    }
    if (p.startsWith('/greader/reader/api/0/stream/contents/')) {
      sendJSON(res, 200, {
        id: 'user/-/state/com.google/reading-list',
        updated: NOW,
        continuation: null,
        items: [ITEM1, ITEM2],
      });
      return;
    }
    if (p === '/greader/reader/api/0/stream/items/contents') {
      sendJSON(res, 200, { id: '', updated: NOW, items: [ITEM1, ITEM2] });
      return;
    }
    if (p === '/greader/reader/api/0/edit-tag' && method === 'POST') {
      state.editTagCalls.push({ ids: form.getAll('i'), add: form.get('a'), remove: form.get('r'), T: form.get('T') });
      sendText(res, 200, 'OK');
      return;
    }
  }

  sendJSON(res, 404, { error_message: `mock: unhandled ${method} ${p}` });
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
    const url = new URL(req.url, 'http://127.0.0.1');
    state.hits.push({ method: req.method, url: req.url });
    try {
      handleRoute(req, res, url, form);
    } catch (err) {
      sendJSON(res, 500, { error_message: `mock handler error: ${err.message}` });
    }
  });
});

// ---------- 探针主流程 ----------

app.whenReady().then(async () => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(Boolean(ok));
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let code = 1;
  const watchdog = setTimeout(() => {
    console.log('FAIL watchdog — 探测总时长超 90s，强制退出');
    app.exit(1);
  }, 90000);

  try {
    await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).on('error', reject));
    const port = server.address().port;
    const bareBase = `http://127.0.0.1:${port}`;
    const greaderBase = `${bareBase}/greader`;

    const { canonicalBaseURL, normalizeMinifluxEndpoint, ReaderAPIAuthenticator } = require(path.join(__dirname, '..', 'src', 'main', 'FreshRSS', 'FreshRSSClient'));
    const { AppStore } = require(path.join(__dirname, '..', 'src', 'main', 'AppStore'));

    // a. URL 归一化纯函数（含 FreshRSS 既有规则回归）
    check('canonical-freshrss-default', canonicalBaseURL('https://freshrss.example.com') === 'https://freshrss.example.com/api/greader.php');
    check('canonical-freshrss-trailing-slash', canonicalBaseURL('https://freshrss.example.com//') === 'https://freshrss.example.com/api/greader.php');
    check('canonical-freshrss-explicit', canonicalBaseURL('https://freshrss.example.com/api/greader.php') === 'https://freshrss.example.com/api/greader.php');
    check('canonical-freshrss-subpath', canonicalBaseURL('https://freshrss.example.com/p/api/greader.php') === 'https://freshrss.example.com/p/api/greader.php');
    check('canonical-miniflux-greader', canonicalBaseURL('https://miniflux.example.com/greader') === 'https://miniflux.example.com/greader');
    check('canonical-miniflux-greader-slash', canonicalBaseURL('https://miniflux.example.com/greader/') === 'https://miniflux.example.com/greader');
    check('normalize-miniflux-bare-host', normalizeMinifluxEndpoint('https://miniflux.example.com') === 'https://miniflux.example.com/greader');
    check('normalize-miniflux-bare-host-port', normalizeMinifluxEndpoint(`${bareBase}/`) === greaderBase);
    check('normalize-miniflux-keeps-greader', normalizeMinifluxEndpoint(`${greaderBase}/`) === greaderBase);
    check('normalize-miniflux-keeps-explicit-path', normalizeMinifluxEndpoint(`${bareBase}/subpath`) === `${bareBase}/subpath`);
    check('normalize-miniflux-empty', normalizeMinifluxEndpoint('') === '');

    // b. ClientLogin 键值对解析：Auth 值含 '=' 时按第一个 = 切分（fetch 打桩，不联网）
    const realFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response('SID=abc\nLSID=abc\nAuth=kvtoken+with=equals\n', { status: 200 });
      const kvAuth = new ReaderAPIAuthenticator();
      const kvToken = await kvAuth.login('http://stub.invalid/greader', 'u', 'p');
      check('clientlogin-kv-parse-with-equals', kvToken === 'kvtoken+with=equals', `token=${kvToken}`);
    } finally {
      globalThis.fetch = realFetch;
    }

    const store = new AppStore(userData);
    check('store-boot', store.accounts.account('local-default') != null);

    // c1. 显式 /greader 地址验证（不带预设参数）
    state.hits = [];
    await store.validateFreshRSSCredentials(greaderBase, MF_USER, MF_PASS);
    check('validate-explicit-greader-url', state.hits.some((h) => h.url === '/greader/accounts/ClientLogin'));

    // c2. 根域名 + miniflux 预设验证（AppStore 侧归一化）
    state.hits = [];
    await store.validateFreshRSSCredentials(bareBase, MF_USER, MF_PASS, 'miniflux');
    check('validate-bare-host-with-preset', state.hits.some((h) => h.url === '/greader/accounts/ClientLogin'),
      state.hits.map((h) => h.url).join(','));

    // c3. 错误密码 → invalidCredentials（mock 返回 401 JSON 错误体）
    let badCredsKind = null;
    try {
      await store.validateFreshRSSCredentials(greaderBase, MF_USER, 'wrong-pass');
    } catch (err) {
      badCredsKind = err.kind;
    }
    check('validate-bad-credentials', badCredsKind === 'invalidCredentials', `kind=${badCredsKind}`);

    // d1. 账号 A：显式 /greader 地址 → 完整首启同步
    state.hits = [];
    const accountA = await store.addFreshRSSAccount({
      displayName: 'Miniflux 显式地址',
      endpointURL: greaderBase,
      username: MF_USER,
      password: MF_PASS,
    });
    check('add-account-a-endpoint', accountA.endpointURL === greaderBase && accountA.type === 'freshRSS',
      `endpoint=${accountA.endpointURL}`);
    await store.syncFreshRSS(accountA.id, { origin: 'manual' });
    const feedA = store.feedsRepo.feedByExternalID(accountA.id, FEED.id);
    check('sync-a-subscription', feedA != null && feedA.title === FEED.title && feedA.feedURL === FEED.url,
      feedA ? `title=${feedA.title}` : 'feed 缺失');
    const foldersA = store.feedsRepo.folders(accountA.id);
    check('sync-a-folder', foldersA.some((f) => f.name === 'Tech'), `folders=${foldersA.map((f) => f.name).join('/')}`);
    const idMapA = store.articlesRepo.externalIDToItemID(accountA.id);
    const entry1A = idMapA.get(ITEM1.id) ? store.articlesRepo.entry(idMapA.get(ITEM1.id)) : null;
    const entry2A = idMapA.get(ITEM2.id) ? store.articlesRepo.entry(idMapA.get(ITEM2.id)) : null;
    check('sync-a-articles', entry1A != null && entry2A != null && entry1A.title === ITEM1.title,
      `items=${idMapA.size}`);
    const syncStateA = store.accounts.getSyncState(accountA.id);
    check('sync-a-state', syncStateA.initialSyncCompleted === true && !syncStateA.lastError,
      `lastError=${syncStateA.lastError}`);
    const hitsA = state.hits;
    check('audit-a-all-greader-prefixed', hitsA.length > 0 && hitsA.every((h) => h.url.startsWith('/greader/')),
      hitsA.map((h) => h.url).join(' | '));

    // d2. 账号 B：根域名 + miniflux 预设 → 归一化出 /greader base → 完整首启同步
    state.hits = [];
    const accountB = await store.addFreshRSSAccount({
      displayName: 'Miniflux 预设',
      endpointURL: bareBase,
      username: MF_USER,
      password: MF_PASS,
      service: 'miniflux',
    });
    check('add-account-b-endpoint-normalized', accountB.endpointURL === greaderBase, `endpoint=${accountB.endpointURL}`);
    await store.syncFreshRSS(accountB.id, { origin: 'manual' });
    const feedB = store.feedsRepo.feedByExternalID(accountB.id, FEED.id);
    check('sync-b-subscription', feedB != null && feedB.title === FEED.title);
    const idMapB = store.articlesRepo.externalIDToItemID(accountB.id);
    check('sync-b-articles', idMapB.has(ITEM1.id) && idMapB.has(ITEM2.id), `items=${idMapB.size}`);
    const syncStateB = store.accounts.getSyncState(accountB.id);
    check('sync-b-state', syncStateB.initialSyncCompleted === true && !syncStateB.lastError,
      `lastError=${syncStateB.lastError}`);
    check('audit-b-all-greader-prefixed', state.hits.length > 0 && state.hits.every((h) => h.url.startsWith('/greader/')),
      state.hits.map((h) => h.url).join(' | '));

    // 未读/星标对账：item1 未读+星标；item2 服务器已读 → 本地已读
    const local1 = store.articlesRepo.entry(idMapB.get(ITEM1.id));
    const local2 = store.articlesRepo.entry(idMapB.get(ITEM2.id));
    check('reconcile-unread-starred', local1.isRead === false && local1.isStarred === true,
      `read=${local1.isRead} starred=${local1.isStarred}`);
    check('reconcile-server-read', local2.isRead === true && local2.isStarred === false,
      `read=${local2.isRead} starred=${local2.isStarred}`);

    // e. outbox 回放：markRead → GET token → POST edit-tag（T 校验）
    state.hits = [];
    state.editTagCalls = [];
    store.markRead(idMapB.get(ITEM2.id), true);
    await store._drainOutbox(accountB.id);
    check('outbox-token-hit', state.hits.some((h) => h.url === '/greader/reader/api/0/token'),
      state.hits.map((h) => h.url).join(' | '));
    const editCall = state.editTagCalls[0];
    check('outbox-edit-tag', editCall != null
      && editCall.ids.includes(ITEM2.id)
      && editCall.add === 'user/-/state/com.google/read'
      && editCall.T === WRITE_TOKEN,
      editCall ? JSON.stringify(editCall) : '未收到 edit-tag');

    // f. 关键端点 path 审计（合并全程命中：hitsA=账号A全流程，state.hits=outbox 段）
    const allHits = [...state.hits, ...hitsA];
    check('audit-endpoints-hit',
      allHits.some((h) => h.url === '/greader/accounts/ClientLogin')
      && allHits.some((h) => h.url === '/greader/reader/api/0/token')
      && allHits.some((h) => h.url.startsWith('/greader/reader/api/0/subscription/list'))
      && allHits.some((h) => h.url.startsWith('/greader/reader/api/0/stream/contents/user/-/state/com.google/reading-list'))
      && allHits.some((h) => h.url.startsWith('/greader/reader/api/0/stream/items/ids') && h.url.includes('xt='))
      && allHits.some((h) => h.url.startsWith('/greader/reader/api/0/stream/items/ids') && h.url.includes('starred'))
      && allHits.some((h) => h.url === '/greader/reader/api/0/edit-tag'),
      `总命中 ${allHits.length} 个请求`);

    code = results.every(Boolean) ? 0 : 1;
  } catch (err) {
    console.log(`FAIL probe-crashed — ${err && err.stack ? err.stack : err}`);
    code = 1;
  } finally {
    clearTimeout(watchdog);
    server.close();
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) { /* Windows 句柄延迟，忽略 */ }
  }
  await sleep(50);
  app.exit(code);
});
