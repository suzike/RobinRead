'use strict';
/**
 * 阶段三：feed 正文格式规范化探测（纯 Node，无需 Electron）。
 * 覆盖：转义 HTML 解码、Markdown 转换、纯文本分段、HTML 直通、幂等、
 * FeedParser 集成（content:encoded 为 Markdown 时入库即规范化）。
 */
const path = require('node:path');
const Core = require('../src/main/ArticleExtractCore');
const { parse: parseFeed } = require('../src/main/FeedParser');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures += 1;
};
const N = (s) => Core.normalizeFeedMarkup(s);

// 1) HTML 直通（含标签原样返回）
const html = '<p>正常 <strong>HTML</strong> 正文。</p>';
check('HTML 直通', N(html) === html);

// 2) 转义 HTML：单层解码（sanitize 后续清理）
const escaped = '&lt;p&gt;转义的&lt;strong&gt;HTML&lt;/strong&gt; 正文。&lt;/p&gt;';
const nEsc = N(escaped);
check('转义 HTML 解码', nEsc.includes('<p>') && nEsc.includes('<strong>'), nEsc.slice(0, 50));

// 3) 双层转义不再解（字面量语义保留：内层 &lt; 保持转义，不变成真实标签）
const doubleEsc = '&amp;lt;p&amp;gt;not tags&amp;lt;/p&amp;gt;';
const nDouble = N(doubleEsc);
check('双层转义不解码', nDouble.includes('&amp;lt;p&amp;gt;') && !nDouble.includes('<p>not tags'), nDouble.slice(0, 60));

// 4) Markdown → HTML
const md = [
  '# 标题一',
  '',
  '正文段落，含 **加粗** 与 [链接](https://example.com/a)。',
  '',
  '- 列表甲',
  '- 列表乙',
  '',
  '```js',
  'const x = 1;',
  '```',
].join('\n');
const nMd = N(md);
check('Markdown 标题（# → h2）', nMd.includes('<h2>标题一</h2>'));
check('Markdown 段落加粗/链接', nMd.includes('<strong>加粗</strong>') && nMd.includes('<a href="https://example.com/a">链接</a>'));
check('Markdown 列表', nMd.includes('<ul>') && nMd.includes('<li>列表甲</li>'));
check('Markdown fence → pre', nMd.includes('<pre><code>const x = 1;</code></pre>'));

// 5) 纯文本 → 段落化 + 转义（样本不含真实标签，含需转义的特殊字符）
const plain = '第一段文字。\n\n第二段含 1<2、3>2 与 "引号" 的文本。';
const nPlain = N(plain);
check('纯文本分段', nPlain === '<p>第一段文字。</p>\n<p>第二段含 1&lt;2、3&gt;2 与 &quot;引号&quot; 的文本。</p>', nPlain.slice(0, 90));

// 6) 幂等：normalize(normalize(x)) === normalize(x)
for (const [name, sample] of [['md', md], ['escaped', escaped], ['plain', plain]]) {
  const once = N(sample);
  check(`幂等：${name}`, N(once) === once);
}

// 7) 空值安全
check('空串/空值安全', N('') === '' && N(null) === '' && N(undefined) === '');

// 8) FeedParser 集成：content:encoded 为 Markdown → 入库前已规范化
const NOW = new Date().toUTCString();
const mdFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>MD 源</title><link>https://example.com/md</link>
<item><title>MD 文章</title><link>https://example.com/md/1</link><pubDate>${NOW}</pubDate>
<content:encoded><![CDATA[# 规范化标题\n\n- 要点一\n- 要点二]]></content:encoded></item>
</channel></rss>`;
const parsed = parseFeed(mdFeed, 'https://example.com/md/feed.xml');
const entryHTML = parsed.entries[0]?.contentHTML || '';
check('FeedParser 集成：入库即规范化', entryHTML.includes('<h2>规范化标题</h2>') && entryHTML.includes('<li>要点一</li>'), entryHTML.slice(0, 80));

console.log(failures === 0 ? '\nPHASE3 NORMALIZE: ALL PASSED' : `\nPHASE3 NORMALIZE: ${failures} FAILED`);
process.exit(failures ? 1 : 0);
