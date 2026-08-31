'use strict';
/**
 * RobinRead（知更）— 渲染层主控制器
 *
 * 对应 RootView.swift + ThreeColumnSplitView.swift：
 * - 统一三区工具栏（刷新/添加 | 标题/全部已读 | 阅读胶囊居中）
 * - 栏焦点管理（←/→、点击激活、进入列表自动选中首篇）
 * - B/N/空格 双击确认导航（ReaderNavigationConfirmation + toast）
 * - 禅模式（ESC 退出，仅保留胶囊）
 * - 字号 Cmd +/−/0
 */
import { configure, t, tf } from './i18n.js';
import { icon } from './icons.js';
import { renderMarkdown } from './markdown.js';
import { promptBox, confirmBox } from './ui-prompt.js';
import { SidebarView } from './views/sidebar.js';
import { ListView } from './views/list.js';
import { ReaderView } from './views/reader.js';
import { SettingsView, showAddFeed, showAddFolder, showRenameFolder, showFreshRSSAccount } from './views/dialogs.js';
import { ShortcutsView } from './views/shortcuts.js';
import { ContextMenu } from './views/context-menu.js';
import {
  normalizeTokens, switchModeTokens, fullPalette, applyPalette, clearPalette,
  persistTokens, clearTokens, pushRecent,
} from './views/theme-engine.js';
import { ThemeProposer, ThemeDesigner } from './views/theme-designer.js';
import { FeedStore } from './views/feed-store.js';
import { KnowledgeCenter } from './views/knowledge.js';
import { EvolutionView } from './views/evolution-view.js';
import { AihotView } from './views/aihot-view.js';
import { AccountController } from './views/account.js';

let customThemeTokens = null; // null = 使用内置纸感默认
const state = {
  snapshot: null,
  sidebar: [],
  scope: { kind: 'today' },
  selectedEntryID: null,
  retainedIDs: new Set(),       // 未读会话保留（对应 retainedUnreadIDs）
  listItems: [],
  zenMode: false,
  sidebarCollapsed: false,
  activeColumn: 1,              // 0=sidebar 1=list 2=reader
  updateInfo: null,
  // 状态推送瘦身：主进程修订号与结构签名（增量补丁，免全量重拉）
  entryStateRev: 0,
  listSetRev: 0,
  sidebarSignature: null,
};

const views = {};
let navConfirmation = null;     // { key, entryID, expiresAt, timer }
let toastTimer = null;

// MARK: - 启动

/** 旧版 localStorage 键（paperrss.* / nanjupaper.*）一次性迁移到 robinread.*，并清理旧键。 */
function migrateLegacyLocalStorage() {
  const legacyKeys = ['sidebarCollapsed', 'collapsedAccounts', 'collapsedFolders', 'customTheme', 'recentThemes'];
  for (const k of legacyKeys) {
    const next = `robinread.${k}`;
    for (const oldPrefix of ['nanjupaper', 'paperrss']) {
      const old = localStorage.getItem(`${oldPrefix}.${k}`);
      if (old != null) {
        if (localStorage.getItem(next) == null) localStorage.setItem(next, old);
        localStorage.removeItem(`${oldPrefix}.${k}`);
      }
    }
  }
}

async function bootstrap() {
  migrateLegacyLocalStorage();
  const result = await window.robin.getState();
  if (!result.ok) return;
  const snapshot = result.data;
  configure({ strings: snapshot.strings, lang: snapshot.language });
  state.snapshot = snapshot;
  applyTheme(snapshot);
  applyFontSize(snapshot.preferences.articleFontSize);
  syncLLMGlobals(snapshot);
  syncCustomTheme(snapshot);
  applyReaderLayout(snapshot.preferences?.readerLayout);
  restoreSidebarCollapsed();

  views.sidebar = new SidebarView(document.getElementById('sidebar-scroll'), document.getElementById('sidebar-footer'), {
    onSelect: handleScopeSelect,
    onFeedContext,
    onFolderContext,
    onMoveFeeds: (feedIDs, folder) => window.robin.setFeedFolder(feedIDs, folder),
    onDeleteFeeds: confirmDeleteFeeds,
    onOpenSettings: () => showSettings(),
    onOpenStore: () => openFeedStore(),
    onOpenKnowledge: () => openKnowledgeCenter(),
    onOpenEvolution: () => openEvolutionView(),
    onOpenAihot: () => openAihotView(),
    onOpenAccount: () => views.account?.openCenter({ feedCount: () => countAllFeeds() }),
    onOpenUpdate: (url) => window.robin.openLink(url),
    onIgnoreVersion: (version) => window.robin.ignoreVersion(version),
  });

  // 账号与会员：初始化状态并与侧栏账号条联动
  views.account = new AccountController({
    feedCount: () => countAllFeeds(),
    onUserChanged: (user) => views.sidebar.updateAccount(user),
  });
  views.account.init();
  views.list = new ListView(document.getElementById('list-scroll'), {
    onSelect: handleEntrySelect,
    onContext: showListRowContext,
    onLoadMore: loadMoreEntries,
    onSearch: runSearch,
    onDigest: showTodayDigest,
    onToggleSort: () => {
      const next = currentListSort() === 'unreadFirst' ? 'time' : 'unreadFirst';
      window.robin.setReaderLayout({ listSort: next });
    },
  });
  views.reader = new ReaderView(
    document.getElementById('reader-scroll'),
    {
      tocRail: document.getElementById('toc-rail'),
      tocTrack: document.getElementById('toc-track'),
      tocPeak: document.getElementById('toc-peak'),
      scrollbar: document.getElementById('floating-scrollbar'),
      thumb: document.getElementById('floating-thumb'),
    },
    {
      onFeedback: showToast,
      onSelectNext: () => selectNextEntry(),
      onFocusList: () => setActiveColumn(1),
    },
  );
  window.__robinReader = views.reader; // E2E 测试句柄

  buildToolbar();
  bindToolbar();
  bindWindowControls();
  applyColumnWidths();
  bindEvents();
  bindSplitters();
  bindKeyboard();

  await reloadAll();
  setActiveColumn(1, { autoSelect: false });
  setTimeout(checkUpdateQuietly, 6000);
}

// MARK: - 主题 / 字号

function applyTheme(snapshot) {
  const prefers = snapshot?.prefersDark ?? window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.body.classList.toggle('dark', prefers);
}

function applyFontSize(size) {
  document.documentElement.style.setProperty('--article-font-size', `${size || 17}px`);
}

function syncLLMGlobals(snapshot) {
  window.__robinLLM = { ...(snapshot?.llm || {}), __hasKey: snapshot?.hasAPIKey !== false };
}

/** 恢复 / 重应用自定义主题（跟随当前明暗模式）。 */
function applyReaderLayout(layout) {
  const root = document.documentElement;
  const fontMap = { serif: 'var(--font-serif)', sans: 'var(--font-sans)' };
  const widthMap = { narrow: '680px', standard: '820px', wide: '960px' };
  const heightMap = { compact: '1.55', standard: '1.72', loose: '1.95' };
  root.style.setProperty('--reader-font', fontMap[layout?.fontFamily] || fontMap.serif);
  root.style.setProperty('--reader-page-width', widthMap[layout?.pageWidth] || widthMap.standard);
  root.style.setProperty('--reader-line-height', heightMap[layout?.lineHeight] || heightMap.standard);
  document.body.dataset.listDensity = layout?.listDensity || 'comfortable';
  window.__robinReaderLayout = layout || {};
  // 列表排序：状态变化时更新按钮并重拉列表（排序影响行序）
  const listSort = layout?.listSort === 'unreadFirst' ? 'unreadFirst' : 'time';
  if (views.list?.setSortButton) views.list.setSortButton(listSort);
  if (listSort !== applyReaderLayout._lastSort) {
    const changed = applyReaderLayout._lastSort !== undefined;
    applyReaderLayout._lastSort = listSort;
    if (changed && views.list) reloadList({ resetScroll: true }).catch(() => {});
  }
  // 注意：translateMode 是「打开文章时的默认模式」，由 reader.open 自行读取；
  // 不在这里强制应用——否则每次 state 推送都会把用户会话内选择的模式重置掉。
}

