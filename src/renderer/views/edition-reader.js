'use strict';
/**
 * edition-reader.js — 期刊翻页阅读（借鉴上游杂志浏览模式）
 * 全屏纸页视图：本期文章逐篇精排展示，←→/按钮翻页，Esc 退出。
 */
import { t } from '../i18n.js';
import { icon } from '../icons.js';

const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class EditionReader {
  constructor({ items = [], startIndex = 0 } = {}) {
    this.items = items.filter((it) => it && it.id);
    this.index = Math.max(0, Math.min(startIndex, this.items.length - 1));
    this.overlay = null;
  }

  present() {
    if (!this.items.length) return;
    const overlay = document.createElement('div');
    overlay.className = 'er-overlay';
    overlay.innerHTML = `
      <div class="er-chrome">
        <span class="er-mast">知更 · 期刊阅读</span>
        <span class="er-pageno"></span>
        <span class="er-actions">
          <button class="er-btn" data-act="prev" title="${escapeHTML(t('上一篇 (←)'))}">‹</button>
          <button class="er-btn" data-act="next" title="${escapeHTML(t('下一篇 (→)'))}">›</button>
          <button class="er-btn" data-act="close" title="${escapeHTML(t('退出 (Esc)'))}">✕</button>
        </span>
      </div>
      <div class="er-stage"><div class="er-page"><div class="er-loading">${escapeHTML(t('正在装载…'))}</div></div></div>`;
    document.body.appendChild(overlay);
    this.overlay = overlay;
    overlay.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close' || e.target === overlay) return this.dismiss();
      if (act === 'prev') return this.turn(-1);
      if (act === 'next') return this.turn(1);
    });
    this._key = (e) => {
      if (e.key === 'Escape') this.dismiss();
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') this.turn(-1);
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') this.turn(1);
    };
    document.addEventListener('keydown', this._key);
    this._load(this.items[this.index].id);
  }

  dismiss() {
    document.removeEventListener('keydown', this._key);
    this.overlay?.remove();
    this.overlay = null;
  }

  turn(dir) {
    const next = this.index + dir;
    if (next < 0 || next >= this.items.length) return;
    this.index = next;
    this._load(this.items[this.index].id);
  }

  async _load(entryID) {
    const page = this.overlay.querySelector('.er-page');
    const item = this.items[this.index];
    page.innerHTML = `<div class="er-loading">${escapeHTML(t('正在装载…'))}</div>`;
    this._syncPageNo();
    try {
      const res = await window.robin.getReader(entryID);
      const d = res && res.ok ? res.data : null;
      const content = d ? (typeof d.content === 'string' ? d.content : (d.content && d.content.html) || '') : '';
      if (!d || !content) throw new Error(t('内容为空'));
      const feedName = d.feed?.title || item.feedTitle || '';
      const date = d.entry?.publishedAt ? new Date(d.entry.publishedAt * 1000).toLocaleDateString('zh-CN') : (item.date || '');
      page.innerHTML = `
        <div class="er-art-head">
          <span class="er-art-feed">${escapeHTML(feedName)}</span>
          <span class="er-art-date">${escapeHTML(date)}</span>
        </div>
        <h1 class="er-art-title">${escapeHTML(d.entry?.title || item.title || '')}</h1>
        <div class="er-rule"></div>
        <div class="er-art-body"></div>`;
      const body = page.querySelector('.er-art-body');
      body.innerHTML = content;
      // 轻处理：去脚本、图片懒显
      body.querySelectorAll('script,style,iframe').forEach((el) => el.remove());
      body.querySelectorAll('img').forEach((im) => { im.loading = 'lazy'; im.referrerPolicy = 'no-referrer'; });
      page.scrollTop = 0;
    } catch (e) {
      page.innerHTML = `<div class="er-loading">${escapeHTML(t('装载失败'))}：${escapeHTML(String(e && e.message || e))}</div>`;
    }
  }

  _syncPageNo() {
    const el = this.overlay?.querySelector('.er-pageno');
    if (el) el.textContent = `${this.index + 1} / ${this.items.length}`;
  }
}
