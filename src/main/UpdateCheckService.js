'use strict';
/**
 * RobinRead（知更）— 更新检查
 *
 * 更新源托管在官网静态托管（website/update.json，随发版更新）。
 * 需要停用在线检查时，将 UPDATE_FEED 置空即可。
 */
const { app } = require('electron');

// 自建更新源（JSON: { tag_name, name, html_url, published_at, body }）。
// 留空 = 禁用在线更新检查。
const UPDATE_FEED = 'https://ronbinread-d9gmsqi2vc0a18f04-1401273698.tcloudbaseapp.com/update.json';

async function fetchLatestRelease() {
  if (!UPDATE_FEED) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(UPDATE_FEED, {
      headers: { 'User-Agent': 'RobinRead', Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return {
      tagName: payload.tag_name ?? null,
      name: payload.name ?? null,
      htmlURL: payload.html_url ?? null,
      publishedAt: payload.published_at ?? null,
      body: (payload.body || '').slice(0, 2000),
    };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
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

module.exports = { checkForUpdate };