function syncCustomTheme(snapshot) {
  const raw = snapshot?.customTheme;
  if (!raw) { customThemeTokens = null; clearPalette(); return; }
  let tokens = normalizeTokens(raw);
  const dark = snapshot?.prefersDark ?? document.body.classList.contains('dark');
  if ((tokens.mode === 'light') === dark) tokens = switchModeTokens(tokens, dark ? 'dark' : 'light');
  customThemeTokens = tokens;
  window.__robinCustomTokens = tokens;
  applyPalette(fullPalette(tokens));
}

/** 应用一套主题令牌（提案卡片 / 设计器共用入口）。 */
function applyThemeTokens(tokens, name) {
  const dark = document.body.classList.contains('dark');
  let next = normalizeTokens(tokens);
  if ((next.mode === 'light') === dark) next = switchModeTokens(next, dark ? 'dark' : 'light');
  customThemeTokens = next;
  window.__robinCustomTokens = next;
  applyPalette(fullPalette(next));
  persistTokens(next);
  if (name) pushRecent(next, name);
}

function resetTheme() {
  customThemeTokens = null;
  window.__robinCustomTokens = null;
  clearPalette();
  clearTokens();
}

// MARK: - 工具栏

function buildToolbar() {
  const set = (id, svg, title) => {
    const el = document.getElementById(id);
    el.innerHTML = svg;
    if (title) el.title = title;
  };
  set('btn-toggle-sidebar', icon('sidebarLeft'), t('切换侧栏'));
  set('btn-refresh', icon('refresh'), t('刷新所有订阅'));
  set('btn-add', icon('plus'), t('新建与更多'));
  set('btn-mark-all', icon('envelopeOpen'), t('将当前列表全部标为已读'));
  set('cap-translate', icon('translate'));
  set('cap-deepread', icon('bookOpen'), t('一键精读：论证/概念/证据/金句 (D)'));
  set('cap-rsummary', icon('docText'), t('高质量中文摘要 (S)'));
  set('cap-read', icon('envelopeClosed'));
  set('cap-star', icon('star'));
  set('cap-zen', icon('expand'));
  set('cap-highlight', icon('marker'), t('高亮：选中文字快速高亮（H）；无选区打开批注面板'));
  set('cap-note', icon('noteSticky'), t('批注面板：本篇高亮与笔记'));
  set('cap-review', icon('refresh'), t('加入复习'));
  set('cap-browser', icon('globe'), t('打开原网页'));
  set('wc-min', icon('winMinimize'), t('最小化'));
  updateCapBrowserState();
  set('wc-close', icon('winClose'), t('关闭'));
  updateMaximizeGlyph(false);
}

function updateMaximizeGlyph(isMaximized) {
  const btn = document.getElementById('wc-max');
  if (!btn) return;
  btn.innerHTML = icon(isMaximized ? 'winRestore' : 'winMaximize');
  btn.title = isMaximized ? t('向下还原') : t('最大化');
}

function bindWindowControls() {
  document.getElementById('wc-min').addEventListener('click', () => window.robin.winMinimize());
  document.getElementById('wc-max').addEventListener('click', () => window.robin.winToggleMaximize());
  document.getElementById('wc-close').addEventListener('click', () => window.robin.winClose());
  window.robin.winIsMaximized().then((result) => {
    if (result.ok) updateMaximizeGlyph(Boolean(result.data));
  });
  window.robin.onWindowMaxChanged((maximized) => updateMaximizeGlyph(Boolean(maximized)));
  // 双击工具栏空白处切换最大化（Windows 标题栏惯例）
  document.getElementById('main-toolbar').addEventListener('dblclick', (event) => {
    if (event.target.closest('.btn, .reader-capsule, .window-controls')) return;
    window.robin.winToggleMaximize();
  });
}

function bindToolbar() {
  document.getElementById('btn-toggle-sidebar').addEventListener('click', toggleSidebarCollapsed);
  document.getElementById('btn-refresh').addEventListener('click', () => {
    if (state.snapshot?.refreshStatus?.state === 'refreshing') return;
    window.robin.refresh();
  });
  document.getElementById('btn-add').addEventListener('click', (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    ContextMenu.show(rect.right - 210, rect.bottom + 6, [
      { label: t('浏览订阅商店…'), icon: 'store', onClick: () => openFeedStore() },
      { label: t('添加订阅'), icon: 'plus', onClick: () => showAddFeed(collectFolders(), reloadAll) },
      { label: t('新建文件夹'), icon: 'folderPlus', onClick: () => showAddFolder(reloadAll) },
      { type: 'separator' },
      { label: t('导入 OPML'), icon: 'import', onClick: () => window.robin.importOPML() },
      { label: t('导出 OPML'), icon: 'export', onClick: () => window.robin.exportOPML() },
    ]);
  });
  document.getElementById('btn-mark-all').addEventListener('click', markCurrentAllRead);

  document.getElementById('cap-translate').addEventListener('click', (event) => {
    // 翻译模式菜单：明确显示当前状态与可选模式（替代难以分辨的循环切换）
    const current = views.reader?.translateMode || 'off';
    const isChinese = views.reader?.isChineseArticle?.() === true;
    const items = [];
    if (window.__robinLLM?.__hasKey === false) {
      items.push({ label: t('AI 未配置 API Key'), disabled: true });
      items.push({ label: t('前往 设置 → AI 配置'), icon: 'gear', onClick: () => showSettings('ai') });
    } else if (isChinese) {
      items.push({ label: t('当前是中文文章，无需翻译'), disabled: true });
      if (current !== 'off') items.push({ label: t('关闭翻译'), icon: 'close', onClick: () => { views.reader.setTranslateMode('off'); updateToolbarState(); } });
    } else {
      items.push({ label: t('双语对照（原文 + 译文）'), icon: 'translate', checked: current === 'bilingual', onClick: () => { views.reader.setTranslateMode('bilingual'); updateToolbarState(); } });
      items.push({ label: t('仅显示中文'), icon: 'translate', checked: current === 'zh', onClick: () => { views.reader.setTranslateMode('zh'); updateToolbarState(); } });
      items.push({ type: 'separator' });
      items.push({ label: t('关闭翻译'), icon: 'close', checked: current === 'off', onClick: () => { views.reader.setTranslateMode('off'); updateToolbarState(); } });
    }
    const rect = event.currentTarget.getBoundingClientRect();
    ContextMenu.show(rect.left, rect.bottom + 6, items);
  });
  document.getElementById('cap-read').addEventListener('click', () => {
    if (state.selectedEntryID) window.robin.markRead(state.selectedEntryID, !currentEntryIsRead());
  });
  document.getElementById('cap-deepread').addEventListener('click', () => dispatchReaderAction('deepRead'));
  document.getElementById('cap-rsummary').addEventListener('click', () => dispatchReaderAction('richSummary'));
  document.getElementById('cap-star').addEventListener('click', () => toggleStarWithGuide());
  document.getElementById('cap-zen').addEventListener('click', toggleZenMode);

  // 批注按钮：高亮（有选区 → 快速高亮；无选区 → 批注面板）/ 笔记（批注面板）
  const capHl = document.getElementById('cap-highlight');
  let pendingSelection = '';
  if (capHl) {
    // 用 mousedown 捕获选区：click 触发时选区已被浏览器清空
    capHl.addEventListener('mousedown', () => {
      pendingSelection = window.getSelection()?.toString()?.trim() || '';
    });
    capHl.addEventListener('click', () => {
      if (!state.selectedEntryID) return;
      const selection = pendingSelection || window.getSelection()?.toString()?.trim() || '';
      pendingSelection = '';
      views.reader?.capsuleHighlight(selection);
    });
  }

  const capNote = document.getElementById('cap-note');
  capNote?.addEventListener('click', () => {
    if (!state.selectedEntryID) return;
    views.reader?.capsuleNote();
  });

  const capReview = document.getElementById('cap-review');
  capReview?.addEventListener('click', async () => {
    if (!state.selectedEntryID) return;
    await window.robin.kbAddToReview({ itemID: state.selectedEntryID });
    showToast(t('已加入复习队列'));
  });

  // 打开原文（阅读胶囊第 5 键，图标为地球）
  const capBrowser = document.getElementById('cap-browser');
  if (capBrowser) {
    capBrowser.addEventListener('click', () => {
      if (views.reader?.entry?.url) window.robin.openLink(views.reader.entry.url);
    });
  }
}

