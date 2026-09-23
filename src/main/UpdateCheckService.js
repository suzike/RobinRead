'use strict';
/**
 * RobinRead（知更）— 更新检查
 *
 * 双更新源互为兜底：官网静态托管（website/update.json）优先；
 * 官网不可达（托管冻结/欠费/被墙）时回退 GitHub Releases API。
 * 需要停用在线检查时，将 UPDATE_FEED 与 GITHUB_RELEASES_API 同时置空即可。
 */
const { app } = require('electron');

// 自建更新源（JSON: { tag_name, name, html_url, published_at, body }）。留空 = 跳过该源。
const UPDATE_FEED = 'https://ronbinread-d9gmsqi2vc0a18f04-1401273698.tcloudbaseapp.com/update.json';
// GitHub 兜底源：latest release（tag_name/assets 与官网 JSON 同形字段可映射）。
const GITHUB_RELEASES_API = 'https://api.github.com/repos/suzike/RobinRead/releases/latest';

let fetchImpl = null; // main.js 注入 net.fetch（走系统代理）；空则回退全局 fetch
function setFetch(fn) { fetchImpl = fn; }

/** 单源抓取：15s 超时，非 2xx / 解析失败一律返回 null（由调用方走下一源）。 */
async function fetchJSON(url, headers) {
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const doFetch = fetchImpl || fetch;
    const response = await doFetch(url, {
      headers: { 'User-Agent': 'RobinRead', Accept: 'application/json', ...headers },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 统一 release 形状；官网源与 GitHub 兜底源各自映射。 */
function normalizeWebsitePayload(payload) {
  if (!payload) return null;
  return {
    tagName: payload.tag_name ?? null,
    name: payload.name ?? null,
    htmlURL: payload.html_url ?? null,
    publishedAt: payload.published_at ?? null,
    body: (payload.body || '').slice(0, 2000),
  };
}

function normalizeGitHubPayload(payload) {
  if (!payload || !payload.tag_name) return null;
  return {
    tagName: payload.tag_name,
    name: payload.name ?? null,
    htmlURL: payload.html_url ?? null,
    publishedAt: payload.published_at ?? null,
    body: (payload.body || '').slice(0, 2000),
    source: 'github',
  };
}

async function fetchLatestRelease() {
  // 官网优先；失败或 payload 不完整时走 GitHub 兜底（GitHub API 直连失败即整体放弃）
  const fromSite = normalizeWebsitePayload(await fetchJSON(UPDATE_FEED));
  if (fromSite && fromSite.tagName) return fromSite;
  return normalizeGitHubPayload(await fetchJSON(GITHUB_RELEASES_API));
}

function normalizeVersion(tag) {
  return String(tag || '').replace(/^v/i, '').trim();
}

/** 解析版本号：core 为数字段，pre 为预发布段（null = 正式版）。 */
function parseVersion(tag) {
  const raw = normalizeVersion(tag);
  const dash = raw.indexOf('-');
  const core = (dash >= 0 ? raw.slice(0, dash) : raw)
    .split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pre = dash >= 0
    ? raw.slice(dash + 1).split('.').map((x) => (/^\d+$/.test(x) ? Number.parseInt(x, 10) : x))
    : null;
  return { core, pre };
}

/** 语义化比较：核心段按数值；预发布 < 正式版；预发布段数字按数值、数字段 < 字符串段、少段更小。 */
function compareVersions(a, b) {
  const len = Math.max(a.core.length, b.core.length);
  for (let i = 0; i < len; i += 1) {
    const av = a.core[i] ?? 0;
    const bv = b.core[i] ?? 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  if (a.pre === null && b.pre === null) return 0;
  if (a.pre === null) return 1;   // 1.3.0 > 1.3.0-beta.5
  if (b.pre === null) return -1;
  const plen = Math.max(a.pre.length, b.pre.length);
  for (let i = 0; i < plen; i += 1) {
    const av = a.pre[i];
    const bv = b.pre[i];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    if (av === bv) continue;
    if (typeof av === 'number' && typeof bv === 'number') return av > bv ? 1 : -1;
    if (typeof av === 'number') return -1;
    if (typeof bv === 'number') return 1;
    return av > bv ? 1 : -1;
  }
  return 0;
}

function isNewer(latest, current) {
  return compareVersions(parseVersion(latest), parseVersion(current)) > 0;
}

async function checkForUpdate(ignoredVersion) {
  const release = await fetchLatestRelease();
  if (!release || !release.tagName) return { available: false };
  const currentVersion = app.getVersion();
  const latest = normalizeVersion(release.tagName);
  if (ignoredVersion && latest === normalizeVersion(ignoredVersion)) {
    return { available: false, release };
  }
  return {
    available: isNewer(latest, currentVersion),
    currentVersion,
    release,
  };
}

module.exports = { checkForUpdate, setFetch };
