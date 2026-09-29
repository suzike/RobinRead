'use strict';
/**
 * edition-reader.js — 期刊翻页阅读 2.0（逐细节对标上游 PaperRss v1.4.5 杂志模式）
 *
 * 版面引擎（MagazinePaginator 逐条移植）：版心 1280 / 页边 40 / 中缝 40 / 页眉 76 /
 * 内容全局缩放 0.95；双页对开门槛 860；字号分级 主稿 34·跨栏 22·侧重 19·窄栏 18；
 * 摘要 13–15、来源 13；旁图 ≤32% 宽、画廊 1.85:1、主图 1.5:1 cover 裁切；
 * 组合规则：整叶专题 / 图文开篇 / 整栏·并列·两行短讯·短讯纵组 / 页尾收口 / 末张竖排图增高 / 背封页。
 *
 * 折页翻页（MagazinePageTurnView + Metal shader 语义复刻）：拖拽跟手（0.65×版宽为全程）、
 * 四档 corner 随机预设、cubic-bezier(0.28,0.12,0.22,1.0) 呼吸缓动、settled() 速度续翻、
 * 书脊暗影 + 折带掠射光影 + 投影、纸声仅提交时播放；窄窗/单页形态用淡入。
 *
 * 封面（MagazineCoverLeaf/AnimationSurface 语义复刻）：rotateY −180° 0.65s timing(0.77,0,0.175,1)、
 * 三层纸叠、自动开页 700ms、页首右拖合上。
 *
 * 页码滑轨（MagazinePageRail 逐条移植）：3×8 刻度、当前页 12、悬停波浪 ±3 槽、
 * 编号目录预览浮层、拖拽 scrub 直接驱动折页进度并吸附最近页。
 *
 * 交互（MagazineInputRegion 移植）：三分区点击翻页、边缘 chevron、滚轮节流翻页、
 * 方向键遥控导航（同带优先、页边才翻页、翻回恢复停留卡片）。
 */
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { PAGE_TURN_SOUND_SRC } from '../data/page-turn-sound.js';
import { PAPERS, paperPref, setPaperPref, paperLabel } from './paper-pref.js';

const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ── 版面常量（MagazinePaginator）──
const GUTTER = 40;
const V_INSET = 20;
const HEADING_SP = 16;
const HEADING_H = 20 + HEADING_SP + V_INSET * 2; // 76
const RAIL_H = 52;
const CONTENT_SCALE = 0.95;
const TURN_PRESETS = [
  { corner: -0.8, dur: 0.34 }, { corner: 0.65, dur: 0.36 },
  { corner: -0.35, dur: 0.32 }, { corner: 1, dur: 0.35 },
];

// 版心随窗口比例自适应（92%），跨显示器尺寸连续缩放；上限 2100 防超宽屏夸张
const pageWidth = (w) => Math.min(2100, Math.max(1, Math.round(w * 0.92)));
/* 阅读排版三档（R1）：页边距与密度的唯一真源（JS 版心测量与 CSS 共用） */
const MARGIN_X = { narrow: 24, standard: 36, wide: 52 };
const DENSITY = { compact: { gapY: 18, lh: 0.86 }, standard: { gapY: 24, lh: 1 }, airy: { gapY: 36, lh: 1.26 } };
/* 字号三档（R24）：乘在全局 --article-font-size 上的系数，分页器实测计算样式自动跟随 */
const FONTSCALE = { small: 0.9, standard: 1, large: 1.14 };
const hInset = (w, margin = 'standard') => Math.min(w < 620 ? 20 : (MARGIN_X[margin] || 36), (pageWidth(w) - 1) / 2);
const turnInset = (h) => Math.min(14, Math.max(0, h - RAIL_H) * 0.03);

/** cubic-bezier(0.28,0.12,0.22,1.0) 求解（MagazineTurnGeometry.eased 二分法原样移植）。 */
function bezierEase(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const X = (tt) => 3 * (1 - tt) * (1 - tt) * tt * 0.28 + 3 * (1 - tt) * tt * tt * 0.22 + tt * tt * tt;
  const Y = (tt) => 3 * (1 - tt) * (1 - tt) * tt * 0.12 + 3 * (1 - tt) * tt * tt * 1.0 + tt * tt * tt;
  let low = 0, high = 1, tt = x;
  for (let i = 0; i < 14; i++) {
    tt = (low + high) / 2;
    if (X(tt) < x) low = tt; else high = tt;
  }
  tt = (low + high) / 2;
  return Y(tt);
}
/** 松手速度续翻：三次曲线保留切线（MagazineTurnGeometry.settled 原样移植）。 */
const settledEase = (time, slope) => {
  const tt = clamp(time, 0, 1);
  return (-2 * tt * tt * tt + 3 * tt * tt) + slope * (tt * tt * tt - 2 * tt * tt + tt);
};

export class EditionReader {
  /**
   * @param {{items:Array, startIndex?:number, onOpen?:(item:Object)=>void, reduceMotion?:boolean}} opts
   * items 条目字段：id/title/summaryPreview/sourceTitle/contentHead/publishedAt/isRead/isStarred/isLater
   */
  constructor({ items = [], startIndex = 0, onOpen = null, reduceMotion = false, fetchArticle = null, feedKey = '', onContext = null, onToggleStar = null, onToggleLater = null } = {}) {
    this.items = (items || []).filter((it) => it && it.id).map((it) => ({
      id: it.id,
      title: this._stripHTML(it.title) || t('未命名文章'),
      summary: this._stripHTML(it.summaryPreview),
      image: this._firstImage(it.contentHead),
      source: this._stripHTML(it.sourceTitle),
      date: it.publishedAt || 0,
      isRead: !!it.isRead,
      isStarred: !!it.isStarred,
      isLater: !!it.isLater,
      readMinutes: Number(it.readMinutes) || 0,
      raw: it,
    }));
    this.startIndex = Math.max(0, startIndex);
    this.onOpen = onOpen;
    this.onToggleStar = onToggleStar || null;
    this.onToggleLater = onToggleLater || null;
    this.reduceMotion = reduceMotion || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.soundSrc = PAGE_TURN_SOUND_SRC;
    this.title = this.items[0]?.source || t('本期选读');
    this.measureCache = new Map();
    this.pages = [];
    this.index = 0;
    this.open = false;          // 封面是否已翻开
    this.selected = null;       // 当前选中卡片（遥控导航）
    this.lastSelByPage = new Map();
    this.turn = null;           // {dir,toIdx,progress,phase,...}
    this.scrub = null;          // 滑轨拖拽会话
    this.mode = 'edition';      // 'edition' 版面模式 | 'article' 正文翻页模式
    this.article = null;        // { entry, html, spreads }
    this._editionState = null;  // 进入正文前的版面快照 { pages, index, selected }
    this._fetchArticle = fetchArticle || (async (id) => this._fetchArticleGoverned(id));
    this.feedKey = feedKey;
    this.onContext = onContext;
    this._sound = null;
    this._resizeTimer = 0;
    this._autoTimer = 0;
  }

  _firstImage(html) {
    if (!html) return '';
    const m = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
    return m && /^https?:|data:/.test(m[1]) ? m[1] : '';
  }