function updateCapBrowserState() {
  const btn = document.getElementById('cap-browser');
  if (btn) btn.disabled = !(views.reader?.entry?.url);
}

function currentEntryIsRead() {
  const item = state.listItems.find((entry) => entry.id === state.selectedEntryID);
  return item ? item.isRead : false;
}

/** 收藏切换 + 可发现性引导：收藏成功时 toast 附「查看收藏」直达侧栏收藏视图。 */
function toggleStarWithGuide() {
  if (!state.selectedEntryID) return;
  const item = state.listItems.find((entry) => entry.id === state.selectedEntryID);
  const willStar = !(item?.isStarred ?? views.reader?.entry?.isStarred);
  window.robin.toggleStar(state.selectedEntryID);
  if (willStar) {
    showToast(t('已收藏'), 1800, {
      label: t('查看收藏'),
      onClick: () => handleScopeSelect({ kind: 'starred' }),
    });
  } else {
    showToast(t('已取消收藏'));
  }
}

function updateToolbarState() {
  const refreshing = state.snapshot?.refreshStatus?.state === 'refreshing';
  document.getElementById('btn-refresh').classList.toggle('spinning', refreshing);
  document.getElementById('btn-mark-all').disabled = !currentHasUnread();
  document.getElementById('tb-list-title').textContent = headerTitle();

  const capsule = document.getElementById('reader-capsule');
  capsule.classList.toggle('visible', state.selectedEntryID != null);
  updateCapBrowserState();

  const item = state.listItems.find((entry) => entry.id === state.selectedEntryID);
  const capTranslate = document.getElementById('cap-translate');
  const tMode = views.reader?.translateMode || 'off';
  const modeLabels = { off: t('翻译：关闭'), bilingual: t('翻译：双语对照'), zh: t('翻译：仅中文') };
  capTranslate.classList.toggle('active', tMode !== 'off');
  capTranslate.title = `${modeLabels[tMode]} (C · 点击切换模式)`;
  const capRead = document.getElementById('cap-read');
  capRead.innerHTML = icon(item?.isRead ? 'envelopeOpen' : 'envelopeClosed');
  capRead.title = t(item?.isRead ? '标为未读' : '标为已读');
  const capStar = document.getElementById('cap-star');
  capStar.classList.toggle('active', Boolean(item?.isStarred));
  capStar.innerHTML = icon(item?.isStarred ? 'starFilled' : 'star');
  capStar.title = `${t(item?.isStarred ? '取消收藏' : '收藏')} (M)`;
  const capZen = document.getElementById('cap-zen');
  capZen.classList.toggle('active', state.zenMode);
  capZen.innerHTML = icon(state.zenMode ? 'collapse' : 'expand');
  capZen.title = t(state.zenMode ? '退出禅模式' : '禅模式全屏阅读');
}

function headerTitle() {
  if (state.selectedEntryID) {
    const item = state.listItems.find((entry) => entry.id === state.selectedEntryID);
    if (item) return item.sourceTitle;
  }
  return scopeTitle(state.scope);
}

function scopeTitle(scope) {
  switch (scope?.kind) {
    case 'today': return t('今天');
    case 'unread': return t('未读');
    case 'starred': return t('收藏');
    case 'feed': {
      const feed = findFeed(scope.feedID);
      return feed ? feed.title : t('订阅');
    }
    case 'feeds': return tf('%lld 个订阅', scope.feedIDs.length);
    case 'folder': return scope.folderName;
    default: return '';
  }
}

function currentHasUnread() {
  switch (state.scope?.kind) {
    case 'today': return (state.snapshot?.sidebarCounts?.todayUnread ?? 0) > 0;
    case 'unread': return (state.snapshot?.sidebarCounts?.allUnread ?? 0) > 0;
    case 'starred': return false;
    case 'feed': return ((state.snapshot?.sidebarCounts?.unreadByFeed ?? {})[state.scope.feedID] ?? 0) > 0;
    case 'feeds': return state.scope.feedIDs.some((id) => ((state.snapshot?.sidebarCounts?.unreadByFeed ?? {})[id] ?? 0) > 0);
    case 'folder': {
      const counts = state.snapshot?.sidebarCounts?.unreadByFolder ?? {};
      return (counts[`${state.scope.accountID}::${state.scope.folderName}`] ?? counts[state.scope.folderName] ?? 0) > 0;
    }
    default: return false;
  }
}

async function markCurrentAllRead() {
  await window.robin.markAllRead(state.scope);
  // 保留当前选中，清空其余保留集
  state.retainedIDs = state.selectedEntryID ? new Set([state.selectedEntryID]) : new Set();
  await reloadList();
  showToast(t('已全部标为已读'));
}

function findFeed(feedID) {
  for (const account of state.sidebar) {
    if (account.account.id === 'local-default') continue;
    const feed = account.allFeeds?.find((f) => f.id === feedID);
    if (feed) return feed;
  }
  for (const account of state.sidebar) {
    const feed = account.allFeeds?.find((f) => f.id === feedID);
    if (feed) return feed;
  }
  return null;
}

// MARK: - 禅模式 / 侧栏折叠

function toggleZenMode() {
  state.zenMode = !state.zenMode;
  document.body.classList.toggle('zen', state.zenMode);
  if (state.zenMode) showToast(t('ESC 退出，按下 Ctrl+/ 查看快捷键'));
  updateToolbarState();
  syncToolbarZones();
  requestAnimationFrame(() => views.reader?.refreshScrollMetrics());
}

function toggleSidebarCollapsed() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  localStorage.setItem('robinread.sidebarCollapsed', state.sidebarCollapsed ? '1' : '');
  applySidebarCollapsed();
}

function applySidebarCollapsed() {
  const collapsed = state.sidebarCollapsed;
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  document.getElementById('sidebar').style.display = collapsed ? 'none' : '';
  document.getElementById('splitter-sidebar').style.display = collapsed ? 'none' : '';

  // 折叠时侧栏列消失、列表列左缘归 0；顶栏必须同步：
  // 侧栏区三按钮并入列表区最左、侧栏区隐藏，让阅读区 ::before 分割线与下方 splitter-list 对齐。
  const sidebarZone = document.querySelector('.tb-zone-sidebar');
  const listZone = document.getElementById('tb-zone-list');
  const sidebarButtons = document.querySelectorAll('#btn-toggle-sidebar, #btn-refresh, #btn-add');
  const listTitle = listZone.querySelector('.tb-title');

  if (collapsed && !state.zenMode) {
    for (const b of sidebarButtons) listZone.insertBefore(b, listTitle || listZone.firstChild);
    sidebarZone.style.display = 'none';
    listZone.style.display = '';
  } else {
    for (const b of sidebarButtons) sidebarZone.appendChild(b);
    sidebarZone.style.display = state.zenMode ? 'none' : '';
    listZone.style.display = state.zenMode ? 'none' : '';
  }
  syncToolbarZones();
}

