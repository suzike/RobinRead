'use strict';
/**
 * NanJuPaper Windows — 自检脚本
 *
 * 以独立用户数据目录启动应用，注入样本 Feed（本地解析，不联网），
 * 通过 webContents.executeJavaScript 断言三栏 UI 的 DOM 结构，
 * 验证：数据库迁移 / Feed 解析 / 侧栏 / 列表 / 阅读器 / 主题。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, nativeTheme } = require('electron');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-selftest-'));
app.setPath('userData', userData);

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>纸感阅读周刊</title>
    <link>https://example.com/weekly</link>
    <item>
      <title>第一期：让阅读回归沉浸</title>
      <link>https://example.com/weekly/1</link>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <description>三栏布局、衬线排版与克制的智能。</description>
      <content:encoded><![CDATA[
        <h2>为什么是纸感</h2>
        <p>我们把界面还原成纸张的质感：<strong>安静、清晰、专注</strong>。去掉多余的装饰，让文字成为主角。</p>
        <img src="https://example.com/images/paper.png" alt="纸感示例">
        <p>第二段用于验证 TOC 轨道与双语翻译的段落定位。</p>
        <h2>克制的智能化</h2>
        <p>AI 只在真正有帮助的地方出现：摘要、划词解释与对照翻译。</p>
        <script>alert('不应出现')</script>
        <p onclick="steal()">事件属性应被消毒移除</p>
      ]]></content:encoded>
    </item>
    <item>
      <title>第二期：FreshRSS 同步与本地优先</title>
      <link>https://example.com/weekly/2</link>
      <pubDate>${new Date(Date.now() - 3600_000).toUTCString()}</pubDate>
      <description>多账号、离线队列与 Keychain 凭据存储。</description>
    </item>
    <item>
      <title>第三期：键盘为先的阅读流</title>
      <link>https://example.com/weekly/3</link>
      <pubDate>${new Date(Date.now() - 7200_000).toUTCString()}</pubDate>
      <description>C 翻译、V 摘要、B/N 翻篇、M 收藏。</description>
    </item>
  </channel>
</rss>`;

app.whenReady().then(async () => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  try {
    const { AppStore } = require(path.join(__dirname, '..', 'src', 'main', 'AppStore'));
    const FeedParser = require(path.join(__dirname, '..', 'src', 'main', 'FeedParser'));

    // 1. Feed 解析
    const parsed = FeedParser.parse(Buffer.from(SAMPLE_RSS, 'utf8'), 'https://example.com/weekly/feed.xml');
    check('feed-parse-rss', parsed.title === '纸感阅读周刊' && parsed.entries.length === 3, `title=${parsed.title}, entries=${parsed.entries.length}`);
    check('feed-parse-content', parsed.entries[0].contentHTML.includes('<h2>为什么是纸感</h2>'));

    // 2. AppStore + SQLite 持久化
    const store = new AppStore(userData);
    check('db-local-account', store.accounts.account('local-default') != null);

    // 3. 写入 Feed 与条目（直接走仓库层，避免网络）
    const feed = store.feedsRepo.insertFeed({
      accountID: 'local-default',
      title: parsed.title,
      siteURL: parsed.siteURL,
      feedURL: 'https://example.com/weekly/feed.xml',
    });
    store.feedsRepo.ensureFolder('local-default', '技术');
    store._applyParsedEntries(feed, parsed.entries);
    check('store-entries', store.articlesRepo.countForFeed(feed.id) === 3);

    // 4. 时间线查询
    const items = store.listItems({ kind: 'feed', feedID: feed.id });
    check('timeline-feed', items.length === 3 && items[0].sourceTitle === '纸感阅读周刊', `first=${items[0]?.title}`);
    const counts = store.timeline.fetchSidebarCounts('local-default', store._startOfDayTimestamp());
    check('sidebar-counts', counts.allUnread === 3 && counts.todayUnread >= 1, `unread=${counts.allUnread}`);

    // 5. 标记已读 + 星标
    store.markRead(items[0].id, true);
    store.toggleStar(items[1].id);
    const after = store.entry(items[0].id);
    check('mark-read', after.isRead === true);
    check('toggle-star', store.entry(items[1].id).isStarred === true);

    // 6. HTML 消毒
    const ArticleExtractor = require(path.join(__dirname, '..', 'src', 'main', 'ArticleExtractor'));
    const sanitized = ArticleExtractor.sanitizedHTML(parsed.entries[0].contentHTML, 'https://example.com/weekly/1');
    check('sanitizer-strip-script', !sanitized.includes('<script'));
    check('sanitizer-strip-events', !sanitized.includes('onclick'));
    check('sanitizer-keep-content', sanitized.includes('为什么是纸感') && /loading="(eager|lazy)"/.test(sanitized));

    // 7. 段落提取（翻译/TOC 基础）
    const paragraphs = ArticleExtractor.readerParagraphs(sanitized, items[0].title);
    check('reader-paragraphs', paragraphs.length >= 4, `count=${paragraphs.length}`);

    // 8. LLM 配置校验（不发网络）
    const { LLMService, LLMServiceError } = require(path.join(__dirname, '..', 'src', 'main', 'LLMService'));
    const { defaultLLMConfiguration } = require(path.join(__dirname, '..', 'src', 'main', 'Models'));
    const service = new LLMService();
    let insecureError = null;
    await service.complete({
      prompt: 'x', system: 'y',
      configuration: { ...defaultLLMConfiguration(), baseURL: 'http://192.168.1.5:11434/v1' },
      apiKey: 'k',
    }).catch((err) => { insecureError = err; });
    check('llm-insecure-endpoint-blocked', insecureError instanceof LLMServiceError && insecureError.kind === 'insecureEndpoint', insecureError?.kind);

    // 9. OPML
    const OPMLService = require(path.join(__dirname, '..', 'src', 'main', 'OPMLService'));
    const xml = store.exportOPML();
    check('opml-export', xml.includes('weekly/feed.xml'));
    const urls = OPMLService.importURLs(xml);
    check('opml-import-roundtrip', urls.length >= 1, `urls=${urls.length}`);

    // 9.5 自进化引擎：源健康 / 行为 / 画像 / 诊断 / 密度
    const E = store.evolution;
    E.recordFetch({ feedID: feed.id, ok: true, entryCount: 3 });
    E.recordFetch({ feedID: feed.id, ok: false, error: 'timeout' });
    const health = E.healthSnapshot();
    check('evo-health', health.length >= 1 && health[0].successCount === 1 && health[0].failureCount === 1, `success=${health[0]?.successCount}`);

    store.knowledge.addManualTag(items[0].id, '人工智能');
    E.recordBehavior({ itemID: items[0].id, feedID: feed.id, action: 'read' });
    E.recordBehavior({ itemID: items[1].id, feedID: feed.id, action: 'star' });
    const profile = E.interestProfile();
    check('evo-profile', (profile.tags || []).some((t) => t.tag === '人工智能' && t.weight > 0), JSON.stringify(profile.tags));

    E.recordFeedback({ kind: 'summary', rating: 1 });
    const fb = E.feedbackSummary();
    check('evo-feedback', fb.total === 1 && fb.likes === 1, `total=${fb.total}`);

    const diag = E.diagnose();
    check('evo-diagnose', diag && diag.total >= 4 && diag.checks.length >= 4, `checks=${diag?.checks?.length}`);

    const density = E.densityByFeed(14);
    check('evo-density', density.some((d) => d.feedID === feed.id && d.entryCount >= 1), JSON.stringify(density));

    // 9.6 知识引擎增强：每日回顾 / 搜索 / 看板 / 热力图 / Anki / 多格式导出 / 双向链接
    const K = store.knowledge;
    K.addHighlight({ itemID: items[0].id, text: '纸感阅读的核心是专注' });
    K.addNote({ itemID: items[0].id, content: '这是 [[纸感阅读的核心是专注]] 的笔记', tags: ['方法'] });
    const review = K.dailyReview();
    check('kb-daily-review', (review.highlights?.length || 0) >= 1 && (review.notes?.length || 0) >= 1, `hl=${review.highlights?.length} note=${review.notes?.length}`);

    const search = K.searchKnowledge('纸感');
    check('kb-search', (search.highlights?.length || 0) + (search.notes?.length || 0) >= 1, `total=${search.total}`);

    const dash = K.dashboard();
    check('kb-dashboard', dash.highlights >= 1 && dash.notes >= 1, `hl=${dash.highlights} note=${dash.notes}`);

    const heat = K.readingHeatmap(30);
    check('kb-heatmap', heat && typeof heat.map === 'object', `days=${heat.days}`);

    const anki = K.exportAnki();
    check('kb-anki-export-empty', typeof anki === 'string', `len=${anki.length}`);
    // 加入复习队列后再导出，验证真实产出
    K.addToReview({ itemID: items[0].id, highlightID: null });
    const anki2 = K.exportAnki();
    check('kb-anki-export', anki2.includes(items[0].title), `len=${anki2.length}`);

    const json = K.exportJSON();
    const parsedJSON = JSON.parse(json);
    check('kb-json-export', parsedJSON.noteCount >= 1 && Array.isArray(parsedJSON.highlights), `notes=${parsedJSON.noteCount}`);

    const html = K.exportHTML();
    check('kb-html-export', html.includes('<!DOCTYPE html>') && html.includes('纸感'), `len=${html.length}`);

    // 双向链接
    const allNotes = K.getAllNotes();
    const note = allNotes.find((n) => n.content.includes('[['));
    if (note) {
      const links = K.refreshNoteLinks(note.id);
      check('kb-wikilinks', Array.isArray(links) && links.length >= 1, `links=${links.length}`);
    } else {
      check('kb-wikilinks', false, 'note with [[link]] not found');
    }

    // 全文搜索
    store.cachesRepo.saveCache({ entryID: items[0].id, text: '沉浸式阅读的核心是专注与克制。', fetched_at: Date.now() / 1000 });
    const fts = store.fullTextSearch('沉浸式');
    check('full-text-search', fts.some((r) => r.id === items[0].id), `results=${fts.length}`);

    // 9.7 自动打标签 + 兴趣画像注入主列表排序
    const autoTags = store.knowledge.autoTagEntry(items[1].id, '深入 LLM Agent 的多智能体协作', '本文探讨大模型智能体的编排');
    check('auto-tag', autoTags.includes('LLM') || autoTags.includes('Agent'), `tags=${autoTags.join(',')}`);
    // 对 items[1]（含 LLM/Agent 标签）产生行为 → 画像学习到 LLM/Agent 兴趣
    store.evolution.recordBehavior({ itemID: items[1].id, feedID: feed.id, action: 'read' });
    store.evolution.recordBehavior({ itemID: items[1].id, feedID: feed.id, action: 'star' });
    const scored = store.listItems({ kind: 'feed', feedID: feed.id });
    const s0 = scored.find((x) => x.id === items[0].id);
    const s1 = scored.find((x) => x.id === items[1].id);
    // items[1] 命中兴趣标签应获得 boost（分数 > 基础分）
    check('interest-boost', s0 && s1 && s1.score > s0.score, `s0=${s0?.score} s1=${s1?.score}`);

    // 9.8 个性化强度：关闭（0）时 boost 应消失，分数回落到基础分
    const boostedScore = s1 ? s1.score : 0;
    store.setFilterRules({ personalization: 0 });
    const scoredOff = store.listItems({ kind: 'feed', feedID: feed.id });
    const s1off = scoredOff.find((x) => x.id === items[1].id);
    check('personalization-off', s1off && s1off.score < boostedScore, `boosted=${boostedScore} off=${s1off?.score}`);
    store.setFilterRules({ personalization: 2 });

    // 9.9 AIHOT 服务（mock fetch，离线测试）
    const { AihotService } = require(path.join(__dirname, '..', 'src', 'main', 'AihotService'));
    const realFetch = global.fetch;
    global.fetch = async (url) => ({
      ok: true,
      status: 200,
      json: async () => {
        const u = String(url);
        if (u.includes('/hot-topics')) {
          return { schemaVersion: 'v1', count: 1, items: [{ rank: 1, id: 'x1', title: '测试热点', source: { name: '源A' }, sourceCount: 3, sourceNames: ['源A', '源B'], latestAt: '2026-08-17T00:00:00Z', links: { original: 'https://example.com', story: 'https://aihot.virxact.com/story/s1' } }] };
        }
        if (u.includes('/stories/')) {
          return { story: { publicId: 's1', title: '测试故事', sourceCount: 3, reportCount: 2, digest: 'AI 摘要', reports: [{ id: 'r1', title: '报道1', summary: '摘要', source: '源A', publishedAt: '2026-08-17T00:00:00Z', links: { original: 'https://example.com' } }], storyline: [], related: [] } };
        }
        if (u.includes('/selected/snapshot')) {
          return { schemaVersion: 'v1', items: [{ id: 'c1', title: '精选1', summary: '摘要', source: { name: '源A' }, score: 80, reason: '值得读', links: { original: 'https://example.com' }, publishedAt: '2026-08-17T00:00:00Z' }] };
        }
        return { items: [] };
      },
    });
    try {
      const hot = await store.aihot.hotTopics();
      check('aihot-hot', hot.length === 1 && hot[0].title === '测试热点' && hot[0].sourceCount === 3, `hot=${hot.length}`);
      const story = await store.aihot.story('s1');
      check('aihot-story', story.digest === 'AI 摘要' && story.reports.length === 1, `reports=${story.reports?.length}`);
      const selected = await store.aihot.selected(10);
      check('aihot-selected', selected.length === 1 && selected[0].reason === '值得读', `selected=${selected.length}`);
    } finally {
      global.fetch = realFetch;
    }

    // 10. UI DOM 断言（真实窗口加载渲染层；先注册 IPC 再加载页面）
    const { registerIPCHandlers } = require(path.join(__dirname, '..', 'src', 'main', 'ipc'));
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 820,
      webPreferences: {
        preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
        contextIsolation: true,
      },
    });
    registerIPCHandlers(store, win);
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));

    const domSummary = await win.webContents.executeJavaScript(`(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const sidebarRows = document.querySelectorAll('.sidebar-row').length;
      const sidebarHasToday = [...document.querySelectorAll('.sidebar-label')].some((el) => el.textContent.includes('今天'));
      return {
        sidebarRows,
        sidebarHasToday,
        hasToolbar: Boolean(document.getElementById('btn-refresh')),
        columns: document.querySelectorAll('.column').length,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        // 渲染层实际套用的主题类（app.js 依据 snapshot.prefersDark / matchMedia 切换 body.dark）
        bodyDark: document.body.classList.contains('dark'),
        cssLoaded: Boolean(document.querySelector('#split')) && getComputedStyle(document.getElementById('split')).display === 'flex',
      };
    })()`);
    check('ui-columns', domSummary.columns === 3, `columns=${domSummary.columns}`);
    check('ui-toolbar', domSummary.hasToolbar);
    check('ui-css-loaded', domSummary.cssLoaded);
    check('ui-sidebar', domSummary.sidebarRows >= 3 && domSummary.sidebarHasToday, `rows=${domSummary.sidebarRows}, today=${domSummary.sidebarHasToday}`);
    // 纸感主题色随系统深浅色切换（body.dark → --page-background: #1b1a17，浅色 → #f6f2e7）。
    // 以渲染层实际套用的 body.dark 为准断言，nativeTheme.shouldUseDarkColors 仅用于诊断输出，
    // 避免系统深色模式下写死浅色值导致长期红灯。
    const expectedBg = domSummary.bodyDark ? 'rgb(27, 26, 23)' : 'rgb(246, 242, 231)';
    check('ui-theme-paper', domSummary.bodyBg === expectedBg,
      `dark(prefersDark=${nativeTheme.shouldUseDarkColors})=${domSummary.bodyDark}, bg=${domSummary.bodyBg}, expected=${expectedBg}`);

    // 第二栏错位修复：column-list 宽度应跟随 --list-width 变量，与工具栏中区对齐
    const alignSummary = await win.webContents.executeJavaScript(`(() => {
      const list = document.getElementById('list');
      const zone = document.getElementById('tb-zone-list');
      const lr = list.getBoundingClientRect();
      const zr = zone.getBoundingClientRect();
      const columnUsesVar = getComputedStyle(list).width;
      return {
        listLeft: lr.left, zoneLeft: zr.left,
        listRight: lr.right, zoneRight: zr.right,
        columnWidth: columnUsesVar,
      };
    })()`);
    // 工具栏中区右缘应覆盖「列表列 + 分割条 5px」，两者右缘对齐（±1px 容差）
    check('ui-column-align', Math.abs(alignSummary.listRight - alignSummary.zoneRight) <= 1.5,
      `listRight=${alignSummary.listRight} zoneRight=${alignSummary.zoneRight}`);

    // 主题持久化：写入后 preferences 应能读回（验证 state:changed 带 customTheme 链路）
    await store.preferences.set('NanJuPaper.customTheme', { th: 142, mode: 'light' });
    const themeReadBack = store.preferences.get('NanJuPaper.customTheme', null);
    check('pref-theme-persist', themeReadBack && themeReadBack.th === 142, JSON.stringify(themeReadBack));

    // 订阅商店目录：清理死链后仍应有大批量源 + 新分类（lang/fe/sec）
    const { CATALOG_EXTRA2 } = require('../src/renderer/views/feed-store-extra2.js');
    check('store-extra2-count', CATALOG_EXTRA2.length >= 90, `extra2=${CATALOG_EXTRA2.length}`);
    const extra2Cats = new Set(CATALOG_EXTRA2.map((e) => e.cat));
    check('store-new-categories', ['lang', 'fe', 'sec'].every((c) => extra2Cats.has(c)), [...extra2Cats].join(','));

    win.destroy();
  } catch (err) {
    check('unexpected-error', false, err.stack || err.message);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length === 0 ? 'SELFTEST: ALL PASSED' : `SELFTEST: ${failed.length} FAILED`);
  app.exit(failed.length === 0 ? 0 : 1);
});
