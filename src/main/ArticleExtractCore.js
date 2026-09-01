'use strict';
/**
 * RobinRead（知更）— 网页正文提取与 HTML 消毒（共享核心逻辑）
 *
 * 纯 Node 模块：不 require electron（app/BrowserWindow 等），因此可以同时运行在：
 *   - Electron 主进程（sanitizedHTML / readerParagraphs 等同步导出，RSS 正文路径）
 *   - utilityProcess 工作进程（src/main/workers/extractor-worker.js，extract 全流程）
 * 依赖链（Models → I18N → I18NStrings）也全部是纯 Node。
 *
 * - 噪音块剥离（作者卡/评论区/分享栏…）
 * - 容器启发式（article-body/post-content/entry-content/… > article > main > body）
 * - 双引擎：Mozilla Readability 通用提取优先，容器启发式 fallback
 * - 白名单标签重建式消毒（不允许任何事件属性/可执行 URL 进入渲染器）
 * - readerParagraphs / insertingInlineTranslations（翻译轨道的稳定段落 ID）
 */
const { plainText } = require('./Models');

const NOISE_KEYWORDS = [
  'author-popover', 'author-item', 'author__info', 'author__bio',
  'article__header__author', 'article-header-author', 'author-card', 'author-box', 'user-card',
  'article__charge', 'post__comments', 'comment-box', 'comment-list',
  'share-bar', 'social-share', 'action-bar', 'phoneBindDialog', 'dialog-title',
  'comp__Directory', 'directory__overlay',
];

function stripNoiseBlocks(html) {
  let current = html;
  const keywordPattern = NOISE_KEYWORDS.join('|');
  const pattern = new RegExp(
    `<(div|section|aside|form|ul|ol|blockquote|button)\\b[^>]*?\\b(?:class|id|data-[a-z-]+)\\s*=\\s*["'][^"']*?\\b(?:${keywordPattern})\\b[^"']*?["'][^>]*?>[\\s\\S]*?<\\/\\1>`,
    'gi'
  );
  for (let i = 0; i < 3; i += 1) {
    const updated = current.replace(pattern, '');
    if (updated.length === current.length) break;
    current = updated;
  }
  return current;
}

