'use strict';
/**
 * EpubBuilder.js — 单篇文章 → EPUB 3 电子书（方向 19 v1，调研报告 2026-09-26）
 *
 * 零依赖：内置最小 ZIP 写入器（仅 store 不压缩；CRC32 查表），
 * 保证 EPUB 规范要求的 mimetype 条目「第一个、无压缩、无额外字段」。
 * 正文必须是已消毒的 HTML（调用方经 ArticleExtractor.sanitizedHTML 产出）。
 */

// ── CRC32（IEEE 802.3，ZIP 规范多项式）──
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** DOS 时间（ZIP 时间戳，2 秒精度；本地时间即可）。 */
function dosDateTime(date) {
  const d = date || new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const day = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, day };
}

/**
 * 组装 ZIP（全部 store）：entries = [{ name, data:Buffer }]。
 * 返回 Buffer。只用于 EPUB 这类小体积文本容器，不做分卷/压缩。
 */
function buildZip(entries, timestamp) {
  const { time, day } = dosDateTime(timestamp);
  const locals = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const data = entry.data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0x0800, 6);      // flags: UTF-8 文件名
    local.writeUInt16LE(0, 8);           // method: store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);          // extra 长度必须为 0（mimetype 规范要求）
    locals.push(local, nameBuf, data);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);            // version made by
    cen.writeUInt16LE(20, 6);            // version needed
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(day, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);            // extra
    cen.writeUInt16LE(0, 32);            // comment
    cen.writeUInt16LE(0, 34);            // disk start
    cen.writeUInt16LE(0, 36);            // internal attrs
    cen.writeUInt32LE(0, 38);            // external attrs
    cen.writeUInt32LE(offset, 42);       // local header 偏移
    central.push(cen, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

function escapeXML(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// XML 良构化的常见命名实体（HTML 实体 → 数值引用；XML 只认 amp/lt/gt/quot/apos 五个）
const ENTITY_MAP = {
  nbsp: 160, shy: 173, copy: 169, reg: 174, trade: 8482, mdash: 8212, ndash: 8211, hellip: 8230,
  lsquo: 8216, rsquo: 8217, ldquo: 8220, rdquo: 8221, laquo: 171, raquo: 187, times: 215, divide: 247,
  plusmn: 177, sup2: 178, sup3: 179, frac12: 189, frac14: 188, frac34: 190, deg: 176, middot: 183,
  bull: 8226, sect: 167, para: 182, dagger: 8224, Dagger: 8225, permil: 8240, prime: 8242, Prime: 8243,
  larr: 8592, uarr: 8593, rarr: 8594, darr: 8595, harr: 8596, ensp: 8194, emsp: 8195, thinsp: 8201,
  zwnj: 8204, zwj: 8205, lrm: 8206, rlm: 8207, euro: 8364, pound: 163, yen: 165, cent: 162, sect2: 167,
};
const VOID_TAGS = /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;
// 布尔属性（HTML 允许无值，XML 不允许）
const BOOLEAN_ATTRS = /^(?:controls|autoplay|loop|muted|disabled|checked|readonly|selected|open|required|multiple|novalidate|playsinline|allowfullscreen|default|reversed|hidden)$/i;

/**
 * 消毒 HTML → XML 良构（EPUB 章节按 XML 解析，三类致命问题必须处理）：
 * 1. 裸 & 与 HTML 命名实体 → 数值引用/转义；2. void 标签自闭合；3. 布尔属性补值。
 */
function toWellFormedXML(html) {
  let s = String(html || '');
  // a. 保护已转义的 &amp; → 占位（避免二次转义）
  s = s.replace(/&amp;/g, '\u0001AMP\u0001');
  // b. 其余命名实体：已知 → 数值引用；未知 → 丢弃（防止 &xyz; 炸解析）
  s = s.replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (whole, name) => (
    Object.prototype.hasOwnProperty.call(ENTITY_MAP, name) ? `&#${ENTITY_MAP[name]};` : ''
  ));
  // c. 剩余裸 &（不含数字/十六进制实体形态）→ 转义
  s = s.replace(/&(?!(?:#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');
  // d. 还原 &amp;
  s = s.replace(/\u0001AMP\u0001/g, '&amp;');
  // e. 布尔属性补值（仅标签内裸词形态，已有 =值 的不受影响）
  s = s.replace(/(<[a-zA-Z][^<>]*?)\s(controls|autoplay|loop|muted|disabled|checked|readonly|selected|open|required|multiple|novalidate|playsinline|allowfullscreen|default|reversed|hidden)(\s*\/?>)/gi,
    (whole, head, attr, tail) => `${head} ${attr.toLowerCase()}="${attr.toLowerCase()}"${tail}`);
  // f. void 标签自闭合（<br> <img ...> → <br/> <img .../>）
  s = s.replace(/<([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*?)\s*(\/?)>/g, (whole, tag, attrs, selfClosed) => {
    if (!VOID_TAGS.test(tag)) return whole;
    const trimmedAttrs = attrs.replace(/\s+$/, '');
    return `<${tag}${trimmedAttrs} />`;
  });
  return s;
}

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const STYLE_CSS = `body { font-family: "LXGW WenKai Screen", "Source Han Serif SC", "Noto Serif CJK SC", Georgia, serif; line-height: 1.75; margin: 5% auto; max-width: 34em; color: #1f1c17; }
h1 { font-size: 1.5em; line-height: 1.3; }
.meta { color: #6b6558; font-size: 0.85em; border-bottom: 1px solid #d8d2c4; padding-bottom: 0.8em; margin-bottom: 1.4em; }
img { max-width: 100%; height: auto; }
blockquote { border-left: 3px solid #8a9a7b; margin: 1.2em 0; padding: 0.2em 0 0.2em 1em; color: #4a463c; }
pre, code { font-family: Consolas, Menlo, monospace; font-size: 0.9em; }
p { text-indent: 0; margin: 0.8em 0; }`;

/**
 * 构建多章节 EPUB（方向 19 整期）：chapters = [{ title, author?, feedTitle?, publishedAt?, url?, html }]
 * 章节文件 OEBPS/ch<N>..xhtml；封面章节缺失时以目录页承担导航。
 * 返回 Buffer。buildEntryEpub 为其单章节特例。
 */
function buildEditionEpub(payload) {
  const bookTitle = String(payload?.title || 'RobinRead Edition');
  const chapters = (Array.isArray(payload?.chapters) ? payload.chapters : []).filter((ch) => ch && String(ch.html || '').trim());
  if (!chapters.length) throw new Error('epub: empty content');
  if (chapters.length > 60) chapters.length = 60;
  const uuid = `robinread-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  const chapterFiles = [];
  const manifestItems = [];
  const spineItems = [];
  const tocItems = [];
  chapters.forEach((ch, index) => {
    const id = `ch${index + 1}`;
    const href = `${id}.xhtml`;
    const chTitle = String(ch.title || `#${index + 1}`);
    const metaBits = [];
    if (ch.feedTitle) metaBits.push(escapeXML(ch.feedTitle));
    if (ch.publishedAt) {
      const d = new Date(ch.publishedAt * 1000);
      if (!Number.isNaN(d.getTime())) metaBits.push(d.toISOString().slice(0, 10));
    }
    const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh" xml:lang="zh">
<head><meta charset="utf-8"/><title>${escapeXML(chTitle)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
<h1>${escapeXML(chTitle)}</h1>
${metaBits.length ? `<p class="meta">${metaBits.join(' · ')}</p>` : ''}
${toWellFormedXML(String(ch.html))}
</body></html>`;
    chapterFiles.push({ name: `OEBPS/${href}`, data: Buffer.from(xhtml, 'utf8') });
    manifestItems.push(`    <item id="${id}" href="${href}" media-type="application/xhtml+xml"/>`);
    spineItems.push(`    <itemref idref="${id}"/>`);
    tocItems.push(`      <li><a href="${href}">${escapeXML(chTitle)}</a></li>`);
  });

  const navXHTML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="utf-8"/><title>TOC</title></head>
<body><nav epub:type="toc"><h1>${escapeXML(bookTitle)}</h1><ol>
${tocItems.join('\n')}
</ol></nav></body></html>`;

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${escapeXML(bookTitle)}</dc:title>
    <dc:language>zh</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
${manifestItems.join('\n')}
  </manifest>
  <spine>
${spineItems.join('\n')}
  </spine>
</package>`;

  return buildZip([
    { name: 'mimetype', data: Buffer.from('application/epub+zip', 'utf8') },
    { name: 'META-INF/container.xml', data: Buffer.from(CONTAINER_XML, 'utf8') },
    { name: 'OEBPS/content.opf', data: Buffer.from(opf, 'utf8') },
    { name: 'OEBPS/nav.xhtml', data: Buffer.from(navXHTML, 'utf8') },
    { name: 'OEBPS/style.css', data: Buffer.from(STYLE_CSS, 'utf8') },
    ...chapterFiles,
  ]);
}

/**
 * 构建单篇 EPUB。payload: { title, author, feedTitle, publishedAt(秒), url, html }
 * 返回 Buffer。
 */
function buildEntryEpub(payload) {
  const title = String(payload?.title || 'Untitled');
  const html = String(payload?.html || '');
  if (!html.trim()) throw new Error('epub: empty content');
  const metaBits = [];
  if (payload?.feedTitle) metaBits.push(escapeXML(payload.feedTitle));
  if (payload?.publishedAt) {
    const d = new Date(payload.publishedAt * 1000);
    if (!Number.isNaN(d.getTime())) metaBits.push(d.toISOString().slice(0, 10));
  }
  return buildEditionEpub({
    title,
    chapters: [{ title, author: payload?.author, feedTitle: payload?.feedTitle, publishedAt: payload?.publishedAt, url: payload?.url, html }],
  });
}

module.exports = { buildEntryEpub, buildEditionEpub, buildZip, crc32, toWellFormedXML };
