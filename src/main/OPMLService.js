'use strict';
/**
 * RobinRead（知更）— OPML 导入导出
 *
 * - 导入：遍历 outline 的 xmlUrl 属性，去重排序
 * - 导出：opml 2.0，text/title/type=rss/xmlUrl/htmlUrl
 */
const { tokenizeXML } = require('./FeedParser');

function importURLs(data) {
  const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
  const urls = new Set();

  tokenizeXML(text, {
    onStart(name, attributes) {
      if (name.toLowerCase() !== 'outline') return;
      const value = attributes.xmlUrl ?? attributes.xmlurl;
      if (!value) return;
      const trimmed = value.trim();
      if (/^https?:\/\//i.test(trimmed)) urls.add(trimmed);
    },
    onText() {},
    onEnd() {},
  });

  return [...urls].sort();
}

function exportOPML(feeds) {
  const outlines = feeds
    .filter((feed) => !feed.isDeleted)
    .map((feed) => {
      const title = escapeXML(feed.title);
      const url = escapeXML(feed.feedURL);
      const site = feed.siteURL ? ` htmlUrl="${escapeXML(feed.siteURL)}"` : '';
      return `    <outline text="${title}" title="${title}" type="rss" xmlUrl="${url}"${site} />`;
    });
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>RobinRead subscriptions</title></head>
  <body>
${outlines.join('\n')}
  </body>
</opml>
`;
}

function escapeXML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

module.exports = { importURLs, exportOPML };