function stripExecutableBlocks(html) {
  return html
    .replace(/<(script|style|noscript|svg|canvas|iframe|form|object|embed|meta|link|base|template|nav|footer|aside)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(script|style|noscript|svg|canvas|iframe|form|object|embed|meta|link|base|template|nav|footer|aside)\b[^>]*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

const CONTAINER_PATTERNS = [
  /<(div|article|section)\b[^>]*?\bclass\s*=\s*["'][^"']*?\b(?:article-body|post-content|entry-content|article-content|ss-article-content|markdown-body|content)\b[^"']*?["'][^>]*?>([\s\S]*?)<\/\1>/gi,
  /<article[^>]*>([\s\S]*?)<\/article>/gi,
  /<main[^>]*>([\s\S]*?)<\/main>/gi,
  /<body[^>]*>([\s\S]*?)<\/body>/gi,
];

function imageURLsFrom(html, baseURL) {
  const pattern = /<img\b[^>]*?\b(?:src|data-src|data-original|data-lazy-src)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi;
  const seen = new Set();
  const result = [];
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const source = (match[1] ?? match[2] ?? match[3] ?? '').replace(/&amp;/g, '&');
    const url = safeRemoteURL(source, baseURL);
    if (!url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    result.push(url);
  }
  return result;
}

function content(html, baseURL) {
  const cleaned = stripNoiseBlocks(stripExecutableBlocks(html));

  for (const pattern of CONTAINER_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(cleaned)) !== null) {
      const fragment = match[0];
      const safeHTML = sanitizedHTML(fragment, baseURL);
      const text = plainText(safeHTML);
      if (text.length >= 120) {
        return { text, html: safeHTML, imageURLs: imageURLsFrom(safeHTML, baseURL) };
      }
    }
  }
  const safeHTML = sanitizedHTML(cleaned, baseURL);
  return { text: plainText(safeHTML), html: safeHTML, imageURLs: imageURLsFrom(safeHTML, baseURL) };
}

// Mozilla Readability 懒加载（重依赖 jsdom，仅在抓取网页时 require，避免拖慢启动）
let _readability = null;
function getReadability() {
  if (_readability) return _readability;
  const { Readability } = require('@mozilla/readability');
  const { JSDOM } = require('jsdom');
  _readability = { Readability, JSDOM };
  return _readability;
}

/**
 * Readability 通用正文提取：Firefox 阅读模式的核心算法，基于文本密度/链接密度启发式，
 * 从任意完整网页提取正文，剥离导航、广告、页眉页脚、元信息——不依赖站点特判。
 * 这是对「容器启发式只认 article-body/post-content 等 class」的通用化补充。
 */
function readabilityContent(html, baseURL = null) {
  try {
    const { Readability, JSDOM } = getReadability();
    const doc = new JSDOM(String(html || ''), { url: baseURL || 'https://example.com' });
    const article = new Readability(doc.window.document).parse();
    if (!article || !article.content) return { text: '', html: '', imageURLs: [] };
    // Readability 已剥离 script/style 等，再过一遍白名单消毒保证绝对安全
    const safeHTML = sanitizedHTML(article.content, baseURL);
    return {
      text: plainText(safeHTML),
      html: safeHTML,
      imageURLs: imageURLsFrom(safeHTML, baseURL),
      title: article.title || '',
    };
  } catch (_) {
    return { text: '', html: '', imageURLs: [] };
  }
}

const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'del', 'mark', 'small', 'sub', 'sup',
  'blockquote', 'pre', 'code', 'kbd', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'figure', 'figcaption', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'img', 'a', 'video', 'source', 'audio', 'picture',
]);
const VOID_TAGS = new Set(['br', 'hr', 'img', 'source']);

/** X/Twitter 头像图地址（发推者头像，非正文内容，上游 3f27e8d 同款过滤）。 */
const TWITTER_AVATAR_PATTERN = /pbs\.twimg\.com\/profile_images\//i;

/** 懒加载真图属性（现代博客 src 常是 1x1 占位，真实地址在 data-* 上）。 */
const LAZY_SRC_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-lazyload', 'data-actualsrc'];

/** 该 <img> 的 src / 懒加载属性是否指向 X/Twitter 头像（profile_images）。 */
function isTwitterAvatarTag(rawAttributes) {
  const attrPattern = /(?:^|\s)(src|data-src|data-original|data-lazy-src|data-lazyload|data-actualsrc)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gis;
  let match;
  while ((match = attrPattern.exec(String(rawAttributes || ''))) !== null) {
    const value = htmlEntityDecoded(match[2] ?? match[3] ?? match[4] ?? '');
    if (TWITTER_AVATAR_PATTERN.test(value)) return true;
  }
  return false;
}

function sanitizedHTML(html, baseURL = null) {
  const stripped = stripNoiseBlocks(html);
  const withoutExecutable = stripExecutableBlocks(stripped)
    .replace(/<!--[\s\S]*?-->/g, '');

  const tagPattern = /<\/?([a-z][a-z0-9]*)\b([^>]*)>/gis;
  let result = '';
  let cursor = 0;
  let imageIndex = 0;
  let match;

  while ((match = tagPattern.exec(withoutExecutable)) !== null) {
    const [fullTag, rawName, rawAttributes] = match;
    result += withoutExecutable.slice(cursor, match.index);
    cursor = match.index + fullTag.length;

    const name = rawName.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) continue;
    const isClosingTag = fullTag.slice(1).trim().startsWith('/');
    if (isClosingTag) {
      if (!VOID_TAGS.has(name)) result += `</${name}>`;
    } else {
      // X/Twitter 正文头像过滤：profile_images 是发推者头像而非内容图，整标签剔除
      if (name === 'img' && isTwitterAvatarTag(rawAttributes)) continue;
      const eagerImage = name === 'img' && imageIndex < 8;
      if (name === 'img') imageIndex += 1;
      result += `<${name}${sanitizedAttributes(rawAttributes, name, baseURL, eagerImage)}>`;
    }
  }
  result += withoutExecutable.slice(cursor);
  return wrappingTopLevelTextRuns(result.trim());
}

