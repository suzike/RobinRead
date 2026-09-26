'use strict';
/**
 * diag-phase9-typography.js — 排版引擎 v2 离线探针（run-all --ci 集）
 *
 * 覆盖（调研报告 2026-09-26 方向 1/4/7）：
 *  1. 盘古之白（cjk-micro.js，jsdom 行为测试）：插入位置 / textContent 保真 / 已加白不重复 /
 *     跨元素边界 / pre·code·译文跳过 / 幂等重建
 *  2. 设置链路静态锚点：AppStore 白名单、设置面行、CSS 选择器、i18n 英文条目
 * 退出码 0=PASS，非 0=FAIL。
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require(path.join(__dirname, '..', 'node_modules', 'jsdom'));

const ROOT = path.join(__dirname, '..');

// cjk-micro.js 位于 src/renderer（type:module）：Node 22.12+/25 可直接 require(esm)，旧版走动态 import 兜底
async function loadCJKMicro() {
  const rel = '../src/renderer/views/cjk-micro.js';
  try {
    return require(rel);
  } catch (error) {
    if (error && error.code === 'ERR_REQUIRE_ESM') {
      return import('file:///' + path.join(__dirname, rel).replace(/\\/g, '/'));
    }
    throw error;
  }
}

(async () => {
  const CJKMicro = await loadCJKMicro();

// ── 1. 盘古之白 DOM 行为 ──
const dom = new JSDOM('<!doctype html><html><body>'
  + '<div id="root">'
  + '<p>今天学习了 React 和 Node.js 的心得体会。</p>'          // 作者已手工加白 → 不应插
  + '<p>混合ChineseEnglish文本示例。</p>'                       // 内部边界 ×2
  + '<p>边界<span>跨元素English</span>测试。</p>'               // 元素内 ×1 + 跨元素边界 ×1
  + '<pre>const count = 1; // 中文注释Mixed不处理</pre>'        // 代码：跳过
  + '<p class="pure">纯中文段落没有混排。</p>'                  // 纯中文 → 0
  + '<p class="nj-t">译文中文 Mixed 不处理。</p>'               // 译文：跳过
  + '</div></body></html>');
const root = dom.window.document.getElementById('root');
const before = root.textContent;
const count = CJKMicro.insertGaps(root);
assert.strictEqual(root.textContent, before, 'textContent 必须逐字不变（复制/搜索/高亮锚点保真）');
assert.strictEqual(count, 4, `应恰好插入 4 处间隙（已加白/纯中文/代码/译文均不插），实际 ${count}`);
assert.strictEqual(root.children[0].querySelectorAll('.nj-gap').length, 0, '作者已加白处不重复插');
assert.strictEqual(root.querySelectorAll('pre .nj-gap, .nj-t .nj-gap').length, 0, 'pre 与译文内不处理');
const pure = root.querySelector('.pure');
assert.strictEqual(pure.querySelectorAll('.nj-gap').length, 0, '纯中文不插');
// 跨元素边界：span 末字符 g 与后续「测」之间必须有 spacer，且 spacer 落在 p 层
const spanP = root.children[2];
const spanEl = spanP.querySelector('span');
assert.ok(spanEl.nextSibling.nodeType === 1
  && spanEl.nextSibling.classList.contains(CJKMicro.GAP_CLASS), '跨元素边界应有 spacer');
// 幂等：移除后重插数量一致、文本不变
assert.strictEqual(CJKMicro.removeGaps(root), count, '移除数量应等于插入数量');
assert.strictEqual(root.querySelectorAll('.nj-gap').length, 0, '移除后应无残留');
assert.strictEqual(CJKMicro.insertGaps(root), count, '重复插入结果确定一致');
assert.strictEqual(root.textContent, before, '重建后 textContent 仍不变');

// ── 2. 设置链路静态锚点 ──
const storeSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'AppStore.js'), 'utf8');
for (const key of ['paraStyle', 'textAlign', 'letterSpacing', 'microTypography', 'dropCap']) {
  assert.ok(storeSrc.includes(`${key}:`), `AppStore.readerLayout 应含 ${key}`);
  assert.ok(new RegExp(`${key}: \\['`).test(storeSrc), `AppStore.setReaderLayout 白名单应含 ${key}`);
}
const dialogsSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'views', 'dialogs.js'), 'utf8');
const LAYOUT_KEY = { 段落风格: 'paraStyle', 文字对齐: 'textAlign', 字距: 'letterSpacing', 中文微排版: 'microTypography', 首字下沉: 'dropCap' };
for (const [label, key] of Object.entries(LAYOUT_KEY)) {
  assert.ok(dialogsSrc.includes(`t('${label}')`), `设置面应含「${label}」`);
  assert.ok(dialogsSrc.includes(`{ ${key}:`), `设置回调应写回 ${key}`);
}
const appSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8');
for (const token of ['--reader-letter-spacing', 'readerPara', 'readerAlign', 'rp-micro-off', 'rp-dropcap', 'robinread:reader-layout-changed']) {
  assert.ok(appSrc.includes(token), `app.js 应含 ${token}`);
}
const readerSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'views', 'reader.js'), 'utf8');
assert.ok(readerSrc.includes('_applyMicroTypography'), 'reader.js 应挂载微排版 pass');
assert.ok(readerSrc.includes("from './cjk-micro.js'"), 'reader.js 应引入 cjk-micro 模块');
const cssSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'styles', 'robin.css'), 'utf8');
for (const token of ['.nj-gap', 'text-spacing-trim', 'initial-letter', 'data-reader-para="indent"', 'data-reader-align="justify"', 'rp-dropcap']) {
  assert.ok(cssSrc.includes(token), `robin.css 应含 ${token}`);
}
const stringsSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'I18NStrings.js'), 'utf8');
for (const key of ['段落风格', '文字对齐', '字距', '中文微排版', '首字下沉']) {
  assert.ok(stringsSrc.includes(`"${key}"`), `i18n 应含「${key}」英文条目`);
}

// ── 3. 内置字库（方向 2）：字体文件与授权随包、@font-face 与设置链路锚点 ──
const fontPath = path.join(ROOT, 'src', 'renderer', 'fonts', 'LXGWWenKaiScreen.ttf');
assert.ok(fs.existsSync(fontPath), '内置字体应存在于 src/renderer/fonts（electron-builder files 含 src/**/*）');
assert.ok(fs.readFileSync(fontPath).subarray(0, 4).equals(Buffer.from([0x00, 0x01, 0x00, 0x00])),
  '字体应为合法 TrueType（魔数 00 01 00 00）');
