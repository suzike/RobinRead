'use strict';
/**
 * RobinRead Windows — IPC 桥接层
 *
 * 渲染进程（三栏 UI）与主进程 AppStore 之间的全部通道。
 * 采用 request/response（invoke）+ 推送（state:changed / ai:delta）两种形态。
 */
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, dialog, nativeTheme, clipboard, session, nativeImage, protocol, shell, Notification } = require('electron');
const { checkForUpdate } = require('./UpdateCheckService');
const { errorMessage } = require('./AppStore');
const ArticleExtractor = require('./ArticleExtractor');

// 自定义图标协议必须先注册为 privileged（仅限 app ready 之前调用）。
// 生产入口 main.js 在 ready 前 require 本模块，特权始终生效；
// selftest 等 harness 在 ready 后才 require，跳过注册——非特权 scheme 的 <img> 加载仍可用。
try {
  if (!app.isReady()) {
    protocol.registerSchemesAsPrivileged([
      { scheme: 'robin-icon', privileges: { standard: false, secure: true, supportFetchAPI: true, stream: true } },
    ]);
  }
} catch (_) { /* 已注册过或环境限制：退化为非特权 scheme */ }

function createMainWindow(store) {
  let bounds = store.preferences.get('RobinRead.windowBounds', null);
  // 屏幕外窗口治理：记忆的坐标落在已断开的显示器（或越界）时丢弃，
  // 回退主屏居中——否则窗口存在于屏幕外，表现为「软件打不开」。
  if (bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)) {
    const { screen } = require('electron');
    const area = { x: bounds.x, y: bounds.y, width: bounds.width || 1280, height: bounds.height || 820 };
    const display = screen.getDisplayMatching(area);
    const visible = bounds.x >= display.workArea.x - 8 && bounds.y >= display.workArea.y - 8
      && bounds.x < display.workArea.x + display.workArea.width
      && bounds.y < display.workArea.y + display.workArea.height;
    if (!visible) bounds = null;
  } else if (bounds && (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y))) {
    bounds = null;
  }
  const primary = require('electron').screen.getPrimaryDisplay().workArea;
  const window = new BrowserWindow({
    width: bounds?.width || 1280,
    height: bounds?.height || 820,
    x: bounds?.x ?? Math.round(primary.x + (primary.width - 1280) / 2),
    y: bounds?.y ?? Math.round(primary.y + (primary.height - 820) / 2),
    minWidth: 980,
    minHeight: 600,
    show: false,
    title: 'RobinRead',
    backgroundColor: '#eae8e1',
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
    icon: resolveIcon(),
  });

  window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  window.once('ready-to-show', () => window.show());

  // 主题同步到 Chromium
  const applyTheme = () => {
    window.webContents.send('theme:changed', { shouldUseDarkColors: nativeTheme.shouldUseDarkColors });
  };
  nativeTheme.on('updated', applyTheme);
  window.webContents.on('did-finish-load', applyTheme);

  // 外链默认走系统浏览器
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // 记忆窗口位置
  const saveBounds = () => {
    if (!window.isDestroyed() && !window.isMinimized()) {
      store.setWindowBounds(window.getBounds());
    }
  };
  window.on('resize', debounce(saveBounds, 500));
  window.on('move', debounce(saveBounds, 500));
  window.on('close', saveBounds);

  return window;
}

function resolveIcon() {
  const candidates = [
    path.join(process.resourcesPath || '', 'icon.ico'),
    path.join(__dirname, '..', '..', 'assets', 'icon.ico'),
    path.join(__dirname, '..', '..', 'assets', 'icon.png'),
  ];
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch (_) { /* 跳过 */ }
  }
  return undefined;
}

// MARK: 桌面四件套共享助手（托盘 / 通知 / 开机自启 / 备份 / 存储）

// 通知构造的可替换缝：生产路径就是 new Notification(options)；
// diag 探针替换 notificationBridge.create 即可无头验证观察器门控逻辑
// （真实系统气泡的弹出效果仍需真机确认）。
const notificationBridge = {
  create(options) { return new Notification(options); },
};

// 应用退出标志：「关闭到托盘」会拦截一切 close（含 Alt+F4 / 任务栏关闭），
// 显式退出路径（托盘菜单退出、备份恢复重启）必须先 markAppQuitting 置位绕过拦截。
let appQuitting = false;
function markAppQuitting() { appQuitting = true; }
function isAppQuitting() { return appQuitting; }