const BLOCK_TAGS = new Set([
  'p', 'div', 'li', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'figcaption', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'ul', 'ol', 'hr',
]);

/** 将顶层裸文本包裹进 <p>（RSSHub Twitter 正文等场景。 */
function wrappingTopLevelTextRuns(html) {
  const tagPattern = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gis;
  let output = '';
  const stack = [];
  let loose = '';
  let cursor = 0;
  let match;

  function flush() {
    const trimmed = loose.trim();
    if (!trimmed || !plainText(trimmed)) {
      output += loose;
    } else {
      output += `<p>${trimmed}</p>`;
    }
    loose = '';
  }

  while ((match = tagPattern.exec(html)) !== null) {
    const [tag, rawName] = match;
    const name = rawName.toLowerCase();
    const segment = html.slice(cursor, match.index);
    if (stack.length === 0) loose += segment;
    else output += segment;
    cursor = match.index + tag.length;

    const isClosing = tag.slice(1).trim().startsWith('/');
    if (isClosing) {
      if (stack.length === 0 && !VOID_TAGS.has(name)) {
        loose += tag;
      } else {
        output += tag;
      }
      if (stack.length > 0 && stack[stack.length - 1] === name) {
        stack.pop();
        flush();
      }
    } else if (BLOCK_TAGS.has(name)) {
      flush();
      output += tag;
      if (!VOID_TAGS.has(name)) stack.push(name);
    } else if (stack.length === 0) {
      loose += tag;
    } else {
      output += tag;
    }
  }
  if (stack.length === 0) loose += html.slice(cursor);
  else output += html.slice(cursor);
  flush();
  return output;
}

const ATTRIBUTES_FOR_TAG = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'title', 'width', 'height', 'srcset']),
  video: new Set(['src', 'poster', 'controls', 'autoplay', 'loop', 'muted', 'playsinline', 'webkit-playsinline', 'allowfullscreen', 'preload', 'width', 'height']),
  source: new Set(['src', 'type', 'srcset', 'media']),
  audio: new Set(['src', 'controls', 'autoplay', 'loop', 'muted', 'preload']),
  th: new Set(['colspan', 'rowspan']),
  td: new Set(['colspan', 'rowspan']),
};

/** srcset 逐候选 URL 解析为绝对地址；全部解析失败返回 null。 */
function sanitizeSrcset(value, baseURL) {
  const parts = String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const part of parts) {
    const seg = part.split(/\s+/);
    const resolved = safeRemoteURL(seg[0], baseURL);
    if (!resolved) continue;
    out.push([resolved, ...seg.slice(1)].join(' '));
  }
  return out.length ? out.join(', ') : null;
}

