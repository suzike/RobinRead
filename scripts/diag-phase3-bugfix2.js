'use strict';
/**
 * diag-phase3-bugfix2.js — 阶段三渲染层第二轮修复端到端探测（B14 / B15 / B12 / timeAgo）
 *
 * 与生产一致的 boot（参照 diag-phase1-renderer.js 骨架）：独立临时 userData（os.tmpdir 隔离）
 * + 真实 registerIPCHandlers + show:false 窗口 + backgroundThrottling:false 加载 src/renderer/index.html；
 * 样本数据 pubDate 一律 iso(now)。主进程 mock global.fetch 拦截 aihot.virxact.com（其余走真实 fetch），
 * 以可控行延迟制造「慢板块先点、快板块后点」的确定性竞态窗口：
 *   /api/v1/hot-topics        延迟 ~60ms   → 热点榜 fixture（HOT-ITEM）
 *   /api/v1/dailies/latest    延迟 ~900ms  → AI 日报 fixture（DAILY-FLASH）
 *
 * 覆盖：
 *   B14 _load 请求令牌：daily（慢）→ hot（快）连点后，最终 data/DOM 属于 hot，不被迟到的 daily 覆盖
 *       （含 _loadMoreSelected/_openStory 同一令牌语义的实现层存在性检查）
 *   B15 数字字段数值化：rank/sourceCount/score/story 计数传入恶意字符串走
 *       _renderHot/_renderLeaderboard/_renderSelected/_renderStory → 无 <img src=x 注入、无 onerror 落地
 *   B12 HueWheel 监听器泄漏：30 次重渲后 window mousemove 只有当前实例回调；destroy 后 move/up 均失效；
 *       dismiss() 一并销毁
 *   d   timeAgo i18n：zh 输出「5 分钟前」；en 不抛错且含数值（键未收录时允许中文回退）
 *
 * 幂等：全部数据落在一次性临时目录；本地端口随机；退出码 0=全 PASS，1=有 FAIL。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

// 必须在 app ready 前 require：ipc.js 顶层注册 robin-icon 特权 scheme（与生产 main.js 相同路径）
require('../src/main/ipc');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-phase3-bugfix2-'));
app.setPath('userData', userData);

const HOT_DELAY_MS = 60;
const DAILY_DELAY_MS = 900;

// ── aihot fixtures（raw API 形状，经 AihotService 归一化后进渲染层） ──
const HOT_ITEMS = {
  items: [
    { rank: 1, id: 'h1', title: 'HOT-ITEM-ONE', source: { name: '源A' }, sourceCount: 3, sourceNames: ['源A', '源B'], latestAt: new Date().toISOString(), links: { original: 'https://example.com/1', story: 'https://aihot.virxact.com/story/s1' } },
    { rank: 2, id: 'h2', title: 'HOT-ITEM-TWO', source: { name: '源B' }, sourceCount: 2, sourceNames: ['源B'], latestAt: new Date().toISOString(), links: { original: 'https://example.com/2' } },
  ],
};
const DAILY_RAW = {
  report: {
    date: '2026-08-30',
    lead: { title: '导语', paragraph: '日报导语段落' },
    sections: [{ title: '大模型', items: [{ title: '日报条目', summary: '摘要', url: 'https://example.com/daily-1' }] }],
    flashes: [{ title: 'DAILY-FLASH', summary: '快讯摘要', url: 'https://example.com/flash-1' }],
    generatedAt: new Date().toISOString(),
  },
};

const jsonResp = (data) => ({ ok: true, status: 200, json: async () => data });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(Boolean(ok));
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };
  let code = 1;
  const watchdog = setTimeout(() => {
    console.log('FAIL watchdog — 探测总时长超 150s，强制退出');
    app.exit(1);
  }, 150000);

  // mock fetch：只拦截 aihot.virxact.com，制造确定性行延迟；其余请求走真实实现
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (!u.includes('aihot.virxact.com')) return realFetch(url, opts);
    if (u.includes('/api/v1/hot-topics')) { await sleep(HOT_DELAY_MS); return jsonResp(HOT_ITEMS); }
    if (u.includes('/api/v1/dailies/latest')) { await sleep(DAILY_DELAY_MS); return jsonResp(DAILY_RAW); }
    return jsonResp({ items: [] });
  };

  try {
    const FeedParser = require('../src/main/FeedParser');
    const { AppStore } = require('../src/main/AppStore');
    const { registerIPCHandlers } = require('../src/main/ipc');

    // 最小样本 feed：仅保证应用 boot 渲染稳定（aihot 探测不依赖它）
    const iso = (ms) => new Date(ms).toUTCString();
    const now = Date.now();
    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>阶段三修复探测周刊</title><link>https://example.com/bugfix2</link>
  <item><title>boot 样本文章</title><link>https://example.com/bugfix2/1</link>
    <pubDate>${iso(now)}</pubDate><description>boot 样本。</description>
    <content:encoded><![CDATA[<p>boot 样本正文，仅用于让应用完成首屏渲染。</p>]]></content:encoded>
  </item>
</channel></rss>`;
    const parsed = FeedParser.parse(Buffer.from(rss, 'utf8'), 'https://example.com/bugfix2/feed.xml');
    const store = new AppStore(userData);
    const feed = store.feedsRepo.insertFeed({
      accountID: 'local-default',
      title: parsed.title,
      siteURL: parsed.siteURL,
      feedURL: 'https://example.com/bugfix2/feed.xml',
    });
    store._applyParsedEntries(feed, parsed.entries);

    const win = new BrowserWindow({
      show: false, width: 1500, height: 940,
      webPreferences: {
        preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    registerIPCHandlers(store, win);
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    // gotcha：executeJavaScript 的 rejection 会变成空 {}，注入 IIFE 内一律自行 try/catch 返回 e.message
    const run = async (js) => {
      try { return await win.webContents.executeJavaScript(js, true); }
      catch (e) { return { ok: false, error: 'executeJavaScript-rejected: ' + String((e && e.message) || e) }; }
    };
    await sleep(4500); // boot：reloadAll + 首屏渲染（show:false 下 rAF 可能不跑，一律 setTimeout 等待）

    // ── 0. boot 断言 ──
    const boot = await run(`(() => { try {
      return { ok: !!window.robin && !!document.body, rows: document.querySelectorAll('.entry-row').length };
    } catch (e) { return { ok: false, error: e.message }; } })()`);
    check('boot 应用启动、IPC 桥就绪', boot.ok === true && boot.rows >= 1, JSON.stringify(boot));

    // ── 1. B14：慢板块先点、快板块后点 → 最终内容与当前 section 一致 ──
    const b14 = await run(`(async () => {
      try {
        const { AihotView } = await import('./views/aihot-view.js');
        const view = new AihotView({ onOpenURL() {}, onFeedback() {} });
        view.present();
        await new Promise((r) => setTimeout(r, 1500)); // present 的初始 hot 加载完成（并预热服务端缓存）
        window.__aihotView = view;
        // 与侧栏 click 处理器完全相同的序列：先点慢板块（daily，900ms），80ms 后点快板块（hot）
        view.section = 'daily'; view._render(); view._load();
        await new Promise((r) => setTimeout(r, 80));
        const sectionAtFirstClick = view.section;
        view.section = 'hot'; view._render(); view._load();
        const sectionAfterSecondClick = view.section;
        await new Promise((r) => setTimeout(r, 2400)); // 等 daily 的迟到响应（约 900ms 后到达）
        const host = view.contentHost;
        return {
          ok: true,
          section: view.section,
          sectionAtFirstClick,
          sectionAfterSecondClick,
          dataType: Array.isArray(view.data) ? 'array' : typeof view.data,
          firstTitle: Array.isArray(view.data) ? (view.data[0] || {}).title : String(view.data && view.data.date),
          hasEmpty: !!host.querySelector('.list-empty'),
          emptyText: (host.querySelector('.list-empty') || {}).textContent || '',
          hasHot: host.textContent.includes('HOT-ITEM-ONE'),
          hasDaily: host.textContent.includes('DAILY-FLASH'),
          loadTokenWorks: typeof view._loadToken === 'object',
        };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    })()`);
    check('B14 前置：先点 daily 再点 hot（两次 _load 并发），令牌存在',
      b14.ok === true && b14.sectionAtFirstClick === 'daily' && b14.sectionAfterSecondClick === 'hot' && b14.loadTokenWorks === true, JSON.stringify(b14));
    check('B14 快板块渲染不被慢板块迟到响应覆盖（data 归 hot、无「暂无数据」、无日报内容）',
      b14.ok === true && b14.section === 'hot' && b14.dataType === 'array' && b14.firstTitle === 'HOT-ITEM-ONE'
      && b14.hasEmpty === false && b14.hasHot === true && b14.hasDaily === false,
      `section=${b14.section} data=${b14.dataType}:${b14.firstTitle} empty=${b14.hasEmpty}(${b14.emptyText}) hot=${b14.hasHot} daily=${b14.hasDaily}`);

    // ── 2. B15：恶意字符串注入数字字段 → 数值化为 0，无 img/onerror 落地 ──
    const b15 = await run(`(() => {
      try {
        const view = window.__aihotView;
        const xss = '<img src=x onerror="window.__xss=1">';
        const out = { probes: [] };
        const sweep = (label) => {
          out.probes.push({
            label,
            xssFired: window.__xss === 1,
            imgInjected: !!document.querySelector('img[src="x"]'),
            onerrorInHTML: view.contentHost.innerHTML.includes('onerror'),
          });
          window.__xss = undefined;
        };
        // a. 热点榜：rank/sourceCount 均为恶意串
        view.section = 'hot';
        view.data = [{ rank: xss, id: 'x1', title: 'XSS-HOT', sourceCount: xss, sourceNames: ['S'], latestAt: new Date().toISOString() }];
        view._renderContent();
        const hotRank = (view.contentHost.querySelector('.aihot-rank') || {}).textContent || '';
        const hotCount = (view.contentHost.querySelector('.aihot-source-count') || {}).textContent || '';
        sweep('hot');
        out.hotRank = hotRank; out.hotCount = hotCount;
        // b. 模型榜：rank/score 恶意串
        view.section = 'leaderboard';
        view.data = [{ rank: xss, name: 'MODEL-X', vendor: 'V', score: xss, inputPrice: '$1', outputPrice: '$2', releaseDate: '2026-01-01', completeness: '99', detailURL: 'https://example.com' }];
        view._renderContent();
        const lbRank = (view.contentHost.querySelector('.aihot-rank') || {}).textContent || '';
        sweep('leaderboard');
        out.lbRank = lbRank;
        // c. 精选：score 恶意串
        view.section = 'selected';
        view.data = [{ id: 'c1', title: 'XSS-SEL', summary: 'S', source: 'SRC', score: xss }];
        view._renderContent();
        sweep('selected');
        // d. 故事：sourceCount/reportCount 恶意串
        view.section = 'story';
        view.data = { title: 'XSS-STORY', sourceCount: xss, reportCount: xss, digest: 'D', reports: [], storyline: [], related: [] };
        view._renderContent();
        sweep('story');
        out.ok = out.probes.every((p) => !p.xssFired && !p.imgInjected && !p.onerrorInHTML);
        return out;
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    })()`);
    check('B15 热点榜 rank/sourceCount 恶意串被数值化（rank 显示 0、无注入）',
      b15.ok === true && b15.hotRank === '0' && String(b15.hotCount || '').includes('0 源在报'),
      JSON.stringify({ hotRank: b15.hotRank, hotCount: b15.hotCount, probes: b15.probes }));
    check('B15 模型榜/精选/故事恶意串全部数值化或转义（四个面板零 img[src=x] / onerror / onerror 触发）',
      b15.ok === true && b15.lbRank === '00'
      && (b15.probes || []).every((p) => !p.xssFired && !p.imgInjected && !p.onerrorInHTML),
      JSON.stringify({ lbRank: b15.lbRank, probes: b15.probes }));

    // ── 3. B12：HueWheel 重渲监听器泄漏 ──
    const b12 = await run(`(() => {
      try {
        const wheelProtoProbe = {}; // 结构断言占位
        const out = { ...wheelProtoProbe };
        return Promise.resolve().then(async () => {
          const { ThemeDesigner } = await import('./views/theme-designer.js');
          const td = new ThemeDesigner({ onApplied() {}, onReset() {} });
          td.livePreview = false; // 不污染页面主题变量
          td.present();
          // 模拟拖滑杆：每个 input 事件 → patch → commit → _render（每次重建 HueWheel）
          const wheels = [];
          for (let i = 0; i < 30; i += 1) { td._render(); wheels.push(td.wheel); }
          out.rebuiltDistinct = new Set(wheels).size === 30;
          out.destroyExists = wheels.every((w) => typeof w.destroy === 'function');
          // 为每个轮子挂计数器并模拟按住拖拽，随后广播一次 mousemove：
          // 已销毁实例的监听器若未摘除，其计数器会增加
          wheels.forEach((w) => { w.__calls = 0; w.onHue = () => { w.__calls += 1; }; w._dragging = true; });
          window.dispatchEvent(new MouseEvent('mousemove', { clientX: 3, clientY: 3 }));
          const deadLeak = wheels.slice(0, -1).filter((w) => w.__calls > 0).length;
          out.deadLeak = deadLeak; // 期望 0：29 个旧轮无一响应
          out.currentResponded = wheels[wheels.length - 1].__calls >= 1; // 期望 true：现役轮仍工作
          out.allDestroyedFlag = wheels.slice(0, -1).every((w) => w._destroyed === true);
          // mouseup 正向：现役轮收到 mouseup 后 _dragging 复位
          const wLive = td.wheel;
          wLive._dragging = true;
          window.dispatchEvent(new MouseEvent('mouseup', {}));
          out.mouseupResets = wLive._dragging === false;
          // destroy 反向：销毁后 mouseup 不再复位 _dragging（监听器确已移除）
          const wKill = td.wheel;
          wKill.destroy();
          out.destroyNullsRefs = wKill._destroyed === true && wKill.onHue === null && wKill.canvas === null;
          wKill._dragging = true;
          window.dispatchEvent(new MouseEvent('mouseup', {}));
          out.mouseupDeadAfterDestroy = wKill._dragging === true;
          // dismiss 清理：关闭设计器时当前轮一并销毁
          const wBefore = td.wheel;
          wBefore.__calls = 0; wBefore.onHue = () => { wBefore.__calls += 1; }; wBefore._dragging = true;
          td.dismiss();
          out.dismissDestroysWheel = wBefore._destroyed === true;
          window.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 5 }));
          out.noCallbackAfterDismiss = wBefore.__calls === 0;
          out.ok = out.rebuiltDistinct && out.destroyExists && out.deadLeak === 0 && out.currentResponded
            && out.allDestroyedFlag && out.mouseupResets && out.destroyNullsRefs && out.mouseupDeadAfterDestroy
            && out.dismissDestroysWheel && out.noCallbackAfterDismiss;
          return out;
        });
      } catch (e) { return Promise.resolve({ ok: false, error: String(e && e.message || e) }); }
    })()`);
    check('B12 HueWheel：destroy 存在、30 次重渲后仅现役轮响应 mousemove（旧轮零泄漏）',
      b12.ok === true && b12.rebuiltDistinct === true && b12.deadLeak === 0 && b12.currentResponded === true,
      JSON.stringify({ rebuilt: b12.rebuiltDistinct, deadLeak: b12.deadLeak, current: b12.currentResponded, destroyExists: b12.destroyExists }));
    check('B12 HueWheel：destroy 摘除 move/up 监听器并置空引用；dismiss 一并销毁',
      b12.ok === true && b12.mouseupResets === true && b12.destroyNullsRefs === true
      && b12.mouseupDeadAfterDestroy === true && b12.dismissDestroysWheel === true && b12.noCallbackAfterDismiss === true,
      JSON.stringify({ up: b12.mouseupResets, nulls: b12.destroyNullsRefs, upDead: b12.mouseupDeadAfterDestroy, dismiss: b12.dismissDestroysWheel, noCb: b12.noCallbackAfterDismiss }));

    // ── 4. timeAgo i18n：zh「5 分钟前」；en 不抛错且含数值（允许中文回退） ──
    const timeAgo = await run(`(async () => {
      try {
        const view = window.__aihotView;
        const { configure, currentLanguage } = await import('./i18n.js');
        const prev = currentLanguage();
        const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
        configure({ lang: 'zh' });
        view.section = 'hot';
        view.data = [{ rank: 1, id: 't1', title: 'TIME-TITLE', sourceCount: 2, sourceNames: ['S'], latestAt: fiveMinAgo }];
        view._renderContent();
        const zhOut = (view.contentHost.querySelector('.aihot-time') || {}).textContent || '';
        configure({ lang: 'en' });
        view._renderContent();
        const enOut = (view.contentHost.querySelector('.aihot-time') || {}).textContent || '';
        configure({ lang: prev });
        return { ok: true, zhOut, enOut, enSane: typeof enOut === 'string' && enOut.includes('5') };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    })()`);
    check('d timeAgo zh 输出「5 分钟前」（tf 带参替换）', timeAgo.ok === true && timeAgo.zhOut === '5 分钟前',
      `zh="${timeAgo.zhOut}"`);
    check('d timeAgo en 不抛错且输出含数值（键未收录时回退中文属预期）',
      timeAgo.ok === true && timeAgo.enSane === true, `en="${timeAgo.enOut}"`);

    // 清理：关掉 aihot 弹层，避免影响退出
    await run(`(() => { try { window.__aihotView?.dismiss(); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } })()`);

    code = results.every(Boolean) ? 0 : 1;
    console.log(code === 0 ? 'PHASE3 BUGFIX2 PROBE: ALL PASSED' : 'PHASE3 BUGFIX2 PROBE: FAILED');
  } catch (err) {
    console.error('HARNESS ERROR:', err && (err.stack || err.message || err));
    code = 1;
  }
  clearTimeout(watchdog);
  global.fetch = realFetch;
  app.exit(code);
}).catch((err) => { console.error(err); app.exit(1); });