/** 开机自启状态：仅打包环境（app.isPackaged）可靠，dev（electron .）下 supported=false。 */
function loginItemState() {
  try {
    return {
      supported: app.isPackaged === true,
      enabled: app.getLoginItemSettings().openAtLogin === true,
      message: app.isPackaged ? '' : '开机自启仅打包版（安装版）可用',
    };
  } catch (_) {
    return { supported: false, enabled: false, message: '当前环境不支持开机自启' };
  }
}

/** 开机自启写操作：打包环境写注册表（path 固定为当前 exe），dev 下直接回显不支持。 */
function setLoginItemEnabled(enabled) {
  if (app.isPackaged) {
    try {
      app.setLoginItemSettings({ openAtLogin: !!enabled, path: process.execPath });
    } catch (_) { /* 写失败时原样回读系统状态 */ }
  }
  return loginItemState();
}

/**
 * 备份导出核心（可直调；对话框由 IPC handler 包装）。
 * 方案：VACUUM INTO 生成紧凑完整快照（天然合并 WAL）→ base64，连同偏好打包成单文件 JSON。
 * 接受大库下 base64 体积开销（纯本地操作）；单引号路径按 SQL 规则转义。
 */
async function backupExportTo(store, filePath) {
  const tmpSnapshot = `${filePath}.vacuum-snapshot.tmp.db`;
  try { fs.rmSync(tmpSnapshot, { force: true }); } catch (_) { /* 目标不存在 */ }
  try {
    const escaped = String(tmpSnapshot).replace(/'/g, "''");
    store.database.exec(`VACUUM INTO '${escaped}'`);
    const dbBase64 = fs.readFileSync(tmpSnapshot).toString('base64');
    const payload = {
      version: app.getVersion(),
      exportedAt: new Date().toISOString(),
      dbBase64,
      preferences: JSON.parse(JSON.stringify(store.preferences.values)),
    };
    fs.writeFileSync(filePath, JSON.stringify(payload), 'utf8');
    return { path: filePath, bytes: fs.statSync(filePath).size, exportedAt: payload.exportedAt };
  } finally {
    try { fs.rmSync(tmpSnapshot, { force: true }); } catch (_) { /* 临时快照清理 */ }
  }
}

/**
 * 备份导入核心：校验结构 → 解码写 restore-pending 三件套。
 * 真正替换发生在下次启动（main.js applyPendingRestore，先于 AppStore 打开数据库）。
 */
function backupImportFrom(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    throw new Error('无法解析该文件：不是有效的 JSON 备份');
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.version
    || typeof parsed.dbBase64 !== 'string' || parsed.dbBase64.length < 32) {
    throw new Error('不是有效的 RobinRead 备份文件（缺少 version / dbBase64 字段）');
  }
  const dbBytes = Buffer.from(parsed.dbBase64, 'base64');
  if (dbBytes.length < 100 || dbBytes.subarray(0, 15).toString('utf8') !== 'SQLite format 3') {
    throw new Error('备份中的数据库内容无效或已损坏');
  }
  const userData = app.getPath('userData');
  fs.writeFileSync(path.join(userData, 'restore-pending.db'), dbBytes);
  fs.writeFileSync(path.join(userData, 'restore-pending.preferences.json'),
    JSON.stringify(parsed.preferences && typeof parsed.preferences === 'object' ? parsed.preferences : {}, null, 2),
    'utf8');
  fs.writeFileSync(path.join(userData, 'restore-pending.json'),
    JSON.stringify({ done: false, importedAt: new Date().toISOString(), from: path.basename(filePath) }),
    'utf8');
  return { ready: true, importedAt: new Date().toISOString() };
}

/** 目录递归求体积（容错：目录不存在 / 无权限按 0）。 */
function directoryBytes(dir) {
  let total = 0;
  const walk = (p) => {
    let entries = [];
    try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(p, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        try { total += fs.statSync(full).size; } catch (_) { /* 跳过 */ }
      }
    }
  };
  walk(dir);
  return total;
}

/** 存储体积统计：db / wal / 正文缓存 / AI 产物 / 站点图标。 */
function storageStatsFor(store) {
  const userData = app.getPath('userData');
  const fileSize = (p) => { try { return fs.statSync(p).size; } catch (_) { return 0; } };
  let cachesCount = 0;
  let cachesBytes = 0;
  let artifactsCount = 0;
  try {
    const row = store.database.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(text)+LENGTH(html)),0) AS bytes FROM article_caches').get();
    cachesCount = Number(row?.n ?? 0);
    cachesBytes = Number(row?.bytes ?? 0);
  } catch (_) { /* 表缺失按 0 */ }
  try {
    artifactsCount = Number(store.database.prepare('SELECT COUNT(*) AS n FROM ai_artifacts').get()?.n ?? 0);
  } catch (_) { /* 同上 */ }
  return {
    dbSize: fileSize(path.join(userData, 'library.db')),
    walSize: fileSize(path.join(userData, 'library.db-wal')),
    cachesCount,
    cachesBytes,
    artifactsCount,
    iconsBytes: directoryBytes(path.join(userData, 'favicons')),
  };
}