function sanitizedAttributes(source, tag, baseURL, eagerImage = false) {
  const allowed = ATTRIBUTES_FOR_TAG[tag];
  if (!allowed) return '';
  const pattern = /([a-z][a-z0-9:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gis;
  const attributes = [];
  const seenNames = new Set();
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const name = match[1].toLowerCase();
    if (!allowed.has(name) || seenNames.has(name)) continue;
    seenNames.add(name);
    const value = match[2] ?? match[3] ?? match[4] ?? null;
    if (value != null) {
      let cleaned = value.trim();
      if (name === 'href' || name === 'src' || name === 'poster') {
        const resolved = safeRemoteURL(cleaned, baseURL);
        if (!resolved) continue;
        cleaned = resolved;
      } else if (['width', 'height', 'colspan', 'rowspan'].includes(name)) {
        const number = Number.parseInt(cleaned, 10);
        if (!(number > 0 && number <= 10000)) continue;
        cleaned = String(number);
      }
      attributes.push(` ${name}="${escapeAttribute(cleaned)}"`);
    } else {
      attributes.push(` ${name}`);
    }
  }
  if (tag === 'img') {
    // 懒加载治理：src 缺失或是占位时，用 data-* 真图地址替换
    const srcAttr = attributes.find((a) => a.startsWith(' src="'));
    const hasRealSrc = srcAttr && !/\/(pixel|spacer|blank)\b|1x1/i.test(srcAttr);
    if (!hasRealSrc) {
      for (const lazy of LAZY_SRC_ATTRS) {
        const raw = /([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(source);
        void raw;
        const m = new RegExp(lazy + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(source);
        if (m) {
          const resolved = safeRemoteURL(m[1] ?? m[2] ?? m[3] ?? '', baseURL);
          if (resolved) {
            if (srcAttr) attributes.splice(attributes.indexOf(srcAttr), 1, ` src="${escapeAttribute(resolved)}"`);
            else attributes.push(` src="${escapeAttribute(resolved)}"`);
            break;
          }
        }
      }
    }
    attributes.push(` loading="${eagerImage ? 'eager' : 'lazy'}"`);
    attributes.push(' decoding="async"');
    attributes.push(' referrerpolicy="no-referrer"');
  } else if (tag === 'video') {
    if (!seenNames.has('controls')) attributes.push(' controls');
    if (!seenNames.has('playsinline')) attributes.push(' playsinline');
    if (!seenNames.has('webkit-playsinline')) attributes.push(' webkit-playsinline');
    if (!seenNames.has('allowfullscreen')) attributes.push(' allowfullscreen');
  }
  return attributes.join('');
}

function safeRemoteURL(rawValue, baseURL) {
  const normalized = htmlEntityDecoded(String(rawValue ?? '')).trim();
  if (!normalized) return null;
  for (const ch of normalized) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return null;
  }
  let url;
  try {
    url = new URL(normalized, baseURL || undefined);
  } catch (_) {
    return null;
  }
  if (!['https:', 'http:'].includes(url.protocol.toLowerCase())) return null;
  // Twitter/X 媒体 WebP 兼容性：转为 JPEG 表示
  if (url.hostname.toLowerCase() === 'pbs.twimg.com' && url.pathname.includes('/media/')) {
    const params = new URLSearchParams(url.search);
    if ((params.get('format') || '').toLowerCase() === 'webp') {
      params.set('format', 'jpg');
      return `${url.origin}${url.pathname}?${params.toString()}`;
    }
  }
  return url.toString();
}

function htmlEntityDecoded(value) {
  let decoded = value;
  for (let i = 0; i < 3; i += 1) {
    const next = decoded
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&colon;/gi, ':')
      .replace(/&tab;/gi, '\t')
      .replace(/&newline;/gi, '\n')
      .replace(/&#x3a;/gi, ':')
      .replace(/&#58;/gi, ':');
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHTMLText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// MARK: - 阅读器段落（翻译与 TOC 的稳定 ID）

function splitBlockTextIntoParagraphs(text) {
  const lines = text.split('\n');
  const result = [];
  let current = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (current) {
        result.push(current.trim());
        current = '';
      }
    } else {
      if (current) current += '\n';
      current += line;
    }
  }
  if (current) result.push(current.trim());
  return result.filter(Boolean);
}

function readerParagraphs(html, title) {
  const paragraphs = [];
  const cleanTitle = (title || '').trim();
  if (cleanTitle) paragraphs.push({ id: 'title', original: cleanTitle });

  const expression = /<(p|div|li|blockquote|pre|h[1-6]|figcaption|dt|dd)\b[^>]*>[\s\S]*?<\/\1>/gis;
  let paragraphIndex = 0;
  let match;
  while ((match = expression.exec(html)) !== null) {
    const blockHTML = match[0];
    const explicitID = (blockHTML.match(/data-nj-id="([^"]+)"/i) || [])[1];

    // 逐句双语：渲染端已把句子包进 data-sent span —— 句子即翻译单元（ID 显式，两端一致）
    const sentExpression = /<span[^>]*data-sent="([^"]+)"[^>]*>([\s\S]*?)<\/span>/gi;
    let sentMatch;
    let hasSentences = false;
    while ((sentMatch = sentExpression.exec(blockHTML)) !== null) {
      const original = plainText(sentMatch[2]);
      if (!original) continue;
      paragraphs.push({ id: sentMatch[1], parentId: explicitID || null, original });
      hasSentences = true;
    }
    if (hasSentences) {
      paragraphIndex += 1;
      continue;
    }

    const original = plainText(blockHTML);
    if (!original) continue;
    if (explicitID) {
      // 渲染端标注过的块：直接使用显式段落 ID（与 DOM 完全一致）
      paragraphs.push({ id: explicitID, original });
      paragraphIndex += 1;
      continue;
    }
    // 原始 HTML（无标注）：沿用旧编号规则（含子段落拆分）
    const subParagraphs = splitBlockTextIntoParagraphs(original);
    if (subParagraphs.length > 1) {
      subParagraphs.forEach((subText, subIdx) => {
        paragraphs.push({ id: `p${paragraphIndex}_${subIdx}`, original: subText });
      });
    } else {
      paragraphs.push({ id: `p${paragraphIndex}`, original });
    }
    paragraphIndex += 1;
  }
  return paragraphs;
}

function insertingInlineTranslations(html, segments, pendingIDs = []) {
  const expression = /<(p|div|li|blockquote|pre|h[1-6]|figcaption|dt|dd)\b[^>]*>[\s\S]*?<\/\1>/gis;
  const segmentsByID = new Map(segments.map((seg) => [seg.id, seg]));
  const pendingSet = new Set(pendingIDs);
  let rendered = '';
  let cursor = 0;
  let paragraphIndex = 0;
  let match;

  while ((match = expression.exec(html)) !== null) {
    rendered += html.slice(cursor, match.index);
    const block = match[0];
    cursor = match.index + block.length;

    const original = plainText(block);
    if (!original) {
      rendered += block;
      continue;
    }

    const subParagraphs = splitBlockTextIntoParagraphs(original);
    if (subParagraphs.length > 1) {
      subParagraphs.forEach((subText, subIdx) => {
        const subID = `p${paragraphIndex}_${subIdx}`;
        const escaped = escapeHTMLText(subText).replace(/\n/g, '<br>');
        rendered += `<p class="nj-subparagraph" data-nj-id="${subID}">${escaped}</p>`;
        const segment = segmentsByID.get(subID);
        if (segment && isSameReaderParagraph(subText, segment.original)) {
          rendered += translationMarkup(segment.translation, subID);
        } else if (pendingSet.has(subID)) {
          rendered += pendingTranslationMarkup(subID);
        }
      });
    } else {
      const id = `p${paragraphIndex}`;
      rendered += annotatedReaderBlock(block, id);
      const segment = segmentsByID.get(id);
      if (segment && isSameReaderParagraph(original, segment.original)) {
        rendered += translationMarkup(segment.translation, id);
      } else if (pendingSet.has(id)) {
        rendered += pendingTranslationMarkup(id);
      }
    }
    paragraphIndex += 1;
  }
  rendered += html.slice(cursor);
  return rendered;
}

function annotatedReaderBlock(block, id) {
  const closingBracket = block.indexOf('>');
  if (closingBracket < 0) return block;
  return `${block.slice(0, closingBracket)} data-nj-id="${id}"${block.slice(closingBracket)}`;
}

function translationMarkup(translation, id) {
  return `<aside id="nj-translation-${id}" class="nj-translation" data-nj-translation-for="${id}" aria-label="翻译">
  <p><span class="nj-translation-label" aria-label="译文">
    <span class="nj-language-chip" aria-hidden="true">A</span>
    <span class="nj-language-chip" aria-hidden="true">文</span>
  </span><span class="nj-translation-text">${escapeHTMLText(translation).replace(/\n/g, '<br>')}</span></p>
</aside>`;
}

function pendingTranslationMarkup(id) {
  return `<aside id="nj-translation-${id}" class="nj-translation is-loading" data-nj-translation-for="${id}" aria-label="正在生成翻译" aria-live="polite">
  <p><span class="nj-translation-label" aria-label="译文">
    <span class="nj-language-chip" aria-hidden="true">A</span>
    <span class="nj-language-chip" aria-hidden="true">文</span>
  </span><span class="nj-translation-text">正在翻译…</span></p>
</aside>`;
}

function isSameReaderParagraph(a, b) {
  const normalize = (value) => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  return normalize(a) === normalize(b);
}

function removingDuplicateLeadingHeading(html, articleTitle) {
  if (!html) return html;
  const cleanTitle = normalizeHeadingText(articleTitle);
  if (!cleanTitle) return html;

  const pattern = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i;
  const match = html.match(pattern);
  if (!match) return html;

  const prefixHTML = html.slice(0, match.index);
  if (/<p[^>]*>/i.test(prefixHTML)) return html;
  const prefixPlainText = normalizeHeadingText(plainText(prefixHTML));

  const headingText = normalizeHeadingText(plainText(match[1]));
  if (headingText === cleanTitle && prefixPlainText.length <= 120) {
    return html.slice(0, match.index) + html.slice(match.index + match[0].length);
  }
  return html;
}

function normalizeHeadingText(text) {
  return String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * 判断是否需要网页正文提取。两类命中：
 * 1. feed 内容过短（摘要级）且存在原文链接；
 * 2. 有一定篇幅但全文无任何富结构（图/代码块/表格/标题/列表/引用）——「贴网页地址订阅」
 *    的页面转写产物就是这种纯文本堆砌，原图与排版都在原文页里，须抓原文补全。
 */
function needsExtraction(entry) {
  if (entry.url == null) return false;
  const sourceText = entry.contentHTML ? plainText(entry.contentHTML) : plainText(entry.summary || '');
  if (sourceText.length < 500) return true;
  const html = entry.contentHTML || '';
  return html.length > 0 && !/<(img|picture|video|pre|table|blockquote|h[2-6]|ul|ol|figure)[\s>]/i.test(html);
}

/** 网页字节流按真实编码解码：BOM → Content-Type → meta charset → UTF-8（坏字符超阈值时启发式回退）。 */
function decodeWebPage(buf, contentType) {
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return buf.subarray(3).toString('utf8');
  }
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    try { return new TextDecoder('utf-16le').decode(buf.subarray(2)); } catch (_) { return buf.toString('utf8'); }
  }
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
    try { return new TextDecoder('utf-16be').decode(buf.subarray(2)); } catch (_) { return buf.toString('utf8'); }
  }
  let charset = null;
  const ctMatch = String(contentType || '').match(/charset\s*=\s*"?([\w-]+)/i);
  if (ctMatch) charset = ctMatch[1].toLowerCase();
  if (!charset) {
    const head = buf.subarray(0, 4096).toString('latin1');
    const metaMatch = head.match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i);
    if (metaMatch) charset = metaMatch[1].toLowerCase();
  }
  if (charset && !['utf-8', 'utf8', 'us-ascii', 'ascii'].includes(charset)) {
    try { return new TextDecoder(charset).decode(buf); } catch (_) { /* 未知编码，走默认 */ }
  }
  const utf8 = buf.toString('utf8');
  const bad = (utf8.match(/\uFFFD/g) || []).length;
  // UTF-8 解码大量坏字符 → 多半是 GBK/Big5/日韩编码页面，按序启发尝试
  if (bad > utf8.length * 0.02 && utf8.length > 0) {
    for (const guess of ['gbk', 'big5', 'shift_jis', 'euc-kr', 'windows-1252']) {
      try { return new TextDecoder(guess).decode(buf); } catch (_) { /* 下一个 */ }
    }
  }
  return utf8;
}

