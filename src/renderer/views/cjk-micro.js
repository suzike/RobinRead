'use strict';
/**
 * cjk-micro.js — 中文微排版：中西文混排自动加间隙（盘古之白，W3C clreq §3.1.4）
 *
 * 规范要求汉字与西文字母/数字之间保留不多于 1/4 汉字宽的间隙。
 * 实现：在相邻处插入「空的内联 spacer span」（.nj-gap），宽度由 CSS 控制。
 * 只动版面、不动文本——textContent 逐字不变，复制 / 全文搜索 / 高亮与批注锚点全部保真。
 *
 * 纯 DOM 操作、零依赖：renderer 直接 import；离线探针（jsdom）经 require(esm) 桥接使用。
 */

// 汉字（含扩展区）+ 全角标点/符号：与西文相邻都视为需要间隙
const CJK_RE = /[\u2E80-\u2EFF\u3000-\u303F\u31C0-\u31EF\u3200-\u32FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/;
const LATIN_RE = /[A-Za-z0-9]/;
// 代码与已注入的译文不参与混排间距（保持原样）
const SKIP_SELECTOR = 'pre, code, kbd, samp, script, style, textarea, .nj-t, .katex, .MathJax, [data-nj-no-gap]';
const GAP_CLASS = 'nj-gap';

function isBoundary(a, b) {
  if (!a || !b || a === b) return false;
  return (CJK_RE.test(a) && LATIN_RE.test(b)) || (LATIN_RE.test(a) && CJK_RE.test(b));
}

/** 探测相邻节点的边缘字符（跳过 spacer 与无文字节点；空白原样返回 → 判定自然为否）。 */
function neighborChar(node, backward) {
  let sib = backward ? node.previousSibling : node.nextSibling;
  while (sib) {
    if (sib.nodeType === 1) {
      if (sib.classList && sib.classList.contains(GAP_CLASS)) {
        sib = backward ? sib.previousSibling : sib.nextSibling;
        continue;
      }
      const text = sib.textContent || '';
      return backward ? text.slice(-1) : text.slice(0, 1);
    }
    if (sib.nodeType === 3) {
      const text = sib.nodeValue || '';
      if (!text) {
        sib = backward ? sib.previousSibling : sib.nextSibling;
        continue;
      }
      return backward ? text.slice(-1) : text.slice(0, 1);
    }
    sib = backward ? sib.previousSibling : sib.nextSibling;
  }
  return '';
}

function makeGap(doc) {
  const span = doc.createElement('span');
  span.className = GAP_CLASS;
  return span;
}

/** 在 node 与前/后相邻内容之间补间隙；已被 spacer 隔开则不重复。 */
function ensureGapAround(doc, node, backward) {
  const parent = node.parentNode;
  if (!parent) return 0;
  const selfChar = backward ? (node.nodeValue || '').slice(-1) : (node.nodeValue || '').slice(0, 1);
  if (!isBoundary(neighborChar(node, backward), selfChar)) return 0;
  const adjacent = backward ? node.previousSibling : node.nextSibling;
  if (adjacent && adjacent.nodeType === 1 && adjacent.classList.contains(GAP_CLASS)) return 0;
  const gap = makeGap(doc);
  if (backward) parent.insertBefore(gap, node);
  else parent.insertBefore(gap, node.nextSibling);
  return 1;
}

/** 节点内部：逐字符扫边界，splitText 后插 spacer（作者已手工加空格的位置不加白）。返回插入数量。 */
function insertIntoTextNode(doc, node) {
  const text = node.nodeValue || '';
  if (text.length < 2) return 0;
  const parent = node.parentNode;
  if (!parent) return 0;
  let rest = node;
  let base = 0; // rest 首字符在原 text 中的下标
  let inserted = 0;
  for (let i = 1; i < text.length; i += 1) {
    if (!isBoundary(text[i - 1], text[i])) continue;
    const right = rest.splitText(i - base);
    parent.insertBefore(makeGap(doc), right);
    rest = right;
    base = i;
    inserted += 1;
  }
  return inserted;
}

/**
 * 在 root 子树内插入盘古之白 spacer，返回插入数量。
 * 幂等：先 removeGaps 再调用可完全重建。
 */
function insertGaps(rootEl) {
  if (!rootEl) return 0;
  const doc = rootEl.ownerDocument || (rootEl.nodeType === 9 ? rootEl : null);
  if (!doc || !doc.createTreeWalker) return 0;
  const walker = doc.createTreeWalker(rootEl, 4 /* SHOW_TEXT */, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || !parent.closest(SKIP_SELECTOR)) return 1 /* FILTER_ACCEPT */;
      return 2 /* FILTER_REJECT */;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let inserted = 0;
  for (const node of nodes) {
    inserted += ensureGapAround(doc, node, true);
    inserted += ensureGapAround(doc, node, false);
    inserted += insertIntoTextNode(doc, node);
  }
  return inserted;
}

/** 移除子树内全部 spacer，返回移除数量。 */
function removeGaps(rootEl) {
  if (!rootEl || !rootEl.querySelectorAll) return 0;
  const gaps = rootEl.querySelectorAll('.' + GAP_CLASS);
  const count = gaps.length;
  gaps.forEach((el) => el.remove());
  return count;
}

export { insertGaps, removeGaps, isBoundary, GAP_CLASS, CJK_RE, LATIN_RE, SKIP_SELECTOR };
