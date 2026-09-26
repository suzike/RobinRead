'use strict';
/**
 * article-search.js — 文章内搜索（方向 12 谱系 · 阅读功能加强）
 *
 * Ctrl+F 唤起：大小写不敏感检索正文文本节点，命中全部高亮（CSS Custom Highlight API，
 * 不改 DOM —— 复制/翻译/批注锚点零影响），Enter/Shift+Enter 在命中间循环导航。
 * 跨行内元素（如 <b>拆开的词）不在 v1 检索范围；代码块与注入译文跳过。
 */
import { t } from '../i18n.js';

const MAX_HITS = 500;
const SKIP_SELECTOR = 'pre, code, script, style, .nj-t, .nj-translation, .katex, .nj-note-marker';

export class ArticleSearch {
  constructor(reader) {
    this.reader = reader;
    this.bar = null;
    this.input = null;
    this.countEl = null;
    this.query = '';
    this.hits = [];
    this.current = -1;
    this._deb = null;
  }

  get open() {
    return !!this.bar;
  }

  open() {
    const reader = this.reader;
    if (!reader.entryID || !reader.body) return;
    if (typeof CSS === 'undefined' || !CSS.highlights) {
      reader.handlers.onFeedback?.(t('当前环境不支持正文搜索高亮。'));
      return;
    }
    if (!this.bar) {
      const bar = document.createElement('div');
      bar.className = 'nj-find-bar';
      bar.innerHTML = `
        <input type="text" spellcheck="false" placeholder="${t('搜索正文…')}"/>
        <span class="nj-find-count">0/0</span>
        <button type="button" class="nj-find-nav nj-find-prev" title="${t('上一个（Shift+Enter）')}">↑</button>
        <button type="button" class="nj-find-nav nj-find-next" title="${t('下一个（Enter）')}">↓</button>
        <button type="button" class="nj-find-close" title="${t('关闭（Esc）')}">✕</button>`;
      this.bar = bar;
      this.input = bar.querySelector('input');
      this.countEl = bar.querySelector('.nj-find-count');
      this.input.addEventListener('input', () => {
        clearTimeout(this._deb);
        this._deb = setTimeout(() => this._run(this.input.value), 220);
      });
      this.input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          if (event.shiftKey) this.prev();
          else this.next();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          this.close();
        }
      });
      bar.querySelector('.nj-find-prev').addEventListener('click', () => this.prev());
      bar.querySelector('.nj-find-next').addEventListener('click', () => this.next());
      bar.querySelector('.nj-find-close').addEventListener('click', () => this.close());
      (reader.scrollEl.parentElement || document.body).appendChild(bar);
    }
    this.bar.style.display = '';
    this.input.focus();
    this.input.select();
  }

  /** 打开搜索条并立即执行 query（搜索结果 → 文章定位闭环）。 */
  run(query) {
    this.open();
    if (!this.bar) return;
    this.input.value = query || '';
    this._deb = null;
    this._run(query || '');
  }

  close() {
    this.bar?.remove();
    this.bar = null;
    this.input = null;
    this._clearHighlights();
  }

  reset() {
    this.close();
  }

  prev() {
    if (!this.hits.length) return;
    this.current = ((this.current - 1) % this.hits.length + this.hits.length) % this.hits.length;
    this._showCurrent();
  }

  next() {
    if (!this.hits.length) return;
    this.current = (this.current + 1) % this.hits.length;
    this._showCurrent();
  }

  _run(query) {
    this.query = String(query || '');
    this._clearHighlights();
    this.hits = this._collectRanges(this.query);
    this.current = this.hits.length ? 0 : -1;
    if (this.hits.length) {
      CSS.highlights.set('nj-find', new Highlight(...this.hits));
      this._showCurrent();
    }
    this._syncCount();
  }

  _collectRanges(query) {
    const ranges = [];
    const body = this.reader.body;
    const q = query.trim().toLowerCase();
    if (!q || !body) return ranges;
    const walker = document.createTreeWalker(body, 4 /* SHOW_TEXT */, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest(SKIP_SELECTOR)) return 2 /* FILTER_REJECT */;
        return node.nodeValue && node.nodeValue.toLowerCase().includes(q) ? 1 /* ACCEPT */ : 3 /* SKIP */;
      },
    });
    let node;
    while ((node = walker.nextNode()) && ranges.length < MAX_HITS) {
      const lower = node.nodeValue.toLowerCase();
      let from = 0;
      let idx = lower.indexOf(q, from);
      while (idx !== -1 && ranges.length < MAX_HITS) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + q.length);
        ranges.push(range);
        from = idx + q.length;
        idx = lower.indexOf(q, from);
      }
    }
    return ranges;
  }

  _showCurrent() {
    if (!this.hits.length || this.current < 0) return;
    CSS.highlights.set('nj-find-current', new Highlight(this.hits[this.current]));
    const el = this.hits[this.current].startContainer.parentElement;
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  _syncCount() {
    if (this.countEl) this.countEl.textContent = `${this.hits.length ? this.current + 1 : 0}/${this.hits.length}`;
  }

  _clearHighlights() {
    try {
      CSS.highlights.delete('nj-find');
      CSS.highlights.delete('nj-find-current');
    } catch (_) { /* 忽略 */ }
    this.hits = [];
    this.current = -1;
  }
}