let netFetchImpl = null; // main.js 注入 electron net.fetch（走系统代理）；空则回退全局 fetch
function setNetFetch(fn) { netFetchImpl = fn; }
function hasNetFetch() { return netFetchImpl != null; }

/**
 * 抓取网页字节流（30s 超时）。net.fetch（系统代理）优先，回退全局 fetch。
 * 主进程预抓与主进程回退路径共用；utilityProcess worker 内无 electron，恒用全局 fetch。
 */
async function fetchWebPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const doFetch = netFetchImpl || fetch;
    const response = await doFetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'RobinRead/2.0 (+personal RSS reader)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type'),
      finalURL: response.url || url,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 仅当注入了 net.fetch 时执行主进程侧预抓（供 worker 免自抓）；未注入时抛错由调用方跳过。 */
async function fetchViaNetFetch(url) {
  if (!netFetchImpl) throw new Error('no-netfetch');
  return fetchWebPage(url);
}

/** 字节流 → 编码探测 → 双引擎提取 → 消毒（CPU 部分，主进程与 worker 共用）。 */
function extractFromBuffer(url, buffer, contentType) {
  const sliced = buffer.subarray(0, 4_000_000);
  const html = decodeWebPage(sliced, contentType);
  // 双引擎：Readability 通用提取优先（质量更好、能绕开 SPA/壳），容器启发式 fallback（如 ithome 等反爬壳）
  const heuristic = content(html, url);
  const readability = readabilityContent(html, url);
  const result = readability.text.length >= heuristic.text.length ? readability : heuristic;
  if (result.text.length < 120) throw new Error('noReadableContent');
  return {
    entryID: '',
    text: result.text,
    html: result.html,
    imageURLs: result.imageURLs,
    fetchedAt: Date.now() / 1000,
    sourceURL: url,
    isSanitized: true,
  };
}