assert.ok(fs.existsSync(path.join(ROOT, 'src', 'renderer', 'fonts', 'OFL-LXGWWenKaiScreen.txt')),
  'OFL 授权文件应随包分发');
assert.ok(cssSrc.includes('@font-face') && cssSrc.includes("'LXGW WenKai Screen'"), 'robin.css 应注册内置字体');
assert.ok(cssSrc.includes('../fonts/LXGWWenKaiScreen.ttf'), '@font-face 应指向随包字体文件');
assert.ok(/fontFamily: \['serif', 'sans', 'wenkai'\]/.test(storeSrc), 'fontFamily 白名单应含 wenkai');
assert.ok(appSrc.includes("wenkai: '"), 'app.js fontMap 应含 wenkai 回退栈');
assert.ok(dialogsSrc.includes("t('霞鹜文楷（内置）')"), '设置面应含霞鹜文楷选项');
assert.ok(stringsSrc.includes('"霞鹜文楷（内置）"'), 'i18n 应含霞鹜文楷英文条目');

// ── 4. 标题字体通道（方向 2 v2）与每日刊头（方向 6）锚点 ──
const smileyPath = path.join(ROOT, 'src', 'renderer', 'fonts', 'SmileySans-Oblique.ttf');
assert.ok(fs.existsSync(smileyPath), '得意黑应存在于 src/renderer/fonts');
assert.ok(fs.readFileSync(smileyPath).subarray(0, 4).equals(Buffer.from([0x00, 0x01, 0x00, 0x00])),
  '得意黑应为合法 TrueType');
assert.ok(fs.existsSync(path.join(ROOT, 'src', 'renderer', 'fonts', 'OFL-SmileySans.txt')), '得意黑 OFL 授权应随包');
assert.ok(cssSrc.includes("'Smiley Sans'") && cssSrc.includes('../fonts/SmileySans-Oblique.ttf'), 'robin.css 应注册得意黑');
assert.ok(cssSrc.includes('--reader-title-font'), 'robin.css 应使用标题字体变量');
assert.ok(/titleFont: \['inherit', 'smiley'\]/.test(storeSrc) && storeSrc.includes("RobinRead.titleFont"), 'AppStore 应含 titleFont 白名单与持久化');
assert.ok(appSrc.includes('--reader-title-font'), 'app.js 应派发标题字体变量');
assert.ok(dialogsSrc.includes("t('得意黑（内置）')") && dialogsSrc.includes("t('标题字体')"), '设置面应含标题字体行');
assert.ok(stringsSrc.includes('"得意黑（内置）"'), 'i18n 应含得意黑条目');
const listSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'views', 'list.js'), 'utf8');
for (const token of ['editionMasthead', 'nj-edition-cover', 'nj-edition-toc-row', '封面故事', '本期目录']) {
  assert.ok(listSrc.includes(token), `list.js 应含刊头要素 ${token}`);
}
assert.ok(/if \(items\.length > 0\) this\.rowsHost\.appendChild\(this\.editionMasthead\(items\)\);/.test(listSrc), '杂志视图应先渲染刊头再渲染网格');
for (const token of ['.nj-edition', 'nj-edition-toc-row', 'nj-fig']) {
  assert.ok(cssSrc.includes(token), `robin.css 应含刊头/图注样式 ${token}`);
}

// ── 5. 同题对比速读（方向 14 v1）：主进程生成器 + 全链路桥 + UI 挂点 ──
assert.ok(storeSrc.includes('async generateClusterBrief(items)'), 'AppStore 应含 generateClusterBrief');
const ipcSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipc.js'), 'utf8');
assert.ok(ipcSrc.includes("handle('ai:clusterBrief'"), 'ipc 应注册 ai:clusterBrief 通道');
const preloadSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'preload.js'), 'utf8');
assert.ok(preloadSrc.includes("clusterBrief: (items) => invoke('ai:clusterBrief', items)"), 'preload 应暴露 clusterBrief 桥');
assert.ok(appSrc.includes('onClusterBrief: showClusterBrief') && appSrc.includes('async function showClusterBrief'), 'app.js 应实现并接线对比速读弹窗');
assert.ok(listSrc.includes('this.handlers.onClusterBrief?.(cluster.items)'), '聚类行应挂 AI 速读按钮');
for (const key of ['同题对比速读', 'AI 速读', '正在生成对比摘要…', '同题报道至少需要两篇才能对比。']) {
  assert.ok(stringsSrc.includes(`"${key}"`), `i18n 应含「${key}」`);
}
assert.ok(cssSrc.includes('.nj-brief-modal') && cssSrc.includes('.cluster-brief-btn'), 'robin.css 应含对比速读样式');

console.log('PASS 排版引擎 v2（盘古之白保真/幂等 + 设置链路锚点全通过）');
process.exit(0);
})().catch((error) => {
  console.error('FAIL', error && error.message ? error.message : error);
  process.exit(1);
});