function restoreSidebarCollapsed() {
  state.sidebarCollapsed = localStorage.getItem('robinread.sidebarCollapsed') === '1';
  applySidebarCollapsed();
}

/** 工具栏中区跟随列表栏左缘（顶栏区块左缘对齐列表栏分割线）。 */
function applyColumnWidths() {
  const sidebarWidth = state.snapshot?.preferences?.sidebarWidth || 240;
  const listWidth = state.snapshot?.preferences?.listWidth || 340;
  document.documentElement.style.setProperty('--sidebar-width', `${sidebarWidth}px`);
  document.documentElement.style.setProperty('--list-width', `${listWidth}px`);
}

function syncToolbarZones() {
  const listEl = document.getElementById('list');
  const rect = listEl.getBoundingClientRect();
  const bodyRect = document.body.getBoundingClientRect();
  document.getElementById('tb-zone-list').style.minWidth = `${Math.max(0, rect.width)}px`;
}

// MARK: - 数据加载

async function reloadAll() {
  await reloadSidebar();
  await reloadList();
}

async function reloadSidebar() {
  const result = await window.robin.getSidebar();
  if (!result.ok) return;
  state.sidebar = result.data;
  window.__robinSidebar = result.data;
  window.__robinLanguage = state.snapshot?.language || 'zh';
  views.sidebar.render(state.sidebar, state.snapshot?.sidebarCounts, state.scope);
}

async function reloadList({ resetScroll = false } = {}) {
  const result = await window.robin.getList(state.scope, { limit: 100, retainingIDs: [...state.retainedIDs], sort: currentListSort() });
  if (!result.ok) return;
  state.listItems = result.data;
  views.list.render(state.listItems, state.scope, state.selectedEntryID, currentHasUnread());
  views.list.setDigestVisible(state.scope?.kind === 'today' || state.scope?.kind === 'unread');
  updateToolbarState();
  if (resetScroll) views.list.scrollTop();
}

async function runSearch(query) {
  if (!query) {
    views.list.setSearchMode(false);
    views.list.setDigestVisible(state.scope?.kind === 'today' || state.scope?.kind === 'unread');
    await reloadList();
    return;
  }
  views.list.setSearchMode(true);
  views.list.setDigestVisible(false);
  // 优先全文搜索（含正文），空结果回退到标题/摘要搜索
  let items = await window.robin.fullTextSearch(query);
  if (!items || !items.length) {
    const result = await window.robin.search(query);
    items = result.ok ? result.data : [];
  }
  state.listItems = items || [];
  views.list.render(items || [], { kind: 'search' }, state.selectedEntryID, false);
  updateToolbarState();
}