/**
 * 抓取网页并提取正文（完整流程：30s 超时 fetch → 4MB 截断 → 多编码探测 → 双引擎提取 → 白名单消毒）。
 * 传入 preloaded（主进程已抓好的字节流）时跳过自抓；无外部进程依赖：主进程回退路径与
 * utilityProcess 工作进程共用本函数。
 */
async function extractInProcess(url, preloaded = null) {
  if (preloaded && preloaded.buffer) {
    return extractFromBuffer(preloaded.finalURL || url, preloaded.buffer, preloaded.contentType || null);
  }
  const { buffer, contentType, finalURL } = await fetchWebPage(url);
  return extractFromBuffer(finalURL, buffer, contentType);
}

// MARK: - Feed 正文格式规范化（转义 HTML / Markdown / 纯文本 → HTML）
// 上游 ArticleMarkupNormalizer 思路的 JS 移植：按内容特征（非域名）识别格式，
// 统一转成 HTML 后再走白名单消毒。判定顺序保证幂等：规范化输出含真实标签，
// 再次输入时走 HTML 直通分支。

const ANY_TAG_RE = /<[a-z!/][^>]*>/i;
const BLOCK_TAG_RE = /<(p|div|br|hr|h[1-6]|ul|ol|li|table|blockquote|pre|img|figure|figcaption|section|article)\b/i;