/**
 * 立即清理：与 AppStore.housekeeping 相同口径的 SQL（孤儿 AI 产物 7 天、
 * 孤儿/过期正文缓存 45 天；explored_feeds 属探索画像不清理）+ 全文索引孤儿
 * 兜底 + VACUUM 压缩体积。返回清理后的最新统计。
 */
function cleanupStorage(store) {
  store.database.exec(`
    DELETE FROM ai_artifacts WHERE (item_id IS NULL OR item_id NOT IN (SELECT id FROM items))
      AND updated_at < strftime('%s','now','-7 days');
    DELETE FROM article_caches WHERE item_id NOT IN (SELECT id FROM items)
      OR fetched_at < strftime('%s','now','-45 days');
  `);
  try {
    const { sweepOrphans } = require('./Persistence/SearchIndex');
    sweepOrphans(store.database);
  } catch (_) { /* 全文索引兜底失败不阻塞 */ }
  try { store.database.exec('VACUUM'); } catch (_) { /* VACUUM 失败不阻塞统计回显 */ }
  return storageStatsFor(store);
}

function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// MARK: Feed 图标协议（robin-icon:// → FeedIconStore 三级缓存）
let _iconProtocolInstalled = false;
function registerIconProtocol() {
  if (_iconProtocolInstalled) return;
  _iconProtocolInstalled = true;
  const { FeedIconStore } = require('./FeedIconStore');
  const icons = new FeedIconStore(path.join(app.getPath('userData'), 'favicons'));
  protocol.handle('robin-icon', async (request) => {
    try {
      const url = new URL(request.url);
      const dataURL = await icons.load({
        storedIconURL: url.searchParams.get('stored') || '',
        siteURL: url.searchParams.get('site') || '',
        feedURL: url.searchParams.get('feed') || '',
        host: url.searchParams.get('host') || '',
      });
      if (!dataURL) return new Response('', { status: 404 });
      const comma = dataURL.indexOf(',');
      const mime = dataURL.slice(5, comma).split(';')[0] || 'image/png';
      const body = Buffer.from(dataURL.slice(comma + 1), 'base64');
      return new Response(body, { headers: { 'Content-Type': mime, 'Cache-Control': 'max-age=86400' } });
    } catch (_) {
      return new Response('', { status: 404 });
    }
  });
}

// 图片防盗链通用治理：本地页面（file://）发起的图片请求不带 Referer，
// 部分国内 CDN（少数派 cdnfile、微信、知乎等）会因此 403。
// 策略：图片子请求若 Referer 为空 → 注入 Referer。微信图片 CDN（qpic.cn）要求
// 注入 mp.weixin.qq.com（文章源站），其余注入图片自身站点根。
// 注册在 registerIPCHandlers 内，保证测试 harness 直接调用时同样生效。
let _networkInterceptorsInstalled = false;
function registerNetworkInterceptors() {
  if (_networkInterceptorsInstalled) return;
  _networkInterceptorsInstalled = true;
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    if (details.resourceType === 'image' && !headers.Referer && !headers.referer) {
      try {
        const url = new URL(details.url);
        if (url.protocol === 'https:' || url.protocol === 'http:') {
          const host = url.host.toLowerCase();
          const refererHost = (host === 'mmbiz.qpic.cn' || host.endsWith('.qpic.cn'))
            ? 'mp.weixin.qq.com'
            : url.host;
          headers.Referer = `${url.protocol}//${refererHost}/`;
        }
      } catch (_) { /* 非法地址跳过 */ }
    }
    callback({ requestHeaders: headers });
  });
}

