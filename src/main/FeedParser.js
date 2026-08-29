'use strict';
/**
 * RobinRead（知更）— Feed 解析器
 *
 * - 支持 RSS 2.0 / RDF / Atom / JSON Feed
 * - 命名空间前缀剥离（content:encoded / dc:creator）
 * - link href 解析（Atom rel="self" 排除）
 * - 首个作者/内容字段优先（first writer wins）
 */
const { plainText, decodeHTMLEntities } = require('./Models');

class FeedParserError extends Error {
  constructor(kind) {
    const messages = {
      unsupported: '此地址不是可识别的 RSS、Atom 或 JSON Feed。',
      malformed: 'Feed 内容格式不完整。',
    };
    super(messages[kind] || kind);
    this.kind = kind;
  }
}

/**
 * 按正确编码解码 Feed 字节流。
 * 优先级：BOM → XML/HTML 声明的 encoding → meta charset → UTF-8 兜底。
 * 解决 GBK/GB2312 等中文源乱码。
 */
function decodeBuffer(buf) {
  // BOM：UTF-8
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return buf.subarray(3).toString('utf8');
  }
  // BOM：UTF-16LE / UTF-16BE
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    return buf.subarray(2).toString('utf16le');
  }
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
    try { return new TextDecoder('utf-16be').decode(buf.subarray(2)); } catch (_) { /* fallthrough */ }
  }
  // 用 latin1 读头部（不破坏字节），探测 XML 声明或 meta charset
  const head = buf.subarray(0, 2048).toString('latin1');
  const m = head.match(/encoding\s*=\s*["']([^"']+)["']/i) || head.match(/charset\s*=\s*["']?([\w-]+)/i);
  if (m) {
    const enc = m[1].toLowerCase();
    if (enc !== 'utf-8' && enc !== 'utf8') {
      try { return new TextDecoder(enc).decode(buf); } catch (_) { /* 未知编码，走 UTF-8 */ }
    }
  }
  return buf.toString('utf8');
}

function parse(data, baseURL) {
  const text = Buffer.isBuffer(data) ? decodeBuffer(data) : String(data);
  const trimmed = text.replace(/^[\t\n\r ]+/, '');
  if (trimmed.startsWith('{')) {
    return parseJSON(text);
  }
  return parseXML(text, baseURL);
}

// MARK: - JSON Feed

function parseJSON(text) {
  let decoded;
  try {
    decoded = JSON.parse(text);
  } catch (_) {
    throw new FeedParserError('malformed');
  }
  if (!decoded || decoded.version === undefined) throw new FeedParserError('unsupported');

  const items = (decoded.items || []).map((item) => {
    const link = item.url || item.external_url || null;
    const body = item.content_html ?? item.content_text ?? null;
    return {
      id: item.id || link || uuidLike(),
      title: decodeHTMLEntities((item.title || '').trim()) || '未命名文章',
      author: item.authors && item.authors[0] ? item.authors[0].name : null,
      url: link,
      publishedAt: parseDate(item.date_published),
      summary: decodeHTMLEntities(item.summary || (body ? plainText(body) : '')),
      contentHTML: item.content_html ?? item.content_text ?? null,
    };
  });

  const iconURL = decoded.icon || decoded.favicon || null;
  return {
    title: decoded.title || '未命名订阅',
    siteURL: decoded.home_page_url || null,
    iconURL,
    entries: items,
  };
}

function uuidLike() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function parseDate(value) {
  if (!value) return null;
  const direct = Date.parse(value);
  if (!Number.isNaN(direct)) return direct / 1000;
  // RFC 822 兼容（"GMT" 等少见缩写）
  const cleaned = String(value).trim();
  const fallback = Date.parse(cleaned.replace(/\bUT\b$/, 'UTC').replace(/\bGMT\b$/, 'UTC'));
  if (!Number.isNaN(fallback)) return fallback / 1000;
  return null;
}

// MARK: - XML (RSS / RDF / Atom)

function localName(elementName) {
  const lower = elementName.toLowerCase();
  const idx = lower.lastIndexOf(':');
  return idx >= 0 ? lower.slice(idx + 1) : lower;
}

/**
 * 轻量 XML 标记扫描器：产生 start/text/end 事件。
 * 与 Foundation XMLParser 相同的单遍语义（不构建 DOM），
 * 支持自闭合标签与 CDATA。
 */
function tokenizeXML(xml, handlers) {
  const { onStart, onText, onEnd } = handlers;
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) {
      onText(xml.slice(i));
      break;
    }
    if (lt > i) onText(xml.slice(i, lt));
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end < 0) { onText(xml.slice(lt + 9)); break; }
      onText(xml.slice(lt + 9, end));
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<?', lt) || xml.startsWith('<!', lt)) {
      const end = xml.indexOf('>', lt);
      i = end < 0 ? n : end + 1;
      continue;
    }
    const gt = xml.indexOf('>', lt);
    if (gt < 0) break;
    let rawTag = xml.slice(lt + 1, gt);
    const isClosing = rawTag.startsWith('/');
    if (isClosing) rawTag = rawTag.slice(1);
    const isSelfClosing = rawTag.endsWith('/');
    if (isSelfClosing) rawTag = rawTag.slice(0, -1);
    const spaceMatch = rawTag.match(/^([^\s\/]+)([\s\S]*)$/);
    if (!spaceMatch) { i = gt + 1; continue; }
    const name = spaceMatch[1];
    const attrText = spaceMatch[2] || '';
    const attributes = parseAttributes(attrText);
    if (!isClosing) onStart(name, attributes);
    if (isSelfClosing) onEnd(name);
    else if (isClosing) onEnd(name);
    i = gt + 1;
  }
}