/** 单层实体解码（&amp;lt; 这类双层转义不再解，保持字面量语义）。 */
function decodeEntitiesOnce(value) {
  return String(value)
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function looksLikeMarkdown(text) {
  if (/```/.test(text)) return true;
  const nonEmpty = text.split(/\r?\n/).filter((l) => l.trim());
  if (nonEmpty.length < 2) return false;
  let md = 0;
  for (const line of nonEmpty) {
    if (/^\s{0,3}#{1,6}\s+\S/.test(line)) md += 1;
    else if (/^\s{0,3}[-*+]\s+\S/.test(line)) md += 1;
    else if (/^\s{0,3}\d+[.)]\s+\S/.test(line)) md += 1;
    else if (/^\s{0,3}>\s?\S/.test(line)) md += 1;
    else if (/\*\*[^*\n]+\*\*/.test(line) || /\[[^\]\n]+\]\(https?:\/\/[^)\n]+\)/.test(line)) md += 1;
  }
  return md >= 2 && md / nonEmpty.length >= 0.4;
}

/** 行内格式：文本先转义，再生成受控标签（URL 仅 http/https，属性天然无引号）。 */
function mdInline(escaped) {
  return escaped
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (m, alt, url) => `<img src="${url}" alt="${alt}"/>`)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, text, url) => `<a href="${url}">${text}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>');
}

function markdownToHTML(md) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const BLOCK_START = /^\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s?|```)/;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const buf = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i += 1; }
      i += 1;
      out.push(`<pre><code>${escapeHTMLText(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(6, heading[1].length + 1); // # 从 h2 起，与阅读器标题重映射口径一致
      out.push(`<h${level}>${mdInline(escapeHTMLText(heading[2]))}</h${level}>`);
      i += 1;
      continue;
    }
    if (/^\s{0,3}[-*+]\s+\S/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s{0,3}[-*+]\s+\S/.test(lines[i])) { items.push(lines[i].replace(/^\s{0,3}[-*+]\s+/, '')); i += 1; }
      out.push(`<ul>${items.map((t) => `<li>${mdInline(escapeHTMLText(t))}</li>`).join('')}</ul>`);
      continue;
    }
    if (/^\s{0,3}\d+[.)]\s+\S/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s{0,3}\d+[.)]\s+\S/.test(lines[i])) { items.push(lines[i].replace(/^\s{0,3}\d+[.)]\s+/, '')); i += 1; }
      out.push(`<ol>${items.map((t) => `<li>${mdInline(escapeHTMLText(t))}</li>`).join('')}</ol>`);
      continue;
    }
    if (/^\s{0,3}>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s{0,3}>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s{0,3}>\s?/, '')); i += 1; }
      out.push(`<blockquote><p>${mdInline(escapeHTMLText(buf.join('\n'))).replace(/\n/g, '<br>')}</p></blockquote>`);
      continue;
    }
    if (!line.trim()) { i += 1; continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i])) { buf.push(lines[i]); i += 1; }
    out.push(`<p>${mdInline(escapeHTMLText(buf.join('\n'))).replace(/\n/g, '<br>')}</p>`);
  }
  return out.join('\n');
}

