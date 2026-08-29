'use strict';
/**
 * RobinRead（知更）— 核心数据模型与纯函数
 *
 * AIArtifact / LLMConfiguration / plainText / stableDigest 等）。
 * 持久化形态在 Persistence 层（SQLite 持久化）；
 * 本模块承载业务侧默认值、派生逻辑与校验函数。
 */
const { i18n } = require('./I18N');
const crypto = require('node:crypto');

// MARK: - FeedRefreshInterval

const FEED_REFRESH_INTERVALS = [
  { rawValue: 'manual', title: () => i18n.localized('仅手动'), seconds: null },
  { rawValue: 'thirtyMinutes', title: () => i18n.localized('每 30 分钟'), seconds: 30 * 60 },
  { rawValue: 'oneHour', title: () => i18n.localized('每小时'), seconds: 60 * 60 },
  { rawValue: 'twoHours', title: () => i18n.localized('每 2 小时'), seconds: 2 * 60 * 60 },
  { rawValue: 'fourHours', title: () => i18n.localized('每 4 小时'), seconds: 4 * 60 * 60 },
  { rawValue: 'eightHours', title: () => i18n.localized('每 8 小时'), seconds: 8 * 60 * 60 },
];

function refreshIntervalTitle(rawValue) {
  const entry = FEED_REFRESH_INTERVALS.find((item) => item.rawValue === rawValue);
  return entry ? entry.title() : rawValue;
}

function refreshIntervalSeconds(rawValue) {
  const entry = FEED_REFRESH_INTERVALS.find((item) => item.rawValue === rawValue);
  return entry ? entry.seconds : null;
}

// MARK: - AccountType

const AccountType = Object.freeze({ local: 'local', freshRSS: 'freshRSS' });
const LOCAL_ACCOUNT_ID = 'local-default';

// MARK: - TimelineScope（对应 TimelineQueryService.swift 的枚举）

// { kind: 'today', startOfDay }
// { kind: 'unread' }
// { kind: 'starred' }
// { kind: 'feed', feedID }
// { kind: 'feeds', feedIDs: [] }
// { kind: 'folder', accountID, folderName }

function scopeTitle(scope) {
  switch (scope.kind) {
    case 'today': return i18n.localized('今天');
    case 'unread': return i18n.localized('未读');
    case 'starred': return i18n.localized('星标');
    case 'feed': return null; // 由调用方补 feed 标题
    case 'feeds': return i18n.localized('订阅源');
    case 'folder': return scope.folderName;
    default: return '';
  }
}

// MARK: - AIArtifactKind

const AIArtifactKind = Object.freeze({
  translation: 'translation',
  bilingual: 'bilingual',
  summary: 'summary',
  articleContext: 'articleContext',
  selectionExplanation: 'selectionExplanation',
  interpretation: 'interpretation',
  deepRead: 'deepRead',
  richSummary: 'richSummary',
});

function artifactKindTitle(kind) {
  switch (kind) {
    case AIArtifactKind.translation: return i18n.localized('全文翻译');
    case AIArtifactKind.bilingual: return i18n.localized('上下对照');
    case AIArtifactKind.summary: return i18n.localized('AI 总结');
    case AIArtifactKind.articleContext: return i18n.localized('文章上下文缓存');
    case AIArtifactKind.selectionExplanation: return i18n.localized('选中文字解释');
    case AIArtifactKind.interpretation: return i18n.localized('旧版 AI 解读');
    default: return kind;
  }
}

// MARK: - LLMConfiguration

function defaultLLMConfiguration() {
  return {
    providerName: 'OpenAI 兼容接口',
    providerDescription: '用于翻译、总结和解读文章',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    reasoningMode: '自动',
    temperature: 0.2,
    targetLanguage: '简体中文',
    allowInsecureLocalEndpoint: false,
    showsAISummary: true,
    automaticallyGenerateSummary: false,
    showsSelectionExplanation: true,
    showsSelectionAsk: true,
    showsSelectionTranslation: true,
    customPrompt: '',
  };
}

function deepSeekLLMConfiguration() {
  return {
    ...defaultLLMConfiguration(),
    providerName: 'DeepSeek',
    providerDescription: 'DeepSeek OpenAI 兼容接口',
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    reasoningMode: '自动',
  };
}

function usesDeepSeekAPI(configuration) {
  try {
    const host = new URL(configuration.baseURL.trim()).hostname.toLowerCase();
    return host === 'api.deepseek.com';
  } catch (_) {
    return false;
  }
}

// MARK: - String 扩展（plainText / stableDigest）

/** 常用命名 HTML 实体表（补全中文排版/科技文中高频实体）。 */
const NAMED_ENTITIES = {
  nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '', zwj: '',
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  ldquo: '\u201C', rdquo: '\u201D', lsquo: '\u2018', rsquo: '\u2019',
  laquo: '\u00AB', raquo: '\u00BB', mdash: '\u2014', ndash: '\u2013', hellip: '\u2026',
  middot: '\u00B7', bull: '\u2022', dagger: '\u2020', permil: '\u2030',
  prime: '\u2032', Prime: '\u2033', deg: '\u00B0', plusmn: '\u00B1',
  times: '\u00D7', divide: '\u00F7', copy: '\u00A9', reg: '\u00AE', trade: '\u2122',
  euro: '\u20AC', pound: '\u00A3', yen: '\u00A5', cent: '\u00A2', sect: '\u00A7', para: '\u00B6',
  larr: '\u2190', rarr: '\u2192', uarr: '\u2191', darr: '\u2193', harr: '\u2194',
  ne: '\u2260', le: '\u2264', ge: '\u2265', sum: '\u2211', prod: '\u220F',
  radic: '\u221A', infin: '\u221E', alpha: '\u03B1', beta: '\u03B2', gamma: '\u03B3',
  delta: '\u03B4', pi: '\u03C0', mu: '\u03BC', lambda: '\u03BB', omega: '\u03C9',
  sigma: '\u03C3', theta: '\u03B8', phi: '\u03C6', lrm: '', rlm: '',
};

