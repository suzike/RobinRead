'use strict';
/**
 * RobinRead（知更）— Feed 抓取服务
 *
 * - 抓取走 Electron net.fetch（Chromium 网络栈 = 系统代理）：被墙源（公众号桥、
 *   境外源）在用户开启系统代理时即可达；纯 node 环境（探针）回退全局 fetch
 * - ETag / If-Modified-Since 条件请求（304 短路）；force 模式跳过条件头强制全量
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

let netFetchImpl = null;
/** 注入 Electron net.fetch（main.js 启动时调用），抓取改走系统代理。 */
function useNetFetch(fn) { netFetchImpl = fn; }

/** 统一 HTTP GET：Electron 主进程走 net.fetch，纯 node 回退全局 fetch。 */
async function httpFetch(url, { headers, signal } = {}) {
  if (netFetchImpl) {
    const response = await netFetchImpl(url, { method: 'GET', headers, signal, redirect: 'follow' });
    return { status: response.status, headers: response.headers, buf: Buffer.from(await response.arrayBuffer()) };
  }
  const res = await fetch(url, { headers, signal, redirect: 'follow' });
  return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
}

async function fetchFeed(feed, { force = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const headers = {
      'User-Agent': APP_UA,
      Accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, application/json',
    };
    // 手动刷新（force）跳过条件请求：防 CDN/桥接缓存错误 304 导致「有新文章刷不出来」
    if (!force) {
      if (feed.etag) headers['If-None-Match'] = feed.etag;
      if (feed.lastModified) headers['If-Modified-Since'] = feed.lastModified;
    }

    let { status, headers: respHeaders, buf } = await httpFetch(feed.feedURL, { headers, signal: controller.signal });

    if (status === 304) {
      return { notModified: true, etag: respHeaders.get('etag') ?? feed.etag, lastModified: respHeaders.get('last-modified') ?? feed.lastModified };
    }
    if (status === 429) throw new HTTPStatusError(429); // 被限流时换 UA 重试只会加重
    if (status === 403 || status === 401) {
      // 部分站点（如 blogs.mathworks.com）拦截未知 UA：用浏览器 UA 重试一次
      const retry = await httpFetch(feed.feedURL, {
        headers: { ...headers, 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml,application/xml,*/*' },
        signal: controller.signal,
      });
      if (retry.status >= 400 || retry.buf.length === 0) throw new HTTPStatusError(retry.status || 502);
      status = retry.status;
      buf = retry.buf;
      respHeaders = retry.headers;
    }
    if (status >= 400 || buf.length === 0) {
      // 重试后仍未成功时保持原状态码语义
      if (status >= 400) throw new HTTPStatusError(status);
      throw new HTTPStatusError(0);
    }

    const parsed = FeedParser.parse(buf, feed.feedURL);
    return { notModified: false, parsed, etag: respHeaders.get('etag'), lastModified: respHeaders.get('last-modified') };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchFeed, HTTPStatusError, useNetFetch };