/**
 * Feed 正文规范化入口：
 * 1) 已含真实标签 → HTML，原样（后续统一走白名单消毒）；
 * 2) 无标签但单层解码后出现标签 → 转义 HTML，返回解码结果；
 * 3) Markdown 特征主导 → 转 HTML（# 从 h2 起、fence→pre、受控行内标签）；
 * 4) 其余纯文本 → 转义 + 空行分段。
 */
function normalizeFeedMarkup(html) {
  const raw = String(html ?? '');
  if (!raw.trim()) return raw;
  if (ANY_TAG_RE.test(raw)) return raw;
  const decoded = decodeEntitiesOnce(raw);
  if (decoded !== raw && ANY_TAG_RE.test(decoded)) {
    if (BLOCK_TAG_RE.test(decoded) || /<a\s|<img\s|<span\s|<em|<strong|<code/i.test(decoded)) return decoded;
  }
  const text = decoded !== raw ? decoded : raw;
  if (looksLikeMarkdown(text)) return markdownToHTML(text);
  const paragraphs = splitBlockTextIntoParagraphs(text);
  if (paragraphs.length === 0) return raw;
  return paragraphs
    .map((p) => `<p>${escapeHTMLText(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

module.exports = {
  content,
  readabilityContent,
  sanitizedHTML,
  imageURLsFrom,
  readerParagraphs,
  insertingInlineTranslations,
  translationMarkup,
  pendingTranslationMarkup,
  removingDuplicateLeadingHeading,
  needsExtraction,
  plainText,
  isSameReaderParagraph,
  decodeWebPage,
  extractInProcess,
  extractFromBuffer,
  fetchWebPage,
  fetchViaNetFetch,
  setNetFetch,
  hasNetFetch,
  normalizeFeedMarkup,
};
