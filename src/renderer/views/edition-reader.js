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

const pageWidth = (w) => Math.min(1480, Math.max(1, w - (w < 620 ? 32 : 48)));
const hInset = (w) => Math.min(w < 620 ? 20 : 36, (pageWidth(w) - 1) / 2);
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
   * items 条目字段：id/title/summaryPreview/sourceTitle/contentHead/publishedAt/isRead/isStarred
   */
  constructor({ items = [], startIndex = 0, onOpen = null, reduceMotion = false, fetchArticle = null } = {}) {
    this.items = (items || []).filter((it) => it && it.id).map((it) => ({
      id: it.id,
      title: it.title || t('未命名文章'),
      summary: it.summaryPreview || '',
      image: this._firstImage(it.contentHead),
      source: it.sourceTitle || '',
      date: it.publishedAt || 0,
      isRead: !!it.isRead,
      isStarred: !!it.isStarred,
      raw: it,
    }));
    this.startIndex = Math.max(0, startIndex);
    this.onOpen = onOpen;
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
    this._sound = null;
    this._resizeTimer = 0;
    this._autoTimer = 0;
  }

  _firstImage(html) {
    if (!html) return '';
    const m = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
    return m && /^https?:|data:/.test(m[1]) ? m[1] : '';
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
    const hi = hInset(w);
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
      Math.round(st.imageH), st.beside ? 1 : 0, Math.round(st.sideW || 0), Math.round(width)].join('/');
  }
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
      el.style.cssText = `width:${Math.max(1, width)}px;font-size:${st.titleSize * CONTENT_SCALE}px;line-height:${(st.titleSize + 2 * CONTENT_SCALE) / st.titleSize};`;
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
    this.pages = [];
    if (!entries.length) return;
    const useH = Math.max(120, pageH);

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
            const y = path.ps.length ? path.height + 24 : 0;
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
          const y = result.ps.length ? result.height + 24 : 0;
          if (y + h <= limit) {
            return { ps: [...result.ps, place(entry, 0, y, width, h, st)], height: y + h, void: result.void };
          }
        }
        if (st.beside && st.imageH > 80) {
          st = { ...st, imageH: 80 };
          const h = measure(entry, st, width);
          const y = result.ps.length ? result.height + 24 : 0;
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
        y += h + 24;
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
            y += h + 24;
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
            y += h + 24;
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
          const y = path.ps.length ? path.height + 24 : 0;
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
    overlay.dataset.paper = localStorage.getItem('robinread.magPaper') || 'paper';
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
      <button class="er-close" title="${escapeHTML(t('退出 (Esc)'))}">✕</button>
      <button class="er-paper" title="${escapeHTML(t('切换纸张质感'))}"></button>
      <div class="er-notice" hidden></div>`;
    document.body.appendChild(overlay);
    this.overlay = overlay;
    overlay.__editionReader = this;
    // 纸张质感三态（与列表刊头共用 robinread.magPaper 偏好）
    const paperBtn = overlay.querySelector('.er-paper');
    const paperLabel = () => ({ paper: t('纸感'), white: t('素白'), book: t('书卷') })[overlay.dataset.paper] || t('纸感');
    paperBtn.textContent = paperLabel();
    paperBtn.addEventListener('click', () => {
      const order = ['paper', 'white', 'book'];
      const next = order[(order.indexOf(overlay.dataset.paper) + 1) % order.length];
      overlay.dataset.paper = next;
      localStorage.setItem('robinread.magPaper', next);
      paperBtn.textContent = paperLabel();
    });
    this.measureHost = document.createElement('div');
    this.measureHost.className = 'er-measure';
    overlay.appendChild(this.measureHost);
    this._sound = new Audio(this.soundSrc);
    this._sound.volume = 0.72;
    this._bind();
    this._relayout(true);
    if (this.reduceMotion) this._doOpen();
    else {
      this._autoTimer = setTimeout(() => this._doOpen(), 700);
    }
  }

  dismiss() {
    clearTimeout(this._autoTimer);
    clearTimeout(this._resizeTimer);
    clearTimeout(this._raf); cancelAnimationFrame(this._raf);
    document.removeEventListener('keydown', this._key, true);
    window.removeEventListener('resize', this._onResize);
    this.overlay?.remove();
    this.overlay = null;
  }

  _doOpen() {
    if (!this.overlay || this.open || this.turn) return;
    if (!this.pages.length) return;
    this.open = true;
    this._play();
    const cover = this.overlay.querySelector('.er-cover');
    const dur = this.reduceMotion ? 0.16 : 0.65;
    cover.hidden = false;
    cover.style.transitionDuration = `${dur}s`;
    cover.classList.add('er-cover-animating', 'er-cover-open');
    setTimeout(() => {
      cover.hidden = true;
      cover.classList.remove('er-cover-animating', 'er-cover-open');
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
    overlay.querySelector('.er-stage').addEventListener('wheel', (e) => this._wheel(e), { passive: true });
    this._bindRail();
    this._key = (e) => this._keydown(e);
    document.addEventListener('keydown', this._key, true);
    this._onResize = () => {
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => this._relayout(false), 160);
    };
    window.addEventListener('resize', this._onResize);
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

  /** 预取图片宽高比（同时 warm 缓存）：单图 1.5s 超时兜底按 0.66 比例。 */
  async _preloadImageRatios(nodes) {
    const srcs = new Set();
    for (const n of nodes) {
      if (n.tagName?.toLowerCase() === 'img') {
        const s = n.getAttribute('src');
        if (s && (/^https?:/.test(s) || /^data:image\//.test(s))) srcs.add(s);
      }
    }
    const map = new Map();
    await Promise.all([...srcs].slice(0, 16).map((src) => new Promise((resolve) => {
      const im = new Image();
      let done = false;
      const finish = () => { if (!done) { done = true; if (im.naturalWidth > 0 && im.naturalHeight > 0) map.set(src, im.naturalHeight / im.naturalWidth); resolve(); } };
      im.onload = finish;
      im.onerror = () => { done = true; resolve(); };
      setTimeout(finish, 1500);
      im.referrerPolicy = 'no-referrer';
      im.src = src;
    })));
    return map;
  }

  /** 正文 → 块序列 → 贪心装箱成半叶 → 两叶一对开。单块超高文本按句切分兜底。 */
  async _paginateArticle(entry, html) {
    const m = this._metrics();
    const leafH = Math.max(160, m.bookH - HEADING_H);
    const colW = Math.min(600, m.leafW);
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
    host.appendChild(body);
    const blocks = [];
    // 测量必须与渲染同环境：块要放进 .er-article 容器才有 15.5px/1.92 行距等排版样式；
    // 占位首块避免「first-child margin-top 清零」造成测量偏小
    const wrap = document.createElement('div');
    wrap.className = 'er-article';
    wrap.style.cssText = `width:${colW}px;`;
    wrap.innerHTML = '<i style="display:block;height:0"></i>';
    host.appendChild(wrap);
    const measure = (el) => {
      wrap.appendChild(el);
      const h = Math.ceil(el.getBoundingClientRect().height);
      el.remove();
      return h;
    };
    // 首叶头部：眉题 + 大标题 + 分隔线
    const headEl = document.createElement('div');
    headEl.className = 'er-article-head';
    headEl.innerHTML = `<div class="er-article-kicker">${escapeHTML(entry.source)} · ${escapeHTML(this._fmtDate(entry.date))}</div>
      <h1 class="er-article-title">${escapeHTML(entry.title)}</h1><div class="er-article-rule"></div>`;
    blocks.push({ el: headEl, h: measure(headEl), breakable: false });
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
      // 块级元素整体装箱；超高块拆子元素或按句切
      const clone = node.cloneNode(true);
      clone.removeAttribute('style');
      const h = measure(clone.cloneNode(true));
      if (h <= leafH * 0.96) { blocks.push({ el: clone, h, breakable: tag === 'p' }); continue; }
      if (tag === 'p' || tag === 'li' || tag === 'blockquote') {
        const sentences = this._splitSentences(clone.textContent || '');
        if (sentences.length > 1) {
          const per = Math.ceil(sentences.length / Math.ceil(h / (leafH * 0.9)));
          for (let i = 0; i < sentences.length; i += per) {
            const part = document.createElement('p');
            part.textContent = sentences.slice(i, i + per).join('');
            blocks.push({ el: part, h: measure(part.cloneNode(true)), breakable: true });
          }
          continue;
        }
      }
      for (const child of [...clone.children]) {
        const ch = measure(child.cloneNode(true));
        blocks.push({ el: child.cloneNode(true), h: Math.min(ch, leafH), breakable: false });
      }
    }
    host.remove();
    // 贪心装箱（半叶）；标题块 keep-with-next：叶底放不下「标题+后块」时整组下移，杜绝孤行节标题
    const isHeadingBlk = (blk) => /^h[1-6]$/i.test(blk?.el?.tagName || '');
    const leaves = [];
    let cur = [], used = 0;
    for (let bi = 0; bi < blocks.length; bi++) {
      const blk = blocks[bi];
      const need = used + blk.h + (isHeadingBlk(blk) && blocks[bi + 1] ? 8 + blocks[bi + 1].h : 0);
      if (used > 0 && need > leafH) { leaves.push(cur); cur = []; used = 0; }
      cur.push(blk);
      used += blk.h + 8;
    }
    if (cur.length) leaves.push(cur);
    // 两叶一对开；末尾单叶补「完」页
    const spreads = [];
    for (let i = 0; i < leaves.length; i += 2) {
      spreads.push({ left: leaves[i], right: leaves[i + 1] || null, isEnd: i + 1 >= leaves.length });
    }
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
  }

  _splitSentences(text) {
    const t0 = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t0) return [];
    const parts = t0.split(/(?<=[。！？；!?;.])\s*/).filter(Boolean);
    return parts.length > 1 ? parts : [t0];
  }

  _pageArticleInner(page, index) {
    const m = this._metrics();
    const leafW = m.leafW;
    const colW = Math.min(600, leafW);
    const el = document.createElement('div');
    el.className = 'er-in';
    el.style.width = `${m.paperW}px`;
    const head = document.createElement('div');
    head.className = 'er-head';
    head.innerHTML = `<button class="er-head-back" title="${escapeHTML(t('返回本期 (Esc)'))}">‹ ${escapeHTML(t('本期'))}</button>
      <span class="er-head-title">${escapeHTML(page.title)}</span><span class="er-head-no">${String(index + 1).padStart(2, '0')} / ${String(this.pages.length).padStart(2, '0')}</span>`;
    head.querySelector('.er-head-back').addEventListener('click', (ev) => { ev.stopPropagation(); this._closeArticle(); });
    el.appendChild(head);
    const canvas = document.createElement('div');
    canvas.className = 'er-canvas';
    canvas.style.height = `${page.height}px`;
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
    header.innerHTML = `<span class="er-head-title">${escapeHTML(page.title)}</span><span class="er-head-no">${String(index + 1).padStart(2, '0')}</span>`;
    el.appendChild(header);
    const canvas = document.createElement('div');
    canvas.className = 'er-canvas';
    canvas.style.height = `${lay.height}px`;
    const byId = new Map(page.entries.map((e) => [e.id, e]));
    const onlyLeft = lay.placements.length && lay.placements.every((p) => p.x + p.w <= leafW + 1);
    for (const pl of lay.placements) {
      const entry = byId.get(pl.entryID);
      if (!entry) continue;
      const holder = document.createElement('div');
      holder.className = 'er-place';
      holder.style.cssText = `left:${pl.x}px;top:${pl.y}px;width:${pl.w}px;height:${pl.h}px;`;
      if (pl.y > 0) holder.dataset.hl = '1';
      holder.appendChild(this._buildStory(entry, pl.st, pl.w));
      holder.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this._select(entry.id);
        this._openArticle(entry);
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
    const imgSpacing = 16 * sc;
    if (st.imageH > 0 && entry.image) {
      const imgBox = document.createElement('div');
      imgBox.className = 'er-img';
      const iw = this._imgW(st, width);
      imgBox.style.cssText = st.stacks
        ? `width:100%;height:${st.imageH}px;margin-bottom:${imgSpacing}px;`
        : `width:${iw}px;height:${st.imageH}px;flex:0 0 auto;margin-right:${imgSpacing}px;`;
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.alt = '';
      img.addEventListener('load', () => img.classList.add('ok'), { once: true });
      img.addEventListener('error', () => imgBox.classList.add('bad'), { once: true });
      if (!skeleton) img.src = entry.image; // 测量态不触发网络请求（图高为固定档位）
      imgBox.appendChild(img);
      story.appendChild(imgBox);
    }
    const textSpacing = (st.role === 'lead' ? 10 : 6) * sc;
    const metaSpacing = (st.role === 'lead' ? 14 : 10) * sc;
    const tx = document.createElement('div');
    tx.className = 'er-tx';
    if (!st.stacks && st.imageH > 0) tx.style.minHeight = `${st.imageH}px`;
    const top = document.createElement('div');
    top.className = 'er-tx-top';
    top.style.cssText = `display:flex;flex-direction:column;gap:${textSpacing}px;padding-bottom:${metaSpacing}px;`;
    const title = document.createElement('h3');
    title.className = 'er-title';
    title.style.cssText = `font-size:${st.titleSize * sc}px;line-height:${(st.titleSize + 2 * sc) / (st.titleSize * sc)};`;
    if (st.titleLines < 10000) { title.style.display = '-webkit-box'; title.style.webkitBoxOrient = 'vertical'; title.style.webkitLineClamp = st.titleLines; title.style.overflow = 'hidden'; }
    title.textContent = entry.title;
    top.appendChild(title);
    if (entry.summary && st.summaryLines > 0) {
      const sum = document.createElement('p');
      sum.className = 'er-sum';
      sum.style.cssText = `font-size:${st.summarySize * sc}px;line-height:${(st.summarySize + 4 * sc) / (st.summarySize * sc)};`;
      if (st.summaryLines < 10000) { sum.style.display = '-webkit-box'; sum.style.webkitBoxOrient = 'vertical'; sum.style.webkitLineClamp = st.summaryLines; sum.style.overflow = 'hidden'; }
      sum.textContent = entry.summary;
      top.appendChild(sum);
    }
    tx.appendChild(top);
    const meta = document.createElement('div');
    meta.className = 'er-meta';
    meta.style.fontSize = `${13 * sc}px`;
    const dot = !entry.isRead ? '<i class="er-dot"></i>' : '';
    const star = entry.isStarred ? `<span class="er-star">${icon('starFilled')}</span>` : '';
    meta.innerHTML = `${dot}<span class="er-src">${escapeHTML(entry.source)}</span>${star}<span class="er-sp"></span><span class="er-date">${escapeHTML(this._fmtDate(entry.date))}</span>`;
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
    cover.querySelector('.er-cover-front').innerHTML = `
      <div class="er-face-shade"></div>
      <div class="er-cover-face">
        <div class="er-stack s3"></div><div class="er-stack s2"></div><div class="er-stack s1"></div>
        <div class="er-brand">知更</div>
        <div class="er-cover-title">${escapeHTML(this.title)}</div>
      </div>`;
    if (first) {
      right.appendChild(this._pageInner(first, 0));
      back.appendChild(this._pageInner(first, 0));
    }
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
    const fade = !this._metrics().spread || fromPage.form !== 'spread' || toPage.form !== 'spread' || this.reduceMotion;
    const book = this.overlay.querySelector('.er-book');
    const leaf = this.overlay.querySelector('.er-leaf');
    const sheetB = this.overlay.querySelector('.er-sheet[data-role="b"]');
    const turn = {
      dir, toIdx, preset, fade,
      progress: interactive ? 0 : null,
      phase: interactive ? 'drag' : 'settle',
      animStart: 0, animDur: 0, animFrom: 0, animTo: dir > 0 ? 1 : 0, slope: null,
      velocity: 0,
    };
    this.turn = turn;
    // 目标页装载到 b（正翻=预取页通常已在；反翻=现载）
    this._prepareSheetB(toIdx);
    if (fade) {
      leaf.hidden = true;
      sheetB.classList.add('er-fadein');
      if (!interactive) this._startSettle(0, dir > 0 ? 1 : 0, null, this.reduceMotion ? 0.12 : 0.2);
    } else {
      this._mountLeaf(turn);
      if (!interactive) this._startSettle(0, dir > 0 ? 1 : 0, null, null);
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
    const book = this.overlay.querySelector('.er-book');
    const leaf = this.overlay.querySelector('.er-leaf');
    const cast = this.overlay.querySelector('.er-cast');
    const pulse = Math.sin(Math.PI * turn.progress);
    if (turn.fade) {
      const b = this.overlay.querySelector('.er-sheet[data-role="b"]');
      b.style.opacity = String(turn.progress);
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
    leaf.querySelector('.er-face-front .er-face-shade').style.opacity = String(0.4 * glow);
    leaf.querySelector('.er-face-back .er-face-shade').style.opacity = String(0.3 * glow);
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
    // 16ms timer 驱动（对标上游 clockTask 的 Task.sleep(16ms) 兜底钟）：
    // rAF 在 Electron 隐藏窗口会被冻结，timer 稳定；真实窗口下 transform 走合成器，顺滑度无损
    const tick = () => {
      const tn = this.turn;
      if (!tn || tn !== turn || tn.phase !== 'settle') return;
      const time = clamp((performance.now() - turn.animStart) / (turn.animDur * 1000), 0, 1);
      const eased = turn.slope != null ? settledEase(time, turn.slope) : bezierEase(time);
      this._applyProgress(turn.animFrom + (turn.animTo - turn.animFrom) * eased);
      if (time >= 1) this._finishTurn(turn.animTo >= 0.999);
      else this._raf = setTimeout(tick, 16);
    };
    this._raf = setTimeout(tick, 16);
  }

  _finishTurn(committed) {
    const turn = this.turn;
    if (!turn) return;
    this.turn = null;
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
      this.index = turn.toIdx;
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
    if (!this._sound) return;
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
    if (!this.open || this.turn) return;
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

  // ────────────────────────────────────────────────
  // 键盘遥控导航（MagazineSpatialNavigation 语义移植）
  // ────────────────────────────────────────────────
  _keydown(e) {
    if (!this.overlay) return;
    if (e.key === 'Escape') {
      if (this.mode === 'article') { e.preventDefault(); return this._closeArticle(); }
      return this.dismiss();
    }
    if (!this.open) {
      if (['ArrowRight', 'Enter', ' ', 'PageDown'].includes(e.key)) { e.preventDefault(); this._doOpen(); }
      return;
    }
    if (this.mode === 'article') {
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
    ticks.innerHTML = indices.map((pageIndex, slot) => `
      <button class="er-tick${pageIndex === cur ? ' on' : ''}" data-index="${pageIndex}" data-slot="${slot}"
        title="${escapeHTML(t('页面'))} ${pageIndex + 1} / ${this.pages.length}"></button>`).join('');
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
    const page = this.pages[this._railCurrent()];
    if (!page) return;
    preview.innerHTML = page.entries.map((en, i) =>
      `<div class="er-pv-row"><span class="er-pv-no">${i + 1}.</span><span class="er-pv-title">${escapeHTML(en.title)}</span></div>`).join('');
    preview.hidden = false;
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
      rail.querySelector('.er-count').hidden = true;
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
  }
}
