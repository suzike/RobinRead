'use strict';
const Core = require('../src/main/ArticleExtractCore');

const richHTML = '<h2>标题</h2>' + '<p>这是一段足够长的正文内容，用来验证富结构判定只在篇幅达标后才生效，避免短文被误判。</p>'.repeat(12) + '<img src="a.png"><pre>code</pre>';
const dumpBody = ('这是纯文本讨论正文，讲解 nanoGPT 在 MATLAB 里的实现细节与数学原理。').repeat(200);
const textDump = '<p>' + dumpBody.slice(0, 6000).replace(/(.{80})/g, '$1\r<br>') + '</p>';

const cases = [
  ['纯文本堆砌(需提取)', { url: 'https://www.mathworks.com/x', contentHTML: textDump }, true],
  ['富内容长文(不提取)', { url: 'https://blog.com/a', contentHTML: richHTML }, false],
  ['短正文(需提取)', { url: 'https://x.com/a', contentHTML: '<p>短</p>' }, true],
  ['无原文链接(不提取)', { url: null, contentHTML: textDump }, false],
  ['空正文有链接(需提取)', { url: 'https://x.com/b', contentHTML: null }, true],
];

let ok = 0;
for (const [name, entry, expected] of cases) {
  const got = Core.needsExtraction(entry);
  const pass = got === expected;
  if (pass) ok += 1;
  console.log((pass ? 'PASS' : 'FAIL') + ' ' + name + ' → ' + got);
}
console.log(ok === cases.length ? 'ALL PASSED' : 'FAILED');
process.exit(ok === cases.length ? 0 : 1);