function registerIPCHandlers(store, window) {
  registerNetworkInterceptors();
  registerIconProtocol();
  const send = (channel, payload) => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  };

  // 状态推送
  const { STRINGS } = require('./I18NStrings');
  const { i18n } = require('./I18N');
  const onStateChanged = () => send('state:changed', {
    ...store.snapshot(),
    language: i18n.language,
    prefersDark: nativeTheme.shouldUseDarkColors,
    customTheme: store.preferences.get('RobinRead.customTheme', null),
  });
  store.on('state:changed', onStateChanged);
  store.on('ai:delta', (payload) => send('ai:delta', payload));
  store.on('ai:status', (payload) => send('ai:status', payload));

  // MARK: 新文章通知（刷新完成 × 未读净增 × 偏好开启 × 窗口不在前台）
  // 模块级观察状态：refreshing → 非refreshing 的转变时刻比较刷新前后的全站未读数。
  let notifyWasRefreshing = false;
  let notifyUnreadAtRefreshStart = null;
  store.on('state:changed', () => {
    try {
      const snap = store.snapshot();
      const unread = Number(snap.sidebarCounts?.allUnread ?? 0) || 0;
      const refreshing = snap.refreshStatus?.state === 'refreshing';
      if (refreshing && !notifyWasRefreshing) {
        notifyUnreadAtRefreshStart = unread; // 记录刷新前基线
      }
      if (!refreshing && notifyWasRefreshing) {
        const baseline = notifyUnreadAtRefreshStart;
        notifyUnreadAtRefreshStart = null;
        // 基线缺失（如启动即处于刷新中）时退回 store 给出的本次新增数
        const fallback = Number(snap.lastRefreshOutcome?.newUnreadCount ?? 0) || 0;
        const gained = Math.max(0, baseline == null ? fallback : unread - baseline);
        if (gained >= 1
          && store.preferences.get('RobinRead.newArticleNotify', true) !== false
          && !window.isDestroyed()
          && !(window.isVisible() && !window.isMinimized())) {
          // 仅窗口隐藏 / 最小化时提醒，前台阅读不打扰；主进程通知无需请求权限
          const notification = notificationBridge.create({
            title: '知更 · 新文章',
            body: `本次刷新新增 ${gained} 篇文章`,
            icon: resolveIcon(),
          });
          notification.on('click', () => {
            try {
              const win = !window.isDestroyed() ? window : BrowserWindow.getAllWindows()[0];
              if (!win) return;
              if (win.isMinimized()) win.restore();
              win.show();
              win.focus();
            } catch (_) { /* 通知点击不抛错 */ }
          });
          notification.show();
        }
      }
      notifyWasRefreshing = refreshing;
    } catch (_) { /* 通知链路异常不干扰状态推送 */ }
  });

  // 系统主题变化 → 同步推送到渲染层（含非 createMainWindow 创建的窗口）
  nativeTheme.on('updated', () => {
    send('theme:changed', { shouldUseDarkColors: nativeTheme.shouldUseDarkColors });
    send('state:changed', { ...store.snapshot(), language: i18n.language, prefersDark: nativeTheme.shouldUseDarkColors, customTheme: store.preferences.get('RobinRead.customTheme', null) });
  });

  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return { ok: true, data: await fn(...args) };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    });
  };

  // MARK: 状态查询
  handle('app:state', () => ({
    ...store.snapshot(),
    llm: store.llmConfigurationSnapshot(),
    hasAPIKey: store.hasAIAPIKey(),
    strings: STRINGS,
    language: i18n.language,
    prefersDark: nativeTheme.shouldUseDarkColors,
    customTheme: store.preferences.get('RobinRead.customTheme', null),
    version: app.getVersion(),
  }));
  handle('app:sidebar', () => store.sidebarStructure());
  handle('app:syncStates', () => store.accountSyncStates());
  handle('app:list', (scope, options) => store.listItems(scope, options || {}));
  handle('app:reader', (entryID) => store.readerArticle(entryID));
  handle('app:entry', (entryID) => {
    const entry = store.entry(entryID);
    if (!entry) return null;
    const feed = store.feed(entry.feedID);
    const content = store.articleContent(entryID);
    const summary = store.existingSummary(entryID);
    return { entry, feed, content, summary };
  });
  handle('app:adjacent', (scope, entryID, direction) => store.adjacentItem(scope, entryID, direction));

  // MARK: Feed / 文件夹
  handle('feeds:add', (url, folder) => store.addFeed(url, folder));
  handle('feeds:delete', (feedIDs) => store.deleteFeeds(feedIDs));
  handle('feeds:setFolder', (feedIDs, folderName) => store.setFeedFolder(feedIDs, folderName));
  handle('feeds:reorder', (orderedIDs) => store.reorderFeeds(orderedIDs));
  handle('folders:add', (name) => store.addFolder(name));
  handle('folders:rename', (folderID, newName) => store.renameFolder(folderID, newName));
  handle('folders:delete', (folderID) => store.deleteFolder(folderID));

  // MARK: OPML（文件对话框在主进程）
  handle('opml:import', async () => {
    const result = await dialog.showOpenDialog(window, {
      title: '导入 OPML',
      filters: [{ name: 'OPML', extensions: ['opml', 'xml'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const data = fs.readFileSync(result.filePaths[0]);
    return store.importOPML(data);
  });
  handle('opml:export', async () => {
    const result = await dialog.showSaveDialog(window, {
      title: '导出 OPML',
      defaultPath: 'RobinRead-subscriptions.opml',
      filters: [{ name: 'OPML', extensions: ['opml'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const xml = store.exportOPML();
    fs.writeFileSync(result.filePath, xml, 'utf8');
    return { path: result.filePath };
  });

  // MARK: 刷新
  handle('refresh:run', () => store.refresh('manual'));
  handle('refresh:feed', (feedID) => store.refreshFeed(feedID));

  // MARK: 搜索
  handle('app:search', (query, options) => store.searchEntries(query, options || {}));
  handle('app:smartFolderSearch', (query, limit) => store.smartFolderSearch(query, { limit: Number(limit) || 200 }));

  // MARK: 今日简报（流式 + 当日缓存秒开）
  handle('ai:digest', () => store.generateTodayDigest((delta) => send('ai:digest-delta', { delta })));
  handle('ai:digestCache', () => store.cachedTodayDigest());

  // MARK: 阅读排版
  handle('prefs:setReaderLayout', (patch) => store.setReaderLayout(patch));
  handle('prefs:setFilterRules', (patch) => store.setFilterRules(patch));

  // MARK: 阅读状态
  handle('read:mark', (entryID, read) => store.markRead(entryID, read));
  handle('read:toggleStar', (entryID) => store.toggleStar(entryID));
  handle('read:toggleLater', (entryID, later) => store.toggleLater(entryID, later));
  handle('read:markAll', (scope) => store.markAllRead(scope));

  // MARK: 正文提取
  handle('extract:run', (entryID) => store.extractArticle(entryID));

  // MARK: 账户
  handle('accounts:addFreshRSS', (payload) => store.addFreshRSSAccount(payload));
  handle('accounts:validate', ({ endpointURL, username, password }) => store.validateFreshRSSCredentials(endpointURL, username, password));
  handle('accounts:remove', (accountID) => store.removeAccount(accountID));
  handle('accounts:setEnabled', (accountID, isEnabled) => store.setAccountEnabled(accountID, isEnabled));
  handle('accounts:sync', (accountID) => store.syncFreshRSS(accountID, { origin: 'manual' }));

  // MARK: AI
  handle('ai:generateSummary', (entryID) => store.generateSummary(entryID));
  handle('ai:deepRead', (entryID) => store.deepRead(entryID));
  handle('ai:richSummary', (entryID) => store.richSummary(entryID));
  handle('ai:existingWork', (entryID, kind) => store.existingArticleWork(entryID, kind));
  handle('ai:explain', (payload) => store.explainSelection({ ...payload, onDelta: (delta) => send('ai:selection-delta', { requestID: payload.requestID, delta }) }));
  handle('ai:ask', (payload) => store.askSelection({ ...payload, onDelta: (delta) => send('ai:selection-delta', { requestID: payload.requestID, delta }) }));
  handle('ai:translateSelection', (payload) => store.translateSelection({ ...payload, onDelta: (delta) => send('ai:selection-delta', { requestID: payload.requestID, delta }) }));
  handle('ai:translateParagraphs', (entryID, html, paragraphIDs) => store.translateBilingualParagraphs({ entryID, html, paragraphIDs }));
  handle('ai:cachedBilingual', (entryID, html) => store.cachedBilingual(entryID, html));
  handle('ai:annotations', (entryID) => store.selectionAnnotations(entryID));
  handle('ai:cancel', (key) => store.cancelAI(key));
  handle('ai:test', () => store.testAIConnection());

  // MARK: 偏好
  handle('prefs:setTheme', (theme) => {
    if (['light', 'dark'].includes(theme)) nativeTheme.themeSource = theme;
    else nativeTheme.themeSource = 'system';
    store.setAppTheme(theme);
  });
  handle('prefs:setFontSize', (size) => store.setArticleFontSize(size));
  handle('prefs:setLanguage', (language) => store.setAppLanguage(language));
  handle('prefs:setRefreshInterval', (raw) => store.setRefreshInterval(raw));
  handle('prefs:setRefreshOnLaunch', (enabled) => store.setRefreshOnLaunch(enabled));
  handle('prefs:setLLM', (patch) => store.setLLMConfiguration(patch));
  handle('prefs:setAPIKey', (key) => store.setAIAPIKey(key));
  handle('llm:providers', () => store.providersSnapshot());
  handle('llm:addProvider', (payload) => store.addProvider(payload || {}));
  handle('llm:updateProvider', (id, patch) => store.updateProvider(id, patch || {}));
  handle('llm:removeProvider', (id) => store.removeProvider(id));
  handle('llm:setActive', (id) => store.setActiveProvider(id));
  handle('prefs:setColumnWidths', (payload) => store.setColumnWidths(payload));
  handle('prefs:setThemeTokens', (tokens) => {
    store.preferences.set('RobinRead.customTheme', tokens);
  });
  handle('prefs:clearThemeTokens', () => {
    store.preferences.remove('RobinRead.customTheme');
  });

  // MARK: 更新
  handle('update:check', async () => checkForUpdate(store.preferences.get('RobinRead.ignoredVersion', null)));
  handle('update:ignoreVersion', (version) => {
    store.preferences.set('RobinRead.ignoredVersion', version);
  });

  // MARK: 无边框窗口控制
  ipcMain.on('window:minimize', () => window.minimize());
  ipcMain.on('window:maximize', () => {
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  // MARK: 关闭到托盘
  // 偏好 RobinRead.closeToTray（默认 false）开启时：窗口按钮的关闭 → hide；
  // 系统级关闭（Alt+F4 / 任务栏关闭）经 close 事件拦截同样 hide。
  // 显式退出（托盘菜单退出 / 备份恢复重启）先 markAppQuitting 置位绕过拦截。
  const closeToTrayEnabled = () => store.preferences.get('RobinRead.closeToTray', false) === true;
  ipcMain.on('window:close', () => {
    if (closeToTrayEnabled()) window.hide();
    else window.close();
  });
  window.on('close', (event) => {
    if (!appQuitting && closeToTrayEnabled()) {
      event.preventDefault();
      window.hide();
    }
  });
  handle('window:isMaximized', () => window.isMaximized());
  const sendMaxState = () => {
    if (!window.isDestroyed()) window.webContents.send('window:maximized-changed', window.isMaximized());
  };
  window.on('maximize', sendMaxState);
  window.on('unmaximize', sendMaxState);


  // MARK: 知识引擎（高亮/笔记/复习/标签/统计/收藏/连接/导出）
  const K = () => store.knowledge;
  handle('kb:highlights', (itemID) => K().getHighlights(itemID));
  handle('kb:allHighlights', () => K().getAllHighlights(200));
  handle('kb:addHighlight', (payload) => K().addHighlight(payload));
  handle('kb:removeHighlight', (id) => K().removeHighlight(id));
  handle('kb:updateHighlight', (id, patch) => K().updateHighlight(id, patch));
  handle('kb:notes', (itemID) => itemID ? K().getNotes(itemID) : K().getAllNotes());
  handle('kb:addNote', (payload) => K().addNote(payload));
  handle('kb:updateNote', (id, patch) => K().updateNote(id, patch));
  handle('kb:deleteNote', (id) => K().deleteNote(id));
  handle('kb:dueReviews', () => K().getDueReviews());
  handle('kb:review', (id, quality) => K().reviewCard(id, quality));
  handle('kb:addToReview', (payload) => K().addToReview(payload));
  handle('kb:removeFromReview', (id) => K().removeFromReview(id));
  handle('kb:tags', (itemID) => itemID ? K().getItemTags(itemID) : K().getTags());
  handle('kb:entriesForTag', (tag, limit) => K().entriesForTag(tag, limit));
  handle('kb:addTag', (itemID, tag) => K().addManualTag(itemID, tag));
  handle('kb:removeTag', (itemID, tag) => K().removeTag(itemID, tag));
  handle('kb:stats', (days) => K().getStats(days || 30));
  handle('kb:collections', () => K().listCollections());
  handle('kb:createCollection', (name, desc) => K().createCollection(name, desc));
  handle('kb:updateCollection', (id, patch) => K().updateCollection(id, patch || {}));
  handle('kb:collectionItems', (colID) => K().getCollectionItems(colID));
  handle('kb:addToCollection', (colID, itemID) => K().addToCollection(colID, itemID));
  handle('kb:removeFromCollection', (colID, itemID) => K().removeFromCollection(colID, itemID));
  handle('kb:deleteCollection', (id) => K().deleteCollection(id));
  handle('kb:smartFolders', () => K().listSmartFolders());
  handle('kb:createSmartFolder', (name, query) => K().createSmartFolder(name, query));
  handle('kb:deleteSmartFolder', (id) => K().deleteSmartFolder(id));
  handle('kb:related', (itemID) => K().findRelated(itemID));
  handle('kb:exportMarkdown', (itemID) => K().exportToMarkdown(itemID));
  handle('kb:exportNotes', () => K().exportAllNotes());
  handle('kb:dailyReview', (dateStr) => K().dailyReview(dateStr));
  handle('kb:exportAnki', () => K().exportAnki());
  handle('kb:searchKnowledge', (query, options) => K().searchKnowledge(query, options || {}));
  handle('kb:heatmap', (days) => K().readingHeatmap(days || 90));
  handle('kb:dashboard', () => K().dashboard());
  handle('kb:exportJSON', () => K().exportJSON());
  handle('kb:exportHTML', () => K().exportHTML());
  handle('kb:refreshLinks', (noteID) => K().refreshNoteLinks(noteID));
  handle('kb:backlinks', (noteID) => K().backlinks(noteID));

  // MARK: 自进化引擎（源健康/行为/画像/反馈/推荐/诊断/密度）
  const E = () => store.evolution;
  handle('evo:health', () => E().healthSnapshot());
  handle('evo:deadFeeds', () => E().deadFeeds());
  handle('evo:profile', () => E().interestProfile());
  handle('evo:recommend', (limit) => E().recommendArticles(limit || 8));
  handle('evo:feedback', (payload) => E().recordFeedback(payload));
  handle('evo:feedbackSummary', () => E().feedbackSummary());
  handle('evo:diagnose', () => E().diagnose());
  handle('evo:densityByFeed', (days) => E().densityByFeed(days || 14));
  handle('evo:densityByDay', (days) => E().densityByDay(days || 14));

  // MARK: 信息维度
  handle('app:fullTextSearch', (query, options) => store.fullTextSearch(query, options || {}));

  // MARK: AIHOT（热点榜 / 故事时间线 / 精选 / 日报 / 本地状态 / AI 深读）
  handle('aihot:hotTopics', () => store.aihot.hotTopics());
  handle('aihot:story', (publicId) => store.aihot.story(publicId));
  handle('aihot:selected', (limit) => store.aihot.selected(limit || 30));
  handle('aihot:daily', () => store.aihot.daily());
  handle('aihot:dailyIndex', (limit) => store.aihot.dailies(limit || 30));
  handle('aihot:dailyByDate', (date) => store.aihot.dailyByDate(date));
  handle('aihot:items', (opts) => store.aihot.items(opts || {}));
  handle('aihot:selectedPage', (opts) => store.aihot.selectedPage(opts || {}));
  handle('aihot:leaderboard', () => store.aihot.leaderboard());
  handle('aihot:extractURL', (url) => store.aihot.extractURL(url));
  handle('aihot:snapshot', () => store.aihotSnapshot());
  handle('aihot:toggleFavorite', (item) => store.aihotToggleFavorite(item));
  handle('aihot:markRead', (ids) => store.aihotMarkRead(ids));
  handle('aihot:setKeywords', (kw) => store.aihotSetKeywords(kw));
  handle('aihot:deepRead', (payload) => store.aihotDeepRead(payload));

  // MARK: 商店健康 + AI 探索（订阅源发现）
  handle('store:health', () => store.healthByFeedURL());
  handle('explore:run', (payload) => store.explore.run(payload || {}));
  handle('explore:explain', (payload) => store.explore.explain(payload || {}));
  handle('explore:dismiss', (payload) => store.explore.dismiss(payload || {}));

  // MARK: 账号与会员（微信登录 / 会员状态 / 订单）
  const { AuthService } = require('./Account/AuthService');
  const auth = new AuthService({
    credentialStore: store.credentials,
    preferences: store.preferences,
    getMainWindow: () => window,
    onChange: (user) => send('account:changed', { user }),
  });
  // 订阅源数量门控（addFeed / importOPML 统一走这里，覆盖 OPML 导入与商店快捷订阅）
  store.accountGate = auth;
  handle('account:config', async () => ({ apiBase: auth.apiBase, ...(await auth.config()) }));
  handle('account:loginWechat', () => auth.loginWithWechat());
  handle('account:loginDev', (nickname) => auth.loginDev(nickname));
  handle('account:register', (username, password, nickname) => auth.register(username, password, nickname));
  handle('account:loginPassword', (username, password) => auth.loginWithPassword(username, password));
  handle('account:redeem', (code) => auth.redeem(code));
  handle('account:logout', () => auth.logout());
  handle('account:me', (force) => auth.me(!!force));
  handle('account:consumeAIQuota', () => auth.consumeAIQuota());
  handle('account:updateProfile', (patch) => auth.updateProfile(patch || {}));
  // 本地图片 → 居中方形裁剪 → 128px 缩放 → PNG（过大转 JPEG）→ data URL
  handle('account:pickAvatar', async () => {
    const result = await dialog.showOpenDialog(window, {
      title: '选择头像图片',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const image = nativeImage.createFromPath(result.filePaths[0]);
    if (image.isEmpty()) throw new Error('无法读取该图片，请换一张试试');
    const { width, height } = image.getSize();
    const side = Math.min(width, height);
    const square = image.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side });
    const resized = square.resize({ width: 128, height: 128, quality: 'good' });
    const png = resized.toPNG();
    if (png.length <= 96 * 1024) return `data:image/png;base64,${png.toString('base64')}`;
    return `data:image/jpeg;base64,${resized.toJPEG(85).toString('base64')}`;
  });
  handle('pay:createOrder', (plan) => auth.createOrder(plan));
  handle('pay:queryOrder', (outTradeNo) => auth.queryOrder(outTradeNo));

  // MARK: 渲染进程文章内链接（阅读器 iframe 内点击）
  ipcMain.on('reader:openLink', (_event, url) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });

  // 剪贴板兜底：页面侧 navigator.clipboard 在窗口失焦/隐藏时会失败，走主进程必成
  handle('app:copyText', (text) => { clipboard.writeText(String(text ?? '')); return true; });

  // MARK: 导出（另存为对话框 + 同步写文本文件；canceled / 异常由 handle 统一包装）
  handle('app:pickSavePath', async ({ defaultName } = {}) => {
    const result = await dialog.showSaveDialog(window, {
      title: '导出文章',
      defaultPath: defaultName || 'export.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'All Files', extensions: ['*'] }],
    });
    if (result.canceled || !result.filePath) return null;
    return result.filePath;
  });
  handle('app:writeTextFile', ({ filePath, content } = {}) => {
    if (!filePath || typeof filePath !== 'string') throw new Error('缺少有效的文件路径');
    fs.writeFileSync(filePath, String(content ?? ''), 'utf8');
    return true;
  });

  // MARK: 桌面通用偏好（关闭到托盘 / 新文章通知）
  handle('prefs:getGeneral', () => ({
    closeToTray: store.preferences.get('RobinRead.closeToTray', false) === true,
    newArticleNotify: store.preferences.get('RobinRead.newArticleNotify', true) !== false,
  }));
  handle('prefs:setGeneral', (patch) => {
    const p = patch || {};
    if (typeof p.closeToTray === 'boolean') store.preferences.set('RobinRead.closeToTray', p.closeToTray);
    if (typeof p.newArticleNotify === 'boolean') store.preferences.set('RobinRead.newArticleNotify', p.newArticleNotify);
    return {
      closeToTray: store.preferences.get('RobinRead.closeToTray', false) === true,
      newArticleNotify: store.preferences.get('RobinRead.newArticleNotify', true) !== false,
    };
  });

  // MARK: 开机自启（无参读取 / 带参写入；dev 下 supported=false 并提示仅打包版可用）
  handle('app:loginItem', (enabled) => {
    if (enabled == null) return loginItemState();
    return setLoginItemEnabled(enabled);
  });

  // MARK: 备份与恢复（单文件 JSON：VACUUM INTO 快照 + 偏好）
  handle('backup:export', async () => {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const result = await dialog.showSaveDialog(window, {
      title: '导出备份',
      defaultPath: `RobinRead-backup-${stamp}.json`,
      filters: [{ name: 'RobinRead 备份', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return null;
    return backupExportTo(store, result.filePath);
  });
  handle('backup:import', async () => {
    const result = await dialog.showOpenDialog(window, {
      title: '导入备份',
      filters: [{ name: 'RobinRead 备份', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return backupImportFrom(result.filePaths[0]);
  });
  // 渲染层 alertBox（「将重启应用完成恢复」）确认后调用：优雅关闭 → relaunch
  ipcMain.on('backup:relaunch', () => {
    try {
      store.preferences.flushSync();
      store.database.close();
    } catch (_) { /* 关闭失败也继续重启 */ }
    markAppQuitting();
    app.relaunch();
    app.exit(0);
  });

  // MARK: 存储管理（体积统计 / 立即清理 / 打开数据目录）
  handle('storage:stats', () => storageStatsFor(store));
  handle('storage:cleanup', () => cleanupStorage(store));
  handle('storage:openDataDir', async () => shell.openPath(app.getPath('userData')));
}

module.exports = {
  registerIPCHandlers,
  createMainWindow,
  registerNetworkInterceptors,
  resolveIcon,
  markAppQuitting,
  isAppQuitting,
  loginItemState,
  setLoginItemEnabled,
  backupExportTo,
  backupImportFrom,
  storageStatsFor,
  cleanupStorage,
  notificationBridge,
};
