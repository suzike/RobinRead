'use strict';
/**
 * diag-phase10-export.js — 导出工厂离线探针（run-all --ci 集）
 *
 * 覆盖调研报告方向 13/19/24：
 *  1. EPUB 构建（EpubBuilder）：ZIP 结构逐字节校验——mimetype 首条目且 store 无压缩、
 *     全部条目名、每条 CRC32 复算一致、OPF/nav/XHTML 内容锚点、空正文拒绝
 *  2. 设置链路静态锚点：双语对照版式（13）与自定义 CSS（24）全链路
 * 退出码 0=PASS，非 0=FAIL。
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require(path.join(__dirname, '..', 'node_modules', 'jsdom'));
const { buildEntryEpub, buildEditionEpub, crc32, toWellFormedXML } = require(path.join(__dirname, '..', 'src', 'main', 'EpubBuilder.js'));

const ROOT = path.join(__dirname, '..');

// ── 1. EPUB 结构 ──
const epub = buildEntryEpub({
  title: '纸刊导出测试：从模型到智能体',
  author: '知更作者',
  feedTitle: '科技前沿周刊',
  publishedAt: 1758864000,
  url: 'https://example.com/p/1',
  html: '<h2>章节标题</h2><p>这是正文段落，包含足够的文字用于验证 EPUB 导出链路的完整性。</p><blockquote><p>引用内容。</p></blockquote>',
});

// 1a. 首条目必须是 mimetype：store（无压缩）、无 extra 字段、内容精确
assert.ok(epub.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'ZIP 魔数 PK\x03\x04');
assert.strictEqual(epub.readUInt16LE(8), 0, 'mimetype 必须为 store（method=0）');
const nameLen = epub.readUInt16LE(26);
const extraLen = epub.readUInt16LE(28);
assert.strictEqual(nameLen, 8, '首条目名长度应为 8（mimetype）');
assert.strictEqual(extraLen, 0, 'mimetype 条目 extra 长度必须为 0');
assert.strictEqual(epub.subarray(30, 30 + nameLen).toString(), 'mimetype');
const mimeLen = epub.readUInt32LE(18);
assert.strictEqual(epub.subarray(30 + nameLen, 30 + nameLen + mimeLen).toString(), 'application/epub+zip');

// 1b. 遍历中央目录：条目名齐全 + 每条 CRC32 复算一致
const names = [];
let cursor = epub.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
while (cursor >= 0) {
  const crc = epub.readUInt32LE(cursor + 16);
  const cSize = epub.readUInt32LE(cursor + 20);
  const nLen = epub.readUInt16LE(cursor + 28);
  const eLen = epub.readUInt16LE(cursor + 30);
  const cLen = epub.readUInt16LE(cursor + 32);
  const localOffset = epub.readUInt32LE(cursor + 42);
  const name = epub.subarray(cursor + 46, cursor + 46 + nLen).toString('utf8');
  names.push(name);
  // 回到 local header 取数据复算 CRC
  const lNameLen = epub.readUInt16LE(localOffset + 26);
  const lExtraLen = epub.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + lNameLen + lExtraLen;
  assert.strictEqual(crc32(epub.subarray(dataStart, dataStart + cSize)) >>> 0, crc, `CRC32 应一致：${name}`);
  cursor = epub.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), cursor + 46 + nLen + eLen + cLen);
}
assert.deepStrictEqual(names.sort(), [
  'META-INF/container.xml', 'OEBPS/ch1.xhtml', 'OEBPS/content.opf',
  'OEBPS/nav.xhtml', 'OEBPS/style.css', 'mimetype',
].sort(), 'EPUB 条目集应完整');

// 1c. 内容锚点 + 空正文拒绝（store 文本条目以 UTF-8 存放，整包按 utf8 解码即可命中中文）
const articleXML = epub.toString('utf8');
assert.ok(articleXML.includes('纸刊导出测试'), 'article.xhtml 应含标题');
assert.ok(articleXML.includes('验证 EPUB 导出链路'), 'article.xhtml 应含正文');
assert.ok(articleXML.includes('<dc:title>'), 'content.opf 应含元数据');
assert.ok(articleXML.includes('properties="nav"'), 'OPF 应声明 EPUB 3 导航');
assert.throws(() => buildEntryEpub({ title: '空', html: '   ' }), '空正文应抛错');

// ── 1d. 整期 EPUB（方向 19b）：多章节 manifest/spine/nav 一致性 ──
const edition = buildEditionEpub({
  title: '知更 · 本期',
  chapters: [1, 2, 3].map((n) => ({ title: `第 ${n} 篇`, feedTitle: '周刊', html: `<p>第 ${n} 篇正文。</p>` })),
});
const editionText = edition.toString('utf8');
for (const token of ['ch1.xhtml', 'ch2.xhtml', 'ch3.xhtml']) {
  assert.ok(editionText.includes(token), `整期应含章节文件 ${token}`);
}
assert.ok((editionText.match(/<itemref idref="ch\d+"/g) || []).length === 3, 'spine 应含 3 个章节');
assert.ok((editionText.match(/<li><a href="ch\d\.xhtml">/g) || []).length === 3, 'nav 应含 3 条目录');
assert.throws(() => buildEditionEpub({ title: '空刊', chapters: [{ title: 'a', html: '' }] }), '全空整期应抛错');

// ── 1d'. XML 良构化（P0 修复）：脏 HTML → 严格 XML 可解析 ──
const dirty = '<p>A&B —&nbsp;混排</p><br><img src="https://e.com/x.jpg" width="10"><video controls></video><p> END</p>';
const wf = toWellFormedXML(dirty);
assert.ok(wf.includes('A&amp;B'), '裸 & 应转义');
assert.ok(wf.includes('&#160;'), 'nbsp 应转数值引用');
assert.ok(/<br\s*\/>/.test(wf), 'br 应自闭合');
assert.ok(/<img[^>]*\/>/.test(wf), 'img 应自闭合');
assert.ok(wf.includes('controls="controls"'), '布尔属性应补值');
{
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const parser = new dom.window.DOMParser();
  const dirtyDoc = parser.parseFromString(
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>${dirty}</body></html>`, 'application/xml');
  assert.ok(dirtyDoc.querySelector('parsererror'), '原始脏 HTML 作为 XML 应解析失败（验证测试有效性）');
  const goodDoc = parser.parseFromString(
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>${wf}</body></html>`, 'application/xml');
  assert.ok(!goodDoc.querySelector('parsererror'), `良构化后应通过 XML 解析：${goodDoc.querySelector('parsererror')?.textContent?.slice(0, 120)}`);
}
// 整书级校验：用脏 HTML 生成 EPUB，逐个 XHTML 章节过 XML 解析器
const dirtyEpub = buildEntryEpub({
  title: '脏HTML测试', feedTitle: '周刊', publishedAt: 1758864000,
  html: `${dirty}<p>&copy; 2026 &mdash; 「知更」</p>`,
});
const cdSig = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
let p2 = dirtyEpub.indexOf(cdSig);
const fileBytes = {};
while (p2 >= 0) {
  const nLen = dirtyEpub.readUInt16LE(p2 + 28);
  const cSize = dirtyEpub.readUInt32LE(p2 + 20); // 条目数据长度以中央目录为准（local 头偏移取错会混入二进制）
  const lOff = dirtyEpub.readUInt32LE(p2 + 42);
  const name = dirtyEpub.subarray(p2 + 46, p2 + 46 + nLen).toString('utf8');
  const lnLen = dirtyEpub.readUInt16LE(lOff + 26);
  const leLen = dirtyEpub.readUInt16LE(lOff + 28);
  const dStart = lOff + 30 + lnLen + leLen;
  fileBytes[name] = dirtyEpub.subarray(dStart, dStart + cSize);
  p2 = dirtyEpub.indexOf(cdSig, p2 + 46 + nLen);
}
{
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const parser = new dom.window.DOMParser();
  for (const name of ['OEBPS/ch1.xhtml', 'OEBPS/nav.xhtml', 'OEBPS/content.opf', 'META-INF/container.xml']) {
    const doc = parser.parseFromString(fileBytes[name].toString('utf8'), /xhtml|html/.test(name) ? 'application/xml' : 'application/xml');
    assert.ok(!doc.querySelector('parsererror'), `${name} 应为良构 XML：${doc.querySelector('parsererror')?.textContent?.slice(0, 100)}`);
  }
  assert.ok(fileBytes['OEBPS/ch1.xhtml'].toString('utf8').includes('&#169;'), 'copy 实体应转数值引用');
}


// ── 2. 双语对照版式（13）与自定义 CSS（24）静态锚点 ──
const storeSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'AppStore.js'), 'utf8');
assert.ok(storeSrc.includes("RobinRead.bilingualStyle") && /bilingualStyle: \['inline', 'card'\]/.test(storeSrc), 'AppStore 应含对照版式键');
assert.ok(storeSrc.includes("RobinRead.readerCustomCSS") && storeSrc.includes("key === 'customCss'"), 'AppStore 应含自定义 CSS 专用通道');
assert.ok(storeSrc.includes('exportEntryEpub(entryID)') && storeSrc.includes("require('./EpubBuilder')"), 'AppStore 应含 EPUB 导出方法');
const ipcSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipc.js'), 'utf8');
for (const ch of ["'app:exportEpub'", "'prefs:readerCustomCSS'"]) assert.ok(ipcSrc.includes(`handle(${ch}`), `ipc 应含 ${ch}`);
const preloadSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'preload.js'), 'utf8');
assert.ok(preloadSrc.includes('exportEpub:') && preloadSrc.includes('readerCustomCSS:'), 'preload 应暴露新桥');
const appSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8');
for (const token of ['applyCustomCSS', 'bilingualStyle', 'robinread:custom-css']) assert.ok(appSrc.includes(token), `app.js 应含 ${token}`);
const dialogsSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'views', 'dialogs.js'), 'utf8');
for (const token of ['对照版式', '自定义样式', 'nj-css-input']) assert.ok(dialogsSrc.includes(token), `设置面应含 ${token}`);
const readerSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'views', 'reader.js'), 'utf8');
assert.ok(readerSrc.includes('_exportEpubFile') && readerSrc.includes('导出为 EPUB 电子书'), '导出菜单应含 EPUB 项');
const cssSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'styles', 'robin.css'), 'utf8');
assert.ok(cssSrc.includes('data-bilingual-style="card"') && cssSrc.includes('.nj-css-input'), 'robin.css 应含对照分行与 CSS 输入样式');
const stringsSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'I18NStrings.js'), 'utf8');
for (const key of ['对照版式', '自定义样式', '导出为 EPUB 电子书']) assert.ok(stringsSrc.includes(`"${key}"`), `i18n 应含「${key}」`);

// ── 2b. 方向 11（聚焦）/ 22（命令面板）/ 19b（整期导出链路）静态锚点 ──
assert.ok(cssSrc.includes('body.rp-focus'), 'robin.css 应含聚焦模式样式');
const indexSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
assert.ok(indexSrc.includes('cap-focus'), '胶囊区应含聚焦按钮');
assert.ok(fs.existsSync(path.join(ROOT, 'src', 'renderer', 'views', 'command-palette.js')), '命令面板视图应存在');
const paletteSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'views', 'command-palette.js'), 'utf8');
for (const token of ['cmd-palette', '_filter', 'present(']) assert.ok(paletteSrc.includes(token), `command-palette.js 应含 ${token}`);
assert.ok(appSrc.includes('openCommandPalette') && appSrc.includes("event.code === 'KeyP'"), 'app.js 应绑定命令面板快捷键');
assert.ok(appSrc.includes('buildPaletteCommands') && appSrc.includes('toggleFocusMode'), 'app.js 应含命令注册表与聚焦开关');
assert.ok(/body\[data-bilingual-style/.test(cssSrc), '对照版式标记应生效');
assert.ok(storeSrc.includes('exportEditionEpub(entryIDs)'), 'AppStore 应含整期导出方法');
assert.ok(preloadSrc.includes('exportEditionEpub:'), 'preload 应暴露整期导出桥');
assert.ok(appSrc.includes('showEditionExport'), 'app.js 应含整期导出保存流程');
const listSrc2 = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'views', 'list.js'), 'utf8');
assert.ok(listSrc2.includes('this.handlers.onExportEdition?.'), '刊头应挂整期导出按钮');
for (const key of ['导出本期 EPUB', '聚焦模式：非当前段落渐暗（F）', '切换：聚焦模式', '输入命令或搜索…']) {
  assert.ok(stringsSrc.includes(`"${key}"`), `i18n 应含「${key}」`);
}

console.log('PASS 导出工厂（EPUB 结构逐字节校验）+ 对照版式/自定义CSS 链路锚点');
process.exit(0);
