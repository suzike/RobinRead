'use strict';
/**
 * NanJuPaper Windows — Mock 集成测试
 * 1. 本地 OpenAI 兼容服务器（SSE 流式）→ LLMService 摘要/划词/翻译批量
 * 2. 本地 FreshRSS (Google Reader API) 服务器 → 账户添加、初始同步、未读/星标对账、outbox 回放
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { app } = require('electron');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-mock-'));
app.setPath('userData', userData);

function createLLMMock(port) {
  const deltas = ['结论：', '纸感阅读', '强调专注。', '- 要点一', '- 要点二'];
  let requestBodies = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requestBodies.push({ url: req.url, auth: req.headers.authorization, body });
      if (req.url.endsWith('/chat/completions') && body.includes('"stream":true')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        let index = 0;
        const timer = setInterval(() => {
          if (index < deltas.length) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: deltas[index] } }] })}\n\n`);
            index += 1;
          } else {
            res.write('data: [DONE]\n\n');
            res.end();
            clearInterval(timer);
          }
        }, 8);
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(['译文A', '译文B', '译文C']) } }] }));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, requestBodies }));
  });
}

function createFreshRSSMock(port) {
  const state = {
    authOK: false,
    writeTokenIssued: 0,
    editTagCalls: [],
    subscriptions: [{
      id: 'feed/1001', title: '示例订阅源', url: 'https://example.com/feed.xml',
      htmlUrl: 'https://example.com/', iconUrl: null,
      categories: [{ id: 'user/-/label/技术', label: '技术' }],
    }],
    items: [
      {
        id: 'tag:google.com,2005:reader/item/0001abc',
        published: Math.floor(Date.now() / 1000) - 600,
        title: 'Mock 文章一', author: '作者A',
        canonical: [{ href: 'https://example.com/1' }],
        alternate: [{ href: 'https://example.com/1' }],
        content: { content: '<p>这是第一篇 mock 文章的正文，用于验证同步管线。</p>' },
        categories: ['user/-/state/com.google/reading-list', 'user/-/state/com.google/fresh'],
        origin: { streamId: 'feed/1001', title: '示例订阅源', htmlUrl: 'https://example.com/' },
        crawlTimeMsec: String(Date.now() - 600_000),
      },
      {
        id: 'tag:google.com,2005:reader/item/0002def',
        published: Math.floor(Date.now() / 1000) - 3600,
        title: 'Mock 文章二（已读）', author: null,
        canonical: [{ href: 'https://example.com/2' }],
        content: { content: '<p>第二篇 mock 文章。</p>' },
        categories: ['user/-/state/com.google/reading-list', 'user/-/state/com.google/read'],
        origin: { streamId: 'feed/1001', title: '示例订阅源', htmlUrl: 'https://example.com/' },
        crawlTimeMsec: String(Date.now() - 3_600_000),
      },
    ],
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const route = url.pathname;
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const auth = req.headers.authorization || '';
      const json = (payload) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (route.endsWith('/accounts/ClientLogin')) {
        const params = new URLSearchParams(body);
        if (params.get('Email') === 'api_user' && params.get('Passwd') === 'app-password') {
          state.authOK = true;
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('SID=abc\nLSID=def\nAuth=mock-auth-token\n');
        } else {
          res.writeHead(401);
          res.end('BadAuthentication');
        }
        return;
      }

      if (!auth.includes('mock-auth-token')) {
        res.writeHead(401);
        res.end('Unauthorized');
        return;
      }

      if (route.endsWith('/token')) {
        state.writeTokenIssued += 1;
        res.writeHead(200);
        res.end('mock-write-token');
        return;
      }
      if (route.endsWith('/subscription/list')) {
        json({ subscriptions: state.subscriptions });
        return;
      }
      if (route.endsWith('/tag/list')) {
        json({ tags: [{ id: 'user/-/label/技术' }] });
        return;
      }
      if (route.endsWith('/stream/items/ids')) {
        const stream = url.searchParams.get('s') || '';
        const ids = state.items
          .filter((item) => {
            const read = item.categories.includes('user/-/state/com.google/read');
            if (stream.includes('starred')) return item.categories.includes('user/-/state/com.google/starred');
            if (stream.includes('reading-list')) return !read; // xt=read → 排除已读
            return true;
          })
          .map((item) => ({ id: item.id }));
        json({ itemRefs: ids });
        return;
      }
      if (route.endsWith('/stream/items/contents')) {
        const params = new URLSearchParams(body);
        const wanted = new Set(params.getAll('i'));
        json({ items: state.items.filter((item) => wanted.has(item.id)) });
        return;
      }
      if (route.includes('/stream/contents/')) {
        json({ items: state.items });
        return;
      }
      if (route.endsWith('/edit-tag')) {
        const params = new URLSearchParams(body);
        state.editTagCalls.push({
          items: params.getAll('i'),
          add: params.getAll('a'),
          remove: params.getAll('r'),
          token: params.get('T'),
        });
        res.writeHead(200);
        res.end('OK');
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, state }));
  });
}

app.whenReady().then(async () => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  try {
    // ===== Part 1: LLM 流式 =====
    const llmPort = 48191;
    const llmMock = await createLLMMock(llmPort);
    const { LLMService, ArticleChunker } = require('../src/main/LLMService');
    const { defaultLLMConfiguration } = require('../src/main/Models');
    const service = new LLMService();
    const config = {
      ...defaultLLMConfiguration(),
      baseURL: `http://127.0.0.1:${llmPort}/v1`,
      model: 'mock-model',
      allowInsecureLocalEndpoint: true,
    };

    const chunks = [];
    const streamed = await service.summary('这是一篇用于测试的文章正文。', config, 'mock-key', async (delta) => chunks.push(delta));
    check('llm-stream-summary', streamed === '结论：纸感阅读强调专注。- 要点一- 要点二', `text=${streamed}`);
    check('llm-stream-deltas', chunks.length === 5 && chunks[0] === '结论：');

    const batch = await service.translateBatch(['a', 'b', 'c'], config, 'mock-key');
    check('llm-translate-batch', JSON.stringify(batch) === JSON.stringify(['译文A', '译文B', '译文C']));

    const explain = await service.explainSelection({
      selection: '划选的文字', localContext: '上下文', articleContext: '全文备忘',
      configuration: { ...config, targetLanguage: '简体中文' }, apiKey: 'mock-key',
    });
    check('llm-explain-selection', typeof explain === 'string' && explain.length > 0);

    check('llm-auth-header', llmMock.requestBodies.every((r) => r.auth === 'Bearer mock-key'));
    const streamRequest = llmMock.requestBodies.find((r) => r.body.includes('"stream":true'));
    check('llm-request-shape', streamRequest && streamRequest.url.endsWith('/v1/chat/completions') && streamRequest.body.includes('"model":"mock-model"'));
    llmMock.server.close();

    // ===== Part 2: FreshRSS 同步 =====
    const freshPort = 48192;
    const freshMock = await createFreshRSSMock(freshPort);
    const { AppStore } = require('../src/main/AppStore');
    const store = new AppStore(userData);

    // 2.1 凭据校验失败路径
    let badAuth = null;
    await store.validateFreshRSSCredentials(`http://127.0.0.1:${freshPort}`, 'wrong', 'wrong').catch((err) => { badAuth = err; });
    check('freshrss-bad-auth', badAuth && badAuth.kind === 'invalidCredentials', badAuth?.kind);

    // 2.2 添加账户 + 初始同步
    const account = await store.addFreshRSSAccount({
      displayName: '测试 FreshRSS',
      endpointURL: `http://127.0.0.1:${freshPort}`,
      username: 'api_user',
      password: 'app-password',
    });
    await new Promise((resolve) => setTimeout(resolve, 1500)); // 等后台初始同步
    const feeds = store.feedsRepo.feeds(account.id);
    check('freshrss-feeds-synced', feeds.length === 1 && feeds[0].title === '示例订阅源', `feeds=${feeds.length}`);
    const folders = store.feedsRepo.folders(account.id);
    check('freshrss-folder-synced', folders.length === 1 && folders[0].name === '技术', `folders=${folders.map((f) => f.name).join(',')}`);

    const items = store.listItems({ kind: 'feed', feedID: feeds[0].id });
    check('freshrss-items-synced', items.length === 2, `items=${items.length}`);
    const item1 = store.entry(items.find((i) => i.title.includes('一'))?.id || items[0].id);
    const item2 = store.entry(items.find((i) => i.title.includes('二'))?.id || items[1].id);
    check('freshrss-unread-reconciled', item1 && item1.isRead === false);
    check('freshrss-read-reconciled', item2 && item2.isRead === true);
    check('freshrss-content', (item1?.contentHTML || '').includes('mock 文章的正文'));

    // 2.3 outbox：本地标已读 → 回放到远端
    store.markRead(item1.id, true);
    store.toggleStar(item1.id);
    await new Promise((resolve) => setTimeout(resolve, 3000)); // 等 outbox drain（1.5s 调度 + 请求）
    const editCalls = freshMock.state.editTagCalls;
    const readCall = editCalls.find((c) => c.add.some((tag) => tag.endsWith('/read')));
    const starCall = editCalls.find((c) => c.add.some((tag) => tag.endsWith('/starred')));
    check('freshrss-outbox-read', Boolean(readCall), JSON.stringify(editCalls.map((c) => c.add)));
    check('freshrss-outbox-star', Boolean(starCall));
    check('freshrss-write-token', freshMock.state.writeTokenIssued >= 1 && editCalls.every((c) => c.token === 'mock-write-token'));
    check('freshrss-outbox-drained', store.statesRepo.outboxCount(account.id) === 0, `pending=${store.statesRepo.outboxCount(account.id)}`);

    freshMock.server.close();
  } catch (err) {
    check('unexpected-error', false, (err.stack || err.message).slice(0, 400));
  }

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length === 0 ? 'MOCKTEST: ALL PASSED' : `MOCKTEST: ${failed.length} FAILED`);
  app.exit(failed.length === 0 ? 0 : 1);
});
