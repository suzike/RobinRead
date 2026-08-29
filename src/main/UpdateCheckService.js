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

function isNewer(latest, current) {
  const a = normalizeVersion(latest).split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const b = normalizeVersion(current).split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av > bv;
  }
  return false;
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
