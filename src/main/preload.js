'use strict';
/**
 * RobinRead Windows — Preload 桥
 *
 * 以白名单形式向渲染进程暴露类型化 API（contextIsolation 开启）。
 */
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

/** 解包 {ok, data} → 直接返回 data（失败时返回 undefined）。用于 kb/evo 等「数据即返回值」的方法。 */
const data = (channel, ...args) => invoke(channel, ...args).then((r) => (r && r.ok ? r.data : undefined));

contextBridge.exposeInMainWorld('robin', {
  // 状态
  getState: () => invoke('app:state'),
  getSidebar: () => invoke('app:sidebar'),
  getSyncStates: () => invoke('app:syncStates'),
  getList: (scope, options) => invoke('app:list', scope, options),
  getReader: (entryID) => invoke('app:reader', entryID),
  getEntry: (entryID) => invoke('app:entry', entryID),
  getAdjacent: (scope, entryID, direction) => invoke('app:adjacent', scope, entryID, direction),

  // Feeds / 文件夹
  addFeed: (url, folder) => invoke('feeds:add', url, folder),
  deleteFeeds: (ids) => invoke('feeds:delete', ids),
  setFeedFolder: (ids, folder) => invoke('feeds:setFolder', ids, folder),
  reorderFeeds: (orderedIDs) => invoke('feeds:reorder', orderedIDs),
  addFolder: (name) => invoke('folders:add', name),
  renameFolder: (folderID, name) => invoke('folders:rename', folderID, name),
  deleteFolder: (folderID) => invoke('folders:delete', folderID),

  // OPML
  importOPML: () => invoke('opml:import'),
  exportOPML: () => invoke('opml:export'),

  // 刷新
  refresh: () => invoke('refresh:run'),
  refreshFeed: (feedID) => invoke('refresh:feed', feedID),
  search: (query, options) => invoke('app:search', query, options),
  generateDigest: () => invoke('ai:digest'),
  cachedDigest: () => invoke('ai:digestCache'),

  // 阅读状态
  markRead: (entryID, read) => invoke('read:mark', entryID, read),
  toggleStar: (entryID) => invoke('read:toggleStar', entryID),
  markAllRead: (scope) => invoke('read:markAll', scope),

  // 正文提取
  extractArticle: (entryID) => invoke('extract:run', entryID),

  // 账户
  addFreshRSSAccount: (payload) => invoke('accounts:addFreshRSS', payload),
  validateFreshRSS: (payload) => invoke('accounts:validate', payload),
  removeAccount: (accountID) => invoke('accounts:remove', accountID),
  setAccountEnabled: (accountID, enabled) => invoke('accounts:setEnabled', accountID, enabled),
  syncAccount: (accountID) => invoke('accounts:sync', accountID),

  // AI
  generateSummary: (entryID) => invoke('ai:generateSummary', entryID),
  deepRead: (entryID) => invoke('ai:deepRead', entryID),
  richSummary: (entryID) => invoke('ai:richSummary', entryID),
  existingWork: (entryID, kind) => invoke('ai:existingWork', entryID, kind),
  explainSelection: (payload) => invoke('ai:explain', payload),
  askSelection: (payload) => invoke('ai:ask', payload),
  translateSelection: (payload) => invoke('ai:translateSelection', payload),
  translateParagraphs: (entryID, html, paragraphIDs) => invoke('ai:translateParagraphs', entryID, html, paragraphIDs),
  cachedBilingual: (entryID, html) => invoke('ai:cachedBilingual', entryID, html),
  annotations: (entryID) => invoke('ai:annotations', entryID),
  cancelAI: (key) => invoke('ai:cancel', key),
  testAI: () => invoke('ai:test'),

  // 偏好
  setTheme: (theme) => invoke('prefs:setTheme', theme),
  setFontSize: (size) => invoke('prefs:setFontSize', size),
  setLanguage: (language) => invoke('prefs:setLanguage', language),
  setRefreshInterval: (raw) => invoke('prefs:setRefreshInterval', raw),
  setRefreshOnLaunch: (enabled) => invoke('prefs:setRefreshOnLaunch', enabled),
  setLLM: (patch) => invoke('prefs:setLLM', patch),
  setAPIKey: (key) => invoke('prefs:setAPIKey', key),
  llmProviders: () => data('llm:providers'),
  llmAddProvider: (payload) => invoke('llm:addProvider', payload),
  llmUpdateProvider: (id, patch) => invoke('llm:updateProvider', id, patch),
  llmRemoveProvider: (id) => invoke('llm:removeProvider', id),
  llmSetActive: (id) => invoke('llm:setActive', id),
  setColumnWidths: (payload) => invoke('prefs:setColumnWidths', payload),
  setThemeTokens: (tokens) => invoke('prefs:setThemeTokens', tokens),
  setReaderLayout: (patch) => invoke('prefs:setReaderLayout', patch),
  setFilterRules: (patch) => invoke('prefs:setFilterRules', patch),
  clearThemeTokens: () => invoke('prefs:clearThemeTokens'),

  // 账号与会员（账号密码登录 / 会员状态 / AI 额度 / 订单）
  accountConfig: () => data('account:config'),
  accountLoginWechat: () => invoke('account:loginWechat'),
  accountLoginDev: (nickname) => invoke('account:loginDev', nickname),
  accountRegister: (username, password, nickname) => invoke('account:register', username, password, nickname),
  accountLoginPassword: (username, password) => invoke('account:loginPassword', username, password),
  accountRedeem: (code) => invoke('account:redeem', code),
  accountLogout: () => invoke('account:logout'),
  accountMe: (force) => invoke('account:me', force),
  accountConsumeAIQuota: () => invoke('account:consumeAIQuota'),
  accountUpdateProfile: (patch) => invoke('account:updateProfile', patch),
  accountPickAvatar: () => invoke('account:pickAvatar'),
  payCreateOrder: (plan) => invoke('pay:createOrder', plan),
  payQueryOrder: (outTradeNo) => invoke('pay:queryOrder', outTradeNo),
  onAccountChanged: (listener) => subscribe('account:changed', listener),

  // 更新
  checkUpdate: () => invoke('update:check'),
  ignoreVersion: (version) => invoke('update:ignoreVersion', version),

  // 事件订阅
  onStateChanged: (listener) => subscribe('state:changed', listener),
  onAIDelta: (listener) => subscribe('ai:delta', listener),
  onAIStatus: (listener) => subscribe('ai:status', listener),
  onSelectionDelta: (listener) => subscribe('ai:selection-delta', listener),
  onDigestDelta: (listener) => subscribe('ai:digest-delta', listener),
  onMenu: (channel, listener) => subscribe(channel, listener),
  onThemeChanged: (listener) => subscribe('theme:changed', listener),

  // 阅读器 iframe 内链接转发
  openLink: (url) => ipcRenderer.send('reader:openLink', url),

  // 知识引擎（读操作直接解包 data，写操作保留 {ok,data} 语义）
  kbHighlights: (itemID) => data('kb:highlights', itemID),
  kbAllHighlights: () => data('kb:allHighlights'),
  kbAddHighlight: (payload) => invoke('kb:addHighlight', payload),
  kbRemoveHighlight: (id) => invoke('kb:removeHighlight', id),
  kbUpdateHighlight: (id, patch) => invoke('kb:updateHighlight', id, patch),
  kbNotes: (itemID) => data('kb:notes', itemID),
  kbAddNote: (payload) => invoke('kb:addNote', payload),
  kbUpdateNote: (id, patch) => invoke('kb:updateNote', id, patch),
  kbDeleteNote: (id) => invoke('kb:deleteNote', id),
  kbDueReviews: () => data('kb:dueReviews'),
  kbReview: (id, quality) => data('kb:review', id, quality),
  kbAddToReview: (payload) => invoke('kb:addToReview', payload),
  kbRemoveFromReview: (id) => invoke('kb:removeFromReview', id),
  kbTags: (itemID) => data('kb:tags', itemID),
  kbEntriesForTag: (tag, limit) => data('kb:entriesForTag', tag, limit),
  kbAddTag: (itemID, tag) => invoke('kb:addTag', itemID, tag),
  kbRemoveTag: (itemID, tag) => invoke('kb:removeTag', itemID, tag),
  kbStats: (days) => data('kb:stats', days),
  kbCollections: () => data('kb:collections'),
  kbCreateCollection: (name, desc) => invoke('kb:createCollection', name, desc),
  kbUpdateCollection: (id, patch) => invoke('kb:updateCollection', id, patch),
  kbCollectionItems: (colID) => data('kb:collectionItems', colID),
  kbAddToCollection: (colID, itemID) => invoke('kb:addToCollection', colID, itemID),
  kbRemoveFromCollection: (colID, itemID) => invoke('kb:removeFromCollection', colID, itemID),
  kbDeleteCollection: (id) => invoke('kb:deleteCollection', id),
  kbSmartFolders: () => data('kb:smartFolders'),
  kbCreateSmartFolder: (name, query) => invoke('kb:createSmartFolder', name, query),
  kbDeleteSmartFolder: (id) => invoke('kb:deleteSmartFolder', id),
  kbRelated: (itemID) => data('kb:related', itemID),
  kbExportMarkdown: (itemID) => data('kb:exportMarkdown', itemID),
  kbExportNotes: () => data('kb:exportNotes'),
  kbDailyReview: (dateStr) => data('kb:dailyReview', dateStr),
  kbExportAnki: () => data('kb:exportAnki'),
  kbSearchKnowledge: (query, options) => data('kb:searchKnowledge', query, options),
  kbHeatmap: (days) => data('kb:heatmap', days),
  kbDashboard: () => data('kb:dashboard'),
  kbExportJSON: () => data('kb:exportJSON'),
  kbExportHTML: () => data('kb:exportHTML'),
  kbRefreshLinks: (noteID) => data('kb:refreshLinks', noteID),
  kbBacklinks: (noteID) => data('kb:backlinks', noteID),

  // 自进化引擎
  evoHealth: () => data('evo:health'),
  evoDeadFeeds: () => data('evo:deadFeeds'),
  evoProfile: () => data('evo:profile'),
  evoRecommend: (limit) => data('evo:recommend', limit),
  evoFeedback: (payload) => invoke('evo:feedback', payload),
  evoFeedbackSummary: () => data('evo:feedbackSummary'),
  evoDiagnose: () => data('evo:diagnose'),
  evoDensityByFeed: (days) => data('evo:densityByFeed', days),
  evoDensityByDay: (days) => data('evo:densityByDay', days),

  // 信息维度
  fullTextSearch: (query, options) => data('app:fullTextSearch', query, options),

  // AIHOT（热点榜 / 故事时间线 / 精选 / 日报 / 本地状态 / AI 深读）
  aihotHotTopics: () => data('aihot:hotTopics'),
  aihotStory: (publicId) => data('aihot:story', publicId),
  aihotSelected: (limit) => data('aihot:selected', limit),
  aihotDaily: () => data('aihot:daily'),
  aihotDailyIndex: (limit) => data('aihot:dailyIndex', limit),
  aihotDailyByDate: (date) => data('aihot:dailyByDate', date),
  aihotItems: (opts) => data('aihot:items', opts),
  aihotSelectedPage: (opts) => data('aihot:selectedPage', opts),
  aihotLeaderboard: () => data('aihot:leaderboard'),
  aihotExtractURL: (url) => data('aihot:extractURL', url),
  aihotSnapshot: () => data('aihot:snapshot'),
  aihotToggleFavorite: (item) => invoke('aihot:toggleFavorite', item),
  aihotMarkRead: (ids) => invoke('aihot:markRead', ids),
  aihotSetKeywords: (kw) => invoke('aihot:setKeywords', kw),
  aihotDeepRead: (payload) => invoke('aihot:deepRead', payload),
  copyText: (text) => invoke('app:copyText', text),
  pickSavePath: (defaultName) => invoke('app:pickSavePath', { defaultName }),
  writeTextFile: (filePath, content) => invoke('app:writeTextFile', { filePath, content }),

  // 无边框窗口控制
  winMinimize: () => ipcRenderer.send('window:minimize'),
  winToggleMaximize: () => ipcRenderer.send('window:maximize'),
  winClose: () => ipcRenderer.send('window:close'),
  winIsMaximized: () => invoke('window:isMaximized'),
  onWindowMaxChanged: (listener) => subscribe('window:maximized-changed', listener),
});

function subscribe(channel, listener) {
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}
