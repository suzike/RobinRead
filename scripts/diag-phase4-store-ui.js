'use strict';
/**
 * diag-phase4-store-ui.js — 阶段四商店 UI 端到端探测（治理 + 中文批次 + AI 探索）
 *
 * 与生产一致的 boot：独立临时 userData（os.tmpdir 隔离）+ 真实 registerIPCHandlers
 * + show:false + backgroundThrottling:false，executeJavaScript IIFE 自包 try/catch
 * （executeJavaScript 的 rejection 表现为空 {}，一律在注入代码里捕获并返回 e.message）。
 *
 * 覆盖：
 *   A 治理   CATALOG 合并后 URL 唯一；TOPICS.urls 全部命中目录；卡片无 ★/万订阅
 *            伪数据；「375」计数 = WECHAT_ACCOUNTS.length；健康标注（isDead 沉底 + ⚠ 徽标）
 *   B 中文批  CATALOG 中 lang='zh' 条目数 ≥ 150（原 40 + 新批次 ≥110）
 *   C 探索   打开商店 → AI 探索 → 基础版（真实网络，20-40s，上限 90s）→ 卡片流 ≥3
 *            且每张含客观指标与样章 → 点「不感兴趣」→ 卡片移除
 *
 * 幂等：数据全部落在一次性临时目录；退出码 0 = 全 PASS，1 = 有 FAIL。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

// 必须在 app ready 前 require：注册 robin-icon 特权 scheme（与生产 main.js 相同路径）
require('../src/main/ipc');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-phase4-storeui-'));
app.setPath('userData', userData);

app.whenReady().then(async () => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(Boolean(ok));
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let code = 1;
  const watchdog = setTimeout(() => {
    console.log('FAIL watchdog — 探测总时长超 240s，强制退出');
    app.exit(1);
  }, 240000);

  try {
    // ── 主进程侧：预置一个「已死」的目录源（sspai，cn 分类），验证健康标注与沉底 ──
    const { AppStore } = require('../src/main/AppStore');
    const store = new AppStore(userData);
    const deadFeed = store.feedsRepo.insertFeed({
      accountID: 'local-default',
      title: '少数派（探测标记死源）',
      siteURL: 'https://sspai.com',
      feedURL: 'https://sspai.com/feed',
    });
    store.database.prepare(
      'INSERT OR REPLACE INTO feed_health (feed_id, consecutive_failures, is_dead, last_failure_at) VALUES (?, 5, 1, ?)'
    ).run(deadFeed.id, Date.now() / 1000);
    const health = store.healthByFeedURL();
    check('前置 storeHealth 含死源标记', Boolean(health['https://sspai.com/feed'] && health['https://sspai.com/feed'].isDead === true),
      JSON.stringify(health['https://sspai.com/feed'] || {}));

    // ── 窗口与页面 ──
    const win = new BrowserWindow({
      show: false, width: 1500, height: 940,
      webPreferences: {
        preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    const { registerIPCHandlers } = require('../src/main/ipc');
    registerIPCHandlers(store, win);
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    // gotcha：executeJavaScript 的 rejection 会变成空 {}，注入 IIFE 内一律自行 try/catch 返回 e.message
    const run = async (js) => {
      try { return await win.webContents.executeJavaScript(js, true); }
      catch (e) { return { ok: false, error: 'executeJavaScript-rejected: ' + String((e && e.message) || e) }; }
    };
    await sleep(4000); // boot：reloadAll + 首屏渲染（show:false 下 rAF 可能不跑，一律 setTimeout 等待）

    // ── 0. 动态 import 商店模块（ESM） ──
    const mod = await run(`(async () => { try {
      const m = await import('./views/feed-store.js');
      window.__fs = m;
      return { ok: true, catalog: m.CATALOG.length, topics: m.TOPICS.length };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`);
    check('feed-store.js 动态导入（CATALOG/TOPICS 可达）', mod.ok === true && mod.catalog > 300, JSON.stringify(mod));

    // ── 1. 治理：CATALOG 合并后 URL 唯一 + 中文批次 ≥150 + TOPICS 全命中 ──
    const gov = await run(`(async () => { try {
      const { CATALOG, TOPICS } = window.__fs;
      const seen = new Set(); const dups = [];
      for (const e of CATALOG) { if (seen.has(e.url)) dups.push(e.url); seen.add(e.url); }
      const zhCount = CATALOG.filter((e) => e.lang === 'zh').length;
      const topicMiss = [];
      for (const tp of TOPICS) {
        for (const u of (tp.urls || [])) {
          if (!CATALOG.some((c) => c.url === u)) topicMiss.push(tp.id + ':' + u);
        }
      }
      const ranks = new Set(CATALOG.map((e) => e.rank));
      return { ok: true, total: CATALOG.length, dupCount: dups.length, dups: dups.slice(0, 5),
               zhCount, topicMiss, uniqueRanks: ranks.size === CATALOG.length };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`);
    check('治理 CATALOG 合并后 URL 唯一', gov.ok && gov.dupCount === 0,
      `total=${gov.total} dups=${JSON.stringify(gov.dups || [])} err=${gov.error || ''}`);
    check('治理 每个专题 urls 全部命中 CATALOG', gov.ok && Array.isArray(gov.topicMiss) && gov.topicMiss.length === 0,
      JSON.stringify(gov.topicMiss || gov.error || []));
    check('中文批次 CATALOG lang=zh 条目 ≥150', gov.ok && gov.zhCount >= 150, `zh=${gov.zhCount}`);
    check('治理 rank 全局唯一', gov.ok && gov.uniqueRanks === true, `unique=${gov.uniqueRanks}`);

    // ── 2. 打开商店：卡片 DOM 无伪数据 ──
    const opened = await run(`(async () => { try {
      const { FeedStore } = window.__fs;
      window.__store = new FeedStore({ onSubscribed: () => {} });
      window.__store.present();
      await new Promise((r) => setTimeout(r, 900)); // 等 _loadSubscribed/_loadHealth 重绘
      const modal = document.querySelector('.fs-modal');
      if (!modal) return { ok: false, error: 'no-modal' };
      const text = modal.textContent;
      const cards = modal.querySelectorAll('.fs-card').length;
      return { ok: true, cards, hasSubs: text.includes('万订阅'), hasRating: text.includes('★'),
               hasEditorClaim: text.includes('人工核验') };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`);
    check('商店打开且卡片网格渲染', opened.ok === true && opened.cards >= 300, JSON.stringify(opened));
    check('治理 卡片 DOM 无「万订阅」假订阅数', opened.ok === true && opened.hasSubs === false, `hasSubs=${opened.hasSubs}`);
    check('治理 卡片 DOM 无 ★ 假评分', opened.ok === true && opened.hasRating === false, `hasRating=${opened.hasRating}`);
    check('治理 无「编辑人工核验」文案', opened.ok === true && opened.hasEditorClaim === false, `hasEditorClaim=${opened.hasEditorClaim}`);

    // ── 3. 健康标注：死源卡带 ⚠ 徽标且在 cn 分类内沉底 ──
    const healthUI = await run(`(async () => { try {
      const store = window.__store;
      const loaded = store.health instanceof Map && store.health.get('https://sspai.com/feed');
      // 切到「中文技术」分类（排除专题同名项）
      const railItems = [...document.querySelectorAll('.fs-rail-item:not(.fs-rail-topic)')];
      const cnItem = railItems.find((el) => el.textContent.includes('中文技术'));
      if (!cnItem) return { ok: false, error: 'no-cn-rail' };
      cnItem.click();
      await new Promise((r) => setTimeout(r, 350));
      const grid = document.querySelector('.fs-grid');
      const cards = [...grid.querySelectorAll('.fs-card')];
      const deadCards = cards.filter((c) => c.querySelector('.fs-dead-badge'));
      const lastCard = cards[cards.length - 1];
      return { ok: true, healthLoaded: Boolean(loaded), cardCount: cards.length,
               deadCount: deadCards.length,
               deadIsLast: deadCards.length === 1 && lastCard === deadCards[0],
               deadText: deadCards[0] ? deadCards[0].querySelector('.fs-card-name').textContent : '',
               deadBadgeText: deadCards[0] ? (deadCards[0].querySelector('.fs-dead-badge') || {}).textContent : '' };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`);
    check('健康 storeHealth Map 已加载并匹配卡片', healthUI.ok === true && healthUI.healthLoaded === true,
      `healthLoaded=${healthUI.healthLoaded} err=${healthUI.error || ''}`);
    check('健康 死源卡显示 ⚠ 最近抓取失败 徽标', healthUI.ok === true && healthUI.deadCount === 1
      && String(healthUI.deadBadgeText || '').includes('最近抓取失败'),
      `deadCount=${healthUI.deadCount} badge=${JSON.stringify(healthUI.deadBadgeText)} err=${healthUI.error || ''}`);
    check('健康 死源在同分类内沉底（排序最后）', healthUI.ok === true && healthUI.deadIsLast === true,
      `deadIsLast=${healthUI.deadIsLast} cards=${healthUI.cardCount}`);

    // ── 4. 「375」计数 = WECHAT_ACCOUNTS.length ──
    const wcCount = await run(`(async () => { try {
      const { WECHAT_ACCOUNTS } = await import('./views/wechat-accounts.js');
      const railItems = [...document.querySelectorAll('.fs-rail-item')];
      const wcItem = railItems.find((el) => el.textContent.includes('微信公众号'));
      if (!wcItem) return { ok: false, error: 'no-wc-rail' };
      wcItem.click();
      await new Promise((r) => setTimeout(r, 350));
      const badge = document.querySelector('.wc-search-count');
      const bridgeNote = [...document.querySelectorAll('.fs-card')].some((c) => c.textContent.includes('依赖第三方桥接服务'));
      return { ok: true, expected: WECHAT_ACCOUNTS.length, actual: badge ? badge.textContent.trim() : null, bridgeNote };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`);
    check('公众号搜索计数 = WECHAT_ACCOUNTS.length（无 375 硬编码漂移）',
      wcCount.ok === true && String(wcCount.expected) === String(wcCount.actual),
      `expected=${wcCount.expected} actual=${wcCount.actual} err=${wcCount.error || ''}`);
    check('公众号卡片带桥接依赖常驻小字', wcCount.ok === true && wcCount.bridgeNote === true, `bridgeNote=${wcCount.bridgeNote}`);

    // ── 5. AI 探索：入口 → 基础版（真实网络）→ 卡片流 → 不感兴趣移除 ──
    // 回到全部目录视图，点「AI 探索」入口
    const entry = await run(`(async () => { try {
      const railItems = [...document.querySelectorAll('.fs-rail-item')];
      const allItem = railItems.find((el) => el.textContent.includes('全部'));
      if (allItem) allItem.click();
      await new Promise((r) => setTimeout(r, 300));
      const btn = document.querySelector('.fs-explore-entry');
      if (!btn) return { ok: false, error: 'no-explore-entry' };
      btn.click();
      await new Promise((r) => setTimeout(r, 300));
      const host = document.querySelector('.fs-explore-host');
      const input = document.querySelector('.fs-explore-domain');
      const privacy = document.querySelector('.fs-explore-privacy');
      const basicBtn = document.querySelector('.fs-explore-basic');
      return { ok: Boolean(host && input && basicBtn), gridHidden: !document.querySelector('.fs-grid'),
               hasPrivacy: Boolean(privacy),
               placeholder: input ? input.placeholder : '' };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`);
    check('探索 入口按钮进入探索面板（目录网格隐藏 + 隐私提示 + 领域输入框）',
      entry.ok === true && entry.gridHidden === true && entry.hasPrivacy === true,
      JSON.stringify(entry));

    const exploreStart = await run(`(async () => { try {
      document.querySelector('.fs-explore-basic').click();
      await new Promise((r) => setTimeout(r, 400));
      return { ok: true, loading: document.querySelector('.fs-explore-status') ? document.querySelector('.fs-explore-status').textContent : '' };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`);
    check('探索 基础版启动并显示验证中文案', exploreStart.ok === true,
      JSON.stringify(exploreStart));

    // 等待卡片流（真实网络验证 20-40s，给 90s 上限）
    const waitCards = await run(`(async () => { try {
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 800));
        const phase = window.__store.explore.phase;
        const n = document.querySelectorAll('.fs-explore-card').length;
        if (phase === 'done' && n > 0) {
          const cards = [...document.querySelectorAll('.fs-explore-card')];
          const detail = cards.map((c) => ({
            name: (c.querySelector('.fs-card-name') || {}).textContent || '',
            metrics: (c.querySelector('.fs-explore-metrics') || {}).textContent || '',
            samples: c.querySelectorAll('.fs-explore-sample').length,
            score: (c.querySelector('.fs-score-badge') || {}).textContent || '',
          }));
          return { ok: true, count: cards.length, detail };
        }
        if (phase === 'error') {
          return { ok: false, error: 'explore-error', note: window.__store.explore.error };
        }
      }
      return { ok: false, error: 'timeout-90s', phase: window.__store.explore.phase };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`);
    check('探索 卡片流 ≥3 张（真实网络验证）', waitCards.ok === true && waitCards.count >= 3,
      `count=${waitCards.count} err=${waitCards.error || ''} note=${waitCards.note || ''}`);
    const cardsOk = waitCards.ok && Array.isArray(waitCards.detail)
      && waitCards.detail.every((c) => c.metrics.includes('天前') && c.metrics.includes('字') && c.samples >= 1 && c.score !== '');
    check('探索 每张卡片含客观指标（更新/频率/字数）与样章、分数徽标', cardsOk === true,
      JSON.stringify((waitCards.detail || []).slice(0, 2)));

    // 点一张「不感兴趣」→ 卡片移除
    const dismiss = await run(`(async () => { try {
      const before = document.querySelectorAll('.fs-explore-card').length;
      const firstUrl = document.querySelector('.fs-explore-card').dataset.url;
      document.querySelector('.fs-explore-card .fs-explore-dismiss').click();
      await new Promise((r) => setTimeout(r, 600));
      const after = document.querySelectorAll('.fs-explore-card').length;
      const gone = ![...document.querySelectorAll('.fs-explore-card')].some((c) => c.dataset.url === firstUrl);
      const store = window.__store;
      return { ok: true, before, after, gone, stateGone: !store.explore.cards.some((c) => c.feedURL === firstUrl) };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`);
    check('探索 「不感兴趣」后卡片移除（DOM 与状态同步）',
      dismiss.ok === true && dismiss.after === dismiss.before - 1 && dismiss.gone === true && dismiss.stateGone === true,
      JSON.stringify(dismiss));

    // ── 6. 既有断言不回归：extra2 计数与新分类（selftest 同款口径）──
    const extra2 = await run(`(async () => { try {
      const { CATALOG_EXTRA2 } = await import('./views/feed-store-extra2.js');
      const cats = new Set(CATALOG_EXTRA2.map((e) => e.cat));
      return { ok: true, count: CATALOG_EXTRA2.length,
               hasNewCats: ['lang', 'fe', 'sec'].every((c) => cats.has(c)) };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`);
    check('回归 store-extra2-count（≥90）与新分类保留', extra2.ok === true && extra2.count >= 90 && extra2.hasNewCats,
      `count=${extra2.count} newCats=${extra2.hasNewCats} err=${extra2.error || ''}`);

    code = results.every(Boolean) ? 0 : 1;
    console.log(code === 0 ? 'PHASE4 STORE UI PROBE: ALL PASSED' : 'PHASE4 STORE UI PROBE: FAILED');
  } catch (err) {
    console.error('HARNESS ERROR:', err && (err.stack || err.message || err));
    code = 1;
  }
  clearTimeout(watchdog);
  app.exit(code);
}).catch((err) => { console.error(err); app.exit(1); });