function parseAttributes(text) {
  const attrs = {};
  const re = /([^\s=\/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const name = match[1];
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (!(name in attrs)) attrs[name] = decodeXMLEntities(value);
  }
  return attrs;
}

function decodeXMLEntities(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

/**
 * 聚合站尾巴剥离 + 真实原文提取。
 * AIHOT 等聚合源的 content 形如：
 *   <p>正文摘要</p>
 *   <p>🔗 <a href="真实原文">阅读原文</a></p>
 *   <p>via AIHOT · <a href="item页">item页url</a></p>
 * 后两段是转发壳，剥掉并提取「阅读原文」链接作为真实原文（替换 SPA 中转页）。
 */
function stripAggregatorTail(html) {
  if (!html) return html;
  let cleaned = String(html);
  // 只剥离「via XXX · url」来源标注段（纯转发壳）；保留「🔗 阅读原文」链接
  // （真实原文入口，用户点它查看原文）。AIHOT 的完整内容在 item 页里（SSR 可抓），
  // 所以 url 保留 item 页、靠 extractArticle 抓取完整信息，而不是替换成真实原文。
  cleaned = cleaned.replace(/<p\b[^>]*>\s*via\s+[^<]*?<a\b[^>]*href="[^"]*"[^>]*>[^<]*<\/a>\s*<\/p>/gi, '');
  return cleaned.trim();
}

/** AIHOT / 聚合中转页判定：url 指向 SPA 中转页（正文靠 JS 渲染，抓取只能拿到空壳）。 */
function isAggregatorItemPage(url) {
  return /^https?:\/\/aihot\.virxact\.com\/items\//i.test(String(url || ''));
}

/**
 * hnrss.org 等链接聚合源的 description 是「Article URL / Comments URL / Points / # Comments」元信息，
 * 不是正文（HN 文章的正文在外部链接里）。识别并转成友好卡片：原文链接 + 评论链接 + 点数/评论数，
 * 这样抓取外部原文失败（paywall/fetch failed）时，用户仍能看到可点击的入口而非一段干巴巴的元信息。
 */
function transformAggregatorMeta(html) {
  const s = String(html || '');
  if (!/Article URL:/.test(s) || !/Comments URL:/.test(s)) return null;
  const pick = (re) => { const m = s.match(re); return m ? m[1].trim() : null; };
  const articleURL = pick(/Article URL:\s*(\S+)/);
  const commentsURL = pick(/Comments URL:\s*(\S+)/);
  const points = pick(/Points:\s*(\d+)/);
  const comments = pick(/# Comments:\s*(\d+)/);
  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let htmlOut = '';
  if (articleURL) htmlOut += `<p><a href="${esc(articleURL)}">阅读原文 →</a></p>`;
  if (commentsURL) htmlOut += `<p><a href="${esc(commentsURL)}">💬 在 Hacker News 讨论${comments != null ? `（${esc(comments)} 条评论）` : ''} →</a></p>`;
  const metaParts = [points != null ? `${esc(points)} points` : null, comments != null ? `${esc(comments)} comments` : null].filter(Boolean);
  if (metaParts.length) htmlOut += `<p>${metaParts.join(' · ')}</p>`;
  return {
    html: htmlOut || null,
    summary: metaParts.join(' · ') || articleURL || '',
  };
}

function parseXML(xml, baseURL) {
  let root = '';
  let currentText = '';
  let feedTitle = '';
  let feedLink = null;
  let feedIconURL = null;
  let inImageTag = false;
  let currentItem = null;
  let currentItemLink = null;
  const entries = [];

  function resolveURL(href) {
    if (!href) return null;
    try {
      return new URL(href, baseURL || undefined).toString();
    } catch (_) {
      return null;
    }
  }

  tokenizeXML(xml, {
    onStart(name, attributes) {
      const local = localName(name);
      currentText = '';
      if (!root) root = local;
      if (local === 'image') inImageTag = true;
      if (local === 'item' || local === 'entry') {
        currentItem = {};
        currentItemLink = null;
      }
      if (local === 'link') {
        const href = attributes.href ?? attributes.url;
        const resolved = href ? resolveURL(decodeXMLEntities(href)) : null;
        if (resolved) {
          if (currentItem != null) {
            currentItemLink = resolved;
          } else if ((attributes.rel || '').toLowerCase() !== 'self') {
            // Atom rel="self" 指回 feed 端点而非站点首页
            feedLink = resolved;
          }
        }
      }
    },
    onText(text) {
      currentText += text;
    },
    onEnd(name) {
      const local = localName(name);
      const text = currentText.trim();
      if (currentItem != null) {
        switch (local) {
          case 'title': case 'id': case 'guid': case 'author': case 'name':
          case 'creator': case 'summary': case 'description': case 'content':
          case 'encoded': case 'pubdate': case 'published': case 'updated': case 'link': {
            if (text) {
              let key = local;
              if (local === 'encoded') key = 'content';
              else if (local === 'creator') key = 'author'; // RSS 2.0 <dc:creator>
              else if (local === 'name' && currentItem.author == null) key = 'author';
              // 首个写入者胜出，避免 media:content 等模块元素覆盖真实正文
              if (currentItem[key] == null) currentItem[key] = text;
            }
            break;
          }
          default: break;
        }
      } else {
        if (local === 'title' && text) {
          feedTitle = text;
        } else if ((local === 'icon' || local === 'logo' || (local === 'url' && inImageTag)) && text && !feedIconURL) {
          feedIconURL = resolveURL(text);
        }
        if (local === 'image') inImageTag = false;
      }

      if ((local === 'item' || local === 'entry') && currentItem != null) {
        // RSS 2.0 <link>text</link> 是文本形式，tokenizeXML 对文本不做实体解码——
        // 微信/公众号等 feed 的 <link> 含 &amp;，不解码会让 mp.weixin.qq.com 的
        // mid/idx/sn 参数丢失（跳转到微信首页而非原文）。此处统一补一次实体解码。
        const linkString = currentItemLink ?? (currentItem.link ? resolveURL(decodeXMLEntities(currentItem.link)) : null);
        const body = currentItem.content ?? currentItem.summary ?? currentItem.description ?? null;
        const stable = currentItem.guid ?? currentItem.id ?? linkString
          ?? `${currentItem.title || ''}|${currentItem.published ?? currentItem.pubdate ?? uuidLike()}`;
        // AIHOT 聚合站：剥「via」转发壳，但 url 保留 item 页（item 页可 SSR 完整内容，
        // 打开时由 extractArticle 抓取完整信息）；content 里保留「🔗 阅读原文」真实原文入口
        let entryURL = linkString;
        let entryContent = body;
        if (isAggregatorItemPage(entryURL) && entryContent) {
          entryContent = stripAggregatorTail(entryContent);
        }
        // hnrss 等链接聚合源：description 是元信息非正文 → 转友好卡片 + 短摘要
        let entrySummary = plainText(currentItem.summary ?? currentItem.description ?? body ?? '');
        if (entryContent) {
          const meta = transformAggregatorMeta(entryContent);
          if (meta) {
            entryContent = meta.html || entryContent;
            entrySummary = meta.summary;
          }
        }
        entries.push({
          id: stable,
          title: decodeHTMLEntities(currentItem.title || '') || '未命名文章',
          author: currentItem.author ?? null,
          url: entryURL,
          publishedAt: parseDate(currentItem.published ?? currentItem.updated ?? currentItem.pubdate),
          summary: entrySummary,
          contentHTML: entryContent,
        });
        currentItem = null;
        currentItemLink = null;
      }
      currentText = '';
    },
  });

  if (!(root === 'rss' || root === 'feed' || root === 'rdf' || entries.length > 0)) {
    throw new FeedParserError('unsupported');
  }

  let siteURL = feedLink;
  if (!siteURL) {
    const firstLink = entries.map((e) => e.url).find((u) => u);
    if (firstLink) {
      try {
        const parsed = new URL(firstLink);
        siteURL = `${parsed.protocol}//${parsed.host}/`;
      } catch (_) { siteURL = null; }
    }
  }

  return {
    title: feedTitle || '未命名订阅',
    siteURL,
    iconURL: feedIconURL,
    entries,
  };
}

module.exports = { parse, parseDate, FeedParserError, tokenizeXML, decodeXMLEntities, stripAggregatorTail, isAggregatorItemPage, transformAggregatorMeta };