  /** 剥 HTML 标签 + 解常见实体（RSS 摘要/标题常含片段 HTML，杂志卡片只显示纯文本）。 */
  _stripHTML(s) {
    return String(s ?? '')
      .replace(/<(script|style)[\s\S]*?<\/(script|style)>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** 全文治理链（对齐正文视图 _openBody）：needsExtraction 抓取 → 过短(<400字)抓原文补全 → 摘要兜底。 */
  async _fetchArticleGoverned(id) {
    const plainLen = (h) => String(h ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
    const res = await window.robin.getReader(id);
    const d = res && res.ok ? res.data : null;
    if (!d) return '';
    let html = typeof d.content === 'string' ? d.content : (d.content && d.content.html) || '';
    const entry = d.entry || {};
    if (d.content?.needsExtraction && entry.url) {
      try {
        const extracted = await window.robin.extractArticle(id);
        if (extracted?.ok && extracted.data?.html && plainLen(extracted.data.html) >= 120) html = extracted.data.html;
      } catch { /* 抓取失败用原 content */ }
    }
    if (entry.url && html && plainLen(html) < 400) {
      try {
        const extracted = await window.robin.extractArticle(id);
        if (extracted?.ok && extracted.data?.html && plainLen(extracted.data.html) > Math.max(plainLen(html), 150)) html = extracted.data.html;
      } catch { /* 同上 */ }
    }
    if (!html || plainLen(html) < 80) {
      const summary = entry.summary || '';
      if (plainLen(summary) > plainLen(html)) html = `<p>${escapeHTML(summary)}</p>`;
    }
    return html;
  }

  // ────────────────────────────────────────────────
  // 尺寸
  // ────────────────────────────────────────────────
  _metrics() {
    const w = window.innerWidth, h = window.innerHeight;
    const ins = turnInset(h);
    const paperW = pageWidth(w);
    const bookH = Math.max(1, h - RAIL_H - ins * 2);
    const hi = hInset(w, this.typo?.margin);
    const contentW = Math.max(1, paperW - hi * 2);
    const flow = paperW < 620 || (h - RAIL_H) < 460;
    const spread = !flow && paperW >= 860;
    const leafW = spread ? (contentW - GUTTER) / 2 : contentW;
    return { w, h, ins, paperW, bookH, hi, contentW, flow, spread, leafW };
  }

  // ────────────────────────────────────────────────
  // 条目测量（隐藏 DOM 实测，等价 MagazineMeasurementCache）
  // ────────────────────────────────────────────────
  _styleKey(st, width) {
    return [st.role, st.titleSize, st.titleLines, st.summaryLines, st.summarySize,
      Math.round(st.imageH), st.beside ? 1 : 0, Math.round(st.sideW || 0), Math.round(width),
      this.typo?.density || 'standard', this.typo?.firstCap ? 1 : 0].join('/');
  }
  /** 密度行距系数（标题按一半幅度跟随，摘要全文跟随）。 */
  _den() { return DENSITY[this.typo?.density]?.lh ?? 1; }
  _measure(entry, st, width) {
    const key = `${entry.id}|${entry.title.length}|${entry.summary.length}|${this._styleKey(st, width)}`;
    if (this.measureCache.has(key)) return this.measureCache.get(key);
    if (this.measureCache.size > 4096) this.measureCache.clear();
    const el = this._buildStory(entry, st, width, { skeleton: true });
    el.style.width = `${width}px`;
    this.measureHost.appendChild(el);
    const h = Math.ceil(el.getBoundingClientRect().height);
    el.remove();
    this.measureCache.set(key, h);
    return h;
  }
  _measureText(entry, st, width) {
    const bare = { ...st, imageH: 0, beside: false };
    return this._measure(entry, bare, width);
  }
  _titleFits(entry, st, width) {
    const mk = (lines) => {
      const el = document.createElement('h3');
      el.className = 'er-title';
      el.style.cssText = `width:${Math.max(1, width)}px;font-size:${st.titleSize * CONTENT_SCALE}px;line-height:${((st.titleSize + 2 * CONTENT_SCALE) / st.titleSize) * (1 + (this._den() - 1) * 0.4)};`;
      if (lines < 10000) el.style.webkitLineClamp = lines;
      el.textContent = entry.title;
      el.style.display = '-webkit-box'; el.style.webkitBoxOrient = 'vertical'; el.style.overflow = 'hidden';
      this.measureHost.appendChild(el);
      const h = el.getBoundingClientRect().height;
      el.remove();
      return h;
    };
    return mk(10000) <= mk(st.titleLines) + 1;
  }
  _imgW(st, width) {
    return st.stacks ? Math.max(1, width) : (st.sideW ?? Math.min(width * 0.32, st.imageH * 1.5));
  }
  _matchingSide(st, entry, width) {
    if (!st.beside || !(st.imageH > 0)) return st;
    const out = { ...st, sideW: this._imgW(st, width) };
    out.imageH = Math.ceil(this._measureText(entry, out, width));
    return out;
  }

  // ────────────────────────────────────────────────
  // 条目样式档位（MagazineStoryStyle: normal/supporting/panel/fitted）
  // ────────────────────────────────────────────────
  _normal(entry, width, lead = false) {
    const hasImage = !!entry.image;
    const st = { role: 'supporting', titleSize: 24, titleLines: 3, summaryLines: 3, summarySize: 15, imageH: 0, beside: false, sideW: null, stacks: true };
    if (!hasImage && (!entry.summary || this._measureText(entry, st, width) <= 155)) {
      st.role = 'list'; st.titleSize = 19; st.titleLines = 4;
    }
    if (lead) { st.role = 'lead'; st.titleSize = 34; st.titleLines = hasImage ? 3 : 5; }
    if (hasImage) {
      st.beside = !lead && width >= 360;
      st.stacks = !st.beside;
      st.imageH = st.beside ? Math.min(112, width * 0.20) : Math.max(1, width) / 1.5;
      if (lead && !this._titleFits(entry, st, width)) { st.imageH = 0; st.titleLines = 5; }
    }
    return this._matchingSide(st, entry, width);
  }
  _supporting(entry, width, limit) {
    const st = { role: 'supporting', titleSize: 19, titleLines: 3, summaryLines: 2, summarySize: 13, imageH: 0, beside: false, sideW: null, stacks: true };
    if (entry.image) { st.beside = true; st.stacks = false; st.imageH = Math.min(112, width * 0.20); }
    return this._fitted(entry, st, width, limit, 2, true);
  }
  _panel(entry, width, wide, compactImage = false) {
    const st = { role: 'gallery', titleSize: wide ? 22 : 18, titleLines: wide ? 3 : 4, summaryLines: wide ? 3 : 2, summarySize: wide ? 14 : 13, imageH: 0, beside: false, sideW: null, stacks: true };
    if (entry.image) {
      if (compactImage) { st.beside = true; st.stacks = false; st.imageH = 76; }
      else st.imageH = Math.max(1, width) / 1.85;
    }
    return this._matchingSide(st, entry, width);
  }
  _fitted(entry, st, width, limit, minTitleLines = 2, mayHideImage = false) {
    let out = { ...st };
    while (this._measure(entry, out, width) > limit && out.summaryLines > 0) out.summaryLines -= 1;
    while (this._measure(entry, out, width) > limit && out.imageH > 72) out.imageH = Math.max(72, out.imageH - 24);
    while (this._measure(entry, out, width) > limit && out.titleLines > minTitleLines) out.titleLines -= 1;
    if (mayHideImage && this._measure(entry, out, width) > limit) out.imageH = 0;
    out = this._matchingSide(out, entry, width);
    return this._measure(entry, out, width) <= limit ? out : null;
  }

  // ────────────────────────────────────────────────
  // 分页器（MagazinePaginator.pages 移植）
  // ────────────────────────────────────────────────
  _paginate() {
    const m = this._metrics();
    const { paperW, hi, contentW, leafW, spread, flow } = m;
    const height = Math.max(1, m.bookH - RAIL_H * 0 - HEADING_H); // 书页内容高（页眉含在内：bookH 已含页眉空间）
    const pageH = m.bookH - HEADING_H;
    const entries = this.items;
    const gapY = DENSITY[this.typo?.density]?.gapY ?? 24;
    this.pages = [];
    if (!entries.length) return;
    const useH = Math.max(120, pageH - 18); // 底部预留 folio 页码带，避免末行 meta 与页码相贴

    const place = (entry, x, y, w, h, st) => ({ entryID: entry.id, x, y, w, h, st });
    const measure = (e, st, w) => this._measure(e, st, w);

    // —— 单页 DP 装排（pack）：单条 / 并列双稿 ——
    const pack = (list, width, limit, lead, compact) => {
      let result = { ps: [], height: 0, void: 0 };
      let cursor = 0;
      while (cursor < list.length) {
        const count = Math.min(12, list.length - cursor);
        const states = new Map([[0, result]]);
        for (let offset = 0; offset < count; offset++) {
          const path = states.get(offset);
          if (!path) continue;
          const options = [];
          const isLead = lead && cursor + offset === 0;
          const one = this._normal(list[cursor + offset], width, isLead);
          const h1 = measure(list[cursor + offset], one, width);
          options.push({ ps: [place(list[cursor + offset], 0, 0, width, h1, one)], height: h1, void: 0 });
          if (!isLead && offset + 1 < count) {
            const pw = (width - 24) / 2;
            if (pw >= 220) {
              const a = list[cursor + offset], b = list[cursor + offset + 1];
              const sa = this._normal(a, pw, false), sb = this._normal(b, pw, false);
              const ha = measure(a, sa, pw), hb = measure(b, sb, pw);
              if (this._titleFits(a, sa, pw) && this._titleFits(b, sb, pw) && Math.abs(ha - hb) <= 64) {
                options.push({
                  ps: [place(a, 0, 0, pw, ha, sa), place(b, pw + 24, 0, pw, hb, sb)],
                  height: Math.max(ha, hb), void: Math.abs(ha - hb) * pw,
                });
              }
            }
          }
          for (const row of options) {
            const y = path.ps.length ? path.height + gapY : 0;
            const next = {
              ps: [...path.ps, ...row.ps.map((p) => ({ ...p, y: p.y + y }))],
              height: y + row.height, void: path.void + row.void,
            };
            if (next.height > limit) continue;
            const consumed = offset + row.ps.length;
            const old = states.get(consumed);
            if (old && (old.height > next.height || (old.height === next.height && old.void <= next.void))) continue;
            states.set(consumed, next);
          }
        }
        const consumed = Math.max(...states.keys());
        if (consumed > 0) { result = states.get(consumed); cursor += consumed; }
        if (consumed < count) break;
      }
      if (compact && cursor < list.length) {
        const entry = list[cursor];
        let st = this._normal(entry, width, lead && cursor === 0);
        while (st.summaryLines > 0) {
          st = { ...st, summaryLines: st.summaryLines - 1 };
          st = this._matchingSide(st, entry, width);
          const h = measure(entry, st, width);
          const y = result.ps.length ? result.height + gapY : 0;
          if (y + h <= limit) {
            return { ps: [...result.ps, place(entry, 0, y, width, h, st)], height: y + h, void: result.void };
          }
        }
        if (st.beside && st.imageH > 80) {
          st = { ...st, imageH: 80 };
          const h = measure(entry, st, width);
          const y = result.ps.length ? result.height + gapY : 0;
          if (y + h <= limit) return { ps: [...result.ps, place(entry, 0, y, width, h, st)], height: y + h, void: result.void };
        }
      }
      return result;
    };

    // —— 整叶专题（featureSpread）——
    const featureSpread = (list) => {
      const first = list[0];
      if (!first.image || list.length < 5 || useH < 460) return null;
      const st = this._normal(first, leafW, true);
      if (!(st.imageH > 0) || !this._titleFits(first, st, leafW)) return null;
      const noImg = { ...st, imageH: 0 };
      const textH = measure(first, noImg, leafW);
      const imgH = Math.floor(useH - textH - 16 * CONTENT_SCALE);
      if (imgH < Math.max(220, useH * 0.48)) return null;
      const leadSt = { ...noImg, imageH: imgH };
      const leadH = measure(first, leadSt, leafW);
      const ps = [place(first, 0, 0, leafW, leadH, leadSt)];
      let y = 0;
      for (const entry of list.slice(1)) {
        const side = this._supporting(entry, leafW, Infinity);
        if (!side) break;
        const h = measure(entry, side, leafW);
        if (y + h > useH) break;
        ps.push(place(entry, leafW + GUTTER, y, leafW, h, side));
        y += h + gapY;
      }
      if (ps.length < 4 || y - 24 < useH * 0.56) return null;
      return { ps, height: leadH, template: 'feature' };
    };

    // —— 编辑部对开（editorialSpread）：左右两叶各自游标推进 ——
    const editorialSpread = (list, usesLead) => {
      if (!list.length) return { ps: [], height: 0 };
      const laneW = (leafW - 24) / 2;
      const placed = [];
      let cursor = 0, leftY = 0, rightY = 0;
      const hasImage = (e) => !!e.image;
      const moved = (path, dx, dy) => path.ps.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));

      const block = (i, limit, compact) => {
        if (i >= list.length) return [];
        const entry = list[i];
        const options = [];
        const mkStory = (idx, width, wide) => {
          let st = this._panel(list[idx], width, wide);
          if (compact) {
            st.summaryLines = Math.min(1, st.summaryLines);
            if (hasImage(list[idx])) st = this._panel(list[idx], width, wide, true);
            st.summaryLines = Math.min(1, st.summaryLines);
          }
          st = this._matchingSide(st, list[idx], width);
          const h = measure(list[idx], st, width);
          if (h > limit) {
            if (compact || st.beside || !(st.imageH > 0)) return null;
            const fit = this._fitted(list[idx], st, width, limit, 2, false);
            if (!fit) return null;
            const fh = measure(list[idx], fit, width);
            if (fh > limit) return null;
            return place(list[idx], 0, 0, width, fh, fit);
          }
          return place(list[idx], 0, 0, width, h, st);
        };
        const full = mkStory(i, leafW, true);
        if (full) {
          const brief = !hasImage(entry) && (entry.summary || '').length < 40 && (entry.title || '').length < 30;
          options.push({ ps: [full], height: full.h, void: brief ? leafW * 22 : 0 });
        }
        if (i + 1 < list.length && laneW >= 220) {
          const a = mkStory(i, laneW, false), b = mkStory(i + 1, laneW, false);
          if (a && b) {
            const h = Math.max(a.h, b.h), diff = Math.abs(a.h - b.h);
            if (diff <= Math.max(56, h * 0.24)) {
              options.push({
                ps: [a, { ...b, x: laneW + 24 }],
                height: h, void: diff * laneW,
              });
            }
          }
        }
        if (i + 3 < list.length && laneW >= 220 && list.slice(i, i + 4).every((e) => !hasImage(e))) {
          const group = [];
          let y = 0, holes = 0, ok = true;
          for (let row = 0; row < 2; row++) {
            const a = mkStory(i + row * 2, laneW, false), b = mkStory(i + row * 2 + 1, laneW, false);
            if (!a || !b) { ok = false; break; }
            const h = Math.max(a.h, b.h);
            if (Math.abs(a.h - b.h) > 56 || y + h > limit) { ok = false; break; }
            group.push({ ...a, y }, { ...b, x: laneW + 24, y });
            holes += Math.abs(a.h - b.h) * laneW;
            y += h + gapY;
          }
          if (ok && group.length === 4) options.push({ ps: group, height: y - 24, void: holes });
        }
        if (!hasImage(entry)) {
          const group = [];
          let y = 0;
          for (let idx = i; idx < Math.min(list.length, i + 3); idx++) {
            if (hasImage(list[idx])) break;
            let st = this._panel(list[idx], leafW, true);
            st.titleSize = 19; st.summaryLines = compact ? 1 : 2; st.summarySize = 13;
            st = this._matchingSide(st, list[idx], leafW);
            const h = measure(list[idx], st, leafW);
            if (y + h > limit) break;
            group.push(place(list[idx], 0, y, leafW, h, st));
            y += h + gapY;
            if (group.length >= 2) options.push({ ps: [...group], height: y - 24, void: leafW * 70 });
          }
        }
        return options;
      };
      const limit0 = useH;
      void limit0;

      if (usesLead) {
        let leadSt = this._normal(list[0], leafW, true);
        if (!hasImage(list[0])) { leadSt.titleSize = 30; leadSt.titleLines = 3; leadSt.summaryLines = 2; }
        const leadLimit = Math.min(useH * 0.62, 520);
        const fit = this._fitted(list[0], leadSt, leafW, leadLimit, 3, false);
        if (fit) leadSt = fit;
        const leadH = measure(list[0], leadSt, leafW);
        if (leadH > useH) return { ps: [], height: 0 };
        placed.push(place(list[0], 0, 0, leafW, leadH, leadSt));
        cursor = 1;
        leftY = leadH + 32;
        const rail = [];
        let railH = 0;
        while (cursor < list.length && rail.length < 4) {
          const y = rail.length ? railH + 24 : 0;
          const st = this._supporting(list[cursor], leafW, Infinity);
          if (!st) break;
          const h = measure(list[cursor], st, leafW);
          if (y + h > useH) break;
          rail.push(place(list[cursor], leafW + GUTTER, y, leafW, h, st));
          railH = y + h;
          cursor += 1;
        }
        if (!rail.length) return { ps: [], height: 0 };
        if (rail.length > 1 && leadH > railH) {
          const extra = Math.min(12, (leadH - railH) / (rail.length - 1));
          rail.forEach((p, i) => { p.y += i * extra; }); // 只微调组间距，不改游标次序
          railH = rail[rail.length - 1].y + rail[rail.length - 1].h;
        }
        placed.push(...rail);
        rightY = railH + 32;
      }

      const tailStory = (i, room) => {
        if (i >= list.length || room < 64) return null;
        const st = this._supporting(list[i], leafW, room);
        if (!st) return null;
        const h = measure(list[i], st, leafW);
        if (h > room) return null;
        return { ps: [place(list[i], 0, 0, leafW, h, st)], height: h, void: 0 };
      };
      const leafOptions = (i, room, compact) => {
        if (i >= list.length || room < 64) return [{ ps: [], height: 0, void: 0 }];
        const options = block(i, room, compact);
        if (!options.length) {
          const tail = tailStory(i, room);
          if (tail) options.push(tail);
        }
        options.push({ ps: [], height: 0, void: 0 });
        return options;
      };
      const leafScore = (path, room, compact, hw) => {
        if (!path.ps.length) return (room / Math.max(1, useH)) * 40;
        const count = path.ps.length;
        const narrow = path.ps.filter((p) => p.w < leafW - 1).length;
        let score = (path.void / (leafW * Math.max(1, path.height))) * 200;
        score -= count * 4 + narrow * 5;
        score -= (path.height / Math.max(1, room)) * hw;
        if (compact) score += 8;
        return score;
      };

      let guard = 0;
      while (cursor < list.length && guard++ < 200) {
        const leftRoom = useH - leftY, rightRoom = useH - rightY;
        if (Math.max(leftRoom, rightRoom) < 64) break;
        const lanes = laneW >= 220 ? 4.0 : 2.0;
        const projectedRows = (list.length - cursor + lanes - 1) / lanes;
        const tight = projectedRows * 90 > Math.max(leftRoom, rightRoom);
        const hw = tight ? 30 : 160;
        let chosen = null;
        for (const compact of [false, true]) {
          for (const left of leafOptions(cursor, leftRoom, compact)) {
            for (const right of leafOptions(cursor + left.ps.length, rightRoom, compact)) {
              if (!left.ps.length && !right.ps.length) continue;
              const score = leafScore(left, leftRoom, compact, hw) + leafScore(right, rightRoom, compact, hw);
              if (!chosen || score < chosen.score) chosen = { left, right, score };
            }
          }
        }
        if (!chosen) break;
        placed.push(...moved(chosen.left, 0, leftY));
        placed.push(...moved(chosen.right, leafW + GUTTER, rightY));
        if (chosen.left.ps.length) leftY += chosen.left.height + 32;
        if (chosen.right.ps.length) rightY += chosen.right.height + 32;
        cursor += chosen.left.ps.length + chosen.right.ps.length;
      }
      const bottom = placed.reduce((acc, p) => Math.max(acc, p.y + p.h), 0);
      return { ps: placed, height: bottom };
    };

    // —— 叶尾竖排图增高收口（flushLeafTails）——
    const flushLeafTails = (ps, leafWidth, hgt, isSpread) => {
      if (hgt <= 0 || !ps.length) return ps;
      const columns = isSpread
        ? [[0, leafWidth], [leafWidth + GUTTER, leafWidth * 2 + GUTTER]]
        : [[0, Math.max(leafWidth, ...ps.map((p) => p.x + p.w))]];
      const result = ps.map((p) => ({ ...p }));
      for (const [cx0, cx1] of columns) {
        const idxs = result.map((p, i) => (p.x >= cx0 && p.x < cx1 ? i : -1)).filter((i) => i >= 0);
        if (!idxs.length) continue;
        let target = -1, maxY = -1;
        for (const i of idxs) if (result[i].y + result[i].h > maxY) { maxY = result[i].y + result[i].h; target = i; }
        if (target < 0) continue;
        const pl = result[target];
        const extra = hgt - (pl.y + pl.h);
        if (extra < 32 || !pl.st.stacks || !(pl.st.imageH > 0) || pl.st.imageH >= leafWidth) continue;
        if (!idxs.every((i) => i === target || result[i].y + result[i].h <= pl.y + 1)) continue;
        const cap = Math.floor(Math.min(extra, 200, leafWidth - pl.st.imageH));
        if (cap < 24) continue;
        pl.st = { ...pl.st, imageH: pl.st.imageH + cap };
        pl.h += cap;
      }
      return result;
    };

    // —— 组循环（单组 = 本期全部条目）——
    let cursor = 0;
    const groupTitle = this.title;
    while (cursor < entries.length) {
      const remaining = entries.slice(cursor);
      const first = remaining[0];
      const usesLead = remaining.length >= 4 && (!!first.image || (first.summary || '').length >= 96 || (first.title || '').length >= 48);
      let template = !usesLead ? 'briefs' : (this._normal(first, leafW, true).imageH > 0 ? 'imageLead' : 'textLead');
      let form = spread ? 'spread' : 'single';
      let chosenPaper = paperW;
      let chosenHeight = useH;
      let ps = [];
      const endOfGroup = true;
      if (!flow && endOfGroup) {
        const endingPaper = Math.min(paperW, 720);
        const ending = pack(remaining, Math.max(120, endingPaper - hi * 2), useH, false, false);
        if (ending.ps.length === remaining.length) {
          if (spread) {
            const left = pack(remaining, leafW, useH, false, false);
            if (left.ps.length === remaining.length) {
              ps = left.ps; chosenHeight = useH; chosenPaper = paperW; form = 'spread'; template = 'ending';
            }
          } else {
            ps = ending.ps; chosenHeight = useH; chosenPaper = endingPaper; form = 'single'; template = 'ending';
          }
        }
      }
      if (!ps.length && !flow) {
        if (spread) {
          const variation = String(first.id).split('').reduce((a, c) => (a ^ c.charCodeAt(0)) * 1099511628211, 14695981039346656000) >>> 0;
          const prefersFeature = first.isStarred || (first.summary || '').length >= 160 || variation % 4 === 0;
          let done = false;
          if (prefersFeature && template !== 'feature' && this.pages[this.pages.length - 1]?.template !== 'feature') {
            const feature = featureSpread(remaining);
            if (feature) { ps = feature.ps; template = 'feature'; done = true; }
          }
          if (!done) {
            const editorial = editorialSpread(remaining, usesLead);
            ps = editorial.ps;
          }
          if (!ps.length) {
            const left = pack(remaining, leafW, useH, usesLead, true);
            const right = pack(remaining.slice(left.ps.length), leafW, useH, false, true);
            const total = left.ps.length + right.ps.length;
            const originalLeft = left.ps.length;
            if (originalLeft > 1) {
              for (let split = Math.max(1, originalLeft - 12); split < originalLeft; split++) {
                const cl = pack(remaining.slice(0, split), leafW, useH, usesLead, false);
                if (cl.ps.length !== split) continue;
                const cr = pack(remaining.slice(split, split + (total - split)), leafW, useH, false, false);
                if (cr.ps.length !== total - split) continue;
                const oldDiff = Math.abs(left.height - right.height);
                const newDiff = Math.abs(cl.height - cr.height);
                if (newDiff < oldDiff || (newDiff === oldDiff && cl.void + cr.void < left.void + right.void)) { left = cl; right = cr; }
              }
            }
            ps = [...left.ps, ...right.ps.map((p) => ({ ...p, x: p.x + leafW + GUTTER }))];
          }
        } else {
          ps = pack(remaining, leafW, useH, usesLead, true).ps;
        }
      }
      if (flow || !ps.length) {
        form = 'flow';
        const path = { ps: [], height: 0 };
        for (const entry of remaining.slice(0, flow ? 12 : 1)) {
          const st = this._normal(entry, leafW, false);
          st.titleLines = 10000; st.summaryLines = 10000;
          const h = measure(entry, st, leafW);
          const y = path.ps.length ? path.height + gapY : 0;
          path.ps.push(place(entry, 0, y, leafW, h, st));
          path.height = y + h;
        }
        ps = path.ps;
        chosenHeight = Math.max(useH, path.height);
      }
      if (!flow && template !== 'ending' && ps.length) {
        ps = flushLeafTails(ps, leafW, chosenHeight, spread);
      }
      if (template === 'ending' && ps.length) {
        // 末页收尾：内容块在叶内垂直居中，避免「上半页内容 + 下半页空白」的失衡
        const blockH = ps.reduce((acc, p) => Math.max(acc, p.y + p.h), 0);
        const lift = Math.max(0, Math.floor((useH - blockH) / 2));
        if (lift > 0) ps = ps.map((p) => ({ ...p, y: p.y + lift }));
      }
      const accepted = remaining.slice(0, ps.length);
      this.pages.push({
        id: `p${this.pages.length}:${first.id}`,
        title: groupTitle,
        entries: accepted,
        placements: ps,
        height: chosenHeight,
        template, form,
        paperW: chosenPaper,
        isEnd: endOfGroup && ps.length === remaining.length,
      });
      cursor += ps.length;
      if (!ps.length) break; // 防御：避免死循环
    }
    void height; void contentW; void hi;
  }

  // ────────────────────────────────────────────────
  // DOM 装配
  // ────────────────────────────────────────────────
  present() {
    if (!this.items.length) return;
    const overlay = document.createElement('div');
    overlay.className = 'er-overlay';
    overlay.dataset.paper = paperPref();
    if (document.body.classList.contains('dark')) overlay.classList.add('er-dark');
    overlay.innerHTML = `
      <div class="er-stage">
        <div class="er-bookwrap">
          <div class="er-book">
            <div class="er-sheet" data-role="a"></div>
            <div class="er-sheet" data-role="b"></div>
            <div class="er-cast"></div>
            <div class="er-leaf" hidden>
              <div class="er-face er-face-front"><div class="er-face-shade"></div></div>
              <div class="er-face er-face-back"><div class="er-face-shade"></div></div>
            </div>
            <div class="er-cover" hidden>
              <div class="er-cover-right"></div>
              <div class="er-cover-leaf">
                <div class="er-face er-cover-front"><div class="er-face-shade"></div></div>
                <div class="er-face er-cover-back"></div>
              </div>
            </div>
          </div>
          <button class="er-edge" data-dir="-1" hidden>‹</button>
          <button class="er-edge" data-dir="1" hidden>›</button>
        </div>
        <div class="er-rail" hidden><div class="er-ticks"></div><div class="er-preview" hidden></div><div class="er-count" hidden></div></div>
      </div>
      <div class="er-tools">
        <button class="er-sound" title="${escapeHTML(t('翻页音效'))}"></button>
        <button class="er-paper" title="${escapeHTML(t('切换纸张质感'))}"></button>
        <button class="er-type" title="${escapeHTML(t('阅读排版'))}">Aa</button>
        <button class="er-find" title="${escapeHTML(t('搜索 (Ctrl+F)'))}">${icon('search')}</button>
        <button class="er-export" title="${escapeHTML(t('导出当前页图片'))}">${icon('export')}</button>
        <button class="er-keys" title="${escapeHTML(t('快捷键 (Shift+/)'))}">${icon('keyboard')}</button>
        <button class="er-full" title="${escapeHTML(t('沉浸全屏 (F)'))}">${icon('expand')}</button>
        <button class="er-close" title="${escapeHTML(t('退出 (Esc)'))}">✕</button>
      </div>
      <div class="er-notice" hidden></div>`;
    document.body.appendChild(overlay);
    this.overlay = overlay;
    overlay.__editionReader = this;
    // R35：工具条与舞台手势隔离——pointer/mouse 系不再外泄（拖拽翻页/划词永不误触）；click 仍冒泡供 overlay 委托
    const toolsIsolate = overlay.querySelector('.er-tools');
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'touchstart', 'dblclick']) {
      toolsIsolate.addEventListener(type, (e) => e.stopPropagation());
    }
    // 纸张质感四态（与列表刊头共用偏好；夜间独立记忆见 paper-pref.js）；按钮带当前纸色样本
    const paperBtn = overlay.querySelector('.er-paper');
    const paperBtnSync = () => {
      const chip = { paper: '#F6F2E7', white: '#FFFFFF', book: '#EFE2C8', kraft: '#E9DCC0' }[overlay.dataset.paper] || '#F6F2E7';
      paperBtn.innerHTML = `<i class="er-paper-chip" style="background:${chip}"></i>${escapeHTML(t(paperLabel(overlay.dataset.paper)))}`;
    };
    paperBtnSync();
    paperBtn.addEventListener('click', () => {
      const next = PAPERS[(PAPERS.indexOf(overlay.dataset.paper) + 1) % PAPERS.length];
      overlay.dataset.paper = next;
      setPaperPref(next);
      paperBtnSync();
    });
    // 翻页音效开关（偏好持久化）
    this.soundOn = localStorage.getItem('robinread.editionSound') !== '0';
    const soundBtn = overlay.querySelector('.er-sound');
    const soundLabel = () => (this.soundOn ? t('有声') : t('静音'));
    soundBtn.textContent = soundLabel();
    soundBtn.addEventListener('click', () => {
      this.soundOn = !this.soundOn;
      localStorage.setItem('robinread.editionSound', this.soundOn ? '1' : '0');
      soundBtn.textContent = soundLabel();
    });
    // 沉浸全屏（F 键同效）
    overlay.querySelector('.er-full').addEventListener('click', () => this._toggleFullscreen());
    // 期刊内搜索（R11）：Ctrl+F 或工具条按钮
    overlay.querySelector('.er-find').addEventListener('click', () => this._findOpen());
    // 当前页导出图片（R13）：截取书页矩形 → 复制剪贴板
    overlay.querySelector('.er-export').addEventListener('click', () => this._exportPage());
    // 快捷键速查（R14）
    overlay.querySelector('.er-keys').addEventListener('click', () => this._toggleKeysPanel());
    // 阅读排版（R1）：三档密度 / 页边距 / 首字下沉，即时生效 + 持久化；R9 增栏宽档
    this.typo = { density: 'standard', margin: 'standard', firstCap: false, col: 'standard', fontScale: 'standard', ...JSON.parse(localStorage.getItem('robinread.editionTypography') || '{}') };
    overlay.querySelector('.er-type').addEventListener('click', (ev) => { ev.stopPropagation(); this._toggleTypePanel(ev.currentTarget); });
    this._applyTypography(true);
    this.measureHost = document.createElement('div');
    this.measureHost.className = 'er-measure';
    overlay.appendChild(this.measureHost);
    // 全局字号（Ctrl+= / − / 0 → --article-font-size）变化时文章分页自动重排
    this._fontMo = new MutationObserver(() => {
      clearTimeout(this._fontT);
      this._fontT = setTimeout(() => { if (this.overlay && this.mode === 'article') this._relayout(false); }, 200);
    });
    this._fontMo.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    this._sound = new Audio(this.soundSrc);
    this._sound.volume = 0.85;
    this._bind();
    // 划词工具条（R3）：复制/解释/翻译/提问（AI 流式经 ai:selection-delta）
    this._selChangeHandler = () => this._onSelectionChange();
    document.addEventListener('selectionchange', this._selChangeHandler);
    window.robin?.onSelectionDelta?.((p) => this._selDelta(p));
    this._relayout(true);
    // 阅读位置记忆：同一视野（feedKey）重开时落到上次离开的页
    const savedPos = this._loadPos();
    if (savedPos > 0 && savedPos < this.pages.length) {
      this.startIndex = savedPos;
      this.index = savedPos;
      this._resumedFrom = savedPos; // 续读提醒（R18）
      this._syncSheets(true);
    }
    if (this.reduceMotion) this._doOpen();
    else {
      this._autoTimer = setTimeout(() => this._doOpen(), 700);
    }
  }

  /** 阅读位置记忆（per feedKey）：robinread.editionPos JSON map。 */
  _loadPos() {
    try {
      const map = JSON.parse(localStorage.getItem('robinread.editionPos') || '{}');
      return Number(map[this.feedKey]) || 0;
    } catch { return 0; }
  }
  _savePos(index) {
    if (!this.feedKey) return;
    try {
      const map = JSON.parse(localStorage.getItem('robinread.editionPos') || '{}');
      map[this.feedKey] = index;
      localStorage.setItem('robinread.editionPos', JSON.stringify(map));
    } catch { /* 存储满等异常忽略 */ }
  }

  dismiss() {
    // 会话小结（R15）：本期有阅读行为时，退出后在页面级浮出 toast
    const pages = this._sessionPages || 0;
    const entries = this._sessionEntries ? this._sessionEntries.size : 0;
    if (pages > 0 || entries > 0) {
      const toast = document.createElement('div');
      toast.className = 'er-session-toast';
      toast.textContent = `${t('本次阅读')} · ${t('翻页')} ${pages} · ${t('读')} ${entries} ${t('篇')}`;
      document.body.appendChild(toast);
      requestAnimationFrame(() => toast.classList.add('on'));
      setTimeout(() => {
        toast.classList.remove('on');
        setTimeout(() => toast.remove(), 400);
      }, 3200);
    }
    clearTimeout(this._autoTimer);
    clearTimeout(this._resizeTimer);
    clearTimeout(this._fontT);
    clearTimeout(this._selTimer);
    this._fontMo?.disconnect();
    clearTimeout(this._raf); cancelAnimationFrame(this._raf);
    clearInterval(this._vpTimer);
    document.removeEventListener('keydown', this._key, true);
    document.removeEventListener('selectionchange', this._selChangeHandler);
    this._dismissSelBar();
    this._dismissSelPopover();
    window.removeEventListener('resize', this._onResize);
    this.overlay?.remove();
    this.overlay = null;
  }

  _doOpen() {
    if (!this.overlay || this.open || this.turn) return;
    if (!this.pages.length) return;
    this.open = true;
    this._play();
    this._fx('open');
    // 续读提醒（R18）：开书后提示已落位到上次位置
    if (this._resumedFrom > 0) {
      setTimeout(() => this._notice(`${t('已续读至上次位置 · 第')} ${this._resumedFrom + 1} ${t('页')}`), 950);
    }
    const cover = this.overlay.querySelector('.er-cover');
    const dur = this.reduceMotion ? 0.16 : 0.65;
    cover.hidden = false;
    cover.style.transitionDuration = `${dur}s`;
    cover.classList.add('er-cover-animating', 'er-cover-open');
    setTimeout(() => {
      cover.hidden = true;
      cover.classList.remove('er-cover-animating', 'er-cover-open');
      // 开书后释放封面内的两份首页克隆（right/back），合书时 _renderCover 重建
      cover.querySelector('.er-cover-right').innerHTML = '';
      cover.querySelector('.er-cover-back').innerHTML = '';
      this.overlay.querySelector('.er-book').classList.add('er-reveal');
      this._syncRail();
    }, dur * 1000 + 40);
  }

  _closeBook() {
    if (!this.overlay || !this.open || this.turn) return;
    this.open = false;
    this._play();
    this._renderCover();
    const cover = this.overlay.querySelector('.er-cover');
    const dur = this.reduceMotion ? 0.16 : 0.65;
    this.overlay.querySelector('.er-book').classList.remove('er-reveal');
    // 先无过渡跳到开书姿态，再动画合上（MagazineCoverAnimationSurface 语义）
    cover.hidden = false;
    cover.classList.add('er-cover-open');
    cover.style.transitionDuration = '0s';
    void cover.offsetWidth;
    cover.style.transitionDuration = `${dur}s`;
    cover.classList.add('er-cover-animating');
    cover.classList.remove('er-cover-open');
    setTimeout(() => {
      cover.classList.remove('er-cover-animating');
      this._select(null);
      this._syncRail();
    }, dur * 1000 + 40);
  }

  _bind() {
    const overlay = this.overlay;
    overlay.addEventListener('click', (e) => {
      if (e.target.closest('.er-close')) return this.dismiss();
      const edge = e.target.closest('.er-edge');
      if (edge) return this._go(this._pageIndex() + Number(edge.dataset.dir));
    });
    overlay.querySelector('.er-cover').addEventListener('click', () => this._doOpen());
    overlay.querySelector('.er-stage').addEventListener('pointerdown', (e) => this._down(e));
    overlay.querySelector('.er-stage').addEventListener('wheel', (e) => this._wheel(e), { passive: false });
    // 翻页拖拽与文字/图片选择冲突防护：拖拽翻页启动时清除选区，图片禁止原生拖拽
    overlay.addEventListener('dragstart', (e) => e.preventDefault());
    this._bindRail();
    this._key = (e) => this._keydown(e);
    document.addEventListener('keydown', this._key, true);
    this._onResize = () => {
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => this._relayout(false), 160);
    };
    window.addEventListener('resize', this._onResize);
    // 尺寸轮询守卫：跨显示器拖动/切换时 Electron 偶发丢 resize 事件（实测存在），
    // 每 800ms 比对视口与 DPR，变化即重排——彻底保证书籍组件跟随显示器尺寸
    this._lastViewport = { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio };
    this._vpTimer = setInterval(() => {
      if (!this.overlay) return;
      const vp = { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio };
      if (vp.w !== this._lastViewport.w || vp.h !== this._lastViewport.h || vp.dpr !== this._lastViewport.dpr) {
        this._lastViewport = vp;
        this._onResize();
      }
    }, 800);
    overlay.addEventListener('pointermove', (e) => this._edgeHover(e));
    overlay.addEventListener('pointerleave', () => this._edgeHover(null));
  }

  _relayout(initial) {
    if (!this.overlay) return;
    const keep = this.index;
    const isArticle = this.mode === 'article' && this.article;
    // 翻页进行中窗口尺寸变化：翻页快照与版面几何已失配，取消翻页回稳态（上游 cancelTurn 同款）
    this._cancelTurn();
    if (isArticle) {
      this._paginateArticle(this.article.entry, this.article.html).then(() => {
        if (!this.overlay || this.mode !== 'article') return;
        this.index = clamp(keep, 0, this.pages.length - 1);
        this._syncSheets(true);
        this._syncRail();
      });
    } else {
      this._paginate();
      if (initial) this.index = clamp(this.startIndex, 0, this.pages.length - 1);
      else this.index = clamp(keep, 0, this.pages.length - 1);
    }
    const m = this._metrics();
    // 页边距唯一真源：版心内缩（hi）同步给 CSS padding，JS 测量与 DOM 永远一致
    this.overlay.style.setProperty('--er-inset-x', `${Math.round(m.hi)}px`);
    const book = this.overlay.querySelector('.er-book');
    const wrap = this.overlay.querySelector('.er-bookwrap');
    wrap.style.width = `${m.paperW}px`;
    wrap.style.height = `${m.bookH}px`;
    wrap.style.marginTop = `${m.ins}px`;
    book.style.width = `${m.paperW}px`;
    book.style.height = `${m.bookH}px`;
    this._renderCover();
    this._syncSheets(true);
    this._syncRail();
    book.classList.toggle('er-reveal', this.open);
  }

  // ────────────────────────────────────────────────
  // 正文翻页模式：点击稿件卡 → 正文分页成对开书页，在同界面内翻页阅读
  // ────────────────────────────────────────────────
  async _openArticle(entry) {
    if (!this.overlay || this.turn || this.scrub) return;
    if (this.mode === 'article') return;
    this._editionState = { pages: this.pages, index: this.index, selected: this.selected };
    this.mode = 'article';
    this.article = { entry, html: '', spreads: [] };
    this._articleMinutes = null;
    this._sessionEntries = this._sessionEntries || new Set();
    this._sessionEntries.add(entry.id);
    this.selected = null;
    // 过渡：先给当前页一个装载提示
    const aSheet = this.overlay.querySelector('.er-sheet[data-role="a"]');
    aSheet.innerHTML = `<div class="er-loading-page">${escapeHTML(t('正在装载正文…'))}</div>`;
    let html = '';
    try { html = String(await this._fetchArticle(entry.id) || ''); } catch { html = ''; }
    if (!this.overlay || this.mode !== 'article') return;
    this.article.html = html;
    await this._paginateArticle(entry, html);
    this.index = 0;
    this._syncSheets(true);
    this._syncRail();
    this.overlay.querySelector('.er-book').classList.add('er-reveal');
    this._play();
  }

  _closeArticle() {
    if (this.mode !== 'article' || !this._editionState) { this.mode = 'edition'; return; }
    const st = this._editionState;
    this._editionState = null;
    this.mode = 'edition';
    this.article = null;
    this.pages = st.pages;
    this.index = clamp(st.index, 0, this.pages.length - 1);
    this.selected = st.selected;
    this._syncSheets(true);
    this._syncRail();
    this._play();
  }

  /** 预取图片宽高比（同时 warm 缓存）：单图 1.5s 超时兜底按 0.66 比例；实例级缓存，resize 重排零等待。 */
  async _preloadImageRatios(nodes) {
    if (!this._imgRatioCache) this._imgRatioCache = new Map();
    const srcs = new Set();
    for (const n of nodes) {
      if (n.tagName?.toLowerCase() === 'img') {
        const s = n.getAttribute('src');
        if (s && (/^https?:/.test(s) || /^data:image\//.test(s)) && !this._imgRatioCache.has(s)) srcs.add(s);
      }
    }
    const map = new Map();
    await Promise.all([...srcs].slice(0, 16).map((src) => new Promise((resolve) => {
      const im = new Image();
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          if (im.naturalWidth > 0 && im.naturalHeight > 0) {
            const r = im.naturalHeight / im.naturalWidth;
            map.set(src, r);
            this._imgRatioCache.set(src, r);
          }
        }
        resolve();
      };
      im.onload = finish;
      im.onerror = () => { done = true; resolve(); };
      setTimeout(finish, 1500);
      im.referrerPolicy = 'no-referrer';
      im.src = src;
    })));
    // 已缓存的比例并入返回（未命中才等预取）
    for (const n of nodes) {
      if (n.tagName?.toLowerCase() === 'img') {
        const s = n.getAttribute('src');
        if (s && this._imgRatioCache.has(s) && !map.has(s)) map.set(s, this._imgRatioCache.get(s));
      }
    }
    return map;
  }

  /** 正文 → 块序列 → 贪心装箱成半叶 → 两叶一对开。单块超高文本按句切分兜底。 */
  /** 文章栏宽（R9）：三档 460/540/620，钳制到半叶宽。 */
  _colW() {
    const map = { narrow: 475, standard: 540, wide: 620 };
    return Math.min(map[this.typo?.col] || 540, this._metrics().leafW);
  }

  async _paginateArticle(entry, html) {
    // 字体就绪后再测量（R34 打回）：衬线字体异步加载会让测量用回退字体行高，
    // 渲染时行数变多 → 叶底整段被裁。等待一次性完成，之后测量与渲染同字体。
    if (document.fonts && document.fonts.status !== 'loaded') {
      try { await document.fonts.ready; } catch (_) { /* 字体 API 异常不阻塞分页 */ }
    }
    const m = this._metrics();
    const leafH = Math.max(160, m.bookH - HEADING_H - 28); // 底部安全余量：防叶末行贴纸缘被切（两轮实证 7-14px 级误差，一次盖住）
    const colW = this._colW();
    // R34 重排缓存：同文章同排版参数（字号/密度/页边/栏/首字/视口）直接复用上次装箱结果，
    // 来回翻页、排版面板反复调整、resize 抖动不再重复测量与贪心装箱
    const layoutKey = [entry.id, colW, FONTSCALE[this.typo?.fontScale] || 1, this.typo?.density,
      this.typo?.margin, this.typo?.firstCap ? 1 : 0, `${m.paperW}x${m.bookH}`, String(html || '').length].join('|');
    if (this._layoutCache?.has(layoutKey)) {
      const hit = this._layoutCache.get(layoutKey);
      this._layoutCache.delete(layoutKey);
      this._layoutCache.set(layoutKey, hit); // LRU touch
      this.article.headings = hit.headings;
      this.article.spreads = hit.spreads;
      this.pages = hit.pages;
      return;
    }
    // 解析块
    const host = document.createElement('div');
    host.className = 'er-measure';
    this.overlay.appendChild(host);
    const body = document.createElement('div');
    body.className = 'er-article';
    body.style.cssText = `width:${colW}px;`;
    body.innerHTML = String(html || '');
    body.querySelectorAll('script,style,iframe,link,noscript').forEach((el) => el.remove());
    body.querySelectorAll('img').forEach((im) => { im.loading = 'lazy'; im.referrerPolicy = 'no-referrer'; });
    body.querySelectorAll('video').forEach((v) => { v.controls = true; v.preload = 'metadata'; v.loading = 'lazy'; });
    host.appendChild(body);
    const blocks = [];
    // 测量必须与渲染同环境：块要放进 .er-article 容器才有 15.5px/1.92 行距等排版样式；
    // 占位首块避免「first-child margin-top 清零」造成测量偏小。
    // 批量测量：全部块一次性 append，仅 1-2 次 reflow（逐块 append/remove 是 O(n) 次强制布局，长文会卡装载秒级）
    const wrap = document.createElement('div');
    wrap.className = 'er-article';
    wrap.style.cssText = `width:${colW}px;`;
    wrap.innerHTML = '<i style="display:block;height:0"></i>';
    host.appendChild(wrap);
    const margins = new WeakMap(); // margin 必须在节点挂载时抓取（host.remove() 后 detached 节点读不到样式表）
    const measureBatch = (els) => {
      for (const el of els) wrap.appendChild(el);
      const heights = els.map((el) => Math.ceil(el.getBoundingClientRect().height));
      for (const el of els) {
        const cs = getComputedStyle(el);
        margins.set(el, { mt: parseFloat(cs.marginTop) || 0, mb: parseFloat(cs.marginBottom) || 0 });
        el.remove();
      }
      return heights;
    };
    // 首叶头部：眉题 + 大标题 + 分隔线
    const headEl = document.createElement('div');
    headEl.className = 'er-article-head';
    headEl.innerHTML = `<div class="er-article-kicker">${escapeHTML(entry.source)} · ${escapeHTML(this._fmtDate(entry.date))}</div>
      <h1 class="er-article-title">${escapeHTML(entry.title)}</h1><div class="er-article-rule"></div>`;
    blocks.push({ el: headEl, h: measureBatch([headEl])[0], breakable: false });
    // 递归展平：div/section 等布局容器不作为整体块（否则单容器包裹的正文会被 clamp 截断），
    // 一路展开到内容块（p/h*/ul/ol/table/blockquote/pre/figure/hr/img）；容器自身的直接文本也收集
    const CONTAINER_TAGS = new Set(['div', 'section', 'article', 'main', 'aside', 'span', 'font', 'center', 'small', 'header', 'footer']);
    const raw = [];
    const collect = (node) => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === 3) {
          const txt = String(child.textContent || '').trim();
          if (!txt) continue;
          const p = document.createElement('p');
          p.textContent = txt;
          raw.push(p);
          continue;
        }
        if (child.nodeType !== 1) continue;
        const tag = child.tagName.toLowerCase();
        if (tag === 'br' || tag === 'hr') continue;
        if (CONTAINER_TAGS.has(tag)) { collect(child); continue; }
        // 内容块内嵌 img：拆为独立图块（杂志排版惯例，图不随段落截断）+ 剩余文本块
        if (tag !== 'img' && child.querySelector?.('img')) {
          const imgs = [...child.querySelectorAll('img')];
          const textClone = child.cloneNode(true);
          textClone.querySelectorAll('img').forEach((im) => im.remove());
          for (const im of imgs) raw.push(im);
          if ((textClone.textContent || '').trim() || textClone.querySelector('p,li,blockquote,pre,table')) raw.push(textClone);
          continue;
        }
        raw.push(child);
      }
    };
    collect(body);
    // 图片真实比例预取（同时 warm 缓存）：占位=原图比例，杜绝 cover 裁切；极端长图 cap 后允许横向裁
    const ratios = await this._preloadImageRatios(raw);
    const IMG_CAP = 0.72;
    // 先构造全部块（h=0 占位），再一次性批量测量——单次 reflow，长文装载从秒级降到百毫秒级
    const pending = [];
    for (const node of raw) {
      const tag = node.tagName.toLowerCase();
      if (tag === 'img') {
        const ph = document.createElement('div');
        ph.className = 'er-article-img';
        const clone = node.cloneNode();
        clone.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
        ph.appendChild(clone);
        const src = node.getAttribute('src') || '';
        const ratio = ratios.get(src) ?? 0.66;
        const h = clamp(Math.round(colW * ratio), 110, Math.round(leafH * IMG_CAP));
        blocks.push({ el: ph, h, breakable: false });
        continue;
      }
      const clone = node.cloneNode(true);
      clone.removeAttribute('style');
      blocks.push({ el: clone, h: 0, breakable: tag === 'p' });
      pending.push(clone);
    }
    const heights = measureBatch(pending);
    for (let i = 0; i < pending.length; i++) {
      const blk = blocks.find((b) => b.el === pending[i]);
      blk.h = heights[i];
    }
    // 超高块二次处理（拆子元素或按句切），新块补测量
    const overflowBlocks = blocks.filter((b) => b.h > leafH * 0.96);
    for (const ob of overflowBlocks) {
      const idx = blocks.indexOf(ob);
      const tag = ob.el.tagName.toLowerCase();
      const replacements = [];
      if (tag === 'p' || tag === 'li' || tag === 'blockquote') {
        const sentences = this._splitSentences(ob.el.textContent || '');
        if (sentences.length > 1) {
          const per = Math.max(1, Math.ceil(sentences.length / Math.ceil(ob.h / (leafH * 0.9))));
          for (let i = 0; i < sentences.length; i += per) {
            const part = document.createElement('p');
            part.textContent = sentences.slice(i, i + per).join('');
            replacements.push({ el: part, h: 0, breakable: true });
          }
        }
      }
      if (!replacements.length) {
        for (const child of [...ob.el.children]) {
          const c2 = child.cloneNode(true);
          replacements.push({ el: c2, h: 0, breakable: false });
        }
      }
      if (replacements.length) {
        const hs = measureBatch(replacements.map((r) => r.el));
        replacements.forEach((r, i) => { r.h = Math.min(hs[i] || leafH, leafH); });
        blocks.splice(idx, 1, ...replacements);
      }
    }
    host.remove();
    // 贪心装箱（半叶）；标题块 keep-with-next：叶底放不下「标题+后块」时整组下移，杜绝孤行节标题
    // 块间距按真实段距计（.er-article p margin-bottom ≈ 1.15em ≈ 18px；旧值 8px 系统性低估导致末叶溢出纸缘）
    // R34 打回：rect 高不含外边距——节标题 1.8em 上边距被系统性漏算，标题密集文累积溢出叶底裁行。
    // 装箱间隙用「前块 mb 与后块 mt 的折叠值」，与浏览器普通流一致（margin 已在挂载时抓取）
    for (const blk of blocks) {
      const mg = margins.get(blk.el);
      blk.mt = mg ? mg.mt : 0;
      blk.mb = mg ? mg.mb : 0;
    }
    const isHeadingBlk = (blk) => /^h[1-6]$/i.test(blk?.el?.tagName || '');
    const leaves = [];
    let cur = [], used = 0;
    for (let bi = 0; bi < blocks.length; bi++) {
      const blk = blocks[bi];
      const prev = cur[cur.length - 1];
      const gap = prev ? Math.max(prev.mb, blk.mt) : 0;
      const need = used + gap + blk.h + (isHeadingBlk(blk) && blocks[bi + 1] ? Math.max(blk.mb, blocks[bi + 1].mt) + blocks[bi + 1].h : 0);
      if (used > 0 && need > leafH) { leaves.push(cur); cur = []; used = 0; }
      const prevIn = cur[cur.length - 1];
      cur.push(blk);
      used += (prevIn ? Math.max(prevIn.mb, blk.mt) : 0) + blk.h;
    }
    if (cur.length) leaves.push(cur);
    // 两叶一对开；末尾单叶补「完」页
    const spreads = [];
    for (let i = 0; i < leaves.length; i += 2) {
      spreads.push({ left: leaves[i], right: leaves[i + 1] || null, isEnd: i + 1 >= leaves.length });
    }
    // 文章目录：标题块 → 所属对开页序号（目录面板跳转用）
    const headings = [];
    leaves.forEach((leaf, li) => {
      for (const blk of leaf) {
        const hm = /^h([1-6])$/i.exec(blk.el.tagName || '');
        if (hm) {
          headings.push({ text: blk.el.textContent.trim().slice(0, 60), spread: Math.floor(li / 2),
            level: clamp(Number(hm[1]) - 1, 1, 3) }); // h2=1 h3=2 …（R8 目录树状）
        }
      }
    });
    this.article.headings = headings;
    this.pages = spreads.map((sp, i) => ({
      id: `a${i}:${entry.id}`,
      title: entry.title,
      entries: [],
      placements: [],
      height: leafH,
      template: 'article',
      form: 'spread',
      paperW: m.paperW,
      isEnd: i === spreads.length - 1,
      article: sp,
    }));
    if (this.article) this.article.spreads = spreads;
    // R34：装箱结果入缓存（LRU 上限 12 篇；spreads 携带可复挂的块 DOM）
    this._layoutCache = this._layoutCache || new Map();
    if (this._layoutCache.size > 12) this._layoutCache.delete(this._layoutCache.keys().next().value);
    this._layoutCache.set(layoutKey, { pages: this.pages, spreads, headings });
  }

  _splitSentences(text) {
    const t0 = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t0) return [];
    const parts = t0.split(/(?<=[。！？；!?;.])\s*/).filter(Boolean);
    return parts.length > 1 ? parts : [t0];
  }

  /** 文章目录面板：右侧滑出，点击节标题跳转所在对开页；当前页所在节高亮。 */
  _toggleToc(fromIndex) {
    if (!this.overlay) return;
    let toc = this.overlay.querySelector('.er-toc');
    if (toc) { toc.remove(); return; }
    toc = document.createElement('div');
    toc.className = 'er-toc';
    const rows = (this.article?.headings || []).map((h) =>
      `<button class="er-toc-row" data-spread="${h.spread}" data-level="${h.level || 1}"><span class="er-toc-page">${h.spread + 1}</span><span class="er-toc-text">${escapeHTML(h.text)}</span></button>`).join('');
    toc.innerHTML = `<div class="er-toc-head">${escapeHTML(t('文章目录'))}</div><div class="er-toc-list">${rows || `<div class="er-toc-empty">${escapeHTML(t('本文暂无小节标题'))}</div>`}</div>`;
    this._syncToc(toc);
    toc.addEventListener('click', (ev) => {
      const row = ev.target.closest('.er-toc-row');
      if (row) { toc.remove(); this._go(Number(row.dataset.spread)); }
      else if (!ev.target.closest('.er-toc-list')) toc.remove();
    });
    this.overlay.appendChild(toc);
    requestAnimationFrame(() => {
      toc.classList.add('on');
      toc.querySelector('.er-toc-row.cur')?.scrollIntoView({ block: 'center' });
    });
  }

  /** 目录当前节锚定（R8）：当前页所属的「最后一个起始页 ≤ 当前页」的标题为唯一高亮行。 */
  _syncToc(toc) {
    const panel = toc || this.overlay?.querySelector('.er-toc');
    if (!panel || !this.article) return;
    const hs = this.article.headings || [];
    const rowEls = [...panel.querySelectorAll('.er-toc-row')];
    let anchor = -1;
    for (let i = 0; i < hs.length && i < rowEls.length; i++) {
      if (hs[i].spread <= this.index) anchor = i;
    }
    rowEls.forEach((row, i) => row.classList.toggle('cur', i === anchor));
    if (toc) panel.querySelector('.er-toc-row.cur')?.scrollIntoView({ block: 'center' });
  }

  /** 正文图片灯箱：画廊式（R5 增强：滚轮缩放/拖拽平移/双击 1:1/键盘切换/百分比角标）。 */
  _openLightbox(src) {
    if (!this.overlay) return;
    let lb = this.overlay.querySelector('.er-lightbox');
    if (!lb) {
      lb = document.createElement('div');
      lb.className = 'er-lightbox';
      lb.innerHTML = `<button class="er-lb-nav prev" title="${escapeHTML(t('上一张'))}">‹</button><img alt="" draggable="false">
        <button class="er-lb-nav next" title="${escapeHTML(t('下一张'))}">›</button>
        <button class="er-lb-close" title="${escapeHTML(t('关闭 (Esc)'))}">✕</button>
        <div class="er-lb-count"></div><div class="er-lightbox-err" hidden></div>`;
      this.overlay.appendChild(lb);
      lb.addEventListener('click', (ev) => {
        if (ev.target.closest('.er-lb-nav') || ev.target.closest('.er-lb-close')) return;
        if ((this._lbZoom || 1) > 1.02) { this._lbReset(); return; } // 放大态点空白先复位，再点才关
        lb.classList.remove('on');
        this._lightboxOn = false;
      });
      lb.querySelector('.er-lb-nav.prev').addEventListener('click', () => this._lightboxStep(-1));
      lb.querySelector('.er-lb-nav.next').addEventListener('click', () => this._lightboxStep(1));
      lb.querySelector('.er-lb-close').addEventListener('click', () => { lb.classList.remove('on'); this._lightboxOn = false; });
      // 滚轮缩放（围绕光标），1×–5×；缩回 1× 自动复位
      lb.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        if (!lb.querySelector('img') || lb.querySelector('img').style.display === 'none') return;
        const old = this._lbZoom || 1;
        const zoom = clamp(old * (ev.deltaY < 0 ? 1.15 : 1 / 1.15), 1, 5);
        if (zoom === old) return;
        const rect = lb.getBoundingClientRect();
        const cx = ev.clientX - rect.left, cy = ev.clientY - rect.top;
        this._lbX = cx - ((cx - (this._lbX || 0)) * zoom) / old;
        this._lbY = cy - ((cy - (this._lbY || 0)) * zoom) / old;
        this._lbZoom = zoom;
        if (zoom <= 1.02) this._lbReset();
        else this._lbApply(lb);
      }, { passive: false });
      // 放大态拖拽平移
      lb.addEventListener('pointerdown', (ev) => {
        if ((this._lbZoom || 1) <= 1.02 || ev.target.closest('.er-lb-nav, .er-lb-close')) return;
        ev.preventDefault();
        lb.classList.add('dragging');
        const startX = ev.clientX, startY = ev.clientY, baseX = this._lbX || 0, baseY = this._lbY || 0;
        const move = (m) => { this._lbX = baseX + m.clientX - startX; this._lbY = baseY + m.clientY - startY; this._lbApply(lb); };
        const up = () => {
          lb.classList.remove('dragging');
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
      // 双击：适应窗口 ↔ 2×
      lb.addEventListener('dblclick', () => {
        if ((this._lbZoom || 1) > 1.02) this._lbReset();
        else { this._lbZoom = 2; this._lbX = 0; this._lbY = 0; this._lbApply(lb); }
      });
    }
    // 全篇图片列表（跨页）
    if (!this._lbList || !this._lbList.length) {
      this._lbList = [...this.overlay.querySelectorAll('.er-article img')]
        .map((im) => im.getAttribute('src')).filter(Boolean);
    }
    this._lbIdx = Math.max(0, this._lbList.indexOf(src));
    this._lbShow(lb);
    lb.classList.add('on');
    this._lightboxOn = true;
  }

  _lbApply(lb) {
    const img = lb.querySelector('img');
    img.style.transform = `translate(${this._lbX || 0}px, ${this._lbY || 0}px) scale(${this._lbZoom || 1})`;
    this._lbCount(lb);
  }

  _lbReset() {
    this._lbZoom = 1; this._lbX = 0; this._lbY = 0;
    const lb = this.overlay?.querySelector('.er-lightbox');
    if (!lb) return;
    lb.querySelector('img').style.transform = '';
    this._lbCount(lb);
  }

  _lbCount(lb) {
    const zoomPct = (this._lbZoom || 1) > 1.02 ? ` · ${Math.round((this._lbZoom || 1) * 100)}%` : '';
    lb.querySelector('.er-lb-count').textContent = `${this._lbIdx + 1} / ${this._lbList.length || 1}${zoomPct}`;
  }

  _lbShow(lb) {
    this._lbZoom = 1; this._lbX = 0; this._lbY = 0;
    const img = lb.querySelector('img');
    img.style.transform = '';
    lb.classList.remove('dragging');
    const errEl = lb.querySelector('.er-lightbox-err');
    errEl.hidden = true;
    img.style.display = '';
    const multi = this._lbList.length > 1;
    lb.querySelector('.er-lb-nav.prev').style.display = multi ? '' : 'none';
    lb.querySelector('.er-lb-nav.next').style.display = multi ? '' : 'none';
    img.onerror = () => {
      img.style.display = 'none';
      errEl.hidden = false;
      errEl.textContent = t('图片加载失败');
    };
    img.src = this._lbList[this._lbIdx] || '';
    this._lbCount(lb);
  }

  _lightboxStep(dir) {
    if (!this._lbList?.length) return;
    this._lbIdx = (this._lbIdx + dir + this._lbList.length) % this._lbList.length;
    const lb = this.overlay.querySelector('.er-lightbox');
    if (lb) this._lbShow(lb);
  }

  _pageArticleInner(page, index) {
    const m = this._metrics();
    const leafW = m.leafW;
    const colW = this._colW();
    const el = document.createElement('div');
    el.className = 'er-in';
    el.style.width = `${m.paperW}px`;
    const head = document.createElement('div');
    head.className = 'er-head';
    head.innerHTML = `<button class="er-head-back" title="${escapeHTML(t('返回本期 (Esc)'))}">‹ ${escapeHTML(t('本期'))}</button>
      <span class="er-head-title">${escapeHTML(page.title)}</span><span class="er-head-no">${String(index + 1).padStart(2, '0')} / ${String(this.pages.length).padStart(2, '0')}</span>`;
    head.querySelector('.er-head-back').addEventListener('click', (ev) => { ev.stopPropagation(); this._closeArticle(); });
    // 长文目录：页数 ≥3 时出现「目录」按钮，弹出节标题面板点击跳页
    if (this.pages.length >= 3 && (this.article?.headings?.length || 0) > 1) {
      const tocBtn = document.createElement('button');
      tocBtn.className = 'er-head-toc';
      tocBtn.textContent = t('目录');
      tocBtn.title = t('文章目录');
      tocBtn.addEventListener('click', (ev) => { ev.stopPropagation(); this._toggleToc(index); });
      head.insertBefore(tocBtn, head.querySelector('.er-head-no'));
    }
    el.appendChild(head);
    // 阅读进度线：页眉下的细线随页位推进
    const progress = document.createElement('div');
    progress.className = 'er-article-progress';
    progress.innerHTML = `<i style="width:${Math.round(((index + 1) / Math.max(1, this.pages.length)) * 100)}%"></i>`;
    // 剩余时间预估（R4）：进度线右端小字
    const remain = this._articleRemainMinutes(index);
    progress.insertAdjacentHTML('beforeend', `<span class="er-remain-tip">${remain > 0 ? `${escapeHTML(t('本文约剩'))} ${remain} ${escapeHTML(t('分钟'))}` : escapeHTML(t('本文已读完'))}</span>`);
    el.appendChild(progress);
    const canvas = document.createElement('div');
    canvas.className = 'er-canvas';
    canvas.style.height = `${page.height}px`;
    // 正文图片灯箱：点击放大（Esc/点击关闭）
    canvas.addEventListener('click', (ev) => {
      if (this.focusMode) {
        const blocks = this._focusBlocks();
        const target = ev.target.closest('.er-article > *');
        const idx = blocks.indexOf(target);
        if (idx >= 0) { ev.stopPropagation(); this._focusIdx = idx; this._applyFocus(); return; }
      }
      const img = ev.target.closest('img');
      if (img && img.src && img.closest('.er-article')) { ev.stopPropagation(); this._openLightbox(img.src); }
    });
    const mkLeaf = (blocks, x, isEndLeaf) => {
      const leaf = document.createElement('div');
      leaf.className = 'er-article-leaf';
      leaf.style.cssText = `left:${x}px;top:0;width:${leafW}px;height:${page.height}px;`;
      const col = document.createElement('div');
      col.className = 'er-article';
      col.style.cssText = `width:${colW}px;`;
      if (isEndLeaf || !blocks || !blocks.length) {
        col.classList.add('er-article-end');
        col.innerHTML = `<div class="er-article-endmark">${escapeHTML(t('完'))}</div>
          <div class="er-article-endsub">${escapeHTML(this._fmtDate(this.article?.entry?.date))}</div>`;
      } else {
        for (const blk of blocks) col.appendChild(blk.el);
      }
      leaf.appendChild(col);
      canvas.appendChild(leaf);
    };
    mkLeaf(page.article.left, 0, false);
    // 右叶有正文就渲染正文；仅当无右叶内容（末 spread 余叶）时显示「完」页
    mkLeaf(page.article.right, leafW + GUTTER, !page.article.right || !page.article.right.length);
    el.appendChild(canvas);
    return el;
  }

  _pageInner(page, index) {
    if (page.template === 'article') return this._pageArticleInner(page, index);
    const m = this._metrics();
    const lay = page;
    const inW = lay.paperW || m.paperW;
    const leafW = m.leafW;
    const el = document.createElement('div');
    el.className = 'er-in';
    el.style.width = `${inW}px`;
    const header = document.createElement('div');
    header.className = 'er-head';
    header.innerHTML = `<span class="er-head-title">${escapeHTML(page.title)}</span>`;
    el.appendChild(header);
    const canvas = document.createElement('div');
    canvas.className = 'er-canvas';
    canvas.style.height = `${lay.height}px`;
    // 书页页码：下外角 folio（对开左偶右奇），替代页眉角标
    if (lay.form === 'spread') {
      const lf = document.createElement('div');
      lf.className = 'er-folio l';
      lf.textContent = String(index * 2 + 1).padStart(2, '0');
      const rf = document.createElement('div');
      rf.className = 'er-folio r';
      rf.textContent = String(index * 2 + 2).padStart(2, '0');
      el.append(lf, rf);
    }
    const byId = new Map(page.entries.map((e) => [e.id, e]));
    const onlyLeft = lay.placements.length && lay.placements.every((p) => p.x + p.w <= leafW + 1);
    let placeIdx = 0;
    for (const pl of lay.placements) {
      const entry = byId.get(pl.entryID);
      if (!entry) continue;
      const holder = document.createElement('div');
      holder.className = 'er-place';
      holder.style.cssText = `left:${pl.x}px;top:${pl.y}px;width:${pl.w}px;height:${pl.h}px;`;
      if (pl.y > 0) holder.dataset.hl = '1';
      // 落页错落淡入（R6）：翻页/换页重建 DOM 时自然触发；reduceMotion 关闭
      if (!this.reduceMotion) {
        holder.classList.add('er-place-in');
        holder.style.setProperty('--stagger', `${Math.min(placeIdx * 45, 360)}ms`);
      }
      placeIdx += 1;
      holder.appendChild(this._buildStory(entry, pl.st, pl.w));
      holder.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) return; // 划词中：不触发开文（R3）
        this._select(entry.id);
        this._openArticle(entry);
      });
      holder.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.onContext?.(ev, entry.raw);
      });
      canvas.appendChild(holder);
    }
    if (lay.form === 'spread' && onlyLeft) {
      const back = document.createElement('div');
      back.className = 'er-backcover';
      back.style.cssText = `left:${leafW + GUTTER}px;width:${leafW}px;height:${lay.height}px;`;
      back.innerHTML = `
        <div class="er-brand">知更</div>
        <div class="er-cover-title">${escapeHTML(this.title)}</div>
        <div class="er-rule"></div>
        <div class="er-endnote">${escapeHTML(t('本期阅读完成'))}</div>`;
      canvas.appendChild(back);
    }
    el.appendChild(canvas);
    return el;
  }

  /** 杂志稿件卡（MagazineStoryView 移植：图栈/旁图、字号分级、悬停反馈、元信息行）。 */
  _buildStory(entry, st, width, { skeleton = false } = {}) {
    const sc = CONTENT_SCALE;
    const story = document.createElement('article');
    story.className = `er-story ${st.stacks ? 'stacks' : 'row'} r-${st.role}${entry.isRead ? ' read' : ''}`;
    story.dataset.entryId = entry.id;
    story.tabIndex = -1;
    const den = this._den();
    const imgSpacing = Math.round(16 * sc * den);
    if (st.imageH > 0 && entry.image) {
      const imgBox = document.createElement('div');
      imgBox.className = 'er-img';
      const iw = this._imgW(st, width);
      imgBox.style.cssText = st.stacks
        ? `width:100%;height:${st.imageH}px;margin-bottom:${imgSpacing}px;`
        : `width:${iw}px;height:${st.imageH}px;flex:0 0 auto;margin-right:${imgSpacing}px;`;
      const img = document.createElement('img');
      img.loading = entry.image.startsWith('data:') ? 'eager' : 'lazy'; // 内联 data 图无网络成本，懒加载在隐藏窗反而永不触发
      img.referrerPolicy = 'no-referrer';
      img.alt = '';
      img.addEventListener('load', () => img.classList.add('ok'), { once: true });
      img.addEventListener('error', () => imgBox.classList.add('bad'), { once: true });
      if (!skeleton) img.src = entry.image; // 测量态不触发网络请求（图高为固定档位）
      imgBox.appendChild(img);
      story.appendChild(imgBox);
    }
    const textSpacing = Math.round((st.role === 'lead' ? 10 : 6) * sc * den);
    const metaSpacing = Math.round((st.role === 'lead' ? 14 : 10) * sc * den);
    const tx = document.createElement('div');
    tx.className = 'er-tx';
    if (!st.stacks && st.imageH > 0) tx.style.minHeight = `${st.imageH}px`;
    const top = document.createElement('div');
    top.className = 'er-tx-top';
    top.style.cssText = `display:flex;flex-direction:column;gap:${textSpacing}px;padding-bottom:${metaSpacing}px;`;
    const title = document.createElement('h3');
    title.className = 'er-title';
    title.style.cssText = `font-size:${st.titleSize * sc}px;line-height:${((st.titleSize + 2 * sc) / (st.titleSize * sc)) * (1 + (den - 1) * 0.4)};`;
    if (st.titleLines < 10000) { title.style.display = '-webkit-box'; title.style.webkitBoxOrient = 'vertical'; title.style.webkitLineClamp = st.titleLines; title.style.overflow = 'hidden'; }
    title.textContent = entry.title;
    top.appendChild(title);
    if (entry.summary && st.summaryLines > 0) {
      const sum = document.createElement('p');
      sum.className = 'er-sum';
      const fs = st.summarySize * sc;
      const sumLh = ((st.summarySize + 4 * sc) / fs) * den;
      if (this.typo?.firstCap && st.role === 'lead') {
        // 头条首字下沉：块级布局 + float 首字（-webkit-box 不支持 ::first-letter，故显式包裹）
        sum.style.cssText = `font-size:${fs}px;line-height:${sumLh};display:block;max-height:${Math.ceil(st.summaryLines * fs * sumLh)}px;overflow:hidden;`;
        const chars = Array.from(entry.summary);
        const cap = document.createElement('span');
        cap.className = 'er-cap';
        cap.textContent = chars[0];
        sum.append(cap, chars.slice(1).join(''));
      } else {
        sum.style.cssText = `font-size:${fs}px;line-height:${sumLh};`;
        if (st.summaryLines < 10000) { sum.style.display = '-webkit-box'; sum.style.webkitBoxOrient = 'vertical'; sum.style.webkitLineClamp = st.summaryLines; sum.style.overflow = 'hidden'; }
        sum.textContent = entry.summary;
      }
      top.appendChild(sum);
    }
    tx.appendChild(top);
    const meta = document.createElement('div');
    meta.className = 'er-meta';
    meta.style.fontSize = `${13 * sc}px`;
    const dot = '<i class="er-dot"></i>';
    const star = entry.isStarred ? `<span class="er-star">${icon('starFilled')}</span>` : '';
    const later = entry.isLater ? `<span class="er-later" title="${escapeHTML(t('稍后读'))}">${icon('clock')}</span>` : '';
    const minutes = entry.readMinutes > 0 ? `<span class="er-min" title="${escapeHTML(t('预计阅读时长'))}">${Math.min(999, entry.readMinutes)} ${escapeHTML(t('分钟'))}</span>` : '';
    meta.innerHTML = `${dot}<span class="er-src">${escapeHTML(entry.source)}</span>${star}${later}${minutes}<span class="er-sp"></span><span class="er-date">${escapeHTML(this._fmtDate(entry.date))}</span>`;
    tx.appendChild(meta);
    story.appendChild(tx);
    return story;
  }

  _fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    const zh = (window.__robinLanguage || 'zh') === 'zh';
    return zh ? `${d.getMonth() + 1}月${d.getDate()}日` : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  _renderCover() {
    const cover = this.overlay.querySelector('.er-cover');
    const m = this._metrics();
    cover.style.cssText += `width:${m.paperW}px;height:${m.bookH}px;`;
    // 合书态封面常驻可见；开书动画期间不抢隐藏（resize 中途触发时保护）
    cover.hidden = this.open && !cover.classList.contains('er-cover-animating');
    const first = this.pages[0];
    // 右页：首页右半；封面背面：首页左半（同一份版面，两个裁切窗）
    const right = cover.querySelector('.er-cover-right');
    right.innerHTML = '';
    const back = cover.querySelector('.er-cover-back');
    back.innerHTML = '<div class="er-face-shade"></div>';
    const leaf = cover.querySelector('.er-cover-leaf');
    leaf.style.width = `${m.paperW / 2}px`;
    leaf.style.height = `${m.bookH}px`;
    const leadEntry = this.items.find((it) => it.image) || null;
    const lead = leadEntry ? leadEntry.image : '';
    const volMatch = /(\d+)/.exec(this._coverVol() || '');
    const volNum = volMatch ? volMatch[1] : '';
    cover.querySelector('.er-cover-front').innerHTML = `
      <div class="er-face-shade"></div>
      <div class="er-cover-face">
        <div class="er-stack s3"></div><div class="er-stack s2"></div><div class="er-stack s1"></div>
        <div class="er-brand">知更</div>
        <div class="er-cover-title">${escapeHTML(this.title)}</div>
        <div class="er-rule"></div>
        ${volNum ? `<div class="er-cover-volbig"><span class="er-vol-label">${escapeHTML(t('总第'))}</span><span class="er-vol-num">${escapeHTML(volNum)}</span><span class="er-vol-label">${escapeHTML(t('期'))}</span></div>` : `<div class="er-cover-vol">${escapeHTML(this._coverVol())}</div>`}
        ${lead ? `<div class="er-cover-lead"><img src="${escapeHTML(lead)}" alt="" referrerPolicy="no-referrer" loading="eager"></div><div class="er-cover-leadcap" title="${escapeHTML(leadEntry.title)}">${escapeHTML(leadEntry.title)}</div>` : `<div class="er-cover-stats">${escapeHTML(t('本期收录'))} ${this.items.length} ${escapeHTML(t('篇'))}</div>`}
        <div class="er-cover-date">${escapeHTML(this._coverDate())}</div>
      </div>`;
    if (first) {
      right.appendChild(this._pageInner(first, 0));
      back.appendChild(this._pageInner(first, 0));
    }
  }

  /** 沉浸全屏切换（F 键/按钮）。 */
  _toggleFullscreen() {
    if (!this.overlay) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else this.overlay.requestFullscreen?.().catch(() => {});
  }

  /** 阅读排版（R1）：应用密度/页边/首字下沉到 overlay。 */
  _applyTypography(skipRelayout = false) {
    const ov = this.overlay;
    if (!ov) return;
    ov.dataset.density = this.typo.density;
    ov.dataset.margin = this.typo.margin;
    ov.classList.toggle('er-firstcap', !!this.typo.firstCap);
    ov.style.setProperty('--er-font-scale', String(FONTSCALE[this.typo.fontScale] || 1));
    // 版心内缩由 _relayout 统一下发（含窄窗钳制），此处只更新 dataset 供文章模式 CSS 消费
    if (!skipRelayout) this._onResize();
  }

  /** 排版面板：右侧滑出，三组即时选项。 */
  _toggleTypePanel(anchorBtn) {
    if (!this.overlay) return;
    let panel = this.overlay.querySelector('.er-type-panel');
    if (panel) { panel.remove(); return; }
    panel = document.createElement('div');
    panel.className = 'er-type-panel';
    const row = (label, key, options) => {
      const cur = this.typo[key];
      return `<div class="er-type-row"><span class="er-type-label">${escapeHTML(label)}</span><span class="er-type-opts">${options.map((o) =>
        `<button data-key="${key}" data-val="${o.v}" class="${cur === o.v ? 'on' : ''}">${escapeHTML(o.n)}</button>`).join('')}</span></div>`;
    };
    panel.innerHTML = `
      <div class="er-type-head">${escapeHTML(t('阅读排版'))}</div>
      ${row(t('行距密度'), 'density', [{ v: 'compact', n: t('紧凑') }, { v: 'standard', n: t('标准') }, { v: 'airy', n: t('舒朗') }])}
      ${row(t('字号'), 'fontScale', [{ v: 'small', n: t('小') }, { v: 'standard', n: t('标准') }, { v: 'large', n: t('大') }])}
      ${row(t('页边距'), 'margin', [{ v: 'narrow', n: t('窄') }, { v: 'standard', n: t('标准') }, { v: 'wide', n: t('宽') }])}
      ${row(t('栏宽'), 'col', [{ v: 'narrow', n: t('窄') }, { v: 'standard', n: t('标准') }, { v: 'wide', n: t('宽') }])}
      <div class="er-type-row"><span class="er-type-label">${escapeHTML(t('首字下沉'))}</span><span class="er-type-opts">
        <button data-key="firstCap" data-val="off" class="${!this.typo.firstCap ? 'on' : ''}">${escapeHTML(t('关'))}</button>
        <button data-key="firstCap" data-val="on" class="${this.typo.firstCap ? 'on' : ''}">${escapeHTML(t('开'))}</button>
      </span></div>`;
    panel.addEventListener('click', (ev) => {
      const b = ev.target.closest('.er-type-opts button');
      if (!b) return;
      const { key, val } = b.dataset;
      if (key === 'firstCap') this.typo.firstCap = val === 'on';
      else this.typo[key] = val;
      localStorage.setItem('robinread.editionTypography', JSON.stringify(this.typo));
      this._applyTypography();
      // 重绘面板选中态
      panel.querySelectorAll('.er-type-opts button').forEach((x) => {
        x.classList.toggle('on', String(this.typo[x.dataset.key]) === x.dataset.val || (x.dataset.key === 'firstCap' && String(this.typo.firstCap) === x.dataset.val));
      });
    });
    this.overlay.appendChild(panel);
    // 面板右缘收进书页内，避免悬挑到台面背景
    const br = this.overlay.querySelector('.er-book')?.getBoundingClientRect();
    if (br && br.width > 0) panel.style.right = `${Math.max(12, Math.round(window.innerWidth - br.right + 14))}px`;
    requestAnimationFrame(() => panel.classList.add('on'));
  }

  // ────────────────────────────────────────────────
  // 划词工具条（R3）：胶囊（复制/解释/翻译/提问）+ 弹层，复用 reader 的 ai:* 通道
  // ────────────────────────────────────────────────
  _onSelectionChange() {
    if (!this.overlay) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) { if (!this.selPopover) this._dismissSelBar(); return; }
    if (this.selPopover && Date.now() - (this._selPopoverAt || 0) < 600) return;
    if (this.selPopover || this.selBar) return;
    const text = String(selection);
    if (!text || text.length < 2 || text.length > 4000) return;
    const node = selection.anchorNode;
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (!element || !this.overlay.contains(element)) return;
    if (element.closest('.er-type-panel, .er-toc, .er-sel-popover, .er-selbar, .er-tools, .er-rail')) return;
    clearTimeout(this._selTimer);
    this._selTimer = setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      const block = element.closest('.er-sum, .er-article p, .er-title, h1, h2, h3, li, blockquote');
      const context = String((block?.parentElement || block)?.textContent || '').slice(0, 500);
      this._presentSelBar({ text, rect, context });
    }, 260);
  }

  _presentSelBar(payload) {
    this._dismissSelBar();
    const bar = document.createElement('div');
    bar.className = 'er-selbar';
    const copy = document.createElement('button');
    copy.className = 'er-sel-btn';
    copy.title = t('复制所选文字');
    copy.textContent = t('复制');
    copy.addEventListener('mousedown', (e) => e.preventDefault());
    copy.addEventListener('click', async () => {
      try {
        // 后台/失焦窗 navigator.clipboard 会被拒：优先走主进程兜底通道
        if (window.robin?.copyText) await window.robin.copyText(payload.text);
        else await navigator.clipboard.writeText(payload.text);
        this._notice(t('已复制所选文字'));
      } catch { this._notice(t('复制失败')); }
      this._dismissSelBar();
    });
    bar.appendChild(copy);
    const llm = window.__robinLLM || {};
    const aiBtns = [
      ['explanation', llm.showsSelectionExplanation !== false, t('解释'), t('解释所选文字')],
      ['translation', llm.showsSelectionTranslation !== false, t('翻译'), t('翻译所选文字')],
      ['ask', llm.showsSelectionAsk !== false, t('提问'), t('问 AI 所选文字')],
    ];
    for (const [kind, show, label, title] of aiBtns) {
      if (!show) continue;
      const b = document.createElement('button');
      b.className = 'er-sel-btn ai';
      b.textContent = label;
      b.title = title;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => this._openSelPopover(kind, payload));
      bar.appendChild(b);
    }
    // 挂 overlay 而非 body：随阅读器层级合成（body 直挂 fixed 层在离屏合成中不绘制）、随 dismiss 清理
    this.overlay.appendChild(bar);
    this.selBar = bar;
    const bw = bar.getBoundingClientRect().width;
    let x = payload.rect.x + payload.rect.width / 2 - bw / 2;
    x = Math.max(10, Math.min(window.innerWidth - bw - 10, x));
    let y = payload.rect.y - 42;
    if (y < 60) y = payload.rect.y + payload.rect.height + 8;
    bar.style.left = `${x}px`;
    bar.style.top = `${y}px`;
    setTimeout(() => {
      this._selBarDismiss = (ev) => { if (!bar.contains(ev.target) && !this.selPopover?.contains(ev.target)) this._dismissSelBar(); };
      document.addEventListener('mousedown', this._selBarDismiss);
    }, 0);
  }

  _dismissSelBar() {
    if (this._selBarDismiss) { document.removeEventListener('mousedown', this._selBarDismiss); this._selBarDismiss = null; }
    this.selBar?.remove();
    this.selBar = null;
  }

  _openSelPopover(kind, payload) {
    this._dismissSelBar();
    if (!window.robin?.explainSelection) { this._notice(t('AI 划词在当前环境不可用')); return; }
    this._dismissSelPopover();
    const titles = { explanation: t('AI 解释'), translation: t('翻译'), ask: t('问 AI') };
    const pop = document.createElement('div');
    pop.className = 'er-sel-popover';
    pop.innerHTML = `<div class="er-sel-head"><span class="er-sel-title"></span><button class="er-sel-close">✕</button></div>
      ${kind === 'ask' ? `<div class="er-sel-askrow"><input class="er-sel-input" placeholder="${escapeHTML(t('针对划选文字提问…'))}"/><button class="er-sel-send">${escapeHTML(t('发送'))}</button></div>` : ''}
      <div class="er-sel-body loading"></div>`;
    pop.querySelector('.er-sel-title').textContent = titles[kind];
    pop.querySelector('.er-sel-close').addEventListener('click', () => this._dismissSelPopover());
    this.overlay.appendChild(pop);
    this.selPopover = pop;
    this._selPopoverAt = Date.now();
    const body = pop.querySelector('.er-sel-body');
    const position = () => {
      const rect = pop.getBoundingClientRect();
      let x = payload.rect.x + payload.rect.width / 2 - rect.width / 2;
      x = Math.max(12, Math.min(window.innerWidth - rect.width - 12, x));
      let y = payload.rect.y - rect.height - 12;
      if (y < 56) y = Math.min(window.innerHeight - rect.height - 12, payload.rect.y + payload.rect.height + 12);
      pop.style.left = `${x}px`;
      pop.style.top = `${y}px`;
    };
    position();
    const requestID = `ersel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._selRequestID = requestID;
    const entryID = this.mode === 'article' ? (this.article?.entry?.id || null) : (this.selected || null);
    const run = (question = null) => {
      body.className = 'er-sel-body loading';
      body.textContent = kind === 'translation' ? t('正在翻译…') : t('正在生成…');
      const call = kind === 'translation'
        ? window.robin.translateSelection({ requestID, entryID, selection: payload.text })
        : question
          ? window.robin.askSelection({ requestID, entryID, selection: payload.text, question, localContext: payload.context })
          : window.robin.explainSelection({ requestID, entryID, selection: payload.text, localContext: payload.context });
      Promise.resolve(call).then((res) => {
        if (this.selPopover !== pop) return;
        body.className = `er-sel-body ${res && res.ok ? 'rendered' : 'error'}`;
        body.textContent = res && res.ok ? String(res.data || '') : ((res && res.error) || t('AI 未连接：请在 设置 → AI 服务商与连接 配置后使用'));
        position();
      }).catch(() => {
        if (this.selPopover !== pop) return;
        body.className = 'er-sel-body error';
        body.textContent = t('AI 未连接：请在 设置 → AI 服务商与连接 配置后使用');
        position();
      });
    };
    if (kind === 'ask') {
      const input = pop.querySelector('.er-sel-input');
      pop.querySelector('.er-sel-send').addEventListener('click', () => { const q = input.value.trim(); if (q) run(q); });
      input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { const q = input.value.trim(); if (q) run(q); } });
      setTimeout(() => input.focus(), 40);
    } else run();
    setTimeout(() => {
      this._selPopDismiss = (ev) => { if (!pop.contains(ev.target)) this._dismissSelPopover(); };
      document.addEventListener('mousedown', this._selPopDismiss);
    }, 0);
  }

  _selDelta(p) {
    if (!p || p.requestID !== this._selRequestID) return;
    const body = this.selPopover?.querySelector('.er-sel-body');
    if (!body) return;
    if (body.classList.contains('loading')) { body.className = 'er-sel-body rendered'; body.textContent = ''; }
    body.textContent += p.delta || '';
    body.scrollTop = body.scrollHeight;
  }

  _dismissSelPopover() {
    if (this._selPopDismiss) { document.removeEventListener('mousedown', this._selPopDismiss); this._selPopDismiss = null; }
    this.selPopover?.remove();
    this.selPopover = null;
    this._selRequestID = null;
  }

  /** 命令面板接入（R20）：期刊打开时的专属命令（app.js buildPaletteCommands 合并）。 */
  paletteCommands() {
    if (!this.overlay || !this.open) return [];
    const paperBtn = () => this.overlay.querySelector('.er-paper')?.click();
    return [
      { group: t('期刊'), label: t('下一页'), keywords: 'page next 期刊 下一页 翻页', icon: 'chevronRight', action: () => this._go(this.index + 1) },
      { group: t('期刊'), label: t('上一页'), keywords: 'page prev 期刊 上一页', icon: 'chevronLeft', action: () => this._go(this.index - 1) },
      { group: t('期刊'), label: t('搜索本期 / 本文'), keywords: 'find search 期刊 搜索 查找', icon: 'search', action: () => this._findOpen() },
      { group: t('期刊'), label: t('排版面板（行距/字号/页边/栏宽/首字下沉）'), keywords: 'typography aa 排版 行距 字号 页边 栏宽 首字 font size', icon: 'textLarger', action: () => this._toggleTypePanel(this.overlay.querySelector('.er-type')) },
      { group: t('期刊'), label: t('切换纸张质感'), keywords: 'paper 纸张 质感 牛皮 书卷', icon: 'bookOpen', action: paperBtn },
      { group: t('期刊'), label: t('段落聚焦开关'), keywords: 'focus 段落 聚焦', icon: 'eye', action: () => this._toggleFocusMode() },
      { group: t('期刊'), label: t('导出当前页图片'), keywords: 'export 导出 当前页 图片 截图', icon: 'export', action: () => this._exportPage() },
      { group: t('期刊'), label: t('沉浸全屏'), keywords: 'fullscreen 全屏 沉浸', icon: 'expand', action: () => this._toggleFullscreen() },
      { group: t('期刊'), label: t('退出期刊'), keywords: 'exit quit 退出 期刊', icon: 'close', action: () => this.dismiss() },
    ];
  }

  // ────────────────────────────────────────────────
  // 快捷键速查面板（R14）：? 呼出，纸张卡片两列
  // ────────────────────────────────────────────────
  _toggleKeysPanel() {
    if (!this.overlay) return;
    let panel = this.overlay.querySelector('.er-keys-panel');
    if (panel) { panel.remove(); return; }
    const KEYS = [
      ['← →', t('翻页（PgUp / PgDn 同）')],
      ['Enter', t('开书 · 打开选中文章')],
      ['Ctrl + F', t('搜索本期 / 本文')],
      ['S', t('收藏 / 取消收藏')],
      ['L', t('稍后读 / 移出')],
      ['Aa', t('行距 · 字号 · 页边距 · 栏宽 · 首字下沉')],
      ['Ctrl + 滚轮', t('字号三档步进')],
      ['F', t('沉浸全屏')],
      ['Esc', t('逐层关闭 / 退出版面')],
    ];
    panel = document.createElement('div');
    panel.className = 'er-keys-panel';
    panel.innerHTML = `<div class="er-keys-head">${escapeHTML(t('键盘快捷键'))}</div>
      <div class="er-keys-grid">${KEYS.map(([k, d]) => `<div class="er-keys-row"><kbd>${escapeHTML(k)}</kbd><span>${escapeHTML(d)}</span></div>`).join('')}</div>
      ${this._sessionPages || (this._sessionEntries && this._sessionEntries.size) ? `<div class="er-keys-session">${escapeHTML(t('本次会话'))} · ${escapeHTML(t('翻页'))} <b>${this._sessionPages || 0}</b> · ${escapeHTML(t('读'))} <b>${(this._sessionEntries || new Set()).size}</b> ${escapeHTML(t('篇'))}</div>` : ''}`;
    panel.addEventListener('click', (ev) => { if (!ev.target.closest('kbd')) panel.remove(); });
    this.overlay.appendChild(panel);
    requestAnimationFrame(() => panel.classList.add('on'));
  }

  // ────────────────────────────────────────────────
  // 当前页导出（R13）：截书页矩形 → 剪贴板
  // ────────────────────────────────────────────────
  async _exportPage() {
    if (!this.overlay) return;
    // 收起浮层避免入画
    this._findClose();
    this._dismissSelBar();
    this._dismissSelPopover();
    this.overlay.querySelector('.er-type-panel')?.remove();
    this.overlay.querySelector('.er-toc')?.remove();
    await new Promise((r) => setTimeout(r, 120));
    const book = this.overlay.querySelector('.er-book');
    if (!book) return;
    const r = book.getBoundingClientRect();
    if (r.width < 10) return;
    try {
      // 工具条叠在书页 rect 顶带内，先隐藏避免烙进导出图
      const tools = this.overlay.querySelector('.er-tools');
      const prevVisibility = tools ? tools.style.visibility : '';
      if (tools) tools.style.visibility = 'hidden';
      let base64;
      try {
        base64 = await window.robin.captureRect({ x: r.x, y: r.y, width: r.width, height: r.height });
      } finally {
        if (tools) tools.style.visibility = prevVisibility;
      }
      await window.robin.copyImage(base64);
      this._fx('done');
      this._notice(t('当前页图片已复制到剪贴板'));
    } catch {
      this._notice(t('导出失败：请重试'));
    }
  }

  // ────────────────────────────────────────────────
  // 段落聚焦（R19）：文章模式 P 切换，其余段落降透明、点击/↑↓ 换段
  // ────────────────────────────────────────────────
  _focusBlocks() {
    const page = this.pages[this.index];
    if (!page || !page.article) return [];
    return [...(page.article.left || []), ...(page.article.right || [])].map((b) => b.el).filter(Boolean);
  }
  _applyFocus() {
    const blocks = this._focusBlocks();
    blocks.forEach((el, i) => el.classList.toggle('er-blk-focus', this.focusMode && i === this._focusIdx));
  }
  _focusMove(dir) {
    const blocks = this._focusBlocks();
    if (!blocks.length) return;
    this._focusIdx = clamp((this._focusIdx == null ? 0 : this._focusIdx) + dir, 0, blocks.length - 1);
    this._applyFocus();
  }
  _toggleFocusMode() {
    if (!this.overlay) return;
    if (this.mode !== 'article') { this._notice(t('段落聚焦在文章模式下使用（先点开一篇文章）')); return; }
    this.focusMode = !this.focusMode;
    this.overlay.classList.toggle('er-focus', this.focusMode);
    if (this.focusMode) {
      this._focusIdx = 0;
      this._applyFocus();
      this._notice(t('段落聚焦：点击段落或 ↑↓ 切换'));
    } else {
      this._focusIdx = null;
      // 全局清（翻页中途关闭时旧页快照不在当前页引用里）
      this.overlay.querySelectorAll('.er-blk-focus').forEach((el) => el.classList.remove('er-blk-focus'));
    }
  }

  // ────────────────────────────────────────────────
  // 期刊内搜索（R11）：Ctrl+F 搜索条——文章模式全文定位（叶高亮），版面模式条目跳页
  // ────────────────────────────────────────────────
  _findOpen() {
    if (!this.overlay) return;
    let bar = this.overlay.querySelector('.er-findbar');
    if (bar) { bar.querySelector('.er-find-input').focus(); return; }
    bar = document.createElement('div');
    bar.className = 'er-findbar';
    bar.innerHTML = `<input class="er-find-input" placeholder="${escapeHTML(t('搜索本期 / 本文…'))}"/>
      <span class="er-find-count"></span>
      <button class="er-find-btn prev" title="${escapeHTML(t('上一个 (Shift+Enter)'))}">↑</button>
      <button class="er-find-btn next" title="${escapeHTML(t('下一个 (Enter)'))}">↓</button>
      <button class="er-find-btn close" title="${escapeHTML(t('关闭 (Esc)'))}">✕</button>`;
    this.overlay.appendChild(bar);
    requestAnimationFrame(() => bar.classList.add('on'));
    const input = bar.querySelector('.er-find-input');
    input.addEventListener('input', () => this._findRun(input.value));
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); this._findStep(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') { e.preventDefault(); this._findClose(); }
    });
    bar.querySelector('.prev').addEventListener('click', () => this._findStep(-1));
    bar.querySelector('.next').addEventListener('click', () => this._findStep(1));
    bar.querySelector('.close').addEventListener('click', () => this._findClose());
    setTimeout(() => input.focus(), 60);
  }

  _findClose() {
    this.overlay?.querySelector('.er-findbar')?.remove();
    this._findMatches = [];
    this._findIdx = -1;
    this.overlay?.querySelectorAll('.er-leaf-hit').forEach((el) => el.classList.remove('er-leaf-hit'));
  }

  _findRun(q) {
    this._findMatches = [];
    this._findIdx = -1;
    const count = this.overlay?.querySelector('.er-find-count');
    if (!count) return;
    if (!q) { count.textContent = ''; return; }
    const needle = String(q).toLowerCase();
    if (this.mode === 'article' && this.article) {
      // 处级展开：每一处命中一个条目，计数与页面可数事实同口径（R11 评审）
      this._findMatches = [];
      (this.article.spreads || []).forEach((sp, pi) => {
        for (const leafKey of ['left', 'right']) {
          const blocks = sp[leafKey];
          if (!blocks || !blocks.length) continue;
          const low = blocks.map((b) => b.el.textContent).join(' ').toLowerCase();
          let pos = 0;
          while ((pos = low.indexOf(needle, pos)) !== -1) {
            this._findMatches.push({ page: pi, leaf: leafKey });
            pos += needle.length;
          }
        }
      });
      count.textContent = `${this._findMatches.length} ${t('处')}`;
    } else {
      this._findMatches = this.items
        .filter((it) => (String(it.title || '') + ' ' + String(it.summary || '')).toLowerCase().includes(needle))
        .map((it) => ({ id: it.id, page: this.pages.findIndex((p) => p.entries.some((e) => e.id === it.id)) }));
      count.textContent = `${this._findMatches.length} ${t('条')}`;
    }
  }

  _findStep(dir) {
    if (!this._findMatches.length) return;
    this._findIdx = (this._findIdx + dir + this._findMatches.length) % this._findMatches.length;
    const m = this._findMatches[this._findIdx];
    const count = this.overlay?.querySelector('.er-find-count');
    if (!count) return;
    if (this.mode === 'article') {
      const jump = m.page !== this.index;
      if (jump) this._go(m.page);
      count.textContent = `${this._findIdx + 1} / ${this._findMatches.length} ${t('处')}`;
      // 落页后高亮目标叶（动画 ~0.65s + settle）
      setTimeout(() => {
        this.overlay?.querySelectorAll('.er-leaf-hit').forEach((el) => el.classList.remove('er-leaf-hit'));
        const leaves = this.overlay?.querySelectorAll('.er-article-leaf');
        const leafEl = leaves?.[m.leaf === 'right' ? 1 : 0];
        leafEl?.classList.add('er-leaf-hit');
        setTimeout(() => leafEl?.classList.remove('er-leaf-hit'), 1600);
      }, jump ? 900 : 60);
    } else {
      if (m.page >= 0 && m.page !== this.index) this._go(m.page);
      this._select(m.id);
      count.textContent = `${this._findIdx + 1} / ${this._findMatches.length} ${t('条')}`;
    }
  }

  // ────────────────────────────────────────────────
  // 动作音效（R16）：收藏 tick / 导出 done（WebAudio 合成）、开书纸声变奏；统一受音效开关管
  // ────────────────────────────────────────────────
  _fx(kind) {
    if (!this.soundOn) return;
    this._fxCalls = (this._fxCalls || 0) + 1;
    try {
      if (kind === 'open') {
        const a = new Audio(this.soundSrc);
        a.volume = 0.4;
        a.playbackRate = 1.25;
        a.play().catch(() => {});
        return;
      }
      const ctx = this._fxCtx || (this._fxCtx = new (window.AudioContext || window.webkitAudioContext)());
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const t0 = ctx.currentTime + 0.01;
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      if (kind === 'tick') {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = 880;
        o.connect(gain);
        gain.gain.setValueAtTime(0.06, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.07);
        o.start(t0);
        o.stop(t0 + 0.08);
      } else if (kind === 'done') {
        [660, 990].forEach((f, i) => {
          const o = ctx.createOscillator();
          o.type = 'sine';
          o.frequency.value = f;
          o.connect(gain);
          const s = t0 + i * 0.07;
          gain.gain.setValueAtTime(0.05, s);
          gain.gain.exponentialRampToValueAtTime(0.001, s + 0.09);
          o.start(s);
          o.stop(s + 0.1);
        });
      }
    } catch { /* 音频不可用时静默 */ }
  }

  // ────────────────────────────────────────────────
  // 快捷收藏/稍后读（R12）：S/L 键，版面=选中卡、文章=当前文章
  // ────────────────────────────────────────────────
  _quickToggle(kind) {
    if (!this.open) return;
    let entry = null;
    if (this.mode === 'article') entry = this.article?.entry || null;
    else if (this.selected) entry = this.items.find((x) => x.id === this.selected) || null;
    if (!entry) { this._notice(t('先用方向键选中一张卡片')); return; }
    const isStar = kind === 'star';
    const cur = isStar ? entry.isStarred : entry.isLater;
    const next = !cur;
    if (isStar) entry.isStarred = next;
    else entry.isLater = next;
    const cb = isStar ? this.onToggleStar : this.onToggleLater;
    if (typeof cb === 'function') {
      Promise.resolve(cb(entry.id, next)).catch(() => {});
    }
    this._notice(next
      ? (isStar ? t('已收藏') : t('已加入稍后读'))
      : (isStar ? t('已取消收藏') : t('已移出稍后读')));
    this._fx('tick');
    // 版面当前页重绘以刷新星标/稍后读标记；文章态仅 notice（页眉无标记位）
    if (this.mode === 'edition') this._syncSheets(true);
  }

  /** 封面期号：最新文章所在年的周序号（「总第 N 期」/ Vol.N）。 */  _coverVol() {
    const newest = this.items.reduce((acc, it) => ((it.date || 0) > (acc || 0) ? it.date : acc), 0);
    if (!newest) return '';
    const d = new Date(newest * 1000);
    const jan1 = new Date(d.getFullYear(), 0, 1);
    const week = Math.max(1, Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7));
    return (window.__robinLanguage || 'zh') === 'zh' ? `总第 ${week} 期` : `Vol.${week}`;
  }

  /** 封面期号日期：本期最新文章日期（中文「2026 年 9 月 28 日」/英文长格式）。 */
  _coverDate() {
    const newest = this.items.reduce((acc, it) => ((it.date || 0) > (acc || 0) ? it.date : acc), 0);
    if (!newest) return '';
    const d = new Date(newest * 1000);
    const zh = (window.__robinLanguage || 'zh') === 'zh';
    return zh ? `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`
      : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  _prepareSheetB(idx, force = false) {
    const b = this.overlay.querySelector('.er-sheet[data-role="b"]');
    const page = this.pages[idx];
    const key = page ? `${idx}:${page.id}` : '';
    if (force || b.dataset.key !== key) {
      b.innerHTML = '';
      if (page) {
        b.appendChild(this._pageInner(page, idx));
        this._prefetch(page);
      }
      b.dataset.key = key;
    }
  }

  _syncSheets(force) {
    if (!this.overlay) return;
    const a = this.overlay.querySelector('.er-sheet[data-role="a"]');
    const page = this.pages[this.index];
    if (!page) {
      a.innerHTML = `<div class="er-empty">${escapeHTML(t('暂无文章'))}</div>`;
      a.dataset.key = 'empty';
      this._prepareSheetB(this.index + 1, true);
      return;
    }
    const keyA = `${this.index}:${page.id}`;
    if (force || a.dataset.key !== keyA) {
      a.innerHTML = '';
      a.appendChild(this._pageInner(page, this.index));
      a.dataset.key = keyA;
    }
    this._prepareSheetB(this.index + 1, force);
    this._syncPageChrome();
  }

  _prefetch(page) {
    for (const pl of page.placements) {
      if (pl.st.imageH > 0) {
        const entry = page.entries.find((e) => e.id === pl.entryID);
        if (entry?.image) { const im = new Image(); im.src = entry.image; }
      }
    }
  }

  _syncPageChrome() {
    const page = this.pages[this.index];
    this.overlay.querySelector('.er-sheet[data-role="a"]').classList.toggle('is-spread', page?.form === 'spread');
    this.overlay.querySelector('.er-sheet[data-role="b"]').classList.toggle('is-spread', page?.form === 'spread');
  }

  // ────────────────────────────────────────────────
  // 翻页引擎（折页 / 淡入）
  // ────────────────────────────────────────────────
  _pageIndex() { return this.turn ? this.turn.toIdx : this.index; }

  _beginTurn(toIdx, dir, interactive = false) {
    if (this.turn || !this.open) return null;
    toIdx = clamp(toIdx, -1, this.pages.length - 1);
    if (toIdx < 0) { this._closeBook(); return null; }
    if (toIdx >= this.pages.length) { this._notice(t('已经是最后一页')); return null; }
    if (toIdx === this.index) return null;
    const preset = TURN_PRESETS[Math.floor(Math.random() * TURN_PRESETS.length)];
    const fromPage = this.pages[this.index], toPage = this.pages[toIdx];
    // R34 加固：索引失准（任何来源）时不崩——页对象缺失直接回退淡入路径并校正索引
    if (!fromPage || !toPage) {
      this.index = clamp(this.index, 0, this.pages.length - 1);
      this._syncSheets(true);
      return null;
    }
    // 低端机帧率自适应：折页时连续掉帧（<22fps）则本次会话自动回退淡入
    const fade = !this._metrics().spread || fromPage.form !== 'spread' || toPage.form !== 'spread' || this.reduceMotion || this._perfDegraded === true;
    const book = this.overlay.querySelector('.er-book');
    const leaf = this.overlay.querySelector('.er-leaf');
    const sheetB = this.overlay.querySelector('.er-sheet[data-role="b"]');
    const turn = {
      dir, toIdx, preset, fade,
      progress: interactive ? 0 : null,
      phase: interactive ? 'drag' : 'settle',
      animStart: 0, animDur: 0, animFrom: 0, animTo: 1, slope: null,
      velocity: 0,
    };
    this.turn = turn;
    // 目标页装载到 b（正翻=预取页通常已在；反翻=现载）
    this._prepareSheetB(toIdx);
    if (fade) {
      leaf.hidden = true;
      sheetB.classList.add('er-fadein');
      if (!interactive) this._startSettle(0, 1, null, this.reduceMotion ? 0.12 : 0.2);
    } else {
      this._mountLeaf(turn);
      if (!interactive) this._startSettle(0, 1, null, null);
    }
    return turn;
  }

  _mountLeaf(turn) {
    const m = this._metrics();
    const book = this.overlay.querySelector('.er-book');
    const sheetA = this.overlay.querySelector('.er-sheet[data-role="a"]');
    const leaf = this.overlay.querySelector('.er-leaf');
    const fwd = turn.dir > 0;
    leaf.hidden = false;
    leaf.className = 'er-leaf ' + (fwd ? 'fwd' : 'bwd');
    leaf.style.cssText = `width:${m.paperW / 2}px;height:${m.bookH}px;`;
    book.classList.add('er-turning', fwd ? 'er-turning-fwd' : 'er-turning-bwd');
    sheetA.classList.add(fwd ? 'clip-left' : 'clip-right');
    const front = leaf.querySelector('.er-face-front');
    const back = leaf.querySelector('.er-face-back');
    // 折页两面：窗口全页克隆的「移动半/落半」。
    // 背面自带 rotateY(180°) 预旋，与叶体翻转到 ±180° 抵消——窗口取「落半」即可正向可读，无需再镜像。
    const mkInner = (host, srcSelector, offsetPx) => {
      host.querySelector('.er-face-in')?.remove();
      const inner = document.createElement('div');
      inner.className = 'er-face-in';
      inner.style.cssText = `width:${m.paperW}px;left:${offsetPx}px;`;
      const srcIn = this.overlay.querySelector(srcSelector + ' > .er-in');
      if (srcIn) [...srcIn.children].forEach((ch) => inner.appendChild(ch.cloneNode(true)));
      host.insertBefore(inner, host.firstChild);
      return inner;
    };
    // 前面 = 当前页移动半；背面 = 目标页落半
    mkInner(front, '.er-sheet[data-role="a"]', fwd ? -m.paperW / 2 : 0);
    mkInner(back, '.er-sheet[data-role="b"]', fwd ? 0 : m.paperW / 2);
    turn.frontFace = front;
    turn.backFace = back;
    this._applyProgress(0);
  }

  _applyProgress(p) {
    const turn = this.turn;
    if (!turn) return;
    turn.progress = clamp(p, 0, 1);
    // 拖拽翻页启动时清掉误选的文字选区（正文可选中，与拖拽跟手共用手势）
    if (!this._selCleared) { window.getSelection?.()?.removeAllRanges(); this._selCleared = true; }
    // 元素引用缓存（R11 性能：动画每帧 3-4 次 querySelector 是滚动卡顿的主因之一）
    if (!turn._els || turn._els.book.ownerDocument !== this.overlay.ownerDocument) {
      turn._els = {
        book: this.overlay.querySelector('.er-book'),
        leaf: this.overlay.querySelector('.er-leaf'),
        cast: this.overlay.querySelector('.er-cast'),
        sheetB: this.overlay.querySelector('.er-sheet[data-role="b"]'),
        shadeFront: this.overlay.querySelector('.er-leaf .er-face-front .er-face-shade'),
        shadeBack: this.overlay.querySelector('.er-leaf .er-face-back .er-face-shade'),
      };
    }
    const { book, leaf, cast } = turn._els;
    const pulse = Math.sin(Math.PI * turn.progress);
    if (turn.fade) {
      turn._els.sheetB.style.opacity = String(turn.progress);
      return;
    }
    const fwd = turn.dir > 0;
    const angle = 180 * turn.progress;
    // 单面绘制：过竖直面前只画正面、之后只画背面（纸页 edge-on 时切换不可见，
    // 规避 backface-visibility 在嵌套 3D 下的渲染不确定性）
    if (turn.frontFace && turn.backFace) {
      const showBack = turn.progress >= 0.5;
      turn.frontFace.style.display = showBack ? 'none' : 'block';
      turn.backFace.style.display = showBack ? 'block' : 'none';
    }
    const kink = turn.preset.corner;
    const rz = kink * 1.8 * pulse;
    const ty = kink * 5 * pulse;
    leaf.style.transform = `rotateY(${fwd ? -angle : angle}deg) rotate(${fwd ? rz : -rz}deg) translateY(${ty}px)`;
    // 折带光影（MagazineMetalRenderer shader 语义）：掠射增亮 + 书脊侧暗影
    const glow = Math.pow(pulse, 0.8);
    turn._els.shadeFront.style.opacity = String(0.4 * glow);
    turn._els.shadeBack.style.opacity = String(0.3 * glow);
    cast.style.opacity = String(0.2 * pulse);
    book.style.setProperty('--er-pulse', String(pulse));
  }

  _startSettle(from, to, slope, fixedDur) {
    const turn = this.turn;
    if (!turn) return;
    turn.phase = 'settle';
    turn.animStart = performance.now();
    turn.animFrom = from;
    turn.animTo = to;
    turn.slope = slope;
    turn.animDur = fixedDur ?? Math.max(0.12, turn.preset.dur * Math.abs(to - from) * (this.reduceMotion ? 0.35 : 1));
    if (this.reduceMotion) turn.animDur = Math.min(turn.animDur, 0.12);
    // 帧驱动（R11 性能）：可见窗口用 rAF（与显示器刷新同步，消除 16ms timer 抖动卡顿）；
    // 隐藏窗口 rAF 被冻结，回退 16ms timer（对标上游 clockTask 兜底钟）。合成器走 transform，主线程只写样式。
    const schedule = (fn) => {
      if (document.visibilityState === 'visible') this._raf = requestAnimationFrame(fn);
      else this._raf = setTimeout(fn, 16);
    };
    const tick = () => {
      const tn = this.turn;
      if (!tn || tn !== turn || tn.phase !== 'settle') return;
      // 帧率采样（仅前台聚焦窗口）：连续 5 帧间隔 >45ms 判定低端机，本次会话折页自动降级淡入
      const now = performance.now();
      const dt = now - (this._lastTickAt || now);
      this._lastTickAt = now;
      if (document.visibilityState === 'visible' && document.hasFocus()) {
        if (dt > 45) this._slowFrames = (this._slowFrames || 0) + 1;
        else this._slowFrames = Math.max(0, (this._slowFrames || 0) - 1);
        if (this._slowFrames >= 5) this._perfDegraded = true;
      }
      const time = clamp((performance.now() - turn.animStart) / (turn.animDur * 1000), 0, 1);
      const eased = turn.slope != null ? settledEase(time, turn.slope) : bezierEase(time);
      this._applyProgress(turn.animFrom + (turn.animTo - turn.animFrom) * eased);
      if (time >= 1) this._finishTurn(turn.animTo >= 0.999);
      else schedule(tick);
    };
    schedule(tick);
  }

  _finishTurn(committed) {
    const turn = this.turn;
    if (!turn) return;
    this.turn = null;
    this._selCleared = false;
    const book = this.overlay.querySelector('.er-book');
    const leaf = this.overlay.querySelector('.er-leaf');
    const sheetA = this.overlay.querySelector('.er-sheet[data-role="a"]');
    const sheetB = this.overlay.querySelector('.er-sheet[data-role="b"]');
    sheetB.style.opacity = '';
    sheetB.classList.remove('er-fadein');
    book.classList.remove('er-turning', 'er-turning-fwd', 'er-turning-bwd');
    sheetA.classList.remove('clip-left', 'clip-right');
    leaf.hidden = true;
    if (committed) {
      this._sessionPages = (this._sessionPages || 0) + 1; // 会话阅读统计（R15）
      this.index = turn.toIdx;
      this._savePos(this.index); // 阅读位置记忆（版面模式）
      const landed = this.pages[this.index];
      const remembered = landed && this.lastSelByPage.get(landed.id);
      this._select(remembered && landed.placements.some((p) => p.entryID === remembered) ? remembered : null);
      this._play();
      // a 面强制重建（克隆页不带卡片监听），b 转为下一页预取
      sheetA.dataset.key = 'stale';
      this._syncSheets(false);
      this._syncRail();
    } else {
      this._syncSheets(false);
      this._syncRail();
    }
  }

  _play() {
    if (!this._sound || !this.soundOn) return;
    try { this._sound.currentTime = 0; this._sound.play().catch(() => {}); } catch { /* 忽略 */ }
  }

  // ────────────────────────────────────────────────
  // 交互：指针（三分区点击 + 拖拽跟手）
  // ────────────────────────────────────────────────
  _down(e) {
    if (e.button !== 0) return;
    const stage = e.currentTarget;
    const rect = stage.getBoundingClientRect();
    const m = this._metrics();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (y > rect.height - RAIL_H) return; // 滑轨区域另算
    if (!this.open) return; // 封面态：click 由封面元素处理
    const down = { x, y, t: performance.now(), onStory: !!e.target.closest('.er-story'), moved: false, turnStarted: false };
    const move = (ev) => {
      const dx = ev.clientX - rect.left - down.x, dy = ev.clientY - rect.top - down.y;
      if (!down.moved && Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      if (!down.moved) {
        if (Math.abs(dx) <= Math.abs(dy) * 1.5) { cleanup(); return; } // 纵向：不抢
        down.moved = true;
      }
      if (!this.open) return;
      if (this.index === 0 && dx > 0) { cleanup(); return; } // 页首右拖 = 合上（阈值在 up 判定）
      if (!down.turnStarted) {
        down.turnStarted = true;
        const dir = dx < 0 ? 1 : -1;
        if (dir > 0 && this.index >= this.pages.length - 1) { cleanup(); return; }
        if (dir < 0 && this.index === 0) { cleanup(); return; }
        this._beginTurn(this.index + dir, dir, true);
      }
      const tn = this.turn;
      if (tn && tn.phase === 'drag') {
        const sign = tn.dir > 0 ? -1 : 1;
        const distance = (ev.clientX - rect.left - down.x) * sign;
        this._applyProgress(distance / (m.contentW * 0.65));
        down.lastX = ev.clientX; down.lastT = performance.now();
      }
    };
    const up = (ev) => {
      cleanup();
      const dx = ev.clientX - rect.left - down.x, dy = ev.clientY - rect.top - down.y;
      const dist = Math.hypot(dx, dy);
      if (!down.moved && dist < 6) {
        this._click(x, rect, e);
        return;
      }
      if (this.index === 0 && dx > 0) {
        if (dx > 24) this._closeBook();
        return;
      }
      const tn = this.turn;
      if (!tn || tn.phase !== 'drag') return;
      const dt = Math.max(1, performance.now() - (down.lastT || down.t));
      const vx = ((ev.clientX - (down.lastX ?? down.x + rect.left)) / dt) * 1000; // px/s
      const sign = tn.dir > 0 ? -1 : 1;
      const releaseVelocity = (vx * sign) / (m.contentW * 0.65 * 0.25);
      const p = tn.progress ?? 0;
      const predicted = p + releaseVelocity * 0.16;
      const commit = p > 0.4 || (p > 0.12 && predicted > 0.45);
      tn.slope = Math.abs(p - (commit ? 1 : 0)) > 0.001 ? clamp(releaseVelocity * Math.max(0.12, tn.preset.dur * Math.abs((commit ? 1 : 0) - p)) / ((commit ? 1 : 0) - p), -1, 3) : null;
      if (tn.slope != null) tn.animDur = Math.min(0.42, Math.max(0.22, Math.abs((commit ? 1 : 0) - p) * 0.48));
      if (tn.fade) {
        // 淡入模式也允许取消/提交
        this._startSettle(p, commit ? 1 : 0, null, this.reduceMotion ? 0.12 : 0.2);
      } else {
        this._startSettle(p, commit ? 1 : 0, tn.slope, tn.slope != null ? tn.animDur : null);
      }
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  }

  _click(x, stageRect, ev) {
    const m = this._metrics();
    const stageLeft = (stageRect.width - m.paperW) / 2;
    const rel = x - stageLeft;
    if (ev.target.closest('.er-story')) return; // 卡片自身 click 处理
    if (ev.target.closest('.er-backcover, .er-rail, .er-edge, .er-close')) return;
    if (rel < m.paperW / 3) return this._go(this._pageIndex() - 1);
    if (rel > (m.paperW * 2) / 3) return this._go(this._pageIndex() + 1);
    this._select(null);
  }

  _edgeHover(e) {
    const edges = this.overlay?.querySelectorAll('.er-edge');
    if (!edges) return;
    let show = 0;
    if (e && this.open && !this.turn) {
      const rect = this.overlay.querySelector('.er-stage').getBoundingClientRect();
      const m = this._metrics();
      const margin = Math.max(64, (rect.width - m.paperW) / 2 + 20);
      const x = e.clientX - rect.left;
      if (x < margin) show = -1;
      else if (x > rect.width - margin) show = 1;
    }
    edges.forEach((btn) => { btn.hidden = show !== Number(btn.dataset.dir); });
  }

  _wheel(e) {
    // Ctrl+滚轮（R27）：字号三档步进（复用 R24 fontScale），不翻页、不触发缩放
    if (e.ctrlKey) {
      e.preventDefault();
      this._fontAcc = (this._fontAcc || 0) + e.deltaY;
      if (Math.abs(this._fontAcc) >= 30) {
        const dir = this._fontAcc > 0 ? -1 : 1; // 上滚放大
        this._fontAcc = 0;
        this._stepFontScale(dir);
      }
      return;
    }
    if (!this.open || this.turn) return;
    // 灯箱开启时滚轮不翻页
    if (this._lightboxOn && this.overlay.querySelector('.er-lightbox.on')) return;
    const now = performance.now();
    if (!this._wheelT || now - this._wheelT > 320) this._wheelAcc = 0;
    this._wheelT = now;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    this._wheelAcc = (this._wheelAcc || 0) + d;
    if (Math.abs(this._wheelAcc) >= 40) {
      const dir = this._wheelAcc < 0 ? 1 : -1;
      this._wheelAcc = 0;
      this._go(this.index + dir);
    }
  }

  /** 字号档步进（R27）：small→standard→large 钳位不回绕；同步面板选中态与持久化。 */
  _stepFontScale(dir) {
    const keys = Object.keys(FONTSCALE);
    const cur = keys.indexOf(this.typo.fontScale);
    const next = keys[Math.min(keys.length - 1, Math.max(0, (cur < 0 ? 1 : cur) + dir))];
    if (next === this.typo.fontScale) return;
    this.typo.fontScale = next;
    try { localStorage.setItem('robinread.editionTypography', JSON.stringify(this.typo)); } catch (_) { /* 忽略 */ }
    this._applyTypography();
    const panel = this.overlay?.querySelector('.er-type-panel');
    if (panel) panel.querySelectorAll('.er-type-opts button').forEach((x) => {
      x.classList.toggle('on', String(this.typo[x.dataset.key]) === x.dataset.val || (x.dataset.key === 'firstCap' && String(this.typo.firstCap) === x.dataset.val));
    });
  }

  // ────────────────────────────────────────────────
  // 键盘遥控导航（MagazineSpatialNavigation 语义移植）
  // ────────────────────────────────────────────────
  _keydown(e) {
    if (!this.overlay) return;
    // 灯箱开启时：Esc 放大态先复位再关闭、←→ 切换画廊图片，其余按键忽略防误翻页
    if (this._lightboxOn && this.overlay.querySelector('.er-lightbox.on')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if ((this._lbZoom || 1) > 1.02) this._lbReset();
        else { this.overlay.querySelector('.er-lightbox').classList.remove('on'); this._lightboxOn = false; }
        return;
      }
      if (e.key === 'ArrowRight') { e.preventDefault(); return this._lightboxStep(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); return this._lightboxStep(-1); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); return this._findOpen(); }
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); return this._toggleFullscreen(); }
    // 快捷键速查（R14）：Shift+/ 即 ?
    if (e.key === '?' || (e.shiftKey && e.key === '/')) { e.preventDefault(); return this._toggleKeysPanel(); }
    // 段落聚焦（R19）：P 切换，↑↓ 换段
    if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); return this._toggleFocusMode(); }
    // 收藏 / 稍后读（R12）：S/L 作用于选中卡（版面）或当前文章
    if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); return this._quickToggle('star'); }
    if ((e.key === 'l' || e.key === 'L') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); return this._quickToggle('later'); }
    if (e.key === 'Escape') {
      // 搜索条 → 灯箱 → 划词弹层 → 排版面板 → 快捷键面板 → 文章目录 → 返回版面 → 退出
      if (this.overlay.querySelector('.er-findbar')) { e.preventDefault(); return this._findClose(); }
      const keysPanel = this.overlay.querySelector('.er-keys-panel');
      if (keysPanel) { e.preventDefault(); keysPanel.remove(); return; }
      const lb = this.overlay.querySelector('.er-lightbox.on');
      if (lb) {
        e.preventDefault();
        if ((this._lbZoom || 1) > 1.02) this._lbReset();
        else { lb.classList.remove('on'); this._lightboxOn = false; }
        return;
      }
      if (this.selPopover) { e.preventDefault(); this._dismissSelPopover(); return; }
      if (this.selBar) { e.preventDefault(); this._dismissSelBar(); return; }
      const typePanel = this.overlay.querySelector('.er-type-panel');
      if (typePanel) { e.preventDefault(); typePanel.remove(); return; }
      const toc = this.overlay.querySelector('.er-toc');
      if (toc) { e.preventDefault(); toc.remove(); return; }
      if (this.mode === 'article') { e.preventDefault(); return this._closeArticle(); }
      return this.dismiss();
    }
    if (!this.open) {
      if (['ArrowRight', 'Enter', ' ', 'PageDown'].includes(e.key)) { e.preventDefault(); this._doOpen(); }
      return;
    }
    if (this.mode === 'article') {
      // 段落聚焦模式：↑↓ 换段（R19）
      if (this.focusMode) {
        if (e.key === 'ArrowUp') { e.preventDefault(); return this._focusMove(-1); }
        if (e.key === 'ArrowDown') { e.preventDefault(); return this._focusMove(1); }
      }
      if (e.key === 'PageUp' || e.key === 'ArrowLeft') { e.preventDefault(); return this._go(this.index - 1); }
      if (e.key === 'PageDown' || e.key === 'ArrowRight') { e.preventDefault(); return this._go(this.index + 1); }
      return;
    }
    if (e.key === 'PageUp') { e.preventDefault(); return this._go(this.index - 1); }
    if (e.key === 'PageDown') { e.preventDefault(); return this._go(this.index + 1); }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      if ((e.key === 'Enter' || e.key === ' ') && this.selected) {
        e.preventDefault();
        const entry = this.pages[this.index].entries.find((x) => x.id === this.selected);
        if (entry) this._openArticle(entry);
      }
      return;
    }
    e.preventDefault();
    if (this.turn) return;
    const page = this.pages[this.index];
    const placements = page.placements;
    const cur = placements.find((p) => p.entryID === this.selected);
    if (!cur) {
      if (placements.length) this._select(placements[0].entryID);
      return;
    }
    const neighbor = this._neighbor(cur, placements, e.key);
    if (neighbor) return this._select(neighbor.entryID);
    if (e.key === 'ArrowLeft') {
      this.lastSelByPage.set(page.id, cur.entryID);
      this._go(this.index - 1);
    } else if (e.key === 'ArrowRight') {
      if (this.index >= this.pages.length - 1) return this._notice(t('已经是最后一页'));
      this.lastSelByPage.set(page.id, cur.entryID);
      this._go(this.index + 1);
    }
    // 上下到顶/底即停，不翻页
  }

  _neighbor(cur, placements, key) {
    const verticalOverlap = (a, b) => Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    const verticalGap = (a, b) => Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h), 0);
    const colGap = (a, b, right) => (right ? b.x - (a.x + a.w) : a.x - (b.x + b.w));
    const others = placements.filter((p) => p.entryID !== cur.entryID);
    if (key === 'ArrowRight' || key === 'ArrowLeft') {
      const right = key === 'ArrowRight';
      const side = others.filter((p) => (right ? p.x >= cur.x + cur.w - 1 : p.x + p.w <= cur.x + 1));
      if (!side.length) return null;
      const sameBand = side.filter((p) => verticalOverlap(p, cur) > 0);
      const pick = (arr, cmp) => arr.reduce((acc, p) => (!acc || cmp(p, acc) ? p : acc), null);
      if (sameBand.length) {
        return pick(sameBand, (a, b) => {
          const ga = colGap(a, cur, right), gb = colGap(b, cur, right);
          if (Math.abs(ga - gb) > 8) return ga < gb;
          return a.y < b.y;
        });
      }
      return pick(side, (a, b) => {
        const da = verticalGap(a, cur), db = verticalGap(b, cur);
        if (Math.abs(da - db) > 8) return da < db;
        return a.y < b.y;
      });
    }
    const down = key === 'ArrowDown';
    const strict = others.filter((p) => {
      const overlapX = Math.min(cur.x + cur.w, p.x + p.w) - Math.max(cur.x, p.x);
      return down ? (p.y - (cur.y + cur.h) >= -4 && overlapX > 0 && p.y + p.h > cur.y + cur.h + 1)
        : (cur.y - (p.y + p.h) >= -4 && overlapX > 0 && p.y + p.h < cur.y - 1);
    });
    const pool = strict.length ? strict : others.filter((p) => (down ? p.y >= cur.y + cur.h - 8 : p.y + p.h <= cur.y + 8));
    if (!pool.length) return null;
    return pool.reduce((acc, p) => {
      if (!acc) return p;
      if (Math.abs(p.y - acc.y) > 8) return down ? p.y < acc.y : p.y + p.h > acc.y + acc.h;
      return p.x < acc.x;
    }, null);
  }

  _select(id) {
    this.selected = id;
    this.overlay?.querySelectorAll('.er-story.sel').forEach((el) => el.classList.remove('sel'));
    if (id) this.overlay?.querySelector(`.er-story[data-entry-id="${CSS.escape(id)}"]`)?.classList.add('sel');
  }

  _go(index, interactive = false) {
    if (!this.overlay) return;
    if (!this.open) { if (index > 0) this._doOpen(); return; }
    if (this.turn) {
      // 与上游一致：新指令取消进行中的翻页并直接改道
      if (this.turn.phase === 'drag') return;
      this._cancelTurn();
    }
    if (this.mode === 'article') {
      // 正文模式：首页左翻/末页右翻 → 回到本期版面
      if (index < 0 || index >= this.pages.length) return this._closeArticle();
    } else if (index < 0) return this._closeBook();
    else if (index >= this.pages.length) return this._notice(t('已经是最后一页'));
    if (index === this.index) return;
    this._beginTurn(index, index > this.index ? 1 : -1, interactive);
  }

  _notice(text) {
    const el = this.overlay?.querySelector('.er-notice');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(this._noticeT);
    this._noticeT = setTimeout(() => { el.hidden = true; }, 2000);
  }

  // ────────────────────────────────────────────────
  // 页码滑轨（MagazinePageRail + MagazineRailScrub 移植）
  // ────────────────────────────────────────────────
  _bindRail() {
    const rail = this.overlay.querySelector('.er-rail');
    rail.addEventListener('click', (e) => {
      const tick = e.target.closest('.er-tick');
      if (tick) this._go(Number(tick.dataset.index));
    });
    rail.addEventListener('pointerdown', (e) => this._railDown(e));
    rail.addEventListener('pointerenter', () => this._railHover(true));
    rail.addEventListener('pointerleave', () => { if (!this.scrub) this._railHover(false); });
    rail.addEventListener('pointermove', (e) => this._railWave(e));
  }

  _railWidth() {
    const m = this._metrics();
    return Math.min(280, Math.max(14, m.w * 0.45), Math.max(14, this.pages.length * 14));
  }
  _tickIndices() {
    const count = this.pages.length;
    const width = this._railWidth();
    const slots = Math.min(count, Math.max(2, Math.floor(Math.max(0, width) / 7)));
    if (slots <= 1) return [0];
    const cur = clamp(this._railCurrent(), 0, count - 1);
    const indices = Array.from({ length: slots }, (_, s) => Math.round((s * (count - 1)) / (slots - 1)));
    let slot = Math.round((cur * (slots - 1)) / Math.max(1, count - 1));
    if (slots > 2 && cur > 0 && cur < count - 1) slot = clamp(slot, 1, slots - 2);
    indices[slot] = cur;
    return indices;
  }
  _railCurrent() {
    if (this.scrub?.position != null) return clamp(Math.round(this.scrub.position), 0, this.pages.length - 1);
    return this.turn ? this.turn.toIdx : this.index;
  }
  _syncRail() {
    const rail = this.overlay.querySelector('.er-rail');
    if (!rail) return;
    rail.hidden = !(this.open && this.pages.length > 0);
    const ticks = rail.querySelector('.er-ticks');
    const indices = this._tickIndices();
    const cur = this._railCurrent();
    ticks.style.width = `${this._railWidth()}px`;
    // 栏目分段（R8）：头条专题页（feature/imageLead）前加分隔线，对应「本期栏目」边界
    let prevTpl = null;
    ticks.innerHTML = indices.map((pageIndex, slot) => {
      const page = this.pages[pageIndex];
      const isLead = page && (page.template === 'feature' || page.template === 'imageLead');
      const sep = prevTpl && isLead && prevTpl !== page.template ? '<i class="er-tick-sep" title=""></i>' : '';
      if (page) prevTpl = page.template;
      return `${sep}<button class="er-tick${pageIndex === cur ? ' on' : ''}" data-index="${pageIndex}" data-slot="${slot}"
        aria-label="${escapeHTML(t('页面'))} ${pageIndex + 1} / ${this.pages.length}"></button>`;
    }).join('');
    // 阅读进度与剩余时间预估（R4）
    const count = rail.querySelector('.er-count');
    if (this.open && this.pages.length > 1) {
      const progress = (cur + 1) / this.pages.length;
      const remain = this._remainMinutes(progress);
      count.innerHTML = `<span class="er-remain">${remain > 0 ? `${escapeHTML(t('本期约剩'))} ${remain} ${escapeHTML(t('分钟'))}` : escapeHTML(t('本期已读完'))}</span><span class="er-page-no">${cur + 1} / ${this.pages.length}</span>`;
      count.hidden = false;
    } else {
      count.hidden = true;
    }
    this._syncToc(); // 目录面板开着时，翻页同步当前节高亮（R8）
    if (this.focusMode) this._applyFocus(); // 段落聚焦：翻页后对新页重聚焦（R19）
  }
  /** 本期总阅读分钟（readMinutes 优先，无则按标题+摘要字数估算），缓存一次。 */
  _remainMinutes(progress) {
    if (this._totalMinutes == null) {
      let mins = 0, chars = 0;
      for (const it of this.items) {
        mins += Number(it.readMinutes) || 0;
        chars += String(it.title || '').length + String(it.summary || '').length;
      }
      this._totalMinutes = Math.max(1, mins + Math.round(chars / 500));
    }
    return Math.max(0, Math.round(this._totalMinutes * (1 - progress)));
  }
  /** 文章剩余分钟（R4）：entry.readMinutes 优先，否则按正文字数 400 字/分钟估算。 */
  _articleRemainMinutes(index) {
    const total = this.pages.length;
    if (!total || !this.article) return null;
    if (this._articleMinutes == null) {
      const rm = Number(this.article.entry?.readMinutes) || 0;
      const chars = String(this.article.html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
      this._articleMinutes = rm > 0 ? rm : Math.max(1, Math.round(chars / 400));
    }
    return Math.max(0, Math.round(this._articleMinutes * (1 - (index + 1) / total)));
  }
  _railWave(e) {
    if (this.reduceMotion) return;
    const rail = e.currentTarget;
    const rect = rail.querySelector('.er-ticks').getBoundingClientRect();
    const slotW = rect.width / Math.max(1, rail.querySelectorAll('.er-tick').length);
    const pos = e.clientX - rect.left;
    rail.querySelectorAll('.er-tick').forEach((tick, slot) => {
      const center = slot * slotW + slotW / 2;
      const influence = Math.max(0, 1 - Math.abs(pos - center) / (slotW * 3));
      const lift = 16 * influence * influence * (3 - 2 * influence);
      tick.style.setProperty('--wave', String(lift));
    });
  }
  _railHover(on) {
    const rail = this.overlay?.querySelector('.er-rail');
    if (!rail) return;
    const preview = rail.querySelector('.er-preview');
    if (!on) { preview.hidden = true; return; }
    const idx = this._railCurrent();
    const page = this.pages[idx];
    if (!page) return;
    // 文章模式：pages.entries 为空，预览显示该对开页两叶的首节标题
    if (page.template === 'article' && page.article) {
      const firstHeading = (leaf) => {
        for (const b of (leaf || [])) {
          if (/^h[1-6]$/i.test(b.el.tagName || '')) return b.el.textContent.trim();
          const inner = b.el.querySelector?.('h1,h2,h3,h4');
          if (inner) return inner.textContent.trim();
        }
        return null;
      };
      const rows = [];
      const l = firstHeading(page.article.left), r = firstHeading(page.article.right);
      if (l) rows.push(`<div class="er-pv-row"><span class="er-pv-no">L</span><span class="er-pv-title">${escapeHTML(l)}</span></div>`);
      if (page.article.right) {
        if (r) rows.push(`<div class="er-pv-row"><span class="er-pv-no">R</span><span class="er-pv-title">${escapeHTML(r)}</span></div>`);
        else rows.push(`<div class="er-pv-row"><span class="er-pv-no">R</span><span class="er-pv-title">${escapeHTML(t('完'))}</span></div>`);
      }
      preview.innerHTML = rows.join('') || `<div class="er-pv-row"><span class="er-pv-no">·</span><span class="er-pv-title">${escapeHTML(page.title)}</span></div>`;
      preview.hidden = false;
      return;
    }
    preview.innerHTML = page.entries.map((en, i) =>
      `<div class="er-pv-row"><span class="er-pv-no">${i + 1}.</span><span class="er-pv-title">${escapeHTML(en.title)}</span></div>`).join('');
    this._positionPreview(preview, idx);
    preview.hidden = false;
  }

  /** 预览浮层锚定当前刻度 x 位置（clamp 在滑轨范围内，不遮边缘）。 */
  _positionPreview(preview, idx) {
    const rail = this.overlay?.querySelector('.er-rail');
    if (!rail) return;
    const ticks = rail.querySelector('.er-ticks');
    const tick = ticks?.querySelector(`.er-tick[data-index="${idx}"]`);
    if (!tick || !ticks) { preview.style.left = '50%'; return; }
    const railRect = rail.getBoundingClientRect();
    const tickRect = tick.getBoundingClientRect();
    const half = preview.offsetWidth / 2 || 120;
    const x = clamp(tickRect.left + tickRect.width / 2 - railRect.left, half + 4, railRect.width - half - 4);
    preview.style.left = `${x}px`;
    preview.style.transform = 'translateX(-50%)';
  }
  _railDown(e) {
    if (!this.open || this.pages.length < 2) return;
    const rail = e.currentTarget;
    const ticks = rail.querySelector('.er-ticks');
    const rect = ticks.getBoundingClientRect();
    this.scrub = { position: this.index };
    rail.classList.add('scrubbing');
    rail.querySelector('.er-count').hidden = false;
    if (this.turn) { /* 允许接管正在收尾的翻页 */ this._cancelTurn(); }
    const pos = (ev) => clamp((ev.clientX - rect.left) / Math.max(1, rect.width), 0, 1) * (this.pages.length - 1);
    const move = (ev) => {
      if (!this.scrub) return;
      this._railScrubTo(pos(ev));
      this._railHover(true);
      const count = rail.querySelector('.er-count');
      count.textContent = `${Math.round(this._railCurrent()) + 1} / ${this.pages.length}`;
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      this.scrub = null;
      rail.classList.remove('scrubbing');
      this._syncRail(); // 恢复常显的剩余时间/页码（R4），并按落点重算刻度
      this._railHover(false);
      // 吸附最近页（settleDuration 0.18）
      const final = clamp(Math.round(pos(ev)), 0, this.pages.length - 1);
      if (this.turn) {
        const commit = this.turn.toIdx === final;
        const p = this.turn.progress ?? 0;
        this._startSettle(p, commit ? 1 : 0, null, this.reduceMotion ? 0.12 : 0.18);
      } else if (final !== this.index) this._go(final);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    move(e);
  }
  _railScrubTo(position) {
    if (!this.scrub) return;
    const previous = this.scrub.position ?? position;
    this.scrub.position = position;
    // 同一页对内反写进度；跨边界建新请求
    if (this.turn) {
      const sourceIdx = this.turn.dir > 0 ? this.turn.toIdx - 1 : this.turn.toIdx + 1;
      if (this.pages[sourceIdx]) {
        const low = Math.min(sourceIdx, this.turn.toIdx), high = Math.max(sourceIdx, this.turn.toIdx);
        if (position >= low && position <= high) {
          const p = this.turn.dir > 0 ? position - sourceIdx : sourceIdx - position;
          this._applyProgress(clamp(p, 0, 1));
          this._syncRail();
          return;
        }
      }
    }
    const forward = position >= previous;
    const source = forward ? clamp(Math.floor(position), 0, this.pages.length - 2) : clamp(Math.ceil(position), 1, this.pages.length - 1);
    const target = forward ? source + 1 : source - 1;
    const progress = forward ? position - source : source - position;
    if (this.turn && this.turn.toIdx === target && this.turn.dir === (forward ? 1 : -1)) {
      this._applyProgress(clamp(progress, 0, 1));
    } else {
      this._cancelTurn();
      this._beginTurn(target, forward ? 1 : -1, true);
      this._applyProgress(clamp(progress, 0, 1));
    }
    this._syncRail();
  }
  _cancelTurn() {
    if (!this.turn) return;
    this._selCleared = false;
    const book = this.overlay.querySelector('.er-book');
    const leaf = this.overlay.querySelector('.er-leaf');
    const sheetA = this.overlay.querySelector('.er-sheet[data-role="a"]');
    const sheetB = this.overlay.querySelector('.er-sheet[data-role="b"]');
    sheetB.style.opacity = '';
    sheetB.classList.remove('er-fadein');
    book.classList.remove('er-turning', 'er-turning-fwd', 'er-turning-bwd');
    sheetA.classList.remove('clip-left', 'clip-right');
    leaf.hidden = true;
    this.turn = null;
    // 帧驱动双清（rAF 与 timer 句柄共用 this._raf，rAF id 非法时 clearTimeout 无害）
    clearTimeout(this._raf);
    cancelAnimationFrame(this._raf);
  }
}