/** 解码命名 + 数字 HTML 实体（含十六进制）。正则从左到右扫描，&amp;ldquo; 只解一层（→ 字面 &ldquo;）。 */
function decodeHTMLEntities(value) {
  return String(value ?? '').replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, group) => {
    if (group[0] === '#') {
      const code = (group[1] === 'x' || group[1] === 'X')
        ? Number.parseInt(group.slice(2), 16)
        : Number.parseInt(group.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : whole;
    }
    const mapped = NAMED_ENTITIES[group];
    return mapped !== undefined ? mapped : whole;
  });
}

/** HTML 转纯文本管线。 */
function plainText(html) {
  let value = String(html ?? '');
  value = value.replace(/<(script|style|iframe|form|object|embed)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  value = value.replace(/<br\s*\/?>/gi, '\n');
  // 块级结束标签转换行，避免压缩 HTML 把整篇文章并成一个翻译单元
  value = value.replace(/<\/(p|div|h[1-6]|li|blockquote|pre|figcaption|dt|dd)>/gi, '\n\n');
  value = value.replace(/<[^>]+>/g, ' ');
  // 实体全量解码（命名 + 数字），修复 &ldquo;/&#39; 等直接显示的「实体乱码」
  value = decodeHTMLEntities(value);
  value = value.replace(/[ \t]+/g, ' ');
  value = value.replace(/\s+([,.;:!?])/g, '$1');
  value = value.replace(/[ \t]*\n[ \t]*/g, '\n');
  value = value.replace(/\n{3,}/g, '\n\n');
  return value.trim();
}

/** FNV-1a 64 位摘要（十进制字符串输出，结果稳定）。 */
function stableDigest(text) {
  const data = Buffer.from(String(text ?? ''), 'utf8');
  // BigInt 实现 64 位 FNV-1a
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask64 = 0xffffffffffffffffn;
  for (const byte of data) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString();
}

// MARK: - EntryListItem.shouldShowSummary（列表摘要显示策略，1:1 移植）

function shouldShowSummary(title, summary) {
  const normTitle = String(title ?? '').trim().replace(/\s+/g, ' ');
  const normSummary = String(summary ?? '').trim().replace(/\s+/g, ' ');

  if (!normSummary) return false;
  if (!normTitle) return true;

  // 1. 完全相同
  if (normSummary === normTitle) return false;

  // 2. 合成标题前缀截断（以 … 或 ... 结尾）
  let strippedTitle = '';
  if (normTitle.endsWith('…')) {
    strippedTitle = normTitle.slice(0, -1).trim();
  } else if (normTitle.endsWith('...')) {
    strippedTitle = normTitle.slice(0, -3).trim();
  }
  if (strippedTitle && normSummary.startsWith(strippedTitle)) return false;

  return true;
}

function entryAccountBadge(accountType, accountID, accountDisplayName) {
  if (accountType === AccountType.local || accountID === LOCAL_ACCOUNT_ID) return i18n.localized('本机');
  if (accountDisplayName && accountDisplayName.length) return accountDisplayName;
  return i18n.localized('FreshRSS');
}

/** Feed 图标地址推导，1:1 移植自 Feed.iconURL。 */
function feedIconURL(feed) {
  if (feed.storedIconURL) return feed.storedIconURL;
  let host = null;
  try {
    host = (feed.siteURL ? new URL(feed.siteURL).hostname : null)
      || (feed.feedURL ? new URL(feed.feedURL).hostname : null);
  } catch (_) { host = null; }
  if (!host) return null;
  host = host.toLowerCase();
  const path = feed.feedURL ? feed.feedURL.toLowerCase() : '';
  if (host.includes('twitter.com') || host.includes('x.com') || path.includes('/twitter/') || path.startsWith('/twitter') || path.includes('/x/')) {
    return 'https://abs.twimg.com/favicons/twitter.3.ico';
  }
  return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
}

function uuid() {
  return crypto.randomUUID();
}

function nowSeconds() {
  return Date.now() / 1000;
}

module.exports = {
  FEED_REFRESH_INTERVALS,
  refreshIntervalTitle,
  refreshIntervalSeconds,
  AccountType,
  LOCAL_ACCOUNT_ID,
  scopeTitle,
  AIArtifactKind,
  artifactKindTitle,
  defaultLLMConfiguration,
  deepSeekLLMConfiguration,
  usesDeepSeekAPI,
  plainText,
  decodeHTMLEntities,
  stableDigest,
  shouldShowSummary,
  entryAccountBadge,
  feedIconURL,
  uuid,
  nowSeconds,
};
