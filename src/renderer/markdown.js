'use strict';
/**
 * RobinRead Windows — 共享 Markdown 渲染器
 *
 * 安全渲染 AI 回答 / 简报 / 摘要为结构化 HTML。
 * 支持：标题 / 粗体 / 斜体 / 行内代码 / 代码块 / 列表 / 引用 / 链接 / 分隔线。
 */

function escapeHTML(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderMarkdown(raw) {
  const lines = String(raw ?? '').split('\n');
  const out = [];
  let inCode = false;
  let codeBuf = [];
  let listBuf = null; // { type: 'ul'|'ol', items: [] }

  const flushList = () => {
    if (listBuf && listBuf.items.length) {
      out.push(`<${listBuf.type}>${listBuf.items.map((i) => `<li>${i}</li>`).join('')}</${listBuf.type}>`);
      listBuf = null;
    }
  };

  const inline = (s) => {
    let v = escapeHTML(s);
    v = v.replace(/`([^`]+)`/g, '<code>$1</code>');
    v = v.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    v = v.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    v = v.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return v;
  };

  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('```')) {
      if (inCode) {
        out.push(`<pre><code>${escapeHTML(codeBuf.join('\n'))}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }
    if (!t) { flushList(); continue; }

    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }

    const ul = t.match(/^[-*]\s+(.*)$/);
    if (ul) {
      if (!listBuf || listBuf.type !== 'ul') { flushList(); listBuf = { type: 'ul', items: [] }; }
      listBuf.items.push(inline(ul[1]));
      continue;
    }
    const ol = t.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      if (!listBuf || listBuf.type !== 'ol') { flushList(); listBuf = { type: 'ol', items: [] }; }
      listBuf.items.push(inline(ol[1]));
      continue;
    }
    if (t.startsWith('>')) { flushList(); out.push(`<blockquote>${inline(t.replace(/^>\s?/, ''))}</blockquote>`); continue; }
    if (/^([-*_]\s?){3,}$/.test(t)) { flushList(); out.push('<hr/>'); continue; }

    flushList();
    out.push(`<p>${inline(t)}</p>`);
  }
  if (inCode && codeBuf.length) out.push(`<pre><code>${escapeHTML(codeBuf.join('\n'))}</code></pre>`);
  flushList();
  return out.join('\n');
}
