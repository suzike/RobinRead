'use strict';
/**
 * edition-reader.js — 期刊翻页阅读（借鉴上游杂志翻页模式）
 * 全屏书页视图：CSS 3D 纸页翻转（rotateY ±180°、四档随机预设、
 * cubic-bezier(0.28,0.12,0.22,1.0) 呼吸感缓动——复刻上游 Metal 翻页的视觉语义）。
 */
import { t } from '../i18n.js';

const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 四档随机翻页预设（借鉴上游 MagazineTurnVariation）：拐角偏移 + 时长。 */
const TURN_PRESETS = [
  { corner: -0.8, dur: 0.34 }, { corner: 0.65, dur: 0.36 },
  { corner: -0.35, dur: 0.32 }, { corner: 1, dur: 0.35 },
];

export class EditionReader {
  constructor({ items = [], startIndex = 0 } = {}) {
    this.items = items.filter((it) => it && it.id);
    this.index = Math.max(0, Math.min(startIndex, this.items.length - 1));
    this.overlay = null;
    this.turning = false;
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
      <div class="er-stage">
        <div class="er-book">
          <div class="er-sheet er-sheet-current"><div class="er-page"><div class="er-loading">${escapeHTML(t('正在装载…'))}</div></div></div>
        </div>
      </div>`;
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
    this._syncPageNo();
    this._loadInto(overlay.querySelector('.er-sheet-current'), this.items[this.index].id);
  }

  dismiss() {
    document.removeEventListener('keydown', this._key);
    this.overlay?.remove();
    this.overlay = null;
  }

  /** 翻页：预装载目标页到翻转叶背面 → 纸页 rotateY ±180° 翻转 → 交接常驻 sheet。 */
  async turn(dir) {
    if (this.turning) return;
    const next = this.index + dir;
    if (next < 0 || next >= this.items.length) return;
    const book = this.overlay.querySelector('.er-book');
    if (!book) return;
    this.turning = true;
    const preset = TURN_PRESETS[Math.floor(Math.random() * TURN_PRESETS.length)];
    const leaf = document.createElement('div');
    leaf.className = 'er-leaf ' + (dir > 0 ? 'er-leaf-fwd' : 'er-leaf-back');
    leaf.innerHTML = `
      <div class="er-leaf-face er-leaf-front"></div>
      <div class="er-leaf-face er-leaf-rear"><div class="er-page er-loading">${escapeHTML(t('正在装载…'))}</div></div>`;
    book.appendChild(leaf);
    const rearPage = leaf.querySelector('.er-leaf-rear .er-page');
    try {
      const res = await window.robin.getReader(this.items[next].id);
      const d = res && res.ok ? res.data : null;
      const content = d ? (typeof d.content === 'string' ? d.content : (d.content && d.content.html) || '') : '';
      this._fillPage(rearPage, d, this.items[next], content);
    } catch (e) {
      rearPage.innerHTML = `<div class="er-loading">${escapeHTML(t('装载失败'))}</div>`;
    }
    leaf.style.animationDuration = `${preset.dur}s`;
    const anim = dir > 0 ? 'er-turn-fwd' : 'er-turn-bwd';
    const onEnd = () => {
      leaf.remove();
      this.index = next;
      const sheet = this.overlay.querySelector('.er-sheet-current');
      if (sheet) {
        sheet.innerHTML = rearPage.innerHTML;
        sheet.scrollTop = 0;
      }
      this._syncPageNo();
      this.turning = false;
      const nn = this.items[next + 1];
      if (nn) window.robin.getReader(nn.id).catch(() => {});
    };
    leaf.addEventListener('animationend', onEnd, { once: true });
    leaf.classList.add(anim);
  }

  _fillPage(page, d, item, content) {
    const feedName = d?.feed?.title || item.feedTitle || '';
    const date = d?.entry?.publishedAt ? new Date(d.entry.publishedAt * 1000).toLocaleDateString('zh-CN') : (item.date || '');
    page.innerHTML = `
      <div class="er-art-head">
        <span class="er-art-feed">${escapeHTML(feedName)}</span>
        <span class="er-art-date">${escapeHTML(date)}</span>
      </div>
      <h1 class="er-art-title">${escapeHTML(d?.entry?.title || item.title || '')}</h1>
      <div class="er-rule"></div>
      <div class="er-art-body"></div>`;
    const body = page.querySelector('.er-art-body');
    body.innerHTML = content;
    body.querySelectorAll('script,style,iframe').forEach((el) => el.remove());
    body.querySelectorAll('img').forEach((im) => { im.loading = 'lazy'; im.referrerPolicy = 'no-referrer'; });
  }

  async _loadInto(sheet, entryID) {
    sheet.innerHTML = `<div class="er-page"><div class="er-loading">${escapeHTML(t('正在装载…'))}</div></div>`;
    try {
      const res = await window.robin.getReader(entryID);
      const d = res && res.ok ? res.data : null;
      const content = d ? (typeof d.content === 'string' ? d.content : (d.content && d.content.html) || '') : '';
      const page = document.createElement('div');
      page.className = 'er-page';
      this._fillPage(page, d, this.items[this.index], content);
      sheet.innerHTML = '';
      sheet.appendChild(page);
      sheet.scrollTop = 0;
    } catch (e) {
      sheet.innerHTML = `<div class="er-page"><div class="er-loading">${escapeHTML(t('装载失败'))}：${escapeHTML(String(e && e.message || e))}</div></div>`;
    }
  }

  _syncPageNo() {
    const el = this.overlay?.querySelector('.er-pageno');
    if (el) el.textContent = `${this.index + 1} / ${this.items.length}`;
  }
}