/** 简报可视化渲染：主视觉/统计徽章/主题卡片/来源芯片（[n] 可点击跳转原文）。 */
function renderDigestVisual(raw, refs, meta, onClose = null) {
  const refMap = new Map((refs || []).map((r) => [r.n, r]));
  const host = document.createElement('div');
  host.className = 'digest-visual';

  // ── 主视觉：日期 + 统计徽章 ──
  const now = new Date();
  const locale = window.__robinLanguage === 'en' ? 'en-US' : 'zh-CN';
  const dateStr = now.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
  const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
  const hero = document.createElement('div');
  hero.className = 'dg-hero';
  const topicCount = (String(raw).match(/^## 主题：/gm) || []).length;
  hero.innerHTML = `
    <div class="dg-hero-date"></div>
    <div class="dg-hero-sub">${escapeHTMLInline(t('今日 AI 简报'))} · ${t('星期' + week)}</div>
    <div class="dg-hero-stats">
      <span class="dg-stat"><b>${meta?.items ?? '—'}</b>${escapeHTMLInline(t('篇文章'))}</span>
      <span class="dg-stat"><b>${topicCount || '—'}</b>${escapeHTMLInline(t('个主题'))}</span>
      <span class="dg-stat"><b>${(refs || []).length}</b>${escapeHTMLInline(t('个来源'))}</span>
    </div>`;
  hero.querySelector('.dg-hero-date').textContent = dateStr;
  host.appendChild(hero);

  // ── 正文分节渲染 ──
  const lines = String(raw).split('\n');
  let mode = 'plain';            // overview | topic | deepread | plain
  let card = null;               // 当前主题卡
  let topicNo = 0;
  const chip = (n) => {
    const r = refMap.get(n);
    const el = document.createElement('button');
    el.className = 'dg-ref' + (r ? '' : ' missing');
    el.textContent = String(n);
    el.title = r ? r.title : t('来源已失效');
    if (r) el.addEventListener('click', () => {
      onClose?.();
      handleEntrySelect(r.id, null);
    });
    return el;
  };
  const addBullet = (text, target) => {
    const li = document.createElement('div');
    li.className = 'dg-li';
    // 拆出 [n] 来源编号 → 芯片
    const parts = String(text).split(/(\[\d+\])/g);
    for (const p of parts) {
      const m = p.match(/^\[(\d+)\]$/);
      if (m) { li.appendChild(chip(Number(m[1]))); continue; }
      if (!p.trim()) continue;
      const span = document.createElement('span');
      span.className = 'dg-li-text';
      // 加粗短语
      const bold = p.match(/^\*\*(.+?)\*\*\s*([\s\S]*)$/);
      if (bold) {
        const b = document.createElement('b');
        b.textContent = bold[1];
        span.appendChild(b);
        span.appendChild(document.createTextNode(bold[2]));
      } else {
        span.textContent = p.replace(/\*\*/g, '');
      }
      li.appendChild(span);
    }
    target.appendChild(li);
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^##\s*总览/.test(line)) { mode = 'overview'; continue; }
    if (/^##\s*值得深读/.test(line)) {
      mode = 'deepread';
      card = document.createElement('div');
      card.className = 'dg-deepread';
      card.innerHTML = `<div class="dg-deepread-head">${icon('starFilled')}<span></span></div><div class="dg-deepread-body"></div>`;
      card.querySelector('span').textContent = t('今日值得深读');
      host.appendChild(card);
      continue;
    }
    const topic = line.match(/^##\s*主题[：:]\s*(.+)$/);
    if (topic) {
      mode = 'topic';
      topicNo += 1;
      card = document.createElement('div');
      card.className = 'dg-topic';
      card.innerHTML = `<div class="dg-topic-head"><span class="dg-topic-no"></span><span class="dg-topic-title"></span></div><div class="dg-topic-list"></div>`;
      card.querySelector('.dg-topic-no').textContent = String(topicNo).padStart(2, '0');
      card.querySelector('.dg-topic-title').textContent = topic[1].replace(/\*\*/g, '');
      host.appendChild(card);
      continue;
    }
    if (/^#/.test(line) || mode === 'plain') continue; // 其它标题忽略
    const bullet = line.match(/^[-*]\s+(.+)$/) || line.match(/^\d+[.、]\s+(.+)$/);
    if (mode === 'overview' && card === null) {
      // 总览段落：大字引言卡
      const ov = host.querySelector('.dg-overview') || (() => {
        const d = document.createElement('div');
        d.className = 'dg-overview';
        host.insertBefore(d, host.children[1] || null);
        return d;
      })();
      if (bullet) addBullet(bullet[1], ov);
      else { const p = document.createElement('p'); p.textContent = line.replace(/\*\*/g, ''); ov.appendChild(p); }
      continue;
    }
    if (mode === 'topic' && card) { if (bullet) addBullet(bullet[1], card.querySelector('.dg-topic-list')); continue; }
    if (mode === 'deepread' && card) {
      const bodyEl = card.querySelector('.dg-deepread-body');
      if (bullet) addBullet(bullet[1], bodyEl);
      else { const p = document.createElement('p'); p.textContent = line.replace(/\*\*/g, ''); bodyEl.appendChild(p); }
      continue;
    }
  }
  return host;
}

async function showTodayDigest({ forceRegenerate = false } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal digest-modal';
  modal.innerHTML = `
    <div class="modal-header"><h3>${escapeHTMLInline(t('今日 AI 简报'))}</h3>
      <button class="btn-text" id="digest-copy" style="display:none;margin-right:8px;"></button>
      <button class="btn-text" id="digest-regen" style="display:none;margin-right:8px;"></button>
      <button class="btn icon-only" id="digest-close">${''}</button></div>
    <div class="digest-body loading">${escapeHTMLInline(t('正在汇总今天的文章…'))}</div>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) overlay.remove(); });
  modal.querySelector('#digest-close').innerHTML = icon('close');
  modal.querySelector('#digest-close').addEventListener('click', () => overlay.remove());

  const body = modal.querySelector('.digest-body');
  const regenBtn = modal.querySelector('#digest-regen');
  const copyBtn = modal.querySelector('#digest-copy');
  regenBtn.textContent = t('重新生成');
  copyBtn.textContent = t('复制全文');
  let lastContent = '';
  let lastRefs = [];
  copyBtn.addEventListener('click', async () => {
    const ok = await window.robin.copyText(lastContent);
    showToast(ok ? t('已复制简报全文') : t('复制失败'));
  });
  regenBtn.addEventListener('click', () => {
    overlay.remove();
    showTodayDigest({ forceRegenerate: true });
  });

  const renderInto = (content, refs, meta, streaming) => {
    lastContent = content || '';
    lastRefs = refs || [];
    body.classList.remove('loading');
    body.classList.toggle('streaming', !!streaming);
    body.innerHTML = '';
    body.appendChild(renderDigestVisual(content, refs, meta, () => overlay.remove()));
    body.scrollTop = body.scrollHeight;
  };

  // 当日缓存：秒开渲染 + 提供「重新生成」；强制重新生成或无缓存时走流式
  if (!forceRegenerate) {
    const cached = await window.robin.cachedDigest();
    if (cached?.ok && cached.data?.content) {
      renderInto(cached.data.content, cached.data.entryRefs, cached.data, false);
      regenBtn.style.display = '';
      copyBtn.style.display = '';
      return;
    }
  }
  regenBtn.style.display = 'none';

  // 生成属 AI 功能：过会员/每日额度门（缓存命中不消耗额度）
  if (!(await views.account?.gateAI())) {
    body.classList.remove('loading');
    body.textContent = t('生成今日简报需要会员或每日 AI 额度。');
    return;
  }

  // 流式阶段按可视化渲染（增量全量重绘）
  let streamed = '';
  let done = false;
  const unsubscribe = window.robin.onDigestDelta((payload) => {
    if (done) return;
    streamed += payload.delta || '';
    renderInto(streamed, [], { items: null }, true);
  });

  const result = await window.robin.generateDigest();
  done = true;
  unsubscribe?.();
  if (!result.ok) {
    body.classList.remove('streaming');
    body.classList.add('loading');
    body.textContent = result.error || t('生成失败');
    regenBtn.style.display = '';
    return;
  }
  renderInto(result.data?.content || streamed, result.data?.entryRefs, result.data, false);
  regenBtn.style.display = '';
  copyBtn.style.display = '';
}

function escapeHTMLInline(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
async function loadMoreEntries() {
  if (state.listItems.length === 0 || state.listItems.length % 100 !== 0) return;
  const result = await window.robin.getList(state.scope, {
    limit: 100, offset: state.listItems.length, sort: currentListSort(),
  });
  if (!result.ok || result.data.length === 0) return;
  const existing = new Set(state.listItems.map((entry) => entry.id));
  const fresh = result.data.filter((entry) => !existing.has(entry.id));
  if (fresh.length === 0) return;
  state.listItems.push(...fresh);
  views.list.appendRows(fresh);
}

// MARK: - 选择

function handleScopeSelect(scope) {
  if (sameScope(scope, state.scope)) return;
  cancelNavConfirmation(true);
  state.scope = scope;
  state.selectedEntryID = null;
  state.retainedIDs.clear();
  views.reader.clear();
  reloadSidebar();
  reloadList({ resetScroll: true });
}

function sameScope(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 当前列表排序（主进程 listItems sort 参数）。 */
function currentListSort() {
  return window.__robinReaderLayout?.listSort === 'unreadFirst' ? 'unreadFirst' : 'time';
}

async function handleEntrySelect(entryID, item) {
  state.selectedEntryID = entryID;
  if (state.scope.kind === 'unread') {
    state.retainedIDs.add(entryID);
    // 保留集无界增长会让 unread 过滤 SQL 恶化（IN 参数膨胀），封顶 500
    if (state.retainedIDs.size > 500) {
      const oldest = state.retainedIDs.values().next().value;
      state.retainedIDs.delete(oldest);
    }
  } else {
    state.retainedIDs.clear();
  }
  views.list.markSelected(entryID);
  updateToolbarState();
  await views.reader.open(entryID);
  // 自动精读可能在 open 内改变翻译模式：确定性刷新胶囊状态
  updateToolbarState();
  if (item && !item.isRead) window.robin.markRead(entryID, true);
}

// MARK: - 相邻导航（B/N/空格，双击确认 + toast）

function requestAdjacentArticle(direction) {
  if (!state.selectedEntryID) { cancelNavConfirmation(true); return; }
  const isPrev = direction === 'previous';
  const prompt = isPrev ? t('再次按下 B 查看上一篇') : t('再次按下 N 查看下一篇');
  const boundary = isPrev ? t('已经是列表第一篇') : t('列表已经阅读完毕');
  runWithConfirmation(
    isPrev ? 'prev-article' : 'next-article',
    prompt,
    async () => {
      const result = await window.robin.getAdjacent(state.scope, state.selectedEntryID, direction);
      return result.ok ? result.data : null;
    },
    boundary,
  );
}

function selectNextEntry() {
  runWithConfirmation(
    'space-next-article',
    tf('再次按下空格，切换下一篇。未读 %lld 篇', Math.max(1, state.snapshot?.sidebarCounts?.allUnread ?? 1)),
    async () => {
      if (!state.selectedEntryID) {
        const result = await window.robin.getList(state.scope, { limit: 1 });
        return result.ok && result.data.length ? result.data[0] : null;
      }
      const result = await window.robin.getAdjacent(state.scope, state.selectedEntryID, 'next');
      return result.ok ? result.data : null;
    },
    t('列表已经阅读完毕'),
  );
}

/**
 * 1:1 对应 confirmNavigation：同一 key 在有效期内第二次触发才执行；
 * toast 展示剩余时间后自动过期取消。
 */
async function runWithConfirmation(key, prompt, resolveTarget, boundaryMessage) {
  const now = Date.now();
  const active = navConfirmation && navConfirmation.key === key
    && navConfirmation.entryID === state.selectedEntryID
    && navConfirmation.expiresAt > now;

  if (!active) {
    const expiresAt = now + 1600;
    clearTimeout(navConfirmation?.timer);
    navConfirmation = { key, entryID: state.selectedEntryID, expiresAt, timer: setTimeout(() => { navConfirmation = null; }, 1600) };
    showToast(prompt, 1600);
    return;
  }

  clearTimeout(navConfirmation.timer);
  navConfirmation = null;
  dismissToast();

  const target = await resolveTarget();
  if (!target) {
    showToast(boundaryMessage);
    return;
  }
  await handleEntrySelect(target.id, target);
  views.list.scrollToEntry(target.id);
}

function cancelNavConfirmation(dismissToastAlso) {
  if (navConfirmation) {
    clearTimeout(navConfirmation.timer);
    navConfirmation = null;
  }
  if (dismissToastAlso) dismissToast();
}

// MARK: - Toast（底部胶囊）

/** showToast(message, duration?, action?) — action: { label, onClick }（收藏后「查看收藏」直达）。 */
function showToast(message, duration = 1800, action = null) {
  dismissToast();
  const toast = document.createElement('div');
  toast.className = 'toast-capsule';
  toast.id = 'toast-capsule';
  toast.innerHTML = `<span class="check">${icon('checkCircle')}</span><span class="toast-msg"></span>`;
  toast.querySelector('.toast-msg').textContent = message;
  if (action?.label) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      dismissToast();
      action.onClick?.();
    });
    toast.appendChild(btn);
    duration = Math.max(duration, 4200); // 带动作的提示留足点击时间
  }
  document.body.appendChild(toast);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dismissToast(), duration);
}

function dismissToast() {
  const toast = document.getElementById('toast-capsule');
  if (toast) {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 260);
  }
  clearTimeout(toastTimer);
}

// MARK: - 栏焦点

function setActiveColumn(index, { autoSelect = true } = {}) {
  if (state.zenMode && index < 2) index = 2;
  state.activeColumn = index;
  document.querySelectorAll('.column').forEach((el) => el.classList.remove('column-focused'));
  const map = ['sidebar', 'list', 'reader'];
  const el = document.getElementById(map[index]);
  if (el) el.classList.add('column-focused');
  if (index === 1 && autoSelect && !state.selectedEntryID && state.listItems.length) {
    handleEntrySelect(state.listItems[0].id, state.listItems[0]);
  }
  if (index === 2) views.reader?.focus();
}

// MARK: - 键盘（1:1 对应 ReaderShortcutPolicy + 三栏协调器）

function bindKeyboard() {
  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing = target instanceof HTMLElement && (
      target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable
    );

    // ESC：退出禅模式
    if (event.key === 'Escape' && state.zenMode) {
      event.preventDefault();
      toggleZenMode();
      return;
    }

    // Cmd/Ctrl + / − / 0 字号
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      if (event.key === '=' || event.key === '+') { event.preventDefault(); adjustFontSize(+1); return; }
      if (event.key === '-' || event.key === '_') { event.preventDefault(); adjustFontSize(-1); return; }
      if (event.key === '0') { event.preventDefault(); adjustFontSize(0); return; }
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'KeyR') {
      event.preventDefault(); window.robin.refresh(); return;
    }
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyK') {
      event.preventDefault(); openKnowledgeCenter(); return;
    }
    if ((event.ctrlKey || event.metaKey) && event.code === 'Slash') {
      event.preventDefault(); new ShortcutsView().present(); return;
    }

    if (typing) return;

    // j/k 下一篇/上一篇（列表导航，vim 风格）
    if (event.code === 'KeyJ' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      navigateList(1);
      return;
    }
    if (event.code === 'KeyK' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      navigateList(-1);
      return;
    }
    // “/” 聚焦搜索
    if (event.key === '/' && state.activeColumn <= 1) {
      event.preventDefault();
      views.list?.focusSearch();
      return;
    }

    // ←/→ 栏导航（无修饰键）
    if (event.key === 'ArrowLeft' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      const next = state.zenMode ? 2 : Math.max(state.sidebarCollapsed ? 1 : 0, state.activeColumn - 1);
      setActiveColumn(next, { autoSelect: false });
      return;
    }
    if (event.key === 'ArrowRight' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      setActiveColumn(Math.min(2, state.activeColumn + 1), { autoSelect: false });
      return;
    }

    // 空格（列表栏 → 聚焦阅读器并滚动；阅读器栏 → 滚动/翻页）
    if (event.code === 'Space' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      if (state.activeColumn === 1 && state.selectedEntryID) {
        event.preventDefault();
        setActiveColumn(2, { autoSelect: false });
        views.reader.spaceAdvance();
        return;
      }
      if (state.activeColumn === 2) {
        event.preventDefault();
        views.reader.spaceAdvance();
        return;
      }
    }

    // 阅读器裸键（仅在有选中文章、无划词弹层时）
    if (state.selectedEntryID == null) return;
    if (views.reader?.selectionPopoverOpen) return;

    // 有选区时：H = 快速高亮（选中文本的唯一裸键出口）
    if (event.code === 'KeyH' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
      && getSelectionText().length > 2 && views.reader?.quickHighlightSelection()) {
      event.preventDefault();
      return;
    }
    if (getSelectionText().length > 0) return;

    switch (event.code) {
      case 'KeyC':
        event.preventDefault();
        dispatchReaderAction('toggleBilingual');
        break;
      case 'KeyD':
        event.preventDefault();
        dispatchReaderAction('deepRead');
        break;
      case 'KeyS':
        event.preventDefault();
        dispatchReaderAction('richSummary');
        break;
      case 'KeyV':
        event.preventDefault();
        dispatchReaderAction('showSummary');
        break;
      case 'KeyM':
        event.preventDefault();
        toggleStarWithGuide();
        break;
      case 'KeyB':
        event.preventDefault();
        requestAdjacentArticle('previous');
        break;
      case 'KeyN':
        event.preventDefault();
        requestAdjacentArticle('next');
        break;
      default:
        break;
    }
  });
}

async function navigateList(direction) {
  const items = state.listItems;
  if (!items.length) return;
  const index = items.findIndex((entry) => entry.id === state.selectedEntryID);
  let nextIndex;
  if (index < 0) nextIndex = direction > 0 ? 0 : items.length - 1;
  else nextIndex = Math.max(0, Math.min(items.length - 1, index + direction));
  if (nextIndex === index) return;
  const next = items[nextIndex];
  await handleEntrySelect(next.id, next);
  views.list.scrollToEntry(next.id);
}

/** 当前订阅源总数（各账户合计，用于会员中心展示与额度判断）。 */
function countAllFeeds() {
  return state.sidebar.reduce((n, account) => n + (account.allFeeds?.length || 0), 0);
}

const AI_GATED_ACTIONS = new Set(['deepRead', 'richSummary', 'toggleBilingual']);

function dispatchReaderAction(action) {
  if (state.selectedEntryID == null) return;
  if (AI_GATED_ACTIONS.has(action)) {
    // AI 生成类动作先过会员/免费额度门（会员直接放行，免费扣每日次数）
    views.account?.gateAI().then((allowed) => {
      if (!allowed) return;
      cancelNavConfirmation(true);
      views.reader.handleShortcut(action);
      updateToolbarState();
    });
    return;
  }
  cancelNavConfirmation(true);
  views.reader.handleShortcut(action);
  updateToolbarState();
}

async function adjustFontSize(delta) {
  const current = state.snapshot?.preferences.articleFontSize ?? 17;
  const next = delta === 0 ? 17 : Math.max(13, Math.min(25, current + delta));
  await window.robin.setFontSize(next);
  state.snapshot.preferences.articleFontSize = next;
  applyFontSize(next);
}

function getSelectionText() {
  return String(window.getSelection?.() || '');
}

// MARK: - 分栏拖拽

function bindSplitters() {
  setupSplitter('splitter-sidebar', 'sidebar', 240, 340);
  setupSplitter('splitter-list', 'list', 280, 560);
}

function setupSplitter(splitterID, columnID, min, max) {
  const splitter = document.getElementById(splitterID);
  const column = document.getElementById(columnID);
  let startX = 0;
  let startWidth = 0;

  splitter.addEventListener('mousedown', (event) => {
    startX = event.clientX;
    startWidth = column.getBoundingClientRect().width;
    splitter.classList.add('active');
    event.preventDefault();

    const onMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const width = Math.max(min, Math.min(max, startWidth + delta));
      column.style.width = `${width}px`;
      column.style.minWidth = `${width}px`;
      column.style.maxWidth = `${width}px`;
      syncToolbarZones();
    };
    const onUp = () => {
      splitter.classList.remove('active');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const sidebarWidth = document.getElementById('sidebar').getBoundingClientRect().width;
      const listWidth = document.getElementById('list').getBoundingClientRect().width;
      document.documentElement.style.setProperty('--sidebar-width', `${sidebarWidth}px`);
      document.documentElement.style.setProperty('--list-width', `${listWidth}px`);
      window.robin.setColumnWidths({ sidebarWidth, listWidth });
      state.snapshot.preferences.sidebarWidth = sidebarWidth;
      state.snapshot.preferences.listWidth = listWidth;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

// MARK: - 右键菜单

function collectFolders() {
  const folders = [];
  for (const account of state.sidebar) {
    for (const folder of account.folders) folders.push(folder);
  }
  return folders;
}

function folderMenuItems(feedIDs, currentFolder) {
  const items = [{
    label: t('无分类'),
    checked: currentFolder == null,
    onClick: () => window.robin.setFeedFolder(feedIDs, null),
  }];
  const folders = collectFolders();
  if (folders.length) items.push({ type: 'separator' });
  for (const folder of folders) {
    items.push({
      label: folder.name,
      checked: currentFolder === folder.name,
      onClick: () => window.robin.setFeedFolder(feedIDs, folder.name),
    });
  }
  items.push({ type: 'separator' });
  items.push({
    label: t('新建文件夹...'),
    icon: 'folderPlus',
    onClick: () => showAddFolder(reloadAll),
  });
  return items;
}

function onFeedContext(event, { feed, selectedFeedIDs }) {
  const multi = selectedFeedIDs && selectedFeedIDs.size > 1 && selectedFeedIDs.has(feed.id);
  if (multi) {
    const ids = [...selectedFeedIDs];
    ContextMenu.show(event.clientX, event.clientY, [
      {
        label: tf('标记选中源全部已读 (%lld)', ids.length), icon: 'checkAll',
        onClick: async () => { await window.robin.markAllRead({ kind: 'feeds', feedIDs: ids }); },
      },
      {
        label: tf('复制选中订阅链接 (%lld)', ids.length), icon: 'copy',
        onClick: () => {
          const urls = state.sidebar.flatMap((a) => a.allFeeds)
            .filter((f) => selectedFeedIDs.has(f.id))
            .map((f) => f.feedURL).join('\n');
          navigator.clipboard.writeText(urls);
        },
      },
      { type: 'separator' },
      { label: t('移动选中项到文件夹'), icon: 'folder', children: folderMenuItems(ids) },
      { type: 'separator' },
      {
        label: tf('删除选中的订阅 (%lld)', ids.length), icon: 'trash', destructive: true,
        onClick: () => confirmDeleteFeeds(ids.map((id) => ({ id })), ids.length),
      },
    ]);
    return;
  }
  ContextMenu.show(event.clientX, event.clientY, [
    { label: t('刷新此源'), icon: 'refresh', onClick: async (item) => {
      const result = await window.robin.refreshFeed(feed.id);
      if (result.ok) { await reloadAll(); showToast(t('已刷新')); }
      else showToast(result.error || t('刷新失败'));
    } },
    { label: t('全部已读'), icon: 'checkAll', onClick: () => window.robin.markAllRead({ kind: 'feed', feedID: feed.id }) },
    { label: t('复制订阅'), icon: 'copy', onClick: () => navigator.clipboard.writeText(feed.feedURL) },
    { type: 'separator' },
    { label: t('移动到文件夹'), icon: 'folder', children: folderMenuItems([feed.id], feedFolderName(feed)) },
    { type: 'separator' },
    { label: t('删除订阅'), icon: 'trash', destructive: true, onClick: () => confirmDeleteFeeds([feed], 1) },
  ]);
}

function feedFolderName(feed) {
  for (const account of state.sidebar) {
    for (const folder of account.folders) {
      if ((folder.feedIDs || []).includes(feed.id)) return folder.name;
    }
  }
  return null;
}

function onFolderContext(event, { folder }) {
  ContextMenu.show(event.clientX, event.clientY, [
    {
      label: t('全部已读'), icon: 'checkAll',
      onClick: () => window.robin.markAllRead({ kind: 'folder', accountID: folder.accountID, folderName: folder.name }),
    },
    { type: 'separator' },
    { label: t('重命名文件夹'), icon: 'pencil', onClick: async () => { await showRenameFolder(folder, reloadAll); } },
    {
      label: t('删除文件夹'), icon: 'trash', destructive: true,
      onClick: async () => {
        await window.robin.deleteFolder(folder.id);
        if (state.scope.kind === 'folder' && state.scope.folderName === folder.name) {
          handleScopeSelect({ kind: 'today' });
        }
      },
    },
  ]);
}

function showListRowContext(event, item) {
  ContextMenu.show(event.clientX, event.clientY, [
    {
      label: t(item.isRead ? '标为未读' : '标为已读'), icon: 'checkAll',
      onClick: () => window.robin.markRead(item.id, !item.isRead),
    },
    {
      label: t(item.isStarred ? '取消收藏' : '收藏'), icon: 'star',
      onClick: () => window.robin.toggleStar(item.id),
    },
  ]);
}

async function confirmDeleteFeeds(feeds, countOverride = null) {
  const count = countOverride ?? feeds.length;
  const message = tf('确定要删除选中的 %lld 个订阅源及其所有文章吗？此操作无法撤销。', count);
  const ok = await confirmBox(t('删除订阅'), { message, okLabel: t('删除'), danger: true });
  if (ok) {
    window.robin.deleteFeeds(feeds.map((f) => f.id));
    if (state.selectedEntryID) {
      // 删除订阅后清除阅读器选择（对应 onDeleteSelection）
      state.selectedEntryID = null;
      views.reader.clear();
    }
    if (state.scope.kind === 'feed' && feeds.some((f) => f.id === state.scope.feedID)) {
      handleScopeSelect({ kind: 'today' });
    }
  }
}

// MARK: - 设置

function openKnowledgeCenter() {
  const kc = new KnowledgeCenter({
    onOpenArticle: (itemID) => {
      kc.dismiss();
      handleEntrySelect(itemID, { isRead: true, isStarred: false });
    },
  });
  kc.present();
}

function openEvolutionView() {
  const ev = new EvolutionView({
    onOpenArticle: (itemID) => {
      ev.dismiss();
      handleEntrySelect(itemID, { isRead: true, isStarred: false });
    },
  });
  ev.present();
}

function openAihotView() {
  const ah = new AihotView({
    onOpenURL: (url) => window.robin.openLink(url),
    onFeedback: showToast,
  });
  ah.present();
}

function openFeedStore() {
  const store = new FeedStore({
    onSubscribed: async () => {
      await reloadAll();
    },
  });
  store.present();
}

let settingsView = null;
function showSettings(section = 'appearance') {
  if (settingsView) settingsView.dismiss();
  settingsView = new SettingsView({
    state,
    views,
    onAddFreshRSS: () => showFreshRSSAccount(async () => {
      await reloadAll();
      settingsView?.refresh?.();
    }),
    onReload: reloadAll,
    onRefreshState: refreshState,
  });
  settingsView.present(section);
}

async function refreshState() {
  const result = await window.robin.getState();
  if (!result.ok) return;
  state.snapshot = result.data;
  configure({ lang: result.data.language });
  syncLLMGlobals(result.data);
  applyFontSize(result.data.preferences.articleFontSize);
  updateToolbarState();
}

// MARK: - 更新

async function checkUpdateQuietly() {
  try {
    const result = await window.robin.checkUpdate();
    if (!result.ok || !result.data?.available) return;
    state.updateInfo = result.data;
    views.sidebar.showUpdateBadge(result.data.release);
  } catch (_) { /* 静默 */ }
}

// MARK: - 事件

function bindEvents() {
  window.robin.onStateChanged(async (snapshot) => {
    const languageChanged = state.snapshot && state.snapshot.language !== snapshot.language;
    state.snapshot = snapshot;
    window.__robinLanguage = snapshot.language || 'zh';
    syncLLMGlobals(snapshot);
    if (typeof snapshot.prefersDark === 'boolean') {
      document.body.classList.toggle('dark', snapshot.prefersDark);
    }
    if (customThemeTokens) syncCustomTheme(snapshot);
    applyReaderLayout(snapshot.preferences?.readerLayout);
    if (languageChanged) {
      configure({ lang: snapshot.language });
      buildToolbar();
      views.sidebar.rerender?.();
    }
    views.sidebar.updateCounts(snapshot.sidebarCounts, state.updateInfo);
    // 侧栏结构（订阅/文件夹/账户）未变化时跳过整栏重建——updateCounts 已更新数字
    if (snapshot.sidebarSignature && snapshot.sidebarSignature !== state.sidebarSignature) {
      state.sidebarSignature = snapshot.sidebarSignature;
      await reloadSidebar();
    }
    // 条目状态增量：仅读/星变化且当前视图行集不受影响时，打补丁即可，免去全量重拉
    const entryStateRev = Number(snapshot.entryStateRev) || 0;
    const listSetRev = Number(snapshot.listSetRev) || 0;
    const deltaChanged = entryStateRev !== state.entryStateRev;
    const setChanged = listSetRev !== state.listSetRev;
    const scopeSetAffecting = deltaChanged && scopeSetAffectedByEntryState(state.scope, snapshot.entryChanges || []);
    state.entryStateRev = entryStateRev;
    state.listSetRev = listSetRev;
    updateToolbarState();
    applyFontSize(snapshot.preferences.articleFontSize);
    if (deltaChanged && !setChanged && !scopeSetAffecting && state.listItems.length) {
      views.list.patchEntries(snapshot.entryChanges || [], state.selectedEntryID);
      const delta = (snapshot.entryChanges || []).find((c) => c.id === state.selectedEntryID);
      if (delta) views.reader.updateEntryState({ isRead: delta.isRead, isStarred: delta.isStarred });
      return;
    }
    // 静默刷新行状态（不整体重建，避免打断滚动与选择）
    const result = await window.robin.getList(state.scope, { limit: Math.max(100, state.listItems.length), retainingIDs: [...state.retainedIDs], sort: currentListSort() });
    if (result.ok) {
      const beforeIDs = new Set(state.listItems.map((entry) => entry.id));
      const afterIDs = new Set(result.data.map((entry) => entry.id));
      let sameSet = beforeIDs.size === afterIDs.size;
      if (sameSet) for (const id of afterIDs) { if (!beforeIDs.has(id)) { sameSet = false; break; } }
      state.listItems = result.data;
      if (sameSet) {
        views.list.updateItems(result.data, state.selectedEntryID);
      } else {
        // 行集变化（过滤规则/新增文章/删除）：全量重建，保持选择与滚动位置
        const scrollTop = document.getElementById('list-scroll')?.scrollTop || 0;
        views.list.render(result.data, state.scope, state.selectedEntryID, currentHasUnread());
        views.list.setDigestVisible(state.scope?.kind === 'today' || state.scope?.kind === 'unread');
        const scroller = document.getElementById('list-scroll');
        if (scroller) scroller.scrollTop = scrollTop;
      }
    }
    const item = state.listItems.find((entry) => entry.id === state.selectedEntryID);
    if (item) views.reader.updateEntryState({ isRead: item.isRead, isStarred: item.isStarred });
  });

  /** 当前视图的行集是否会随条目读/星状态变化（决定增量补丁后是否需要重拉）。 */
  function scopeSetAffectedByEntryState(scope, changes) {
    if (!scope || !changes.length) return false;
    if (scope.kind === 'unread') return changes.some((c) => c.isRead);
    if (scope.kind === 'starred') return changes.some((c) => c.isStarred);
    return false; // 全部/今日/源/文件夹视图：读/星不影响行集
  }

  window.robin.onAIDelta((payload) => {
    if (payload.entryID !== state.selectedEntryID) return;
    if (payload.kind === 'deepRead' || payload.kind === 'richSummary') views.reader.onWorkDelta(payload);
    else views.reader.onSummaryDelta(payload);
  });

  window.robin.onAIStatus((payload) => {
    views.reader.onAIStatus(payload);
    views.reader.onWorkStatus?.(payload);
  });

  window.robin.onSelectionDelta((payload) => {
    views.reader.onSelectionDelta(payload);
  });

  window.robin.onThemeChanged(({ shouldUseDarkColors }) => {
    document.body.classList.toggle('dark', Boolean(shouldUseDarkColors));
  });

  window.robin.onMenu('menu:addFeed', () => showAddFeed(collectFolders(), reloadAll));
  window.robin.onMenu('menu:importOPML', () => window.robin.importOPML());
  window.robin.onMenu('menu:exportOPML', () => window.robin.exportOPML());
  window.robin.onMenu('menu:openSettings', () => showSettings('appearance'));
  window.robin.onMenu('menu:openShortcuts', () => new ShortcutsView().present());
  window.robin.onMenu('menu:openStore', () => openFeedStore());
  window.robin.onMenu('menu:checkUpdate', () => checkUpdateQuietly());
  window.robin.onMenu('menu:fontSize', (delta) => adjustFontSize(delta));

  // 点击激活栏（对应 mouseDownMonitor）
  document.addEventListener('mousedown', (event) => {
    if (event.target.closest('.modal-overlay, .context-menu, .toast-capsule, .nj-selection-actions, .nj-selection-popover, .nj-lightbox')) return;
    const sidebar = event.target.closest('#sidebar');
    const list = event.target.closest('#list');
    const reader = event.target.closest('#reader');
    if (list) setActiveColumn(1, { autoSelect: false });
    else if (reader) setActiveColumn(2, { autoSelect: false });
    else if (sidebar) setActiveColumn(0, { autoSelect: false });
  }, true);

  window.addEventListener('resize', debounce(syncToolbarZones, 200));

  // 主题事件（设置页提案 / 设计器）
  window.addEventListener('robinread:theme-applied', (event) => {
    applyThemeTokens(event.detail, event.detailName || null);
  });
  window.addEventListener('robinread:theme-reset', () => {
    resetTheme();
  });
}

function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

window.addEventListener('DOMContentLoaded', () => setActiveColumn(1, { autoSelect: false }));

bootstrap().catch((err) => console.error('bootstrap failed', err));
