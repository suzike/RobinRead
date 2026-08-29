'use strict';
/**
 * RobinRead（知更）— Feed 抓取服务
 *
 * - ETag / If-Modified-Since 条件请求（304 短路）
 * - 标准 RSS 抓取 UA 与 Accept 头
 */
const FeedParser = require('./FeedParser');

class HTTPStatusError extends Error {
  constructor(statusCode) {
    super(`HTTP ${statusCode}`);
    this.statusCode = statusCode;
  }
}

const APP_UA = 'RobinRead/2.0 (+personal RSS reader)';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function fetchFeed(feed) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const headers = {
      'User-Agent': APP_UA,
      Accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, application/json',
    };
    if (feed.etag) headers['If-None-Match'] = feed.etag;
    if (feed.lastModified) headers['If-Modified-Since'] = feed.lastModified;

    const response = await fetch(feed.feedURL, { headers, signal: controller.signal, redirect: 'follow' });
    const etag = response.headers.get('etag');
    const lastModified = response.headers.get('last-modified');

    if (response.status === 304) {
      return { notModified: true, etag: etag ?? feed.etag, lastModified: lastModified ?? feed.lastModified };
    }
    if (response.status === 403 || response.status === 401 || response.status === 429) {
      // 部分站点（如 blogs.mathworks.com）拦截未知 UA：用浏览器 UA 重试一次
      const retry = await fetch(feed.feedURL, {
        headers: { ...headers, 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml,application/xml,*/*' },
        signal: controller.signal, redirect: 'follow',
      });
      if (!retry.ok) throw new HTTPStatusError(retry.status);
      const retryData = Buffer.from(await retry.arrayBuffer());
      const parsed2 = FeedParser.parse(retryData, feed.feedURL);
      return { notModified: false, parsed: parsed2, etag: retry.headers.get('etag'), lastModified: retry.headers.get('last-modified') };
    }
    if (!response.ok) throw new HTTPStatusError(response.status);

    const data = Buffer.from(await response.arrayBuffer());
    const parsed = FeedParser.parse(data, feed.feedURL);
    return { notModified: false, parsed, etag, lastModified };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchFeed, HTTPStatusError };
