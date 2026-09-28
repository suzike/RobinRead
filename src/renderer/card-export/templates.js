/* ==========================================================================
   知更 RobinRead — 精读/摘要卡片导出模板引擎
   纯函数模块（无 DOM 依赖）：同一份代码服务 主窗口预览 / 导出窗口 / 探针样张。
   renderCard(data, options) → { html, css, width, bg }
   ========================================================================== */

export const CARD_WIDTH = 750;

/** 配色变体（滤镜实现：中性色不受影响，一键换色系）。 */
export const CARD_VARIANTS = [
  { id: 'original', label: '原色', filter: 'none' },
  { id: 'forest', label: '森绿', filter: 'hue-rotate(48deg) saturate(1.05)' },
  { id: 'violet', label: '暮紫', filter: 'hue-rotate(190deg) saturate(1.02)' },
  { id: 'ocean', label: '海蓝', filter: 'hue-rotate(120deg)' },
];
export const COVER_FILTERS = [
  { id: 'original', label: '原图', filter: 'none' },
  { id: 'mono', label: '黑白', filter: 'grayscale(1) contrast(1.05)' },
  { id: 'warm', label: '暖调', filter: 'sepia(0.35) saturate(1.15)' },
  { id: 'cool', label: '冷调', filter: 'saturate(0.9) hue-rotate(18deg) brightness(1.02)' },
];
export function coverFilter(id) {
  return (COVER_FILTERS.find((v) => v.id === id) || COVER_FILTERS[0]).filter;
}
export const DENSITY = [
  { id: 'compact', label: '紧凑', zoom: 0.94 },
  { id: 'standard', label: '标准', zoom: 1 },
  { id: 'loose', label: '舒朗', zoom: 1.06 },
];
export const FONT_PAIRS = [
  { id: 'default', label: '默认衬线', css: '' },
  { id: 'modern', label: '现代黑体', css: '.xc-card .xc-title,.xc-card .xc-hero-title,.xc-card .xc-sec-h{font-family:"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;letter-spacing:0}' },
  { id: 'mix', label: '宋黑混排', css: '.xc-card .xc-title,.xc-card .xc-hero-title{font-family:"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}.xc-card{font-family:Georgia,"Source Han Serif SC","Noto Serif SC",serif}' },
];
export function fontPairCss(id) {
  return (FONT_PAIRS.find((v) => v.id === id) || FONT_PAIRS[0]).css;
}
export function densityZoom(id) {
  return (DENSITY.find((v) => v.id === id) || DENSITY[1]).zoom;
}
export function variantFilter(id) {
  return (CARD_VARIANTS.find((v) => v.id === id) || CARD_VARIANTS[0]).filter;
}

export const CARD_TEMPLATES = [
  { id: 'paper', name: '知更书页', hint: '纸感衬线 · 品牌默认 · 经典单栏' },
  { id: 'ink', name: '墨岩', hint: '暗色海报 · 居中构图 · 数据卡' },
  { id: 'mag', name: '杂志编辑', hint: '黑白红 · 跨栏 · 特大标题' },
  { id: 'note', name: '晨读手帖', hint: '楷体拼贴 · 胶带印章 · 手账' },
  { id: 'min', name: '极简白', hint: '大留白 · 左侧导轨 · 克制' },
  { id: 'news', name: '晚报', hint: '报纸双栏 · 刊头 · 半调封面' },
  { id: 'aurora', name: '霞光', hint: '极光暗夜 · 玻璃质感 · 渐变描边' },
  { id: 'mesh', name: '晨雾', hint: '渐变晨雾 · 马卡龙色块 · 轻盈' },
  { id: 'blue', name: '蓝图', hint: '工程蓝晒 · 网格坐标 · 制图美学' },
  { id: 'jade', name: '青瓷', hint: '青瓷釉色 · 印章朱砂 · 东方留白' },
];

export const KIND_BADGES = { deepRead: '精读笔记', richSummary: '高质量摘要', summary: 'AI 摘要' };

/* ---------------------------------------------------------------- utils */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
  feather: '<path d="M12.67 19a2 2 0 0 0 1.42-.59l6.15-6.17a6 6 0 0 0-8.49-8.49L5.59 9.91A2 2 0 0 0 5 11.33V18a1 1 0 0 0 1 1z"/><path d="M16 8 2 22"/><path d="M17.5 15H9"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  scale: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  quote: '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>',
  check: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/>',
  spark: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  doc: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
};
const icon = (name, size = 14, sw = 1.8) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;

const titleChars = (s, n) => String(s || '知更').replace(/\s+/g, '').slice(0, n);

/* ------------------------------------------------------ shared builders */

const badgeRow = (d) => `
  <div class="xc-badgerow">
    <span class="xc-badge">${icon('feather', 12, 2)}${esc(KIND_BADGES[d.kind] || '阅读笔记')}</span>
    <span class="xc-feed">${esc(d.feedTitle || '')}</span>
    <span class="xc-dot">·</span>
    <span class="xc-date">${esc(d.date || '')}</span>
  </div>`;

const metaStrip = (d) => {
  const bits = [];
  if (d.feedTitle) bits.push(`来源 ${esc(d.feedTitle)}`);
  if (d.date) bits.push(esc(d.date));
  if (d.meta?.minutes) bits.push(`${icon('clock', 12)} 约 ${d.meta.minutes} 分钟`);
  if (d.meta?.words) bits.push(`${d.meta.words} 字`);
  return `<div class="xc-meta">${bits.join('<span class="xc-meta-sep">·</span>')}</div>`;
};

const coverBlock = (d, o, ghost = 4) => {
  if (o.cover === false) return '';
  if (d.cover) return `<figure class="xc-cover"><img src="${d.cover}" alt=""/></figure>`;
  return `<div class="xc-cover xc-cover-gen">
    <span class="xc-gen-ic">${icon('feather', 60, 1.3)}</span>
    <span class="xc-ghost">${esc(titleChars(d.title, ghost))}</span>
  </div>`;
};

/** 杂志级 hero 封面。plain=true 时仅全出血图片带（供自带刊头/标题的 mag/news 使用，避免标题重复）。 */
const heroBlock = (d, o, theme = 'paper', plain = false) => {
  if (o.cover === false || !d.cover) return null;
  if (plain) return `<header class="xc-hero xc-hero-plain xc-hero-${theme}"><img class="xc-hero-img" src="${d.cover}" alt=""/></header>`;
  const bits = [esc(d.date || '')];
  if (d.meta?.minutes) bits.push(`约 ${d.meta.minutes} 分钟`);
  if (d.meta?.words) bits.push(`${d.meta.words} 字`);
  return `
    <header class="xc-hero xc-hero-${theme}">
      <img class="xc-hero-img" src="${d.cover}" alt=""/>
      <div class="xc-hero-scrim"></div>
      <div class="xc-hero-text">
        <div class="xc-hero-kicker">
          <span class="xc-hero-badge">${icon('feather', 12, 2)}${esc(KIND_BADGES[d.kind] || '阅读笔记')}</span>
          <span class="xc-hero-feed">${esc(d.feedTitle || '')}</span>
        </div>
        <h1 class="xc-hero-title">${esc(d.title)}</h1>
        <div class="xc-hero-meta">${bits.join('<span class="xc-hero-dot">·</span>')}</div>
      </div>
    </header>`;
};

/** hero 存在时替代「badge+标题+元信息+普通封面」的组合；否则返回 null 用原构图。 */
const heroOrHead = (d, o, theme, ghost) =>
  heroBlock(d, o, theme) || `${badgeRow(d)}<h1 class="xc-title">${esc(d.title)}</h1>${metaStrip(d)}${coverBlock(d, o, ghost)}`;

const leadBlock = (d) => {
  if (!d.lead) return '';
  // 导语以引号/标点开头时跳过首字下沉（下沉一个引号非常难看）
  const noCap = /^[「『"'“‘。，、；：？！…—]/.test(d.lead.trim()[0] || '');
  return `<p class="xc-lead${noCap ? ' xc-lead-plain' : ''}">${esc(d.lead)}</p>`;
};

const secHead = (ic, label) => `<div class="xc-sec-h"><span class="xc-sec-ic">${icon(ic, 14)}</span><span class="xc-sec-t">${esc(label)}</span></div>`;

const stepsBlock = (d) => {
  const items = (d.steps || []).map((s, i) => `
    <li class="xc-step">
      <span class="xc-step-n">${String(i + 1).padStart(2, '0')}</span>
      <div class="xc-step-b"><div class="xc-step-t">${esc(s.t || '')}</div>${s.d ? `<div class="xc-step-d">${esc(s.d)}</div>` : ''}</div>
    </li>`).join('');
  return items ? `<section class="xc-sec xc-sec-steps">${secHead('route', '论证脉络')}<ol class="xc-steps">${items}</ol></section>` : '';
};

const pointsBlock = (d) => {
  const items = (d.points || []).map((p, i) => `
    <li class="xc-point">
      <span class="xc-point-n">${String(i + 1).padStart(2, '0')}</span>
      <div class="xc-point-b"><div class="xc-point-t">${esc(p.t || '')}</div>${p.d ? `<div class="xc-point-d">${esc(p.d)}</div>` : ''}</div>
    </li>`).join('');
  return items ? `<section class="xc-sec xc-sec-points">${secHead('list', '核心要点')}<ul class="xc-points">${items}</ul></section>` : '';
};

const statsBlock = (d, o) => {
  if (o.stats === false) return '';
  const items = (d.stats || []).map((s) => {
    const m = String(s.v).match(/^([^\d.]*)([\d.,]+)(.*)$/) || [null, '', s.v, ''];
    const hasRangeDigit = m[2] && /[0-9]/.test(m[3]);
    const val = m[2] && !hasRangeDigit ? `<span class="xc-stat-n">${esc(m[2])}</span><small class="xc-stat-u">${esc(m[1] + m[3])}</small>` : esc(s.v);
    return `
    <div class="xc-stat"><div class="xc-stat-v">${val}</div><div class="xc-stat-l">${esc(s.l)}</div></div>`;
  }).join('');
  return items ? `<section class="xc-sec xc-sec-stats">${secHead('chart', '关键数据')}<div class="xc-stats">${items}</div></section>` : '';
};

const chipsBlock = (d) => {
  const items = (d.concepts || []).map((c) => `<span class="xc-chip">${esc(typeof c === 'string' ? c : c.t)}</span>`).join('');
  return items ? `<section class="xc-sec xc-sec-chips">${secHead('tag', '关键概念')}<div class="xc-chips">${items}</div></section>` : '';
};

const counterBlock = (d) => (d.counter
  ? `<section class="xc-sec xc-sec-counter">${secHead('scale', '另一面')}<p class="xc-counter">${esc(d.counter)}</p></section>` : '');

const quotesBlock = (d) => {
  const items = (d.quotes || []).map((q) => `<blockquote class="xc-quote"><span class="xc-qmark">“</span><p>${esc(q)}</p></blockquote>`).join('');
  return items ? `<section class="xc-sec xc-sec-quotes">${items}</section>` : '';
};

const actionsBlock = (d) => {
  const items = (d.actions || []).map((a) => `<li class="xc-action"><span class="xc-action-box">${icon('check', 12, 2.2)}</span><span>${esc(a)}</span></li>`).join('');
  return items ? `<section class="xc-sec xc-sec-actions">${secHead('check', '读后行动')}<ul class="xc-actions">${items}</ul></section>` : '';
};

const conclusionBlock = (d) => (d.conclusion
  ? `<section class="xc-sec xc-sec-conclusion">${secHead('spark', '结论与启示')}<p class="xc-conclusion">${esc(d.conclusion)}</p></section>` : '');

const footBlock = (d, o) => {
  const qr = o.qr ? `<div class="xc-qr-box"><div class="xc-qr">${o.qr}</div><span class="xc-qr-cap">扫码读原文</span></div>` : '';
  const wmMinimal = o.watermarkStyle === 'minimal';
  const brandRight = o.watermark === false
    ? `<div class="xc-foot-r"><div class="xc-brand-sub">${esc(d.date || '')}</div></div>`
    : `<div class="xc-foot-r">
      <div class="xc-brand">${wmMinimal ? '' : icon('feather', 15, 2)}<span class="xc-brand-name">${wmMinimal ? '知更' : '知更 RobinRead'}</span></div>
      <div class="xc-brand-sub">${esc(KIND_BADGES[d.kind] || '阅读笔记')} · DEEP READING · ${esc(d.date || '')}</div>
    </div>`;
  return `<footer class="xc-foot">
    <div class="xc-foot-l">${qr}</div>
    ${brandRight}
  </footer>`;
};

const proseBlock = (d) => {
  const items = (d.prose || []).map((p) => `<p class="xc-prose-p">${esc(p)}</p>`).join('');
  return items ? `<section class="xc-sec xc-sec-prose">${items}</section>` : '';
};

/* ------------------------------------------------------------ 基础样式 */

const BASE_CSS = `
.xc-card { width:${CARD_WIDTH}px; box-sizing:border-box; position:relative; overflow:hidden; -webkit-font-smoothing:antialiased; }
.xc-card, .xc-card * { box-sizing:border-box; margin:0; padding:0; }
.xc-card img { display:block; max-width:100%; }
.xc-card svg { vertical-align:-0.16em; }
.xc-hide { display:none !important; }
.xc-badgerow, .xc-meta, .xc-sec, .xc-foot { position:relative; }
.xc-sec-h { display:flex; align-items:center; gap:8px; }
.xc-steps, .xc-points, .xc-actions { list-style:none; }
.xc-qmark { font-family: Georgia, "Times New Roman", serif; line-height: 1; }
.xc-lead, .xc-step-d, .xc-point-d, .xc-counter, .xc-conclusion, .xc-quote p, .xc-prose-p { text-wrap: pretty; }
.xc-lead-plain::first-letter { float:none !important; font-size:inherit !important; line-height:inherit !important;
  padding:0 !important; color:inherit !important; font-weight:inherit !important; }
.xc-stats { justify-content:center; }
.xc-stat { flex:1 1 0; max-width:250px; }
/* hero 封面结构（配色由各模板 xc-hero-<theme> 定义） */
.xc-hero { position:relative; overflow:hidden; }
.xc-hero-img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
.xc-hero-scrim { position:absolute; inset:0; }
.xc-hero-text { position:absolute; left:0; right:0; bottom:0; padding:24px 34px 22px; display:flex; flex-direction:column; gap:10px; }
.xc-hero-kicker { display:flex; align-items:center; gap:10px; }
.xc-hero-badge { display:inline-flex; align-items:center; gap:5px; padding:4px 11px; border-radius:999px; font-size:12px; letter-spacing:2px; }
.xc-hero-feed { font-size:12.5px; letter-spacing:2px; }
.xc-hero-title { font-size:30px; line-height:1.34; font-weight:700; text-wrap:balance; }
.xc-hero-meta { font-size:12.5px; letter-spacing:1px; display:flex; align-items:center; gap:7px; }
.xc-hero-dot { opacity:.6; }
`;

/* ================================================================ T1 知更书页 */
const PAPER = {
  id: 'paper',
  bg: '#f7f3e8',
  css: `
.xc-t-paper {
  font-family: "Source Han Serif SC","Noto Serif SC","Songti SC","STSong",SimSun,Georgia,serif;
  color:#2c2921; background:linear-gradient(180deg,#faf6ec 0%,#f7f3e8 34%,#f2ecdc 100%);
  padding:52px 56px 44px; letter-spacing:.2px;
}
.xc-t-paper::before { content:''; position:absolute; top:0; left:0; right:0; height:5px;
  background:linear-gradient(90deg,#617357,#8a9a7c 46%,#a3573d); }
.xc-t-paper::after { content:''; position:absolute; inset:10px; pointer-events:none;
  border:1px solid rgba(97,115,87,.16); }
.xc-t-paper .xc-badgerow { display:flex; align-items:center; gap:9px; font-size:13px; color:#77836d; }
.xc-t-paper .xc-badge { display:inline-flex; align-items:center; gap:5px; padding:4px 11px;
  border:1px solid rgba(97,115,87,.55); border-radius:999px; color:#5a6b50; font-size:12.5px; letter-spacing:2px; }
.xc-t-paper .xc-dot { color:rgba(44,41,33,.35); }
.xc-t-paper .xc-title { margin-top:22px; font-size:35px; line-height:1.4; font-weight:700;
  letter-spacing:.8px; text-wrap:balance; color:#292620; }
.xc-t-paper .xc-meta { margin-top:18px; display:flex; align-items:center; gap:9px;
  font-size:12.5px; color:#8b8574; letter-spacing:1px; padding-bottom:18px;
  border-bottom:1px solid rgba(97,115,87,.24); }
.xc-t-paper .xc-meta svg { opacity:.75; }
.xc-t-paper .xc-meta-sep { color:rgba(44,41,33,.3); }
.xc-t-paper .xc-cover { margin:26px 0 0; border-radius:12px; overflow:hidden;
  box-shadow:0 1px 0 rgba(255,255,255,.9) inset, 0 6px 22px rgba(64,58,42,.14); position:relative; }
.xc-t-paper .xc-cover::after { content:''; position:absolute; inset:0; pointer-events:none;
  background:linear-gradient(180deg,rgba(247,243,232,.12),rgba(64,58,42,.10)); }
.xc-t-paper .xc-cover-gen { aspect-ratio:21/9; position:relative; overflow:hidden;
  background:radial-gradient(120% 150% at 18% 0%,#e9e4cf 0%,#d9d4b8 46%,#b9b391 100%); }
.xc-t-paper .xc-gen-ic { position:absolute; right:34px; top:50%; transform:translateY(-50%); color:rgba(97,115,87,.38); }
.xc-t-paper .xc-ghost { position:absolute; left:22px; bottom:14px; font-size:104px; font-weight:700;
  color:rgba(97,115,87,.14); white-space:nowrap; letter-spacing:5px; }
.xc-t-paper .xc-lead { margin-top:30px; font-size:16.5px; line-height:1.95; color:#4a463b; }
.xc-t-paper .xc-lead::first-letter { float:left; font-size:52px; line-height:.95; font-weight:700;
  color:#617357; padding:6px 10px 0 0; }
.xc-t-paper .xc-sec { margin-top:34px; }
.xc-t-paper .xc-sec-h { font-size:18px; font-weight:700; color:#55654b; letter-spacing:2px; gap:8px; }
.xc-t-paper .xc-sec-h::after { content:''; flex:1; height:1px; margin-left:6px;
  background:linear-gradient(90deg,rgba(97,115,87,.4),rgba(97,115,87,0)); }
.xc-t-paper .xc-sec-ic { color:#617357; }
.xc-t-paper .xc-steps { margin-top:16px; padding-left:4px; }
.xc-t-paper .xc-step { position:relative; display:flex; gap:14px; padding:0 0 20px 0; }
.xc-t-paper .xc-step:not(:last-child)::before { content:''; position:absolute; left:17px; top:36px; bottom:-2px;
  border-left:1px dashed rgba(97,115,87,.45); }
.xc-t-paper .xc-step:last-child { padding-bottom:2px; }
.xc-t-paper .xc-step-n { flex:none; width:35px; height:35px; border-radius:50%;
  border:1px solid rgba(97,115,87,.55); color:#55654b; background:#f9f5ea;
  display:flex; align-items:center; justify-content:center; font-size:13px; letter-spacing:1px; }
.xc-t-paper .xc-step-t { font-size:15.5px; font-weight:700; color:#3a362c; padding-top:6px; }
.xc-t-paper .xc-step-d { margin-top:5px; font-size:14px; line-height:1.85; color:#6b6656; }
.xc-t-paper .xc-points { margin-top:16px; }
.xc-t-paper .xc-point { display:flex; gap:13px; padding:11px 0; }
.xc-t-paper .xc-point + .xc-point { border-top:1px dashed rgba(97,115,87,.28); }
.xc-t-paper .xc-point-n { flex:none; font-size:14px; color:#8a9a7c; font-weight:700; letter-spacing:1px; padding-top:3px; }
.xc-t-paper .xc-point-t { font-size:15.5px; font-weight:700; color:#3a362c; }
.xc-t-paper .xc-point-d { margin-top:4px; font-size:14px; line-height:1.85; color:#6b6656; }
.xc-t-paper .xc-stats { margin-top:16px; display:flex; gap:14px; }
.xc-t-paper .xc-stat { flex:1; background:rgba(97,115,87,.07); border:1px solid rgba(97,115,87,.22);
  border-radius:10px; padding:18px 16px 15px; text-align:center; }
.xc-t-paper .xc-stat-v { font-size:30px; font-weight:700; color:#55654b; letter-spacing:.5px; }
.xc-t-paper .xc-stat-l { margin-top:6px; font-size:12.5px; color:#8b8574; letter-spacing:1px; }
.xc-t-paper .xc-chips { margin-top:14px; display:flex; flex-wrap:wrap; gap:10px; }
.xc-t-paper .xc-chip { padding:6px 15px; border:1px solid rgba(97,115,87,.5); border-radius:999px;
  font-size:13.5px; color:#55654b; background:rgba(97,115,87,.05); letter-spacing:1px; }
.xc-t-paper .xc-counter { margin-top:14px; background:#f3ead6; border-left:3px solid #a3573d;
  border-radius:0 10px 10px 0; padding:15px 18px; font-size:14px; line-height:1.9; color:#6d5c47; }
.xc-t-paper .xc-sec-counter .xc-sec-h { color:#96603f; }
.xc-t-paper .xc-sec-counter .xc-sec-ic { color:#a3573d; }
.xc-t-paper .xc-quote { position:relative; margin-top:16px; padding:6px 0 6px 40px; }
.xc-t-paper .xc-quote + .xc-quote { margin-top:22px; }
.xc-t-paper .xc-qmark { position:absolute; left:0; top:-8px; font-size:56px; color:rgba(97,115,87,.5); }
.xc-t-paper .xc-quote p { font-size:16.5px; line-height:1.9; color:#3f3b30; font-weight:700; letter-spacing:.4px; }
.xc-t-paper .xc-actions { margin-top:14px; }
.xc-t-paper .xc-action { display:flex; align-items:flex-start; gap:11px; padding:8px 0;
  font-size:14.5px; line-height:1.8; color:#4a463b; }
.xc-t-paper .xc-action-box { flex:none; margin-top:4px; width:17px; height:17px; border-radius:4px;
  border:1.5px solid #617357; color:#617357; display:flex; align-items:center; justify-content:center; }
.xc-t-paper .xc-conclusion { margin-top:14px; background:rgba(97,115,87,.08);
  border-left:3px solid #617357; border-radius:0 10px 10px 0; padding:16px 19px;
  font-size:15px; line-height:1.95; color:#3f4436; }
.xc-t-paper .xc-prose-p { margin-top:14px; font-size:15px; line-height:1.95; color:#4a463b; }
.xc-t-paper .xc-foot { margin-top:40px; padding-top:20px; border-top:3px double rgba(97,115,87,.4);
  display:flex; align-items:flex-end; justify-content:space-between; gap:20px; }
.xc-t-paper .xc-qr-box { display:flex; align-items:center; gap:12px; }
.xc-t-paper .xc-qr { width:86px; height:86px; padding:7px; background:#fff; border-radius:8px;
  border:1px solid rgba(97,115,87,.3); }
.xc-t-paper .xc-qr svg { width:72px; height:72px; }
.xc-t-paper .xc-qr-cap { font-size:12px; color:#8b8574; letter-spacing:2px; writing-mode:vertical-rl; }
.xc-t-paper .xc-foot-r { text-align:right; }
.xc-t-paper .xc-brand { display:inline-flex; align-items:center; gap:7px; font-size:16px;
  font-weight:700; color:#55654b; letter-spacing:1.5px; }
.xc-t-paper .xc-brand svg { color:#617357; }
.xc-t-paper .xc-brand-sub { margin-top:6px; font-size:11.5px; color:#8b8574; letter-spacing:2px; }
`,
  html(d, o) {
    return `
      <div class="xc-inner">
        ${heroOrHead(d, o, 'paper', 3)}
        ${leadBlock(d)}
        ${stepsBlock(d)}
        ${chipsBlock(d)}
        ${statsBlock(d, o)}
        ${pointsBlock(d)}
        ${counterBlock(d)}
        ${quotesBlock(d)}
        ${actionsBlock(d)}
        ${conclusionBlock(d)}
        ${proseBlock(d)}
        ${footBlock(d, o)}
      </div>`;
  },
};

/* ================================================================ T2 墨岩（暗色海报） */
const INK = {
  id: 'ink',
  bg: '#17191d',
  css: `
.xc-t-ink {
  font-family:"Segoe UI","PingFang SC","Microsoft YaHei","Microsoft YaHei UI",system-ui,sans-serif;
  color:#e8e4d8; background:#17191d; padding:56px 56px 44px; font-weight:300; letter-spacing:.3px;
}
.xc-t-ink::before { content:''; position:absolute; width:420px; height:420px; right:-140px; top:-160px;
  border-radius:50%; background:radial-gradient(circle,rgba(201,168,106,.16),transparent 66%); }
.xc-t-ink::after { content:''; position:absolute; width:380px; height:380px; left:-160px; top:34%;
  border-radius:50%; background:radial-gradient(circle,rgba(122,138,107,.13),transparent 66%); }
.xc-t-ink .xc-inner { position:relative; z-index:1; }
.xc-t-ink .xc-head { text-align:center; }
.xc-t-ink .xc-badgerow { justify-content:center; display:flex; align-items:center; gap:10px;
  font-size:12.5px; color:#9a947f; letter-spacing:3px; }
.xc-t-ink .xc-badge { display:inline-flex; align-items:center; gap:6px; padding:5px 14px;
  border:1px solid rgba(201,168,106,.55); border-radius:2px; color:#c9a86a;
  font-size:12.5px; letter-spacing:4px; }
.xc-t-ink .xc-dot, .xc-t-ink .xc-date { color:#8b8676; }
.xc-t-ink .xc-title { margin-top:26px; font-size:40px; line-height:1.42; font-weight:300;
  letter-spacing:1.5px; color:#f0ecdf; text-wrap:balance; }
.xc-t-ink .xc-meta { margin-top:20px; display:flex; justify-content:center; align-items:center; gap:10px;
  font-size:12.5px; color:#8b8676; letter-spacing:2px; }
.xc-t-ink .xc-meta-sep { color:rgba(232,228,216,.28); }
.xc-t-ink .xc-cover { margin:30px auto 0; width:600px; border-radius:14px; overflow:hidden; position:relative; }
.xc-t-ink .xc-cover::before { content:''; position:absolute; inset:0; z-index:1;
  background:linear-gradient(160deg,#c9a86a,#43331a); mix-blend-mode:screen; opacity:.55; }
.xc-t-ink .xc-cover img { filter:grayscale(1) contrast(1.06); }
.xc-t-ink .xc-cover-gen { aspect-ratio:2/1; position:relative; overflow:hidden;
  background:
    radial-gradient(circle at 78% 22%, rgba(201,168,106,.26), transparent 44%),
    repeating-linear-gradient(115deg, rgba(232,228,216,.05) 0 1.5px, transparent 1.5px 18px),
    radial-gradient(130% 130% at 30% 0%, #2e3138 0%, #20232a 52%, #191b20 100%);
  border:1px solid rgba(201,168,106,.28); }
.xc-t-ink .xc-gen-ic { position:absolute; right:40px; top:50%; transform:translateY(-50%);
  color:rgba(201,168,106,.42); }
.xc-t-ink .xc-ghost { position:absolute; left:26px; bottom:16px; font-size:86px; font-weight:700;
  color:rgba(201,168,106,.13); white-space:nowrap; letter-spacing:4px; }
.xc-t-ink .xc-lead { margin:34px auto 0; max-width:600px; font-size:17px; line-height:2; color:#b9b4a2;
  text-align:center; }
.xc-t-ink .xc-sec { margin-top:40px; }
.xc-t-ink .xc-sec-h { font-size:13px; color:#c9a86a; letter-spacing:5px; font-weight:400; gap:9px; }
.xc-t-ink .xc-sec-h::after { content:''; flex:1; height:1px;
  background:linear-gradient(90deg,rgba(201,168,106,.5),rgba(201,168,106,.05)); }
.xc-t-ink .xc-sec-ic { color:#c9a86a; }
.xc-t-ink .xc-steps { margin-top:20px; padding-left:4px; }
.xc-t-ink .xc-step { position:relative; display:flex; gap:16px; padding-bottom:22px; }
.xc-t-ink .xc-step:not(:last-child)::before { content:''; position:absolute; left:17px; top:34px; bottom:-2px;
  border-left:1px solid rgba(201,168,106,.32); }
.xc-t-ink .xc-step:last-child { padding-bottom:2px; }
.xc-t-ink .xc-step-n { flex:none; width:27px; height:27px; border-radius:50%;
  border:1px solid rgba(201,168,106,.65); background:#17191d; color:#c9a86a;
  display:flex; align-items:center; justify-content:center; font-size:11px; letter-spacing:1px; margin-top:3px; }
.xc-t-ink .xc-step-t { font-size:16px; font-weight:400; color:#e8e4d8; letter-spacing:.5px; }
.xc-t-ink .xc-step-d { margin-top:6px; font-size:13.5px; line-height:1.9; color:#98937f; }
.xc-t-ink .xc-points { margin-top:18px; }
.xc-t-ink .xc-point { display:flex; gap:15px; padding:12px 0; }
.xc-t-ink .xc-point + .xc-point { border-top:1px solid rgba(232,228,216,.08); }
.xc-t-ink .xc-point-n { flex:none; font-size:15px; color:#c9a86a; font-weight:400; letter-spacing:1px; padding-top:2px; }
.xc-t-ink .xc-point-t { font-size:15.5px; font-weight:400; color:#e8e4d8; }
.xc-t-ink .xc-point-d { margin-top:5px; font-size:13.5px; line-height:1.9; color:#98937f; }
.xc-t-ink .xc-stats { margin-top:20px; display:flex; gap:14px; }
.xc-t-ink .xc-stat { flex:1; background:rgba(232,228,216,.045); border:1px solid rgba(201,168,106,.3);
  border-radius:10px; padding:22px 14px 18px; text-align:center; }
.xc-t-ink .xc-stat-v { font-size:34px; font-weight:300; color:#c9a86a; letter-spacing:1px; }
.xc-t-ink .xc-stat-l { margin-top:8px; font-size:12px; color:#98937f; letter-spacing:2px; }
.xc-t-ink .xc-chips { margin-top:16px; display:flex; flex-wrap:wrap; gap:10px; }
.xc-t-ink .xc-chip { padding:6px 16px; border:1px solid rgba(201,168,106,.4); border-radius:2px;
  font-size:13px; color:#c9b98a; letter-spacing:1.5px; }
.xc-t-ink .xc-counter { margin-top:16px; background:rgba(201,168,106,.07);
  border-left:2px solid rgba(201,168,106,.6); padding:16px 19px;
  font-size:13.5px; line-height:1.95; color:#b3a284; }
.xc-t-ink .xc-quote { margin-top:26px; position:relative; padding:0 0 0 46px; }
.xc-t-ink .xc-quote + .xc-quote { margin-top:30px; }
.xc-t-ink .xc-qmark { position:absolute; left:0; top:-6px; font-size:44px; color:rgba(201,168,106,.65); }
.xc-t-ink .xc-quote p { font-size:17px; line-height:2; color:#ddd6c2; letter-spacing:.8px; text-align:left; }
.xc-t-ink .xc-actions { margin-top:16px; }
.xc-t-ink .xc-action { display:flex; align-items:flex-start; gap:12px; padding:8px 0;
  font-size:14px; line-height:1.85; color:#c4bfae; }
.xc-t-ink .xc-action-box { flex:none; margin-top:4px; width:17px; height:17px; border-radius:3px;
  border:1.5px solid rgba(201,168,106,.7); color:#c9a86a; display:flex; align-items:center; justify-content:center; }
.xc-t-ink .xc-conclusion { margin-top:16px; padding:20px 22px; border-top:1px solid rgba(201,168,106,.4);
  border-bottom:1px solid rgba(201,168,106,.2); font-size:15px; line-height:2; color:#cfc9b4; }
.xc-t-ink .xc-prose-p { margin-top:14px; font-size:14.5px; line-height:2; color:#b9b4a2; }
.xc-t-ink .xc-foot { margin-top:46px; padding-top:24px; border-top:1px solid rgba(232,228,216,.1);
  display:flex; align-items:center; justify-content:center; gap:26px; }
.xc-t-ink .xc-qr-box { display:flex; align-items:center; gap:11px; }
.xc-t-ink .xc-qr { width:74px; height:74px; padding:6px; background:#f5f2e8; border-radius:8px; }
.xc-t-ink .xc-qr svg { width:62px; height:62px; }
.xc-t-ink .xc-qr-cap { font-size:11px; color:#8b8676; letter-spacing:3px; writing-mode:vertical-rl; }
.xc-t-ink .xc-foot-r { text-align:left; }
.xc-t-ink .xc-brand { display:inline-flex; align-items:center; gap:8px; font-size:15px;
  color:#e8e4d8; letter-spacing:2.5px; font-weight:400; }
.xc-t-ink .xc-brand svg { color:#c9a86a; }
.xc-t-ink .xc-brand-sub { margin-top:5px; font-size:11px; color:#8b8676; letter-spacing:2.5px; }
`,
  html(d, o) {
    return `
      <div class="xc-inner">
        ${heroOrHead(d, o, 'ink', 3)}
        ${leadBlock(d)}
        ${statsBlock(d, o)}
        ${stepsBlock(d)}
        ${chipsBlock(d)}
        ${pointsBlock(d)}
        ${counterBlock(d)}
        ${quotesBlock(d)}
        ${actionsBlock(d)}
        ${conclusionBlock(d)}
        ${proseBlock(d)}
        ${footBlock(d, o)}
      </div>`;
  },
};

/* ================================================================ T3 杂志编辑 */
const MAG = {
  id: 'mag',
  bg: '#ffffff',
  css: `
.xc-t-mag {
  font-family:"Segoe UI","PingFang SC","Microsoft YaHei","Microsoft YaHei UI",system-ui,sans-serif;
  color:#141414; background:#fff; padding:50px 52px 40px; letter-spacing:.2px;
}
.xc-t-mag .xc-masthead { border-top:3px solid #141414; border-bottom:1px solid #141414;
  padding:12px 0; display:flex; align-items:center; justify-content:space-between; }
.xc-t-mag .xc-badge { display:inline-flex; align-items:center; gap:6px; background:#c73e3a; color:#fff;
  padding:5px 13px; font-size:12px; letter-spacing:4px; font-weight:700; }
.xc-t-mag .xc-feed { font-size:13px; font-weight:700; letter-spacing:2px; }
.xc-t-mag .xc-date { font-size:12.5px; color:#666; letter-spacing:1.5px; }
.xc-t-mag .xc-title { margin-top:34px; font-size:44px; line-height:1.32; font-weight:700;
  letter-spacing:.5px; color:#111; text-wrap:balance; }
.xc-t-mag .xc-meta { margin-top:16px; display:flex; align-items:center; gap:10px;
  font-size:12px; color:#888; letter-spacing:1.5px; }
.xc-t-mag .xc-meta-sep { color:#ccc; }
.xc-t-mag .xc-cover { margin-top:26px; position:relative; overflow:hidden; }
.xc-t-mag .xc-cover img { filter:grayscale(1) contrast(1.12); }
.xc-t-mag .xc-cover::after { content:'知更精选'; position:absolute; left:0; bottom:0;
  background:#c73e3a; color:#fff; font-size:11.5px; letter-spacing:3px; padding:6px 14px; font-weight:700; }
.xc-t-mag .xc-cover-gen { aspect-ratio:2.4/1; position:relative; overflow:hidden; background:
  linear-gradient(135deg,#f2f2f2 0%,#dcdcdc 55%,#c7c7c7 100%); }
.xc-t-mag .xc-gen-ic { position:absolute; right:30px; top:50%; transform:translateY(-50%); color:rgba(20,20,20,.3); }
.xc-t-mag .xc-ghost { position:absolute; left:18px; bottom:14px; font-size:106px; font-weight:700;
  color:rgba(20,20,20,.08); white-space:nowrap; }
.xc-t-mag .xc-lead { margin-top:28px; font-size:17.5px; line-height:1.9; color:#3d3d3d; font-weight:400;
  padding-left:18px; border-left:4px solid #c73e3a; }
.xc-t-mag .xc-stats { margin-top:34px; border-top:1px solid #141414; border-bottom:1px solid #e2e2e2;
  padding:24px 0; display:flex; gap:12px; }
.xc-t-mag .xc-stat { flex:1; }
.xc-t-mag .xc-stat-v { font-size:34px; font-weight:700; color:#c73e3a; letter-spacing:0; }
.xc-t-mag .xc-stat-l { margin-top:6px; font-size:12px; color:#777; letter-spacing:1.5px; }
.xc-t-mag .xc-cols { margin-top:34px; columns:2; column-gap:40px; column-rule:1px solid #e6e6e6; }
.xc-t-mag .xc-cols .xc-sec { break-inside:auto; margin-top:0; margin-bottom:30px; }
.xc-t-mag .xc-sec-h { font-size:14px; font-weight:700; letter-spacing:3px; color:#111; gap:8px; }
.xc-t-mag .xc-sec-h::after { content:''; flex:1; height:2px; background:#141414; margin-left:4px; }
.xc-t-mag .xc-sec-ic { color:#c73e3a; }
.xc-t-mag .xc-steps, .xc-t-mag .xc-points { margin-top:16px; }
.xc-t-mag .xc-step, .xc-t-mag .xc-point { display:flex; gap:13px; padding:10px 0; break-inside:avoid; }
.xc-t-mag .xc-step + .xc-step, .xc-t-mag .xc-point + .xc-point { border-top:1px solid #ececec; }
.xc-t-mag .xc-step-n, .xc-t-mag .xc-point-n { flex:none; font-size:24px; font-weight:700; color:#d4d4d4;
  line-height:1.1; letter-spacing:0; }
.xc-t-mag .xc-step-t, .xc-t-mag .xc-point-t { font-size:14.5px; font-weight:700; color:#141414; }
.xc-t-mag .xc-step-d, .xc-t-mag .xc-point-d { margin-top:5px; font-size:13px; line-height:1.85; color:#555; }
.xc-t-mag .xc-chips { margin-top:14px; display:flex; flex-wrap:wrap; gap:8px; }
.xc-t-mag .xc-chip { padding:5px 13px; border:1px solid #141414; font-size:12px;
  letter-spacing:1.5px; color:#141414; }
.xc-t-mag .xc-counter { margin-top:34px; background:#f6f6f6; border-left:4px solid #c73e3a;
  padding:16px 19px; font-size:13.5px; line-height:1.9; color:#4d4d4d; }
.xc-t-mag .xc-sec-counter .xc-sec-h { color:#c73e3a; }
.xc-t-mag .xc-quote { position:relative; margin-top:34px; padding:10px 0 6px 56px; }
.xc-t-mag .xc-quote + .xc-quote { margin-top:24px; }
.xc-t-mag .xc-qmark { position:absolute; left:0; top:-10px; font-size:74px; color:#c73e3a; opacity:.9; }
.xc-t-mag .xc-quote p { font-size:19px; line-height:1.75; font-weight:700; color:#111; letter-spacing:.3px; }
.xc-t-mag .xc-actions { margin-top:14px; }
.xc-t-mag .xc-sec-actions, .xc-t-mag .xc-sec-conclusion { margin-top:34px; }
.xc-t-mag .xc-action { display:flex; align-items:flex-start; gap:11px; padding:8px 0;
  font-size:13.5px; line-height:1.8; color:#333; }
.xc-t-mag .xc-action-box { flex:none; margin-top:4px; width:16px; height:16px;
  border:1.5px solid #141414; color:#141414; display:flex; align-items:center; justify-content:center; }
.xc-t-mag .xc-conclusion { margin-top:34px; border-top:3px solid #141414; padding-top:18px;
  font-size:15px; line-height:1.95; color:#222; }
.xc-t-mag .xc-prose-p { margin-top:14px; font-size:14px; line-height:1.95; color:#333; }
.xc-t-mag .xc-foot { margin-top:42px; padding-top:18px; border-top:1px solid #141414;
  display:flex; align-items:flex-end; justify-content:space-between; gap:20px; }
.xc-t-mag .xc-qr-box { display:flex; align-items:center; gap:12px; }
.xc-t-mag .xc-qr { width:80px; height:80px; padding:6px; background:#fff; border:1px solid #dcdcdc; }
.xc-t-mag .xc-qr svg { width:68px; height:68px; }
.xc-t-mag .xc-qr-cap { font-size:11px; color:#888; letter-spacing:3px; writing-mode:vertical-rl; }
.xc-t-mag .xc-foot-r { text-align:right; }
.xc-t-mag .xc-brand { display:inline-flex; align-items:center; gap:7px; font-size:15px;
  font-weight:700; letter-spacing:2px; color:#111; }
.xc-t-mag .xc-brand svg { color:#c73e3a; }
.xc-t-mag .xc-brand-sub { margin-top:5px; font-size:11px; color:#888; letter-spacing:2px; }
`,
  html(d, o) {
    const colBody = [stepsBlock(d), chipsBlock(d), pointsBlock(d), counterBlock(d)].filter(Boolean).join('');
    return `
      <div class="xc-masthead">
        <span class="xc-badge">${icon('feather', 12, 2)}${esc(KIND_BADGES[d.kind] || '阅读笔记')}</span>
        <span class="xc-feed">${esc(d.feedTitle || '')}</span>
        <span class="xc-date">${esc(d.date || '')}</span>
      </div>
      <h1 class="xc-title">${esc(d.title)}</h1>
      ${metaStrip(d)}
      ${heroBlock(d, o, 'mag', true) || coverBlock(d, o, 3)}
      ${leadBlock(d)}
      ${statsBlock(d, o)}
      ${colBody ? `<div class="xc-cols">${colBody}</div>` : quotesBlock(d)}
      ${colBody ? quotesBlock(d) : ''}
      ${actionsBlock(d)}
      ${conclusionBlock(d)}
      ${proseBlock(d)}
      ${footBlock(d, o)}`;
  },
};

/* ================================================================ T4 晨读手帖 */
const NOTE = {
  id: 'note',
  bg: '#faf6ee',
  css: `
.xc-t-note {
  font-family:"Kaiti SC",STKaiti,KaiTi,"DFKai-SB","Segoe UI",serif;
  color:#4a3a28; background:#faf6ee; padding:58px 50px 44px; letter-spacing:.4px;
  background-image:radial-gradient(rgba(122,94,58,.07) 1px,transparent 1.4px);
  background-size:26px 26px;
}
.xc-t-note .xc-tape { position:absolute; top:24px; left:50%; width:190px; height:34px;
  transform:translateX(-50%) rotate(-2deg); background:rgba(224,122,63,.55);
  box-shadow:0 2px 6px rgba(122,94,58,.18); }
.xc-t-note .xc-tape::before, .xc-t-note .xc-tape::after { content:''; position:absolute; top:0; bottom:0;
  width:6px; background-image:linear-gradient(90deg,rgba(250,246,238,.9) 40%,transparent 40%);
  background-size:6px 8px; }
.xc-t-note .xc-tape::before { left:-3px; } .xc-t-note .xc-tape::after { right:-3px; }
.xc-t-note .xc-titlewrap { position:relative; margin-top:16px; }
.xc-t-note .xc-title { font-size:36px; line-height:1.45; font-weight:700; color:#43331f;
  letter-spacing:1px; text-wrap:balance; }
.xc-t-note .xc-seal { position:absolute; right:2px; top:-6px; width:64px; height:64px;
  border:2.5px solid rgba(178,58,44,.75); border-radius:10px; transform:rotate(8deg);
  display:flex; align-items:center; justify-content:center; flex-direction:column;
  color:rgba(178,58,44,.85); font-size:19px; font-weight:700; letter-spacing:2px; line-height:1.3;
  writing-mode:vertical-rl; }
.xc-t-note .xc-badgerow { margin-top:16px; display:flex; align-items:center; gap:9px;
  font-size:14px; color:#8a6d47; }
.xc-t-note .xc-badge { display:inline-flex; align-items:center; gap:5px; padding:4px 12px;
  border:1.5px dashed rgba(178,58,44,.6); border-radius:8px; color:#b23a2c;
  font-size:13px; letter-spacing:1.5px; background:rgba(255,255,255,.55); }
.xc-t-note .xc-dot { color:rgba(74,58,40,.4); }
.xc-t-note .xc-meta { margin-top:12px; display:flex; align-items:center; gap:9px; font-size:13px; color:#8a6d47; }
.xc-t-note .xc-meta-sep { color:rgba(74,58,40,.35); }
.xc-t-note .xc-coverwrap { margin:26px auto 0; width:270px; transform:rotate(1.8deg); }
.xc-t-note .xc-coverwrap::after { content:'奕'; position:absolute; right:-96px; top:36%; width:84px; height:84px; display:flex; align-items:center; justify-content:center; border:3px solid rgba(178,58,44,.5); border-radius:50%; color:rgba(178,58,44,.55); font-size:34px; font-weight:700; font-family:inherit; transform:rotate(-8deg); }
.xc-t-note .xc-cover { background:#fff; padding:10px 10px 34px;
  box-shadow:0 8px 22px rgba(74,58,40,.22); position:relative; }
.xc-t-note .xc-cover::after { content:''; position:absolute; inset:10px 10px 34px; pointer-events:none;
  background:linear-gradient(180deg,rgba(255,255,255,.10),rgba(74,58,40,.08)); }
.xc-t-note .xc-cover-gen { aspect-ratio:5/4; position:relative; overflow:hidden;
  background:repeating-linear-gradient(45deg,#f0e4cf 0 12px,#ead9bd 12px 24px); }
.xc-t-note .xc-gen-ic { position:absolute; right:18px; top:16px; color:rgba(138,109,71,.45); }
.xc-t-note .xc-ghost { position:absolute; left:14px; bottom:26px; font-size:92px; font-weight:700;
  color:rgba(138,109,71,.18); white-space:nowrap; }
.xc-t-note .xc-caption { position:absolute; left:0; right:0; bottom:8px; text-align:center;
  font-size:13px; color:#8a6d47; }
.xc-t-note .xc-lead { margin-top:26px; font-size:16.5px; line-height:2.05; color:#54422c; }
.xc-t-note .xc-lead::first-letter { font-size:40px; font-weight:700; color:#b23a2c; }
.xc-t-note .xc-card2 { background:#fffdf8; border-radius:8px; padding:20px 22px;
  box-shadow:0 3px 12px rgba(74,58,40,.12); margin-top:26px; }
.xc-t-note .xc-card2:nth-of-type(odd) { transform:rotate(-.6deg); }
.xc-t-note .xc-card2:nth-of-type(even) { transform:rotate(.5deg); }
.xc-t-note .xc-sec { margin-top:0; }
.xc-t-note .xc-card2 .xc-sec { margin-top:0; }
.xc-t-note .xc-sec-h { font-size:16.5px; font-weight:700; color:#b23a2c; letter-spacing:2px; gap:8px; }
.xc-t-note .xc-sec-h::after { content:''; flex:1; border-bottom:2px dashed rgba(138,109,71,.45); }
.xc-t-note .xc-sec-ic { color:#c96a2e; }
.xc-t-note .xc-steps, .xc-t-note .xc-points { margin-top:14px; }
.xc-t-note .xc-step, .xc-t-note .xc-point { display:flex; gap:13px; padding:9px 0; }
.xc-t-note .xc-step-n, .xc-t-note .xc-point-n { flex:none; width:26px; height:26px; margin-top:2px;
  border-radius:50%; border:1.5px solid rgba(138,109,71,.6); color:#8a6d47;
  display:flex; align-items:center; justify-content:center; font-size:12.5px; background:#faf6ee; }
.xc-t-note .xc-step-t, .xc-t-note .xc-point-t { font-size:15.5px; font-weight:700; color:#43331f; }
.xc-t-note .xc-step-d, .xc-t-note .xc-point-d { margin-top:4px; font-size:13.5px; line-height:1.9; color:#74603f; }
.xc-t-note .xc-stats { margin-top:22px; display:flex; gap:14px; }
.xc-t-note .xc-stat { flex:1; background:#fff8e6; border:1px solid rgba(201,106,46,.35); border-radius:6px;
  padding:16px 12px 13px; text-align:center; box-shadow:0 3px 9px rgba(74,58,40,.12); }
.xc-t-note .xc-stat:nth-child(1) { transform:rotate(-1.6deg); }
.xc-t-note .xc-stat:nth-child(2) { transform:rotate(1.1deg); }
.xc-t-note .xc-stat:nth-child(3) { transform:rotate(-.7deg); }
.xc-t-note .xc-stat-v { font-size:27px; font-weight:700; color:#c96a2e; }
.xc-t-note .xc-stat-l { margin-top:5px; font-size:12.5px; color:#8a6d47; }
.xc-t-note .xc-chips { margin-top:12px; display:flex; flex-wrap:wrap; gap:9px; }
.xc-t-note .xc-chip { padding:5px 14px; border:1.5px dashed rgba(138,109,71,.55); border-radius:999px;
  font-size:13.5px; color:#6d5738; background:rgba(255,255,255,.6); }
.xc-t-note .xc-counter { margin-top:12px; background:#fdf0d7; border-radius:6px; padding:14px 17px;
  font-size:13.5px; line-height:1.95; color:#7a5c33; }
.xc-t-note .xc-sec-counter .xc-sec-h { color:#b26a1e; }
.xc-t-note .xc-sec-counter .xc-sec-ic { color:#b26a1e; }
.xc-t-note .xc-quote { position:relative; margin-top:16px; padding:4px 0 4px 38px; }
.xc-t-note .xc-quote + .xc-quote { margin-top:20px; }
.xc-t-note .xc-qmark { position:absolute; left:0; top:-6px; font-size:48px; color:rgba(178,58,44,.6); }
.xc-t-note .xc-quote p { font-size:16px; line-height:2; color:#54422c; font-weight:700;
  background:repeating-linear-gradient(180deg,transparent 0 34px,rgba(138,109,71,.18) 34px 35.5px); }
.xc-t-note .xc-actions { margin-top:12px; }
.xc-t-note .xc-action { display:flex; align-items:flex-start; gap:11px; padding:7px 0;
  font-size:14.5px; line-height:1.85; color:#54422c; }
.xc-t-note .xc-action-box { flex:none; margin-top:4px; width:17px; height:17px; border-radius:4px;
  border:2px solid rgba(138,109,71,.7); color:#c96a2e; display:flex; align-items:center; justify-content:center; }
.xc-t-note .xc-conclusion { margin-top:12px; font-size:15px; line-height:2; color:#54422c;
  border-top:2px dashed rgba(138,109,71,.45); padding-top:16px; }
.xc-t-note .xc-prose-p { margin-top:12px; font-size:14.5px; line-height:2; color:#54422c; }
.xc-t-note .xc-foot { margin-top:40px; padding-top:20px; border-top:2px dashed rgba(138,109,71,.5);
  display:flex; align-items:flex-end; justify-content:space-between; gap:20px; }
.xc-t-note .xc-qr-box { display:flex; align-items:center; gap:12px; }
.xc-t-note .xc-qr { width:82px; height:82px; padding:7px; background:#fffdf8; border:1.5px dashed rgba(138,109,71,.55); border-radius:8px; }
.xc-t-note .xc-qr svg { width:68px; height:68px; }
.xc-t-note .xc-qr-cap { font-size:12.5px; color:#8a6d47; letter-spacing:2px; }
.xc-t-note .xc-foot-r { text-align:right; }
.xc-t-note .xc-brand { display:inline-flex; align-items:center; gap:7px; font-size:16px;
  font-weight:700; color:#6d5738; letter-spacing:1.5px; }
.xc-t-note .xc-brand svg { color:#b23a2c; }
.xc-t-note .xc-brand-sub { margin-top:5px; font-size:12px; color:#8a6d47; letter-spacing:1.5px; }
`,
  html(d, o) {
    const sec = (block) => (block ? `<div class="xc-card2">${block}</div>` : '');
    return `
      <div class="xc-tape"></div>
      <div class="xc-titlewrap">
        <h1 class="xc-title">${esc(d.title)}</h1>
        <div class="xc-seal"><span>精读</span></div>
      </div>
      ${badgeRow(d)}
      ${metaStrip(d)}
      <div class="xc-coverwrap">
        <figure class="xc-cover">
          ${d.cover
            ? `<img src="${d.cover}" alt=""/>`
            : `<div class="xc-cover-gen"><span class="xc-ghost">${esc(titleChars(d.title, 3))}</span></div>`}
          <figcaption class="xc-caption">来自「${esc(d.feedTitle || '知更')}」</figcaption>
        </figure>
      </div>
      ${leadBlock(d)}
      ${sec(stepsBlock(d))}
      ${sec(chipsBlock(d))}
      ${statsBlock(d, o).replace('xc-sec-h', 'xc-sec-h xc-hide')}
      ${sec(pointsBlock(d))}
      ${sec(counterBlock(d))}
      ${sec(quotesBlock(d))}
      ${sec(actionsBlock(d))}
      ${sec(conclusionBlock(d))}
      ${proseBlock(d)}
      ${footBlock(d, o)}`;
  },
};

/* ================================================================ T5 极简白 */
const MIN = {
  id: 'min',
  bg: '#ffffff',
  css: `
.xc-t-min {
  font-family:"Segoe UI","PingFang SC","Microsoft YaHei","Microsoft YaHei UI",system-ui,sans-serif;
  color:#1f2329; background:#fff; padding:60px 56px 48px 64px; letter-spacing:.2px;
}
.xc-t-min::before { content:''; position:absolute; left:44px; top:60px; bottom:48px;
  width:1.5px; background:#e8e8e8; }
.xc-t-min .xc-badgerow { display:flex; align-items:center; gap:8px; font-size:12px;
  color:#9aa0a8; letter-spacing:3px; }
.xc-t-min .xc-badge { display:inline-flex; align-items:center; gap:5px; color:#1f2329;
  font-weight:600; letter-spacing:3px; }
.xc-t-min .xc-badge svg { color:#6b7280; }
.xc-t-min .xc-dot { color:#d0d3d8; }
.xc-t-min .xc-headrow { display:flex; align-items:flex-start; gap:28px; }
.xc-t-min .xc-title { flex:1; margin-top:18px; font-size:32px; line-height:1.45; font-weight:600;
  color:#1f2329; letter-spacing:.3px; text-wrap:balance; }
.xc-t-min .xc-cover { flex:none; width:128px; height:128px; border-radius:50%; overflow:hidden;
  margin-top:14px; border:1px solid #ececec; }
.xc-t-min .xc-cover img { width:100%; height:100%; object-fit:cover; }
.xc-t-min .xc-cover-gen { position:relative; overflow:hidden;
  background:linear-gradient(150deg,#f3f4f6,#dfe2e6 70%,#d3d7dc); }
.xc-t-min .xc-gen-ic { display:none; }
.xc-t-min .xc-ghost { position:absolute; left:12px; bottom:6px; font-size:40px; font-weight:600;
  color:rgba(31,35,41,.08); white-space:nowrap; }
.xc-t-min .xc-meta { margin-top:18px; display:flex; align-items:center; gap:9px;
  font-size:12.5px; color:#9aa0a8; letter-spacing:1px; }
.xc-t-min .xc-meta-sep { color:#d0d3d8; }
.xc-t-min .xc-cover-wide { display:none; }
.xc-t-min .xc-lead { margin-top:30px; font-size:16px; line-height:1.95; color:#4b5563; }
.xc-t-min .xc-sec { margin-top:36px; }
.xc-t-min .xc-sec-h { font-size:12px; letter-spacing:4px; color:#9aa0a8; font-weight:600; gap:8px; }
.xc-t-min .xc-sec-h::before { content:''; width:8px; height:8px; background:#1f2329; border-radius:2px;
  margin-left:-28px; }
.xc-t-min .xc-sec-ic { color:#6b7280; }
.xc-t-min .xc-sec .xc-steps, .xc-t-min .xc-sec .xc-points { margin-top:16px; padding-left:2px; }
.xc-t-min .xc-step, .xc-t-min .xc-point { display:flex; gap:14px; padding:10px 0; }
.xc-t-min .xc-step + .xc-step, .xc-t-min .xc-point + .xc-point { border-top:1px solid #f1f2f4; }
.xc-t-min .xc-step-n, .xc-t-min .xc-point-n { flex:none; font-size:13px; color:#b0b5bc;
  font-weight:600; padding-top:3px; letter-spacing:.5px; }
.xc-t-min .xc-step-t, .xc-t-min .xc-point-t { font-size:15px; font-weight:600; color:#1f2329; }
.xc-t-min .xc-step-d, .xc-t-min .xc-point-d { margin-top:4px; font-size:13.5px; line-height:1.85; color:#6b7280; }
.xc-t-min .xc-stats { margin-top:18px; display:flex; gap:36px; padding:20px 0 6px;
  border-top:1px solid #ececec; }
.xc-t-min .xc-stat { flex:none; }
.xc-t-min .xc-stat-v { font-size:31px; font-weight:300; color:#1f2329; letter-spacing:.5px; }
.xc-t-min .xc-stat-l { margin-top:5px; font-size:12px; color:#9aa0a8; letter-spacing:1px; }
.xc-t-min .xc-chips { margin-top:14px; display:flex; flex-wrap:wrap; gap:8px; }
.xc-t-min .xc-chip { padding:5px 14px; border:1px solid #e5e7eb; border-radius:999px;
  font-size:12.5px; color:#4b5563; }
.xc-t-min .xc-counter { margin-top:14px; background:#f7f8f9; border-radius:8px;
  padding:15px 18px; font-size:13.5px; line-height:1.9; color:#6b7280; }
.xc-t-min .xc-quote { margin-top:20px; padding-left:44px; position:relative; }
.xc-t-min .xc-quote + .xc-quote { margin-top:26px; }
.xc-t-min .xc-qmark { position:absolute; left:0; top:-8px; font-size:50px; color:#e0e2e6; }
.xc-t-min .xc-quote p { font-size:16.5px; line-height:1.9; color:#1f2329; font-weight:600; }
.xc-t-min .xc-actions { margin-top:14px; }
.xc-t-min .xc-action { display:flex; align-items:flex-start; gap:11px; padding:7px 0;
  font-size:14px; line-height:1.8; color:#374151; }
.xc-t-min .xc-action-box { flex:none; margin-top:4px; width:16px; height:16px; border-radius:4px;
  border:1.5px solid #d1d5db; color:#6b7280; display:flex; align-items:center; justify-content:center; }
.xc-t-min .xc-conclusion { margin-top:14px; padding:17px 0 0; border-top:1px solid #ececec;
  font-size:14.5px; line-height:1.95; color:#1f2329; }
.xc-t-min .xc-prose-p { margin-top:13px; font-size:14px; line-height:1.95; color:#374151; }
.xc-t-min .xc-foot { margin-top:48px; padding-top:20px; border-top:1px solid #ececec;
  display:flex; align-items:flex-end; justify-content:space-between; gap:20px; }
.xc-t-min .xc-qr-box { display:flex; align-items:center; gap:12px; }
.xc-t-min .xc-qr { width:76px; height:76px; padding:6px; background:#fff; border:1px solid #e5e7eb; border-radius:8px; }
.xc-t-min .xc-qr svg { width:64px; height:64px; }
.xc-t-min .xc-qr-cap { font-size:11px; color:#9aa0a8; letter-spacing:2px; }
.xc-t-min .xc-foot-r { text-align:right; }
.xc-t-min .xc-brand { display:inline-flex; align-items:center; gap:7px; font-size:14px;
  font-weight:600; color:#1f2329; letter-spacing:1.5px; }
.xc-t-min .xc-brand svg { color:#6b7280; }
.xc-t-min .xc-brand-sub { margin-top:5px; font-size:11px; color:#9aa0a8; letter-spacing:1.5px; }
`,
  html(d, o) {
    return `
      ${badgeRow(d)}
      <div class="xc-headrow">
        <h1 class="xc-title">${esc(d.title)}</h1>
        ${coverBlock(d, o, 3)}
      </div>
      ${metaStrip(d)}
      ${leadBlock(d)}
      ${statsBlock(d, o)}
      ${stepsBlock(d)}
      ${chipsBlock(d)}
      ${pointsBlock(d)}
      ${counterBlock(d)}
      ${quotesBlock(d)}
      ${actionsBlock(d)}
      ${conclusionBlock(d)}
      ${proseBlock(d)}
      ${footBlock(d, o)}`;
  },
};

/* ================================================================ T6 晚报 */
const NEWS = {
  id: 'news',
  bg: '#f4eeda',
  css: `
.xc-t-news {
  font-family:"Source Han Serif SC","Noto Serif SC","Songti SC","STSong",SimSun,Georgia,serif;
  color:#26221a; background:#f4eeda; padding:46px 52px 40px; letter-spacing:.3px;
  background-image:radial-gradient(rgba(64,52,28,.045) 1px,transparent 1.3px);
  background-size:22px 22px;
}
.xc-t-news .xc-masthead { text-align:center; border-top:3px solid #2a251c; border-bottom:1px solid #2a251c;
  padding:13px 0 11px; position:relative; }
.xc-t-news .xc-masthead::after { content:''; position:absolute; left:0; right:0; top:3px;
  border-top:1px solid #2a251c; }
.xc-t-news .xc-mast-name { font-size:19px; font-weight:700; letter-spacing:8px; color:#2a251c; }
.xc-t-news .xc-mast-sub { margin-top:5px; font-size:11.5px; color:#7d745c; letter-spacing:2.5px;
  display:flex; justify-content:center; gap:14px; }
.xc-t-news .xc-badge { color:#8c2f24; font-weight:700; }
.xc-t-news .xc-title { margin-top:28px; font-size:37px; line-height:1.45; font-weight:700;
  letter-spacing:1.5px; color:#221e15; text-align:center; text-wrap:balance; }
.xc-t-news .xc-meta { margin-top:14px; display:flex; justify-content:center; align-items:center; gap:10px;
  font-size:12.5px; color:#7d745c; letter-spacing:1.5px; padding-bottom:16px;
  border-bottom:1px solid rgba(42,37,28,.35); }
.xc-t-news .xc-meta-sep { color:rgba(42,37,28,.35); }
.xc-t-news .xc-cover { margin-top:22px; border:1px solid #2a251c; padding:5px; background:#faf6e8; position:relative; }
.xc-t-news .xc-cover img { filter:grayscale(1) contrast(1.05); }
.xc-t-news .xc-cover::after { content:''; position:absolute; inset:5px; pointer-events:none;
  background-image:radial-gradient(rgba(38,34,26,.32) .8px,transparent 1.1px);
  background-size:3.5px 3.5px; mix-blend-mode:multiply; }
.xc-t-news .xc-cover-gen { aspect-ratio:2.6/1; position:relative; overflow:hidden;
  background:repeating-linear-gradient(0deg,#e9e2c8 0 3px,#e2dac0 3px 6px); }
.xc-t-news .xc-gen-ic { position:absolute; right:30px; top:50%; transform:translateY(-50%); color:rgba(42,37,28,.32); }
.xc-t-news .xc-ghost { position:absolute; left:16px; bottom:12px; font-size:84px; font-weight:700;
  color:rgba(42,37,28,.14); white-space:nowrap; }
.xc-t-news .xc-cols { margin-top:26px; columns:2; column-gap:36px; column-rule:1px solid rgba(42,37,28,.25); }
.xc-t-news .xc-cols .xc-sec { margin-top:0; margin-bottom:26px; }
.xc-t-news .xc-lead { font-size:15.5px; line-height:2.05; color:#3d372a; }
.xc-t-news .xc-lead::first-letter { float:left; font-size:50px; line-height:.95; font-weight:700;
  color:#8c2f24; padding:5px 9px 0 0; }
.xc-t-news .xc-sec { margin-top:28px; }
.xc-t-news .xc-sec-h { justify-content:center; font-size:15.5px; font-weight:700; letter-spacing:4px;
  color:#2a251c; gap:8px; }
.xc-t-news .xc-sec-h::before, .xc-t-news .xc-sec-h::after { content:''; flex:1; border-top:1px solid rgba(42,37,28,.4); }
.xc-t-news .xc-sec-ic { color:#8c2f24; }
.xc-t-news .xc-steps, .xc-t-news .xc-points { margin-top:14px; }
.xc-t-news .xc-step, .xc-t-news .xc-point { display:flex; gap:12px; padding:9px 0; break-inside:avoid; }
.xc-t-news .xc-step + .xc-step, .xc-t-news .xc-point + .xc-point { border-top:1px dashed rgba(42,37,28,.3); }
.xc-t-news .xc-step-n, .xc-t-news .xc-point-n { flex:none; font-size:13px; font-weight:700; color:#8c2f24;
  padding-top:4px; letter-spacing:1px; }
.xc-t-news .xc-step-t, .xc-t-news .xc-point-t { font-size:15px; font-weight:700; color:#2a251c; }
.xc-t-news .xc-step-d, .xc-t-news .xc-point-d { margin-top:4px; font-size:13.5px; line-height:1.9; color:#544c39; }
.xc-t-news .xc-chips { margin-top:12px; display:flex; flex-wrap:wrap; gap:8px; justify-content:center; }
.xc-t-news .xc-chip { padding:4px 13px; border:1px solid rgba(42,37,28,.5); font-size:12.5px;
  color:#3d372a; letter-spacing:1px; }
.xc-t-news .xc-counter { margin-top:12px; background:rgba(42,37,28,.06); border:1px solid rgba(42,37,28,.35);
  padding:13px 16px; font-size:13px; line-height:1.9; color:#544c39; }
.xc-t-news .xc-sec-counter .xc-sec-h { color:#8c2f24; }
.xc-t-news .xc-stats-band { margin-top:6px; border-top:3px double #2a251c; border-bottom:3px double #2a251c;
  padding:20px 8px; }
.xc-t-news .xc-stats { display:flex; gap:12px; }
.xc-t-news .xc-stat { flex:1; text-align:center; }
.xc-t-news .xc-stat + .xc-stat { border-left:1px solid rgba(42,37,28,.3); }
.xc-t-news .xc-stat-v { font-size:30px; font-weight:700; color:#8c2f24; letter-spacing:.5px; }
.xc-t-news .xc-stat-l { margin-top:6px; font-size:12px; color:#7d745c; letter-spacing:1.5px; }
.xc-t-news .xc-quote { position:relative; margin:24px auto 0; max-width:560px; text-align:center; padding:0 34px; }
.xc-t-news .xc-quote + .xc-quote { margin-top:22px; }
.xc-t-news .xc-qmark { position:absolute; left:0; top:-8px; font-size:50px; color:rgba(140,47,36,.75); }
.xc-t-news .xc-quote p { font-size:16.5px; line-height:2; font-weight:700; color:#2a251c; letter-spacing:.5px; }
.xc-t-news .xc-actions { margin-top:12px; }
.xc-t-news .xc-action { display:flex; align-items:flex-start; gap:10px; padding:7px 0;
  font-size:14px; line-height:1.85; color:#3d372a; }
.xc-t-news .xc-action-box { flex:none; margin-top:4px; width:16px; height:16px;
  border:1.5px solid rgba(42,37,28,.6); color:#8c2f24; display:flex; align-items:center; justify-content:center; }
.xc-t-news .xc-conclusion { margin-top:16px; border-top:1px solid rgba(42,37,28,.35); padding-top:16px;
  font-size:14.5px; line-height:2; color:#3d372a; }
.xc-t-news .xc-prose-p { margin-top:12px; font-size:14px; line-height:2; color:#3d372a; }
.xc-t-news .xc-foot { margin-top:36px; padding-top:18px; border-top:1px solid #2a251c;
  display:flex; align-items:center; justify-content:center; gap:26px; }
.xc-t-news .xc-qr-box { display:flex; align-items:center; gap:11px; }
.xc-t-news .xc-qr { width:76px; height:76px; padding:6px; background:#faf6e8; border:1px solid rgba(42,37,28,.5); }
.xc-t-news .xc-qr svg { width:64px; height:64px; }
.xc-t-news .xc-qr-cap { font-size:11px; color:#7d745c; letter-spacing:2px; writing-mode:vertical-rl; }
.xc-t-news .xc-foot-r { text-align:left; }
.xc-t-news .xc-brand { display:inline-flex; align-items:center; gap:7px; font-size:15px;
  font-weight:700; color:#2a251c; letter-spacing:2px; }
.xc-t-news .xc-brand svg { color:#8c2f24; }
.xc-t-news .xc-brand-sub { margin-top:5px; font-size:11px; color:#7d745c; letter-spacing:2px; }
`,
  html(d, o) {
    const colBody = [leadBlock(d), stepsBlock(d), chipsBlock(d), pointsBlock(d), counterBlock(d)].filter(Boolean).join('');
    const stats = statsBlock(d, o);
    const statsBand = stats ? `<div class="xc-stats-band">${stats.replace('xc-sec-h', 'xc-sec-h xc-hide')}</div>` : '';
    return `
      <div class="xc-masthead">
        <div class="xc-mast-name">${esc(d.feedTitle || '知更晚报')}</div>
        <div class="xc-mast-sub">
          <span class="xc-badge">${esc(KIND_BADGES[d.kind] || '阅读笔记')}特刊</span>
          <span>${esc(d.date || '')}</span>
          <span>知更 RobinRead 出品</span>
        </div>
      </div>
      <h1 class="xc-title">${esc(d.title)}</h1>
      ${metaStrip(d)}
      ${heroBlock(d, o, 'news', true) || coverBlock(d, o, 3)}
      ${statsBand}
      ${colBody ? `<div class="xc-cols">${colBody}</div>` : quotesBlock(d)}
      ${colBody ? quotesBlock(d) : ''}
      ${actionsBlock(d)}
      ${conclusionBlock(d)}
      ${proseBlock(d)}
      ${footBlock(d, o)}`;
  },
};

/* ================================================================ T7 霞光（极光暗夜 · 玻璃质感） */
const AURORA = {
  id: 'aurora',
  bg: '#0a0c14',
  css: `
.xc-t-aurora {
  font-family:"Segoe UI","PingFang SC","HarmonyOS Sans SC","Microsoft YaHei",sans-serif;
  color:#e8ecfa; background:linear-gradient(180deg,#0d1020 0%,#0a0c14 42%,#090b12 100%);
  padding:52px 56px 44px; letter-spacing:.2px;
}
.xc-t-aurora::before { content:''; position:absolute; width:460px; height:340px; left:-130px; top:-150px;
  background:radial-gradient(closest-side,rgba(124,92,255,.4),transparent 72%); filter:blur(30px); }
.xc-t-aurora::after { content:''; position:absolute; width:420px; height:320px; right:-150px; top:16%;
  background:radial-gradient(closest-side,rgba(34,211,238,.26),transparent 70%); filter:blur(34px); }
.xc-t-aurora .xc-badgerow { display:flex; align-items:center; gap:9px; font-size:13px; color:#8d9ac2; }
.xc-t-aurora .xc-badge { display:inline-flex; align-items:center; gap:5px; padding:4px 12px; border-radius:999px;
  border:1px solid transparent; color:#c0b2ff; font-size:12.5px; letter-spacing:2px;
  background:linear-gradient(rgba(16,19,36,.9),rgba(16,19,36,.9)) padding-box,linear-gradient(90deg,#7c5cff,#22d3ee) border-box; }
.xc-t-aurora .xc-dot { color:rgba(232,236,250,.35); }
.xc-t-aurora .xc-title { margin-top:22px; font-size:34px; line-height:1.42; font-weight:700; letter-spacing:.5px;
  text-wrap:balance; background:linear-gradient(115deg,#ffffff 30%,#c9d2ff 68%,#8fd8ff);
  -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
.xc-t-aurora .xc-meta { margin-top:18px; display:flex; align-items:center; gap:9px; font-size:12.5px;
  color:#8d9ac2; letter-spacing:1px; padding-bottom:18px; border-bottom:1px solid rgba(255,255,255,.12); }
.xc-t-aurora .xc-meta-sep { color:rgba(232,236,250,.3); }
.xc-t-aurora .xc-cover { margin:26px 0 0; border-radius:14px; overflow:hidden; position:relative;
  border:1px solid rgba(255,255,255,.14); box-shadow:0 18px 48px rgba(0,0,0,.5); }
.xc-t-aurora .xc-cover-gen { aspect-ratio:21/9; position:relative; overflow:hidden;
  background:radial-gradient(130% 160% at 82% 0%,#1d2440 0%,#121628 48%,#0c0f1e 100%); }
.xc-t-aurora .xc-cover-gen::after { content:''; position:absolute; inset:0;
  background:radial-gradient(60% 90% at 85% 10%,rgba(124,92,255,.35),transparent 65%),radial-gradient(50% 80% at 10% 90%,rgba(34,211,238,.22),transparent 60%); }
.xc-t-aurora .xc-gen-ic { position:absolute; right:34px; top:50%; transform:translateY(-50%);
  color:rgba(143,216,255,.5); z-index:1; }
.xc-t-aurora .xc-ghost { position:absolute; left:24px; bottom:12px; font-size:100px; font-weight:800;
  background:linear-gradient(120deg,rgba(255,255,255,.2),rgba(124,92,255,.24));
  -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; white-space:nowrap; letter-spacing:6px; }
.xc-t-aurora .xc-lead { margin-top:30px; font-size:16px; line-height:1.9; color:rgba(235,240,252,.85); }
.xc-t-aurora .xc-lead::first-letter { font-size:46px; font-weight:700; color:#8fd8ff; }
.xc-t-aurora .xc-lead-plain::first-letter { font-size:inherit; font-weight:inherit; color:inherit; }
.xc-t-aurora .xc-sec { margin-top:34px; }
.xc-t-aurora .xc-sec-h { font-size:17px; font-weight:700; color:#aab6dd; letter-spacing:2.5px; gap:8px; }
.xc-t-aurora .xc-sec-h::after { content:''; flex:1; height:1px; margin-left:6px;
  background:linear-gradient(90deg,rgba(124,92,255,.55),rgba(34,211,238,.25),transparent); }
.xc-t-aurora .xc-sec-ic { color:#8f7bff; }
.xc-t-aurora .xc-steps { margin-top:16px; }
.xc-t-aurora .xc-step { position:relative; display:flex; gap:14px; padding:0 0 20px; }
.xc-t-aurora .xc-step:not(:last-child)::before { content:''; position:absolute; left:17px; top:38px; bottom:-2px;
  border-left:1px dashed rgba(124,92,255,.4); }
.xc-t-aurora .xc-step-n { flex:none; width:35px; height:35px; border-radius:50%; color:#9fe8ff;
  background:linear-gradient(rgba(20,24,44,.95),rgba(20,24,44,.95)) padding-box,linear-gradient(135deg,#7c5cff,#22d3ee) border-box;
  border:1px solid transparent; display:flex; align-items:center; justify-content:center; font-size:13px; letter-spacing:1px; }
.xc-t-aurora .xc-step-t { font-size:15.5px; font-weight:700; color:#f0f3ff; padding-top:6px; }
.xc-t-aurora .xc-step-d { margin-top:5px; font-size:14px; line-height:1.8; color:rgba(219,226,246,.72); }
.xc-t-aurora .xc-points { margin-top:16px; }
.xc-t-aurora .xc-point { display:flex; gap:13px; padding:11px 0; }
.xc-t-aurora .xc-point + .xc-point { border-top:1px dashed rgba(255,255,255,.1); }
.xc-t-aurora .xc-point-n { flex:none; font-size:14px; font-weight:700; letter-spacing:1px; padding-top:3px;
  background:linear-gradient(120deg,#a78bfa,#22d3ee); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
.xc-t-aurora .xc-point-t { font-size:15.5px; font-weight:700; color:#f0f3ff; }
.xc-t-aurora .xc-point-d { margin-top:4px; font-size:14px; line-height:1.8; color:rgba(219,226,246,.72); }
.xc-t-aurora .xc-stats { margin-top:16px; display:flex; gap:14px; }
.xc-t-aurora .xc-stat { flex:1; border-radius:12px; padding:18px 16px 15px; text-align:center;
  background:linear-gradient(180deg,rgba(255,255,255,.09),rgba(255,255,255,.03));
  border:1px solid rgba(255,255,255,.14); box-shadow:inset 0 1px 0 rgba(255,255,255,.08); }
.xc-t-aurora .xc-stat-v { font-size:29px; font-weight:700; letter-spacing:.5px;
  background:linear-gradient(120deg,#c4b5fd,#67e8f9); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
.xc-t-aurora .xc-stat-l { margin-top:6px; font-size:12.5px; color:#8d9ac2; letter-spacing:1px; }
.xc-t-aurora .xc-chips { margin-top:14px; display:flex; flex-wrap:wrap; gap:10px; }
.xc-t-aurora .xc-chip { padding:6px 15px; border-radius:999px; font-size:13.5px; color:#bcd8f5; letter-spacing:1px;
  border:1px solid transparent;
  background:linear-gradient(rgba(14,17,32,.92),rgba(14,17,32,.92)) padding-box,linear-gradient(90deg,rgba(124,92,255,.7),rgba(34,211,238,.55)) border-box; }
.xc-t-aurora .xc-counter { margin-top:14px; border-radius:0 12px 12px 0; padding:15px 18px;
  font-size:14px; line-height:1.85; color:#f3c6d4; background:rgba(251,113,133,.08); border-left:3px solid #fb7185; }
.xc-t-aurora .xc-sec-counter .xc-sec-h { color:#f0aebf; }
.xc-t-aurora .xc-sec-counter .xc-sec-ic { color:#fb7185; }
.xc-t-aurora .xc-quote { position:relative; margin-top:16px; padding:16px 18px 16px 44px; border-radius:12px;
  background:rgba(255,255,255,.045); border:1px solid rgba(255,255,255,.09); }
.xc-t-aurora .xc-quote + .xc-quote { margin-top:14px; }
.xc-t-aurora .xc-qmark { position:absolute; left:12px; top:4px; font-size:52px;
  background:linear-gradient(120deg,#a78bfa,#22d3ee); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
.xc-t-aurora .xc-quote p { font-size:16px; line-height:1.85; color:#eef2ff; font-weight:600; letter-spacing:.4px; }
.xc-t-aurora .xc-actions { margin-top:14px; }
.xc-t-aurora .xc-action { display:flex; align-items:flex-start; gap:11px; padding:8px 0; font-size:14.5px; line-height:1.75; color:rgba(235,240,252,.85); }
.xc-t-aurora .xc-action-box { flex:none; margin-top:4px; width:17px; height:17px; border-radius:5px; color:#67e8f9;
  background:linear-gradient(rgba(20,24,44,.95),rgba(20,24,44,.95)) padding-box,linear-gradient(135deg,#22d3ee,#7c5cff) border-box;
  border:1px solid transparent; display:flex; align-items:center; justify-content:center; }
.xc-t-aurora .xc-conclusion { margin-top:14px; border-radius:0 12px 12px 0; padding:16px 19px;
  font-size:15px; line-height:1.9; color:#dfe4ff; background:linear-gradient(90deg,rgba(124,92,255,.14),rgba(124,92,255,.04));
  border-left:3px solid #7c5cff; }
.xc-t-aurora .xc-prose-p { margin-top:14px; font-size:15px; line-height:1.9; color:rgba(235,240,252,.82); }
.xc-t-aurora .xc-foot { margin-top:40px; padding-top:20px; border-top:1px solid rgba(255,255,255,.12);
  display:flex; align-items:flex-end; justify-content:space-between; gap:20px; }
.xc-t-aurora .xc-qr-box { display:flex; align-items:center; gap:12px; }
.xc-t-aurora .xc-qr { width:86px; height:86px; padding:7px; background:#fff; border-radius:10px; }
.xc-t-aurora .xc-qr svg { width:72px; height:72px; }
.xc-t-aurora .xc-qr-cap { font-size:12px; color:#8d9ac2; letter-spacing:2px; writing-mode:vertical-rl; }
.xc-t-aurora .xc-foot-r { text-align:right; }
.xc-t-aurora .xc-brand { display:inline-flex; align-items:center; gap:7px; font-size:16px; font-weight:700; letter-spacing:1.5px;
  background:linear-gradient(115deg,#e8ecfa,#a78bfa 70%,#67e8f9); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
.xc-t-aurora .xc-brand svg { color:#8f7bff; -webkit-text-fill-color:#8f7bff; }
.xc-t-aurora .xc-brand-sub { margin-top:6px; font-size:11.5px; color:#8d9ac2; letter-spacing:2px; }
`,
  html(d, o) {
    return `
      <div class="xc-inner">
        ${heroOrHead(d, o, 'aurora', 3)}
        ${leadBlock(d)}
        ${stepsBlock(d)}
        ${chipsBlock(d)}
        ${statsBlock(d, o)}
        ${pointsBlock(d)}
        ${counterBlock(d)}
        ${quotesBlock(d)}
        ${actionsBlock(d)}
        ${conclusionBlock(d)}
        ${proseBlock(d)}
        ${footBlock(d, o)}
      </div>`;
  },
};

/* ================================================================ T8 晨雾（渐变晨雾 · 马卡龙色块） */
const MESH = {
  id: 'mesh',
  bg: '#f7f5fb',
  css: `
.xc-t-mesh {
  font-family:"Segoe UI","PingFang SC","HarmonyOS Sans SC","Microsoft YaHei",sans-serif;
  color:#2c2740; background:#ffffff; border-radius:20px; padding:52px 56px 44px;
  letter-spacing:.2px; box-shadow:0 24px 70px rgba(84,68,160,.14), 0 2px 8px rgba(84,68,160,.06);
}
.xc-t-mesh::before { content:''; position:absolute; left:0; right:0; top:0; height:300px; pointer-events:none;
  background:
    radial-gradient(340px 200px at 12% -30px, rgba(255,196,160,.5), transparent 70%),
    radial-gradient(380px 220px at 55% -60px, rgba(196,181,253,.42), transparent 72%),
    radial-gradient(340px 210px at 96% -20px, rgba(147,197,253,.42), transparent 70%),
    radial-gradient(260px 170px at 78% 60px, rgba(167,243,208,.32), transparent 70%); }
.xc-t-mesh .xc-inner { position:relative; }
.xc-t-mesh .xc-badgerow { display:flex; align-items:center; gap:9px; font-size:13px; color:#8b85a0; }
.xc-t-mesh .xc-badge { display:inline-flex; align-items:center; gap:5px; padding:4px 12px; border-radius:999px;
  background:linear-gradient(90deg,#efe9ff,#e0f2ff); color:#6d4fd4; font-size:12.5px; letter-spacing:2px; font-weight:600; }
.xc-t-mesh .xc-dot { color:rgba(44,39,64,.3); }
.xc-t-mesh .xc-title { margin-top:22px; font-size:34px; line-height:1.42; font-weight:800; letter-spacing:.3px;
  text-wrap:balance; color:#251f3d; }
.xc-t-mesh .xc-meta { margin-top:18px; display:flex; align-items:center; gap:9px; font-size:12.5px;
  color:#8b85a0; letter-spacing:1px; padding-bottom:18px; border-bottom:1px solid rgba(44,39,64,.1); }
.xc-t-mesh .xc-meta-sep { color:rgba(44,39,64,.3); }
.xc-t-mesh .xc-cover { margin:26px 0 0; border-radius:16px; overflow:hidden; position:relative;
  border:3px solid #fff; box-shadow:0 12px 34px rgba(84,68,160,.18); }
.xc-t-mesh .xc-cover-gen { aspect-ratio:21/9; position:relative; overflow:hidden;
  background:
    radial-gradient(300px 170px at 20% 10%, rgba(255,196,160,.65), transparent 70%),
    radial-gradient(340px 190px at 80% 20%, rgba(196,181,253,.6), transparent 72%),
    radial-gradient(300px 180px at 55% 100%, rgba(147,197,253,.55), transparent 70%), #fff; }
.xc-t-mesh .xc-gen-ic { position:absolute; right:34px; top:50%; transform:translateY(-50%); color:rgba(109,79,212,.45); }
.xc-t-mesh .xc-ghost { position:absolute; left:24px; bottom:12px; font-size:100px; font-weight:800;
  color:rgba(109,79,212,.14); white-space:nowrap; letter-spacing:6px; }
.xc-t-mesh .xc-lead { margin-top:30px; font-size:16px; line-height:1.9; color:#46405c; }
.xc-t-mesh .xc-lead::first-letter { float:left; font-size:46px; line-height:1; font-weight:800; color:#6d4fd4; padding:4px 9px 0 0; }
.xc-t-mesh .xc-lead-plain::first-letter { float:none !important; font-size:inherit !important; color:inherit !important; padding:0 !important; font-weight:inherit !important; }
.xc-t-mesh .xc-sec { margin-top:34px; }
.xc-t-mesh .xc-sec-h { font-size:17px; font-weight:800; color:#5b4aa8; letter-spacing:2.5px; gap:8px; }
.xc-t-mesh .xc-sec-h::after { content:''; flex:1; height:2px; margin-left:6px; border-radius:2px;
  background:linear-gradient(90deg,#c4b5fd,#93c5fd,transparent); }
.xc-t-mesh .xc-sec-ic { color:#7c66dd; }
.xc-t-mesh .xc-steps { margin-top:16px; }
.xc-t-mesh .xc-step { position:relative; display:flex; gap:14px; padding:0 0 20px; }
.xc-t-mesh .xc-step:not(:last-child)::before { content:''; position:absolute; left:17px; top:38px; bottom:-2px;
  border-left:2px dashed rgba(124,102,221,.35); }
.xc-t-mesh .xc-step-n { flex:none; width:35px; height:35px; border-radius:12px; background:linear-gradient(135deg,#efe9ff,#dbeafe);
  color:#5b4aa8; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:700; }
.xc-t-mesh .xc-step-t { font-size:15.5px; font-weight:700; color:#322b4d; padding-top:6px; }
.xc-t-mesh .xc-step-d { margin-top:5px; font-size:14px; line-height:1.8; color:#5f5975; }
.xc-t-mesh .xc-points { margin-top:16px; }
.xc-t-mesh .xc-point { display:flex; gap:13px; padding:11px 0; }
.xc-t-mesh .xc-point + .xc-point { border-top:1px dashed rgba(44,39,64,.12); }
.xc-t-mesh .xc-point-n { flex:none; font-size:14px; font-weight:800; color:#7c66dd; letter-spacing:1px; padding-top:3px; }
.xc-t-mesh .xc-point-t { font-size:15.5px; font-weight:700; color:#322b4d; }
.xc-t-mesh .xc-point-d { margin-top:4px; font-size:14px; line-height:1.8; color:#5f5975; }
.xc-t-mesh .xc-stats { margin-top:16px; display:flex; gap:14px; }
.xc-t-mesh .xc-stat { flex:1; border-radius:14px; padding:18px 16px 15px; text-align:center; }
.xc-t-mesh .xc-stat:nth-child(4n + 1) { background:#ffe9dd; } .xc-t-mesh .xc-stat:nth-child(4n + 1) .xc-stat-v { color:#b4552d; }
.xc-t-mesh .xc-stat:nth-child(4n + 2) { background:#e9e3ff; } .xc-t-mesh .xc-stat:nth-child(4n + 2) .xc-stat-v { color:#5b46b4; }
.xc-t-mesh .xc-stat:nth-child(4n + 3) { background:#ddeeff; } .xc-t-mesh .xc-stat:nth-child(4n + 3) .xc-stat-v { color:#1f6fa8; }
.xc-t-mesh .xc-stat:nth-child(4n + 4) { background:#ddf3e7; } .xc-t-mesh .xc-stat:nth-child(4n + 4) .xc-stat-v { color:#1f7a52; }
.xc-t-mesh .xc-stat-v { font-size:29px; font-weight:800; letter-spacing:.5px; }
.xc-t-mesh .xc-stat-l { margin-top:6px; font-size:12.5px; color:#6f6a80; letter-spacing:1px; }
.xc-t-mesh .xc-chips { margin-top:14px; display:flex; flex-wrap:wrap; gap:10px; }
.xc-t-mesh .xc-chip { padding:7px 16px; border-radius:999px; font-size:13.5px; font-weight:600; letter-spacing:1px; }
.xc-t-mesh .xc-chip:nth-child(4n + 1) { background:#ffe9dd; color:#a04a22; }
.xc-t-mesh .xc-chip:nth-child(4n + 2) { background:#e9e3ff; color:#5b46b4; }
.xc-t-mesh .xc-chip:nth-child(4n + 3) { background:#ddeeff; color:#1c6394; }
.xc-t-mesh .xc-chip:nth-child(4n + 4) { background:#ddf3e7; color:#1c6b47; }
.xc-t-mesh .xc-counter { margin-top:14px; border-radius:14px; padding:15px 18px; font-size:14px; line-height:1.85;
  color:#9a4a26; background:#fff1e8; border-left:4px solid #f59e6b; }
.xc-t-mesh .xc-sec-counter .xc-sec-h { color:#b4552d; }
.xc-t-mesh .xc-sec-counter .xc-sec-ic { color:#ef7d43; }
.xc-t-mesh .xc-quote { position:relative; margin-top:16px; padding:18px 20px 18px 52px; border-radius:16px; background:#f1edff; }
.xc-t-mesh .xc-quote + .xc-quote { margin-top:14px; }
.xc-t-mesh .xc-qmark { position:absolute; left:14px; top:8px; font-size:52px; color:#8b74e8; }
.xc-t-mesh .xc-quote p { font-size:16px; line-height:1.85; color:#37305a; font-weight:700; letter-spacing:.4px; }
.xc-t-mesh .xc-actions { margin-top:14px; }
.xc-t-mesh .xc-action { display:flex; align-items:flex-start; gap:11px; padding:8px 0; font-size:14.5px; line-height:1.75; color:#46405c; }
.xc-t-mesh .xc-action-box { flex:none; margin-top:4px; width:18px; height:18px; border-radius:6px;
  background:linear-gradient(135deg,#7c66dd,#5b9dd4); color:#fff; display:flex; align-items:center; justify-content:center; }
.xc-t-mesh .xc-conclusion { margin-top:14px; border-radius:14px; padding:17px 19px; font-size:15px; line-height:1.9;
  color:#3d3564; border:1.5px solid transparent;
  background:linear-gradient(#fbfaff,#fbfaff) padding-box,linear-gradient(90deg,#c4b5fd,#f9c39a,#93c5fd) border-box; }
.xc-t-mesh .xc-prose-p { margin-top:14px; font-size:15px; line-height:1.9; color:#46405c; }
.xc-t-mesh .xc-foot { margin-top:40px; padding-top:20px; border-top:1px solid rgba(44,39,64,.12);
  display:flex; align-items:flex-end; justify-content:space-between; gap:20px; }
.xc-t-mesh .xc-qr-box { display:flex; align-items:center; gap:12px; }
.xc-t-mesh .xc-qr { width:86px; height:86px; padding:7px; background:#fff; border-radius:12px; border:1px solid rgba(44,39,64,.12); }
.xc-t-mesh .xc-qr svg { width:72px; height:72px; }
.xc-t-mesh .xc-qr-cap { font-size:12px; color:#8b85a0; letter-spacing:2px; writing-mode:vertical-rl; }
.xc-t-mesh .xc-foot-r { text-align:right; }
.xc-t-mesh .xc-brand { display:inline-flex; align-items:center; gap:7px; font-size:16px; font-weight:800; letter-spacing:1.5px; color:#4c3f8f; }
.xc-t-mesh .xc-brand svg { color:#7c66dd; }
.xc-t-mesh .xc-brand-sub { margin-top:6px; font-size:11.5px; color:#8b85a0; letter-spacing:2px; }
`,
  html(d, o) {
    return `
      <div class="xc-inner">
        ${heroOrHead(d, o, 'mesh', 3)}
        ${leadBlock(d)}
        ${stepsBlock(d)}
        ${chipsBlock(d)}
        ${statsBlock(d, o)}
        ${pointsBlock(d)}
        ${counterBlock(d)}
        ${quotesBlock(d)}
        ${actionsBlock(d)}
        ${conclusionBlock(d)}
        ${proseBlock(d)}
        ${footBlock(d, o)}
      </div>`;
  },
};

/* ================================================================ T9 蓝图（工程蓝晒 · 制图美学） */
const BLUE = {
  id: 'blue',
  bg: '#10304f',
  css: `
.xc-t-blue {
  font-family:"Segoe UI","PingFang SC","HarmonyOS Sans SC","Microsoft YaHei",sans-serif;
  color:#dcebf7; background:
    repeating-linear-gradient(0deg, rgba(255,255,255,.045) 0 1px, transparent 1px 26px),
    repeating-linear-gradient(90deg, rgba(255,255,255,.045) 0 1px, transparent 1px 26px),
    linear-gradient(180deg,#123655 0%,#10304f 40%,#0d2943 100%);
  padding:52px 56px 44px; letter-spacing:.3px;
}
.xc-t-blue::before { content:''; position:absolute; inset:14px; pointer-events:none;
  border:1.5px solid rgba(255,255,255,.32); }
.xc-t-blue::after { content:'ROBINREAD · ENGINEERING NOTES'; position:absolute; right:26px; top:26px;
  font-family:Consolas,"Courier New",monospace; font-size:10.5px; letter-spacing:3px; color:rgba(255,255,255,.5); }
.xc-t-blue .xc-inner { padding:0 6px; }
.xc-t-blue .xc-badgerow { display:flex; align-items:center; gap:9px; font-size:13px; color:#9cc0dc; }
.xc-t-blue .xc-badge { display:inline-flex; align-items:center; gap:6px; padding:4px 12px;
  border:1.5px solid rgba(255,255,255,.55); color:#fff; font-size:12.5px; letter-spacing:2.5px;
  font-family:Consolas,"Courier New",monospace; }
.xc-t-blue .xc-dot { color:rgba(220,235,247,.4); }
.xc-t-blue .xc-title { margin-top:22px; font-size:33px; line-height:1.42; font-weight:700; letter-spacing:.8px;
  text-wrap:balance; color:#fff; padding-bottom:14px; border-bottom:1px dashed rgba(255,255,255,.4); }
.xc-t-blue .xc-meta { margin-top:16px; display:flex; align-items:center; gap:10px; font-size:12.5px;
  color:#9cc0dc; letter-spacing:1px; font-family:Consolas,"Courier New",monospace; }
.xc-t-blue .xc-meta-sep { color:rgba(220,235,247,.4); }
.xc-t-blue .xc-cover { margin:26px 0 0; border:1.5px solid rgba(255,255,255,.55); outline:1px solid rgba(255,255,255,.25);
  outline-offset:5px; overflow:hidden; position:relative; }
.xc-t-blue .xc-cover-gen { aspect-ratio:21/9; position:relative; overflow:hidden;
  background:repeating-linear-gradient(45deg, rgba(255,255,255,.06) 0 10px, transparent 10px 22px), #14395c; }
.xc-t-blue .xc-gen-ic { position:absolute; right:34px; top:50%; transform:translateY(-50%); color:rgba(255,255,255,.55); }
.xc-t-blue .xc-ghost { position:absolute; left:24px; bottom:10px; font-size:96px; font-weight:700;
  color:rgba(255,255,255,.12); white-space:nowrap; letter-spacing:6px;
  font-family:Consolas,"Courier New",monospace; }
.xc-t-blue .xc-lead { margin-top:30px; font-size:16px; line-height:1.9; color:#cfe4f4; }
.xc-t-blue .xc-lead::first-letter { font-size:44px; font-weight:700; color:#8fd0ff; }
.xc-t-blue .xc-lead-plain::first-letter { font-size:inherit; font-weight:inherit; color:inherit; }
.xc-t-blue .xc-sec { margin-top:34px; }
.xc-t-blue .xc-sec-h { font-size:16px; font-weight:700; color:#fff; letter-spacing:3px; gap:9px;
  font-family:Consolas,"Courier New",monospace; }
.xc-t-blue .xc-sec-h::after { content:''; flex:1; margin-left:8px; border-top:1px dashed rgba(255,255,255,.4); }
.xc-t-blue .xc-sec-ic { color:#8fd0ff; }
.xc-t-blue .xc-steps { margin-top:16px; }
.xc-t-blue .xc-step { position:relative; display:flex; gap:14px; padding:0 0 20px; }
.xc-t-blue .xc-step:not(:last-child)::before { content:''; position:absolute; left:17px; top:36px; bottom:-2px;
  border-left:1px dashed rgba(255,255,255,.4); }
.xc-t-blue .xc-step-n { flex:none; width:35px; height:35px; border:1.5px solid rgba(255,255,255,.6); color:#8fd0ff;
  background:rgba(255,255,255,.06); display:flex; align-items:center; justify-content:center;
  font-size:13px; letter-spacing:1px; font-family:Consolas,"Courier New",monospace; }
.xc-t-blue .xc-step-t { font-size:15.5px; font-weight:700; color:#fff; padding-top:6px; }
.xc-t-blue .xc-step-d { margin-top:5px; font-size:14px; line-height:1.8; color:#b7d4ea; }
.xc-t-blue .xc-points { margin-top:16px; }
.xc-t-blue .xc-point { display:flex; gap:13px; padding:11px 0; }
.xc-t-blue .xc-point + .xc-point { border-top:1px dashed rgba(255,255,255,.22); }
.xc-t-blue .xc-point-n { flex:none; font-size:14px; color:#8fd0ff; font-weight:700; letter-spacing:1px; padding-top:3px;
  font-family:Consolas,"Courier New",monospace; }
.xc-t-blue .xc-point-t { font-size:15.5px; font-weight:700; color:#fff; }
.xc-t-blue .xc-point-d { margin-top:4px; font-size:14px; line-height:1.8; color:#b7d4ea; }
.xc-t-blue .xc-stats { margin-top:18px; display:flex; gap:18px; }
.xc-t-blue .xc-stat { flex:1; background:rgba(255,255,255,.05); outline:1.5px solid rgba(255,255,255,.55);
  outline-offset:4px; padding:18px 16px 15px; text-align:center; }
.xc-t-blue .xc-stat-v { font-size:29px; font-weight:700; color:#fff; letter-spacing:.5px;
  font-family:Consolas,"Courier New",monospace; }
.xc-t-blue .xc-stat-l { margin-top:8px; font-size:12px; color:#9cc0dc; letter-spacing:1.5px;
  font-family:Consolas,"Courier New",monospace; }
.xc-t-blue .xc-chips { margin-top:16px; display:flex; flex-wrap:wrap; gap:11px; }
.xc-t-blue .xc-chip { padding:6px 14px; border:1.5px dashed rgba(255,255,255,.55); font-size:13px;
  color:#dcebf7; letter-spacing:1.5px; font-family:Consolas,"Courier New",monospace; }
.xc-t-blue .xc-counter { margin-top:14px; padding:15px 18px; font-size:14px; line-height:1.85; color:#ffd9c2;
  background:rgba(255,255,255,.05); border-left:3px solid #ffab7e; }
.xc-t-blue .xc-sec-counter .xc-sec-h { color:#ffcfb2; }
.xc-t-blue .xc-sec-counter .xc-sec-ic { color:#ffab7e; }
.xc-t-blue .xc-quote { position:relative; margin-top:16px; padding:6px 0 6px 22px; border-left:3px solid #8fd0ff; }
.xc-t-blue .xc-quote + .xc-quote { margin-top:20px; }
.xc-t-blue .xc-qmark { display:none; }
.xc-t-blue .xc-quote p { font-size:16px; line-height:1.85; color:#fff; font-weight:600; letter-spacing:.4px; }
.xc-t-blue .xc-actions { margin-top:14px; }
.xc-t-blue .xc-action { display:flex; align-items:flex-start; gap:11px; padding:8px 0; font-size:14.5px; line-height:1.75; color:#cfe4f4; }
.xc-t-blue .xc-action-box { flex:none; margin-top:4px; width:17px; height:17px; border:1.5px solid #8fd0ff;
  color:#8fd0ff; display:flex; align-items:center; justify-content:center; }
.xc-t-blue .xc-conclusion { margin-top:14px; padding:16px 19px; font-size:15px; line-height:1.9; color:#eaf5ff;
  background:rgba(143,208,255,.1); border:1px solid rgba(143,208,255,.4); }
.xc-t-blue .xc-prose-p { margin-top:14px; font-size:15px; line-height:1.9; color:#cfe4f4; }
.xc-t-blue .xc-foot { margin-top:40px; padding-top:20px; border-top:3px double rgba(255,255,255,.45);
  display:flex; align-items:flex-end; justify-content:space-between; gap:20px; }
.xc-t-blue .xc-qr-box { display:flex; align-items:center; gap:12px; }
.xc-t-blue .xc-qr { width:86px; height:86px; padding:7px; background:#fff; }
.xc-t-blue .xc-qr svg { width:72px; height:72px; }
.xc-t-blue .xc-qr-cap { font-size:12px; color:#9cc0dc; letter-spacing:2px; writing-mode:vertical-rl; }
.xc-t-blue .xc-foot-r { text-align:right; }
.xc-t-blue .xc-brand { display:inline-flex; align-items:center; gap:7px; font-size:15px; font-weight:700;
  color:#fff; letter-spacing:2.5px; font-family:Consolas,"Courier New",monospace; }
.xc-t-blue .xc-brand svg { color:#8fd0ff; }
.xc-t-blue .xc-brand-sub { margin-top:6px; font-size:11.5px; color:#9cc0dc; letter-spacing:2px;
  font-family:Consolas,"Courier New",monospace; }
`,
  html(d, o) {
    return `
      <div class="xc-inner">
        ${heroOrHead(d, o, 'blue', 3)}
        ${leadBlock(d)}
        ${stepsBlock(d)}
        ${chipsBlock(d)}
        ${statsBlock(d, o)}
        ${pointsBlock(d)}
        ${counterBlock(d)}
        ${quotesBlock(d)}
        ${actionsBlock(d)}
        ${conclusionBlock(d)}
        ${proseBlock(d)}
        ${footBlock(d, o)}
      </div>`;
  },
};

/* ================================================================ T10 青瓷（青瓷釉色 · 印章朱砂） */
const JADE = {
  id: 'jade',
  bg: '#edf2ec',
  css: `
.xc-t-jade {
  font-family:"Source Han Serif SC","Noto Serif SC","Songti SC","STSong",SimSun,Georgia,serif;
  color:#25382f; background:linear-gradient(180deg,#f1f6f0 0%,#edf2ec 40%,#e6eee6 100%);
  padding:52px 56px 44px; letter-spacing:.4px;
}
.xc-t-jade::before { content:''; position:absolute; right:-90px; top:-70px; width:300px; height:300px;
  border:2px solid rgba(31,93,80,.14); border-radius:50%; }
.xc-t-jade::after { content:''; position:absolute; right:-60px; top:-40px; width:240px; height:240px;
  border:1px solid rgba(31,93,80,.1); border-radius:50%; }
.xc-t-jade .xc-badgerow { display:flex; align-items:center; gap:9px; font-size:13px; color:#6f8279; }
.xc-t-jade .xc-badge { display:inline-flex; align-items:center; gap:5px; padding:4px 12px; border-radius:4px;
  background:#1f5d50; color:#eef5f0; font-size:12.5px; letter-spacing:3px; }
.xc-t-jade .xc-dot { color:rgba(37,56,47,.35); }
.xc-t-jade .xc-title { margin-top:22px; font-size:34px; line-height:1.45; font-weight:700; letter-spacing:1px;
  text-wrap:balance; color:#1d3a33; }
.xc-t-jade .xc-meta { margin-top:18px; display:flex; align-items:center; gap:9px; font-size:12.5px;
  color:#6f8279; letter-spacing:1px; padding-bottom:18px; border-bottom:1px solid rgba(31,93,80,.28); }
.xc-t-jade .xc-meta-sep { color:rgba(37,56,47,.3); }
.xc-t-jade .xc-cover { margin:26px 0 0; border-radius:6px; overflow:hidden; position:relative;
  border:1px solid rgba(31,93,80,.3); box-shadow:0 8px 26px rgba(31,61,52,.14); }
.xc-t-jade .xc-cover-gen { aspect-ratio:21/9; position:relative; overflow:hidden;
  background:radial-gradient(120% 150% at 80% 0%,#dfe9dd 0%,#ccdbd2 48%,#adc2b4 100%); }
.xc-t-jade .xc-gen-ic { position:absolute; right:34px; top:50%; transform:translateY(-50%); color:rgba(31,93,80,.4); }
.xc-t-jade .xc-ghost { position:absolute; left:22px; bottom:12px; font-size:100px; font-weight:700;
  color:rgba(31,93,80,.13); white-space:nowrap; letter-spacing:6px; }
.xc-t-jade .xc-lead { margin-top:30px; font-size:16.5px; line-height:1.95; color:#3a4c42; }
.xc-t-jade .xc-lead::first-letter { float:left; font-size:50px; line-height:.95; font-weight:700; color:#1f5d50; padding:6px 10px 0 0; }
.xc-t-jade .xc-lead-plain::first-letter { float:none !important; font-size:inherit !important; color:inherit !important; padding:0 !important; font-weight:inherit !important; }
.xc-t-jade .xc-sec { margin-top:34px; }
.xc-t-jade .xc-sec-h { font-size:18px; font-weight:700; color:#1f5d50; letter-spacing:2.5px; gap:8px; }
.xc-t-jade .xc-sec-h::after { content:''; flex:1; height:1px; margin-left:6px;
  background:linear-gradient(90deg,rgba(31,93,80,.45),rgba(31,93,80,0)); }
.xc-t-jade .xc-sec-ic { color:#2c7263; }
.xc-t-jade .xc-steps { margin-top:16px; }
.xc-t-jade .xc-step { position:relative; display:flex; gap:14px; padding:0 0 20px; }
.xc-t-jade .xc-step:not(:last-child)::before { content:''; position:absolute; left:17px; top:36px; bottom:-2px;
  border-left:1px dashed rgba(31,93,80,.45); }
.xc-t-jade .xc-step-n { flex:none; width:35px; height:35px; border-radius:4px; border:1px solid rgba(31,93,80,.55);
  color:#1f5d50; background:#f7faf6; display:flex; align-items:center; justify-content:center;
  font-size:13px; letter-spacing:1px; }
.xc-t-jade .xc-step-t { font-size:15.5px; font-weight:700; color:#25423a; padding-top:6px; }
.xc-t-jade .xc-step-d { margin-top:5px; font-size:14px; line-height:1.85; color:#54685e; }
.xc-t-jade .xc-points { margin-top:16px; }
.xc-t-jade .xc-point { display:flex; gap:13px; padding:11px 0; }
.xc-t-jade .xc-point + .xc-point { border-top:1px dashed rgba(31,93,80,.3); }
.xc-t-jade .xc-point-n { flex:none; font-size:14px; color:#2c7263; font-weight:700; letter-spacing:1px; padding-top:3px; }
.xc-t-jade .xc-point-t { font-size:15.5px; font-weight:700; color:#25423a; }
.xc-t-jade .xc-point-d { margin-top:4px; font-size:14px; line-height:1.85; color:#54685e; }
.xc-t-jade .xc-stats { margin-top:16px; display:flex; gap:14px; }
.xc-t-jade .xc-stat { flex:1; position:relative; background:#fbfdfa; border:1px solid rgba(31,93,80,.28);
  border-radius:6px; padding:20px 16px 15px; text-align:center; }
.xc-t-jade .xc-stat::before { content:''; position:absolute; top:9px; left:50%; transform:translateX(-50%);
  width:14px; height:14px; background:#c34a2f; border-radius:3px; opacity:.85; }
.xc-t-jade .xc-stat-v { font-size:29px; font-weight:700; color:#1f5d50; letter-spacing:.5px; }
.xc-t-jade .xc-stat-l { margin-top:6px; font-size:12.5px; color:#6f8279; letter-spacing:1px; }
.xc-t-jade .xc-chips { margin-top:14px; display:flex; flex-wrap:wrap; gap:10px; }
.xc-t-jade .xc-chip { padding:6px 15px; border:1px solid rgba(31,93,80,.5); border-radius:4px;
  font-size:13.5px; color:#275449; background:rgba(31,93,80,.05); letter-spacing:1px; }
.xc-t-jade .xc-chip::before { content:''; display:inline-block; width:6px; height:6px; border-radius:1px;
  background:#c34a2f; margin-right:8px; vertical-align:1px; opacity:.85; }
.xc-t-jade .xc-counter { margin-top:14px; background:#f8ebe4; border-left:3px solid #c34a2f;
  border-radius:0 6px 6px 0; padding:15px 18px; font-size:14px; line-height:1.9; color:#77452e; }
.xc-t-jade .xc-sec-counter .xc-sec-h { color:#9a4a30; }
.xc-t-jade .xc-sec-counter .xc-sec-ic { color:#c34a2f; }
.xc-t-jade .xc-quote { position:relative; margin-top:16px; padding:6px 0 6px 40px; }
.xc-t-jade .xc-quote + .xc-quote { margin-top:22px; }
.xc-t-jade .xc-qmark { position:absolute; left:0; top:-8px; font-size:56px; color:rgba(31,93,80,.55); }
.xc-t-jade .xc-quote p { font-size:16.5px; line-height:1.9; color:#2a473d; font-weight:700; letter-spacing:.4px; }
.xc-t-jade .xc-actions { margin-top:14px; }
.xc-t-jade .xc-action { display:flex; align-items:flex-start; gap:11px; padding:8px 0; font-size:14.5px; line-height:1.8; color:#3a4c42; }
.xc-t-jade .xc-action-box { flex:none; margin-top:4px; width:17px; height:17px; border-radius:4px;
  border:1.5px solid #1f5d50; color:#1f5d50; display:flex; align-items:center; justify-content:center; }
.xc-t-jade .xc-conclusion { margin-top:14px; background:#1f5d50; color:#eef5f0;
  border-radius:6px; padding:18px 21px; font-size:15px; line-height:1.95; }
.xc-t-jade .xc-sec-conclusion .xc-sec-h { color:#eef5f0; }
.xc-t-jade .xc-sec-conclusion .xc-sec-ic { color:#9cc8ba; }
.xc-t-jade .xc-sec-conclusion { background:#1f5d50; margin:34px 0 0; padding:18px 20px 20px; border-radius:6px; }
.xc-t-jade .xc-sec-conclusion .xc-conclusion { margin-top:10px; background:transparent; color:#dcebe3; padding:0; }
.xc-t-jade .xc-sec-conclusion .xc-sec-h::after { background:linear-gradient(90deg,rgba(238,245,240,.4),transparent); }
.xc-t-jade .xc-prose-p { margin-top:14px; font-size:15px; line-height:1.95; color:#3a4c42; }
.xc-t-jade .xc-foot { margin-top:40px; padding-top:20px; border-top:3px double rgba(31,93,80,.4);
  display:flex; align-items:flex-end; justify-content:space-between; gap:20px; }
.xc-t-jade .xc-qr-box { display:flex; align-items:center; gap:12px; }
.xc-t-jade .xc-qr { width:86px; height:86px; padding:7px; background:#fff; border-radius:4px;
  border:1px solid rgba(31,93,80,.3); }
.xc-t-jade .xc-qr svg { width:72px; height:72px; }
.xc-t-jade .xc-qr-cap { font-size:12px; color:#6f8279; letter-spacing:2px; writing-mode:vertical-rl; }
.xc-t-jade .xc-foot-r { text-align:right; }
.xc-t-jade .xc-brand { display:inline-flex; align-items:center; gap:8px; font-size:16px; font-weight:700;
  color:#1f5d50; letter-spacing:1.5px; }
.xc-t-jade .xc-brand::after { content:''; width:12px; height:12px; background:#c34a2f; border-radius:2px; opacity:.85; }
.xc-t-jade .xc-brand svg { color:#2c7263; }
.xc-t-jade .xc-brand-sub { margin-top:6px; font-size:11.5px; color:#6f8279; letter-spacing:2px; }
`,
  html(d, o) {
    return `
      <div class="xc-inner">
        ${heroOrHead(d, o, 'jade', 3)}
        ${leadBlock(d)}
        ${stepsBlock(d)}
        ${chipsBlock(d)}
        ${statsBlock(d, o)}
        ${pointsBlock(d)}
        ${counterBlock(d)}
        ${quotesBlock(d)}
        ${actionsBlock(d)}
        ${conclusionBlock(d)}
        ${proseBlock(d)}
        ${footBlock(d, o)}
      </div>`;
  },
};

/* ---------------------------------------------------------------- 出口 */

const TEMPLATE_MAP = { paper: PAPER, ink: INK, mag: MAG, note: NOTE, min: MIN, news: NEWS, aurora: AURORA, mesh: MESH, blue: BLUE, jade: JADE };

/* 现有六款的色块/配色升级层：以同优先级追加规则在级联中覆盖原样式（隔离于原 CSS，便于回退）。 */
const TEMPLATE_UPGRADES = {
  paper: `
/* hero 封面（有图时）：全出血 + 白衬线标题压图 */
.xc-t-paper .xc-hero { height:480px; margin:-52px -56px 34px; }
.xc-t-paper .xc-hero-scrim { background:linear-gradient(180deg,rgba(24,30,20,.22) 0%,rgba(22,28,18,.05) 36%,rgba(13,18,11,.84) 100%); }
.xc-t-paper .xc-hero-title { color:#fff; text-shadow:0 2px 20px rgba(0,0,0,.5); letter-spacing:.5px; }
.xc-t-paper .xc-hero-badge { background:#617357; color:#f4f6ef; }
.xc-t-paper .xc-hero-feed { color:rgba(255,255,255,.88); }
.xc-t-paper .xc-hero-meta { color:rgba(255,255,255,.82); }
.xc-t-paper .xc-title { background:linear-gradient(transparent 86%, rgba(163,87,61,.18) 86%); }
.xc-t-paper .xc-stat { background:linear-gradient(180deg,rgba(97,115,87,.1),rgba(97,115,87,.04)); border-color:rgba(97,115,87,.3); position:relative; overflow:hidden; }
.xc-t-paper .xc-stat::before { content:''; position:absolute; top:0; left:0; right:0; height:3px; background:linear-gradient(90deg,#617357,#8a9a7c); }
.xc-t-paper .xc-stat:nth-child(2)::before { background:linear-gradient(90deg,#a3573d,#c98a4b); }
.xc-t-paper .xc-stat:nth-child(3)::before { background:linear-gradient(90deg,#8a9a7c,#617357); }
.xc-t-paper .xc-stat-v { background:linear-gradient(135deg,#55654b,#a3573d); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
.xc-t-paper .xc-chip::before { content:''; display:inline-block; width:6px; height:6px; border-radius:50%; background:#a3573d; margin-right:8px; vertical-align:1px; opacity:.85; }
.xc-t-paper .xc-quote { background:rgba(97,115,87,.06); border-radius:10px; padding:14px 16px 14px 40px; }
.xc-t-paper .xc-quote p { background:linear-gradient(transparent 82%, rgba(163,87,61,.16) 82%); }
.xc-t-paper .xc-conclusion { background:linear-gradient(90deg,rgba(97,115,87,.12),rgba(97,115,87,.04)); }
.xc-t-paper .xc-counter { background:linear-gradient(90deg,#f5e6d8,#f3ead6); }
/* gen 封面：纸纹+虚线内框+巨型鬼影字 */
.xc-t-paper .xc-cover-gen::before { content:''; position:absolute; inset:10px; border:1px dashed rgba(97,115,87,.4); }
.xc-t-paper .xc-cover-gen::after { content:''; position:absolute; inset:0; background: radial-gradient(80% 100% at 88% 12%, rgba(163,87,61,.16), transparent 60%); }
.xc-t-paper .xc-ghost { font-size:130px; left:18px; bottom:2px; opacity:.85; }
`,
  mesh: `
/* hero 封面：全出血 + 暮色蒙版 */
.xc-t-mesh .xc-hero { height:470px; margin:-52px -56px 34px; }
.xc-t-mesh .xc-hero-scrim { background:linear-gradient(180deg,rgba(30,24,50,.16) 0%,rgba(30,24,50,.04) 38%,rgba(20,16,40,.8) 100%); }
.xc-t-mesh .xc-hero-title { color:#fff; text-shadow:0 2px 20px rgba(20,16,40,.55); }
.xc-t-mesh .xc-hero-badge { background:linear-gradient(90deg,#7c66dd,#5b9dd4); color:#fff; }
.xc-t-mesh .xc-hero-feed { color:rgba(255,255,255,.9); }
.xc-t-mesh .xc-hero-meta { color:rgba(255,255,255,.85); }
/* gen 封面：晨雾斑点放大 + 描边鬼影 */
.xc-t-mesh .xc-cover-gen::before { content:''; position:absolute; inset:0; background: radial-gradient(240px 140px at 82% 20%, rgba(147,197,253,.5), transparent 70%), radial-gradient(220px 130px at 12% 85%, rgba(255,196,160,.5), transparent 70%); }
.xc-t-mesh .xc-ghost { font-size:130px; -webkit-text-stroke:2px rgba(109,79,212,.4); -webkit-text-fill-color:transparent; left:18px; bottom:6px; }
`,
  aurora: `
/* hero 封面：全出血 + 暗夜蒙版，标题保持渐变但上压图时改纯白保证可读 */
.xc-t-aurora .xc-hero { height:480px; margin:-52px -56px 34px; }
.xc-t-aurora .xc-hero-scrim { background:linear-gradient(180deg,rgba(8,10,20,.3) 0%,rgba(8,10,20,.06) 36%,rgba(6,8,16,.86) 100%); }
.xc-t-aurora .xc-hero-title { color:#fff; -webkit-text-fill-color:#fff; text-shadow:0 2px 22px rgba(0,0,0,.6); }
.xc-t-aurora .xc-hero-badge { border:1px solid transparent; color:#c0b2ff;
  background:linear-gradient(rgba(16,19,36,.92),rgba(16,19,36,.92)) padding-box,linear-gradient(90deg,#7c5cff,#22d3ee) border-box; }
.xc-t-aurora .xc-hero-feed { color:rgba(232,236,250,.85); }
.xc-t-aurora .xc-hero-meta { color:rgba(232,236,250,.8); }
/* gen 封面：极光带 + 渐变描边鬼影 */
.xc-t-aurora .xc-cover-gen::before { content:''; position:absolute; left:-10%; right:-10%; top:38%; height:2px; background:linear-gradient(90deg,transparent,rgba(124,92,255,.8),rgba(34,211,238,.8),transparent); filter:blur(1px); transform:rotate(-4deg); }
.xc-t-aurora .xc-ghost { font-size:126px; -webkit-text-stroke:2px rgba(143,216,255,.5); -webkit-text-fill-color:transparent; left:20px; bottom:8px; }
`,
  ink: `
.xc-t-ink .xc-title { background:linear-gradient(115deg,#ffffff 40%,#b9c8ff 75%,#8fd8ff); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
.xc-t-ink .xc-stat { background:linear-gradient(180deg,rgba(255,255,255,.09),rgba(255,255,255,.03)); border:1px solid rgba(255,255,255,.16); position:relative; overflow:hidden; }
.xc-t-ink .xc-stat::before { content:''; position:absolute; top:0; left:0; right:0; height:3px; background:linear-gradient(90deg,#7c5cff,#22d3ee); }
.xc-t-ink .xc-stat:nth-child(2)::before { background:linear-gradient(90deg,#22d3ee,#34d399); }
.xc-t-ink .xc-stat:nth-child(3)::before { background:linear-gradient(90deg,#fb7185,#f59e0b); }
.xc-t-ink .xc-stat-v { background:linear-gradient(120deg,#c4b5fd,#67e8f9); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
.xc-t-ink .xc-chip { border:1px solid transparent; background:linear-gradient(rgba(22,26,38,.92),rgba(22,26,38,.92)) padding-box,linear-gradient(90deg,rgba(124,92,255,.65),rgba(34,211,238,.5)) border-box; }
.xc-t-ink .xc-quote { background:rgba(255,255,255,.05); border-radius:12px; padding:14px 16px 14px 44px; }
.xc-t-ink .xc-conclusion { background:linear-gradient(90deg,rgba(124,92,255,.16),rgba(124,92,255,.04)); }
/* ink hero：暗夜蒙版 + 玻璃徽标 */
.xc-t-ink .xc-hero { height:490px; margin:-56px -56px 34px; }
.xc-t-ink .xc-hero-scrim { background:linear-gradient(180deg,rgba(8,9,14,.34) 0%,rgba(8,9,14,.08) 36%,rgba(5,6,10,.88) 100%); }
.xc-t-ink .xc-hero-title { color:#fff; -webkit-text-fill-color:#fff; text-shadow:0 2px 22px rgba(0,0,0,.65); }
.xc-t-ink .xc-hero-badge { border:1px solid transparent; color:#c0b2ff; background:linear-gradient(rgba(16,19,36,.92),rgba(16,19,36,.92)) padding-box,linear-gradient(90deg,#7c5cff,#22d3ee) border-box; }
.xc-t-ink .xc-hero-feed { color:rgba(232,236,250,.85); }
.xc-t-ink .xc-hero-meta { color:rgba(232,236,250,.8); }
/* gen 封面：暗夜网格 + 空心鬼影 + 光晕 */
.xc-t-ink .xc-cover-gen { background: repeating-linear-gradient(0deg, rgba(255,255,255,.04) 0 1px, transparent 1px 28px), repeating-linear-gradient(90deg, rgba(255,255,255,.04) 0 1px, transparent 1px 28px), radial-gradient(100% 130% at 80% 10%, #1a2138 0%, #0d101f 60%); }
.xc-t-ink .xc-cover-gen::after { content:''; position:absolute; right:26px; top:20px; width:90px; height:90px; border-radius:50%; background:radial-gradient(closest-side, rgba(124,92,255,.4), transparent 72%); filter:blur(6px); }
.xc-t-ink .xc-ghost { font-size:130px; -webkit-text-stroke:2px rgba(255,255,255,.34); -webkit-text-fill-color:transparent; left:22px; bottom:6px; }
`,
  mag: `
.xc-t-mag .xc-cols .xc-sec { break-inside: avoid; }
.xc-t-mag .xc-title { background:linear-gradient(transparent 78%, #e0301e 78%, #e0301e 90%, transparent 90%); }
.xc-t-mag .xc-stat { background:#141414; border:none; padding:16px 14px 14px; }
.xc-t-mag .xc-stat:nth-child(2) { background:#e0301e; }
.xc-t-mag .xc-stat-v { color:#fff; }
.xc-t-mag .xc-stat:nth-child(2) .xc-stat-l, .xc-t-mag .xc-stat-l { color:rgba(255,255,255,.75); }
.xc-t-mag .xc-chip { border:1.5px solid #141414; background:#fff; font-weight:700; }
.xc-t-mag .xc-chip:nth-child(odd) { background:#141414; color:#fff; }
.xc-t-mag .xc-quote { border-left:4px solid #e0301e; padding-left:16px; background:#faf7f2; }
.xc-t-mag .xc-conclusion { background:#141414; color:#fff; border-left:4px solid #e0301e; padding:15px 16px 15px 18px; }
/* mag hero：刊头之下全出血，红标白题 */
.xc-t-mag .xc-hero { height:470px; margin:16px -52px 32px; }
.xc-t-mag.xc-vtitle .xc-title { top: 108px; background: none !important; }
.xc-t-mag .xc-hero-scrim { background:linear-gradient(180deg,rgba(12,12,14,.18) 0%,rgba(12,12,14,.04) 40%,rgba(10,10,12,.8) 100%); }
.xc-t-mag .xc-hero-title { color:#fff; -webkit-text-fill-color:#fff; text-shadow:0 2px 18px rgba(0,0,0,.6); }
.xc-t-mag .xc-hero-badge { background:#e0301e; color:#fff; }
.xc-t-mag .xc-hero-feed { color:rgba(255,255,255,.9); }
.xc-t-mag .xc-hero-meta { color:rgba(255,255,255,.85); }
/* gen 封面：黑白分割 + 红角标 + 巨型白字 */
.xc-t-mag .xc-cover-gen { background: linear-gradient(115deg, #141414 0 58%, #e0301e 58% 66%, #f5f2ec 66%); }
.xc-t-mag .xc-cover-gen::after { content:''; position:absolute; left:26px; top:22px; width:56px; height:8px; background:#e0301e; }
.xc-t-mag .xc-ghost { font-size:150px; font-weight:800; color:#fff; left:22px; bottom:-8px; letter-spacing:2px; }
.xc-t-mag .xc-gen-ic { color:rgba(255,255,255,.8); z-index:1; }
`,
  note: `
.xc-t-note .xc-stat { background:#fffdf4; border:1.5px dashed #c9a86a; transform:rotate(-.6deg); }
.xc-t-note .xc-stat:nth-child(2) { transform:rotate(.8deg); }
.xc-t-note .xc-stat:nth-child(3) { transform:rotate(-.4deg); }
.xc-t-note .xc-stat-v { color:#a0522d; }
.xc-t-note .xc-chip { transform:rotate(-1.2deg); box-shadow:0 2px 5px rgba(90,70,40,.16); }
.xc-t-note .xc-chip:nth-child(even) { transform:rotate(1deg); }
.xc-t-note .xc-quote { background:#fffdf4; border:1.5px dashed #c9a86a; border-radius:8px; padding:14px 16px 14px 44px; transform:rotate(-.3deg); }
.xc-t-note .xc-conclusion { background:#fff4d6; border:1.5px dashed #c9a86a; }
/* 封面质感：拍立得白框+微旋 */
.xc-t-note .xc-cover { border:8px solid #fff; box-shadow:0 8px 18px rgba(90,70,40,.25); transform:rotate(-1.4deg); }
/* gen 封面：牛皮纸纹 + 双胶带 + 手写鬼影 */
.xc-t-note .xc-cover-gen { background: repeating-linear-gradient(45deg, rgba(160,120,60,.06) 0 6px, transparent 6px 12px), #efe3c8; }
.xc-t-note .xc-cover-gen::before { content:''; position:absolute; left:8%; top:-7px; width:110px; height:22px; background:rgba(196,181,253,.55); transform:rotate(-5deg); }
.xc-t-note .xc-cover-gen::after { content:''; position:absolute; right:10%; bottom:-7px; width:90px; height:22px; background:rgba(167,243,208,.5); transform:rotate(4deg); }
.xc-t-note .xc-cover-gen { overflow:hidden; }
.xc-t-note .xc-ghost { font-size:86px; color:rgba(160,82,45,.3); left:20px; bottom:10px; }
`,
  min: `
.xc-t-min .xc-stat { background:transparent; border:none; border-top:2.5px solid #16181d; border-radius:0; padding:14px 6px 12px; text-align:left; }
.xc-t-min .xc-stat-v { font-size:32px; color:#16181d; }
.xc-t-min .xc-stat-l { color:#8a8f99; }
.xc-t-min .xc-chip { border:1px solid #d5d8de; background:transparent; color:#3a3f47; }
.xc-t-min .xc-quote { border-left:3px solid #16181d; background:transparent; padding:4px 0 4px 18px; }
.xc-t-min .xc-conclusion { background:#f4f5f7; border-left:3px solid #16181d; padding:15px 16px 15px 18px; }
.xc-t-min .xc-counter { background:#f4f5f7; border-left:3px solid #9a5b00; }
/* 封面质感：细线框+降饱和 */
.xc-t-min .xc-cover { border:1px solid #d5d8de; }
.xc-t-min .xc-cover img { filter: saturate(.82); }
/* gen 封面：极简基线 + 细描边鬼影 */
.xc-t-min .xc-cover-gen { background:#fff; border:1px solid #e8eaee; }
.xc-t-min .xc-cover-gen::after { content:''; position:absolute; left:24px; right:24px; bottom:44px; height:1px; background:#e8eaee; }
.xc-t-min .xc-ghost { font-size:120px; font-weight:300; -webkit-text-stroke:1.5px #d5d8de; -webkit-text-fill-color:transparent; left:20px; bottom:20px; letter-spacing:4px; }
.xc-t-min .xc-gen-ic { display:none; }
`,
  news: `
.xc-t-news .xc-cols .xc-sec { break-inside: avoid; }
.xc-t-news .xc-stat { background:#fbf7ec; border:1px solid #2a251c; border-top:3px double #2a251c; border-radius:0; }
.xc-t-news .xc-stat-v { color:#8c2f1b; }
.xc-t-news .xc-chip { border:1px solid #2a251c; border-radius:0; background:transparent; }
.xc-t-news .xc-chip::before { content:''; display:inline-block; width:5px; height:5px; background:#8c2f1b; margin-right:7px; vertical-align:1px; }
.xc-t-news .xc-quote { border-left:4px solid #8c2f1b; padding-left:16px; }
.xc-t-news .xc-conclusion { background:#f3ecda; border:1px solid #2a251c; border-left:4px solid #8c2f1b; border-radius:0; padding:15px 16px 15px 18px; }
/* news hero：报纸刊头之下全出血 */
.xc-t-news .xc-hero { height:440px; margin:0 -52px 28px; border:1px solid #2a251c; }
.xc-t-news .xc-hero-scrim { background:linear-gradient(180deg,rgba(26,22,16,.2) 0%,rgba(26,22,16,.05) 40%,rgba(18,15,10,.82) 100%); }
.xc-t-news .xc-hero-title { color:#fff; text-shadow:0 2px 18px rgba(0,0,0,.6); }
.xc-t-news .xc-hero-badge { background:#8c2f1b; color:#f6f1e4; }
.xc-t-news .xc-hero-feed { color:rgba(255,255,255,.9); }
.xc-t-news .xc-hero-meta { color:rgba(255,255,255,.85); }
/* gen 封面：半调网点 + 题花条 */
.xc-t-news .xc-cover-gen { background: radial-gradient(circle at 5px 5px, rgba(42,37,28,.22) 2.2px, transparent 2.6px) 0 0/14px 14px, #efe8d6; }
.xc-t-news .xc-cover-gen::after { content:''; position:absolute; left:0; right:0; top:0; height:10px; background:repeating-linear-gradient(90deg, #2a251c 0 26px, transparent 26px 34px); }
.xc-t-news .xc-ghost { font-size:124px; color:rgba(140,47,27,.34); left:20px; bottom:6px; }
`,
  jade: `
/* jade hero：青瓷暗夜蒙版 + 白衬线 */
.xc-t-jade .xc-hero { height:480px; margin:-52px -56px 34px; }
.xc-t-jade .xc-hero-scrim { background:linear-gradient(180deg,rgba(10,26,22,.28) 0%,rgba(10,26,22,.06) 36%,rgba(7,20,16,.86) 100%); }
.xc-t-jade .xc-hero-title { color:#fff; text-shadow:0 2px 20px rgba(0,0,0,.6); }
.xc-t-jade .xc-hero-badge { background:#1f5d50; color:#eef5f0; }
.xc-t-jade .xc-hero-feed { color:rgba(255,255,255,.9); }
.xc-t-jade .xc-hero-meta { color:rgba(255,255,255,.85); }
/* gen 封面：青瓷釉 + 瓷白大圆 + 朱砂点 */
.xc-t-jade .xc-cover-gen { background: radial-gradient(90% 130% at 78% 6%, #f2f7f0 0%, #d8e4da 46%, #b4c8ba 100%); }
.xc-t-jade .xc-cover-gen::after { content:''; position:absolute; right:36px; top:50%; transform:translateY(-50%); width:120px; height:120px; border:2.5px solid rgba(31,93,80,.32); border-radius:50%; }
.xc-t-jade .xc-cover-gen::before { content:''; position:absolute; right:120px; bottom:24px; width:12px; height:12px; background:#c34a2f; border-radius:2px; opacity:.8; }
.xc-t-jade .xc-ghost { font-size:122px; color:rgba(31,93,80,.18); left:20px; bottom:8px; }
`,
  blue: `
/* blue hero：蓝晒蒙版 + 制图徽标 */
.xc-t-blue .xc-hero { height:470px; margin:-52px -56px 34px; border:1.5px solid rgba(255,255,255,.5); }
.xc-t-blue .xc-hero-scrim { background:linear-gradient(180deg,rgba(6,20,34,.3) 0%,rgba(6,20,34,.08) 38%,rgba(4,15,26,.86) 100%); }
.xc-t-blue .xc-hero-title { color:#fff; text-shadow:0 2px 20px rgba(0,0,0,.6); }
.xc-t-blue .xc-hero-badge { border:1.5px solid rgba(255,255,255,.6); color:#cfe8ff; font-family:Consolas,"Courier New",monospace; background:rgba(255,255,255,.06); }
.xc-t-blue .xc-hero-feed { color:rgba(220,235,247,.9); }
.xc-t-blue .xc-hero-meta { color:rgba(220,235,247,.85); }
/* gen 封面：蓝图坐标圆 + 十字准星 */
.xc-t-blue .xc-cover-gen { background: repeating-linear-gradient(0deg, rgba(255,255,255,.05) 0 1px, transparent 1px 24px), repeating-linear-gradient(90deg, rgba(255,255,255,.05) 0 1px, transparent 1px 24px), #14395c; }
.xc-t-blue .xc-cover-gen::after { content:''; position:absolute; right:40px; top:50%; transform:translateY(-50%); width:150px; height:150px; border:1.5px solid rgba(143,208,255,.6); border-radius:50%; box-shadow: inset 0 0 0 18px rgba(143,208,255,.1); }
.xc-t-blue .xc-ghost { font-size:110px; -webkit-text-stroke:1.5px rgba(143,208,255,.5); -webkit-text-fill-color:transparent; left:22px; bottom:12px; font-family:Consolas,monospace; }
`,
};

/** 渲染卡片
 * @param {object} data 卡片数据（见 parse.js / 样例）
 *   { kind, title, feedTitle, date, cover, lead, steps:[{t,d}], points:[{t,d}],
 *     concepts:[], stats:[{v,l}], counter, quotes:[], actions:[], conclusion,
 *     prose:[], meta:{minutes,words} }
 * @param {object} options { templateId, cover:true, stats:true, qr:svgString|null, watermark:true }
 * @returns {{ html:string, css:string, width:number, bg:string }}
 */
export function applyLengthMode(data, mode = 'standard') {
  if (mode === 'standard' || !data) return data;
  const d = { ...data };
  const cap = mode === 'short' ? 3 : 99;
  if (Array.isArray(d.steps)) d.steps = d.steps.slice(0, cap);
  if (Array.isArray(d.points)) d.points = d.points.slice(0, cap);
  if (Array.isArray(d.concepts)) d.concepts = d.concepts.slice(0, mode === 'short' ? 4 : 8);
  if (Array.isArray(d.quotes)) d.quotes = d.quotes.slice(0, mode === 'short' ? 1 : 3);
  if (Array.isArray(d.actions)) d.actions = d.actions.slice(0, mode === 'short' ? 1 : 2);
  if (Array.isArray(d.prose)) d.prose = mode === 'short' ? d.prose.slice(0, 2) : d.prose;
  return d;
}

export function renderCard(data, options = {}) {
  const tpl = TEMPLATE_MAP[options.templateId] || PAPER;
  const o = { cover: true, stats: true, watermark: true, qr: null, ...options };
  const d0Cover = !!data.cover;
  // 横版画幅：次要板块轻量精简；prose（正文主体）永不删——完整内容由双栏密排 + 溢出 contain 缩放保证
  if (options.orientation === 'landscape') {
    const lvl = Number(options.slimLevel) || 2;
    const slim = { ...data };
    const capN = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : arr);
    slim.steps = capN(slim.steps, 2);
    slim.points = capN(slim.points, 2);
    slim.concepts = capN(slim.concepts, lvl >= 3 ? 3 : 4);
    slim.quotes = capN(slim.quotes, 1);
    slim.actions = capN(slim.actions, 1);
    if (lvl >= 3) slim.counter = null;
    data = slim;
  }
  if (options.lengthMode && options.lengthMode !== 'long') data = applyLengthMode(data, options.lengthMode);
  return {
    html: `<div class="xc-card xc-t-${tpl.id}${options.orientation === 'landscape' ? ' landscape' : ''}${options.verticalTitle && !d0Cover && tpl.id !== 'min' && tpl.id !== 'note' ? ' xc-vtitle' : ''}" style="zoom:${densityZoom(options.density)}">${tpl.html(data, o)}</div>`,
    css: BASE_CSS + tpl.css + (TEMPLATE_UPGRADES[tpl.id] || '')
      + (options.coverFilter && options.coverFilter !== 'original' ? `.xc-cover img,.xc-hero-img{filter:${coverFilter(options.coverFilter)}}` : '')
      + fontPairCss(options.fontPair)
      + (options.accentColor ? `.xc-card{border-bottom:6px solid ${options.accentColor}}` : '')
            + (options.orientation === 'landscape' ? `
.xc-card.landscape .xc-inner { columns: 2; column-gap: 40px; column-fill: auto; }
.xc-card.landscape .xc-hero, .xc-card.landscape .xc-badgerow, .xc-card.landscape .xc-title,
.xc-card.landscape .xc-meta, .xc-card.landscape .xc-cover, .xc-card.landscape .xc-foot,
.xc-card.landscape .xc-overview { column-span: all; }
.xc-card.landscape .xc-sec { break-inside: avoid; }
.xc-card.landscape .xc-title { font-size: 26px; margin-top: 10px; }
` : ''),
    width: CARD_WIDTH,
    bg: tpl.bg,
  };
}

/** 生成独立整页 HTML（探针 / 简单预览用）。zoom 由外层 .xc-stage 控制。 */
export function renderFullPage(data, options = {}, zoom = 1) {
  const vf = variantFilter(options.variant);
  const vcss = vf !== 'none' ? `<style>.xc-stage{filter:${vf}}</style>` : '';
  const card = renderCard(data, options);
  return {
    html: `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:${options.bgGradient || card.bg}}
      .xc-stage{zoom:${zoom}}
    </style><style>${card.css}${vcss}</style></head><body><div class="xc-stage">${card.html}</div></body></html>`,
    bg: card.bg,
    width: Math.round(card.width * zoom),
  };
}

/**
 * 生成导出整页 HTML（固定画幅版）。
 * @param {object} fit { zoom:number, ratio:null|number(高/宽，如 4/3、16/9), naturalHeight:number|null }
 *   ratio 为 null 时自然高度流式布局；否则卡片等比缩放完整放入 750×(750*ratio) 画幅（居中，不裁切）。
 * @returns {{html:string, bg:string, width:number, height:number}}
 */
export function seededGradient(title) {
  const palettes = [
    'linear-gradient(135deg,#f6f2e7,#e7e0cf 55%,#d9d0b8)',
    'linear-gradient(135deg,#eef3ee,#dfe9df 55%,#ccdbd2)',
    'linear-gradient(135deg,#f3eef7,#e6def0 55%,#d5cbe6)',
    'linear-gradient(135deg,#eef4f8,#ddeaf4 55%,#c8d9e8)',
    'linear-gradient(135deg,#faf1ec,#f2e2d8 55%,#e6cfc0)',
  ];
  const h = String(title || '');
  let acc = 0;
  for (let i = 0; i < h.length; i++) acc = (acc * 31 + h.charCodeAt(i)) >>> 0;
  return palettes[acc % palettes.length];
}

/** 横版画幅的卡面拉宽与海报化压缩（横竖版固定画幅共用）。 */
const LAND_CSS = (stageW) => `.xc-card{width:${stageW}px}.xc-card .xc-hero,.xc-card .xc-cover-gen{height:300px !important;aspect-ratio:auto}.xc-card .xc-lead{margin-top:14px !important}.xc-card .xc-sec{margin-top:24px !important}.xc-card .xc-foot{margin-top:26px !important}.xc-card .xc-title{font-size:1.55em !important;margin-bottom:10px !important}.xc-card .xc-meta{margin-bottom:12px !important}.xc-card .xc-cover,.xc-card .xc-cover-gen{margin-top:14px !important}.xc-card .xc-stats,.xc-card .xc-chips{margin-top:14px !important}`;

/** 在卡 HTML 的 .xc-foot 元素前插入弹性补空层（无 foot 则直接追加在卡尾）。 */
function insertFillSpacer(cardHtml) {
  const m = cardHtml.match(/<[a-z]+[^>]*class="[^"]*xc-foot[^"]*"[^>]*>/i);
  if (m) return cardHtml.replace(m[0], `<div class="xc-fill-spacer"></div>${m[0]}`);
  const close = cardHtml.lastIndexOf('</div>');
  return close >= 0 ? cardHtml.slice(0, close) + '<div class="xc-fill-spacer"></div>' + cardHtml.slice(close) : cardHtml + '<div class="xc-fill-spacer"></div>';
}

/**
 * 画幅铺满卡片段（fit-to-fill 核心参数化，预览与导出共用）。
 * - fit.fill 缺省 → 自然片段（landCss 已应用，横版卡宽=画幅宽），供实测自然高
 * - fit.fill = { scale }>1 → 填充注入：垂直间距/行距/头图按缺口放大 + .xc-fill-spacer 弹性吃余量，卡高锁定画幅
 * - fit.fill = { compact:true } → 紧凑注入：间距/行距/头图收紧，应对内容超出
 * 返回 { html, css, bg, boxW, boxH }——html 是卡片段（含 spacer），css 含 fitCss。
 */
export function renderCardFitted(data, options = {}, fit = {}) {
  const ratio = fit.ratio;
  const landscape = ratio < 1;
  const stageW = landscape ? Math.round(CARD_WIDTH / ratio) : CARD_WIDTH;
  const boxH = Math.round(stageW * ratio);
  const cardOpts = landscape ? { ...options, orientation: 'landscape', slimLevel: fit.slimLevel ?? (ratio < 0.7 ? 3 : 2) } : options;
  const card = renderCard(data, cardOpts);
  const landCss = landscape ? LAND_CSS(stageW) : '';
  let inner = card.html;
  let fitCss = '';
  if (fit.fill && fit.fill.scale > 1.001) {
    const s = Math.min(fit.fill.scale, 1.8);
    const S1 = 1 + (s - 1) * 0.5;
    const S2 = Math.min(1 + (s - 1) * 0.28, 1.16);
    const S3 = 1 + (s - 1) * 0.85;
    fitCss = `
      .xc-card{display:flex !important;flex-direction:column;height:${boxH}px !important;}
      .xc-card > .xc-inner{display:flex !important;flex-direction:column;flex:1 1 auto;min-height:0;}
      .xc-fill-spacer{flex:1 1 auto;min-height:0;}
      .xc-card .xc-sec{margin-top:calc(34px * ${S1.toFixed(3)}) !important;}
      .xc-card .xc-lead{margin-top:calc(28px * ${S1.toFixed(3)}) !important;}
      .xc-card .xc-foot{margin-top:calc(38px * ${S1.toFixed(3)}) !important;}
      .xc-card .xc-lead,.xc-card .xc-prose-p,.xc-card .xc-point-d,.xc-card .xc-step-d{line-height:${(1.9 * S2).toFixed(3)} !important;}
      .xc-card .xc-hero,.xc-card .xc-cover-gen{height:${Math.round(300 * S3)}px !important;aspect-ratio:auto !important;}
      .xc-card .xc-lead{font-size:calc(16px + ${((s - 1) * 5).toFixed(1)}px) !important;}
    `;
    inner = insertFillSpacer(inner);
  } else if (fit.fill && fit.fill.compact) {
    // 紧凑档：分级密度。density 1=间距/行距/头图收紧；density 2=再收字号/段距/头图（内容完整优先，永不裁切）
    const d2 = fit.fill.density >= 2;
    const lockH = fit.fill.auto ? '' : `height:${boxH}px !important;`;
    fitCss = `
      .xc-card{display:flex !important;flex-direction:column;${lockH}}
      .xc-card > .xc-inner{display:flex !important;flex-direction:column;flex:1 1 auto;min-height:0;}
      .xc-fill-spacer{display:none;}
      .xc-card .xc-sec{margin-top:${d2 ? 18 : 22}px !important;}
      .xc-card .xc-lead{margin-top:${d2 ? 13 : 16}px !important;}
      .xc-card .xc-foot{margin-top:${d2 ? 18 : 22}px !important;}
      .xc-card .xc-lead,.xc-card .xc-prose-p,.xc-card .xc-point-d,.xc-card .xc-step-d{line-height:${d2 ? 1.6 : 1.68} !important;}
      .xc-card .xc-hero,.xc-card .xc-cover-gen{height:${d2 ? 165 : 205}px !important;aspect-ratio:auto !important;}
      .xc-card .xc-cover{margin-top:${d2 ? 10 : 12}px !important;}
      .xc-card.landscape .xc-prose-p,.xc-card.landscape .xc-lead{font-size:${d2 ? 12.5 : 13.5}px !important;line-height:1.6 !important;}
      .xc-card.landscape .xc-sec{break-inside:auto !important;}
    `;
    inner = insertFillSpacer(inner);
    // 溢出探针：内容流末端（footer 后），multicol/锁高的真实终端判定用
    if (/<\/footer>/i.test(inner)) inner = inner.replace(/<\/footer>/i, '</footer><div class="xc-overflow-probe" style="position:relative;height:0;"></div>');
    else inner += '<div class="xc-overflow-probe" style="position:relative;height:0;"></div>';
  }
  return { html: inner, css: `${card.css}${landCss}${fitCss}`, bg: card.bg, boxW: stageW, boxH };
}

/**
 * 画幅铺满管线（fit-to-fill）：画幅是硬约束，内容自适应填满。
 * - fit.fill 缺省（且 fit.naturalHeight 缺省）→ 自然测量页：竖版=整卡流式；横版=满宽（实测自然高用）
 * - fit.fill / fit.finalZoom → 固定画幅 stage（内容注入见 renderCardFitted）
 */
export function renderStagePage(data, options = {}, fit = {}) {
  const vf = variantFilter(options.variant);
  const vstyle = vf !== 'none' ? `filter:${vf}` : '';
  const zoom = fit.zoom || 2;
  const ratio = fit.ratio ?? null;
  if (!ratio) return renderFullPage(data, options, zoom);
  const landscape = ratio < 1;

  // 自然测量页（第一遍）：拿真实内容高度
  if (!fit.fill && fit.naturalHeight == null) {
    const slimLevel = landscape ? (ratio < 0.7 ? 3 : 2) : options.slimLevel;
    const cardOpts = landscape ? { ...options, orientation: 'landscape', slimLevel } : options;
    const card = renderCard(data, cardOpts);
    if (landscape) {
      const stageW = Math.round(CARD_WIDTH / ratio);
      const fill = stageW / CARD_WIDTH;
      const w = Math.round(stageW * zoom);
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;padding:0;background:${card.bg}}
        .xc-stage{width:${stageW}px}
        .xc-stage > .xc-card{zoom:${fill}}
      </style><style>${card.css}</style></head><body><div class="xc-stage">${card.html}</div></body></html>`;
      return { html, bg: card.bg, width: w, height: null };
    }
    const page = renderFullPage(data, cardOpts, zoom);
    return { ...page, height: null };
  }

  const f = renderCardFitted(data, options, fit);
  const finalZoom = Math.min(1, fit.finalZoom || 1);
  return {
    html: `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:${f.bg}}
      .xc-export{zoom:${zoom};${vstyle}}
      .xc-stage{width:${f.boxW}px;height:${f.boxH}px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:${f.bg}}
      .xc-stage > .xc-card{width:${f.boxW}px;flex:none;zoom:${finalZoom} !important}
    </style><style>${f.css}</style></head><body><div class="xc-export"><div class="xc-stage">${f.html}</div></div></body></html>`,
    bg: f.bg,
    width: Math.round(f.boxW * zoom),
    height: Math.round(f.boxH * zoom),
  };
}

/* ══ D1 排版网格与垂直节奏 ══
   统一垂直节奏标尺：节间距 34 / 题图距 26 / 元信息距 16，行高基线 1.9 对齐。
   覆盖各模板散落的 ad-hoc 间距，形成一致的呼吸节拍。 */
const D1_RHYTHM = `/* D1 垂直节奏：节距统一、导语与正文行高基线、页脚收束 */
.xc-card .xc-sec { margin-top: 34px; }
.xc-card .xc-lead { margin-top: 28px; }
.xc-card .xc-foot { margin-top: 38px; }
.xc-card .xc-lead, .xc-card .xc-prose-p, .xc-card .xc-point-d, .xc-card .xc-step-d { line-height: 1.9; }
.xc-card .xc-title { text-wrap: balance; }
`;
for (const k of Object.keys(TEMPLATE_UPGRADES)) TEMPLATE_UPGRADES[k] += D1_RHYTHM;

/* ══ D2 OKLCH 色彩科学化 ══
   暗色模板次级文字提升至 WCAG AA 边距安全区；paper 数据卡轮廓加强；mesh 概念签色彩纪律化。
   新值全部以 OKLCH 感知均匀色彩空间表达（Chromium 111+ 支持），亮度和 chroma 可预测。 */
const D2_COLOR = `
/* aurora：次级文字对比提升（oklch 亮度 L≈0.82） */
.xc-t-aurora .xc-step-d, .xc-t-aurora .xc-point-d, .xc-t-aurora .xc-prose-p { color: oklch(0.86 0.02 260); }
.xc-t-aurora .xc-meta, .xc-t-aurora .xc-stat-l, .xc-t-aurora .xc-hero-feed { color: oklch(0.82 0.03 260); }
/* blue：正文与标注对比提升（oklch 冷蓝轴） */
.xc-t-blue .xc-step-d, .xc-t-blue .xc-point-d, .xc-t-blue .xc-prose-p { color: oklch(0.87 0.03 240); }
.xc-t-blue .xc-meta, .xc-t-blue .xc-stat-l { color: oklch(0.84 0.04 240); }
/* ink：正文提亮 */
.xc-t-ink .xc-step-d, .xc-t-ink .xc-point-d, .xc-t-ink .xc-prose-p { color: oklch(0.85 0.01 260); }
/* paper：数据卡轮廓加强 */
.xc-t-paper .xc-stat { border-color: oklch(0.55 0.04 140 / 0.5); }
.xc-t-paper .xc-stat-v { color: oklch(0.48 0.06 145); }
/* mesh：概念签色彩纪律化（统一淡底+彩色描边+深字） */
.xc-t-mesh .xc-chip { background: color-mix(in srgb, currentColor 8%, #fff) !important; border: 1.5px solid currentColor; color: inherit; }
.xc-t-mesh .xc-chip:nth-child(4n + 1) { color: #a04a22; }
.xc-t-mesh .xc-chip:nth-child(4n + 2) { color: #5b46b4; }
.xc-t-mesh .xc-chip:nth-child(4n + 3) { color: #1c6394; }
.xc-t-mesh .xc-chip:nth-child(4n + 4) { color: #1c6b47; }
`;
for (const k of Object.keys(TEMPLATE_UPGRADES)) TEMPLATE_UPGRADES[k] += D2_COLOR;

/* ══ D3 中文排版艺术 ══
   避头尾（line-break: strict）、标点挤压（text-spacing-trim，Chromium 123+）、
   长文两端对齐（inter-ideograph）、导语悬挂引号。 */
const D3_TYPE = `
.xc-card { line-break: strict; text-spacing-trim: space-first; }
.xc-card .xc-lead, .xc-card .xc-prose-p { text-align: justify; text-justify: inter-ideograph; }
.xc-card .xc-point-d, .xc-card .xc-step-d { text-align: justify; }
.xc-card .xc-lead-plain { text-indent: -0.9em; padding-left: 0.9em; }
.xc-card .xc-counter, .xc-card .xc-conclusion { text-align: justify; }
`;
for (const k of Object.keys(TEMPLATE_UPGRADES)) TEMPLATE_UPGRADES[k] += D3_TYPE;


/* ══ D11 竖排标题选项（东方排版）══ */
const D11_VTITLE = `
.xc-card.xc-vtitle { padding-right: 64px; }
.xc-card.xc-vtitle .xc-title {
  writing-mode: vertical-rl; text-orientation: upright;
  position: absolute; right: 12px; top: 52px;
  max-height: 430px; margin: 0; letter-spacing: 10px; line-height: 1;
  font-size: 1.55em;
}
.xc-card.xc-vtitle .xc-badgerow, .xc-card.xc-vtitle .xc-meta { margin-right: 56px; }
`;
for (const k of Object.keys(TEMPLATE_UPGRADES)) TEMPLATE_UPGRADES[k] += D11_VTITLE;

/* ══ D4 数据可视化卡 ══ */

/* ══ D4 数据可视化卡 ══ */
const D4_STATS = `
.xc-stat-v { font-variant-numeric: tabular-nums; letter-spacing: 0; }
.xc-stat-n { font-size: 1.18em; font-weight: 800; font-variant-numeric: tabular-nums; }
.xc-stat-u { font-size: 0.52em; font-weight: 700; margin-left: 2px; letter-spacing: 0.06em; }
.xc-t-paper .xc-stat-u { -webkit-text-fill-color: #8b8574; }
.xc-t-ink .xc-stat-u { -webkit-text-fill-color: #c9a86a; }
.xc-t-aurora .xc-stat-u { -webkit-text-fill-color: #8d9ac2; }
`;
for (const k of Object.keys(TEMPLATE_UPGRADES)) TEMPLATE_UPGRADES[k] += D4_STATS;

/* ══ D5 金句与引文艺术 ══ */
const D5_QUOTES = `
/* 通用：引号巨型化 + 行高归零 + 引文平衡 */
.xc-card .xc-qmark { font-size: 62px !important; line-height: 0.8; font-family: Georgia, "Times New Roman", serif; }
.xc-card .xc-quote p { text-wrap: balance; }
.xc-card .xc-quote { padding-right: 16px; }
/* mag：巨型黑引号 + 红色竖线 */
.xc-t-mag .xc-qmark { font-size: 72px !important; color: #e0301e; -webkit-text-fill-color: #e0301e; }
/* jade：青瓷大引号 */
.xc-t-jade .xc-qmark { font-size: 64px !important; color: #1f5d50; -webkit-text-fill-color: #1f5d50; }
/* blue：等宽引号 + 蓝色 */
.xc-t-blue .xc-qmark { display: block; font-size: 44px !important; color: #8fd0ff; -webkit-text-fill-color: #8fd0ff; font-family: Consolas, monospace; }
/* min：超大极细引号 */
.xc-t-min .xc-qmark { font-size: 68px !important; font-weight: 300; color: #16181d; -webkit-text-fill-color: #16181d; }
/* news：黑体大引号 */
.xc-t-news .xc-qmark { font-size: 60px !important; color: #8c2f1b; -webkit-text-fill-color: #8c2f1b; }
/* note：手写橘引号 */
.xc-t-note .xc-qmark { font-size: 58px !important; color: #a0522d; -webkit-text-fill-color: #a0522d; }
`;
for (const k of Object.keys(TEMPLATE_UPGRADES)) TEMPLATE_UPGRADES[k] += D5_QUOTES;

/* ══ D6 封面构图系统 ══ */
const D6_COVER = `
/* 文字安全区：hero 文本区加大内边距，蒙版下缘加深保证白字对比 */
.xc-card .xc-hero-text { padding: 26px 38px 24px; }
.xc-card .xc-hero-scrim { background: linear-gradient(180deg, rgba(0,0,0,.26) 0%, rgba(0,0,0,.06) 40%, rgba(0,0,0,.86) 100%) !important; }
/* 生成封面安全区：鬼影字不再贴边 */
.xc-card .xc-cover-gen .xc-ghost { left: 26px; }
.xc-card .xc-cover-gen { overflow: hidden; }
/* 纯图带暗角渐晕：图文融合 */
.xc-t-mag .xc-hero-plain::after, .xc-t-news .xc-hero-plain::after {
  content: ''; position: absolute; inset: 0;
  background: radial-gradient(120% 90% at 50% 40%, transparent 60%, rgba(0,0,0,.22) 100%);
}
`;
for (const k of Object.keys(TEMPLATE_UPGRADES)) TEMPLATE_UPGRADES[k] += D6_COVER;

/* ══ D7 图文混排 ══ */
const D7_MIX = `
/* 配图圆角/边框语言按模板分化；正文内图片统一圆角+题注间距 */
.xc-card .xc-body img, .xc-card .robin-body img { border-radius: 10px; }
.xc-card figure { margin: 18px 0; }
.xc-card figcaption { margin-top: 8px; font-size: 12px; color: var(--text-tertiary, #999); letter-spacing: 0.04em; }
/* 纯色主题配图边框语言 */
.xc-t-paper .xc-cover { border-radius: 14px; }
.xc-t-min .xc-cover { border-radius: 6px; border: 1px solid #d5d8de !important; }
.xc-t-news .xc-cover { border-radius: 0; }
.xc-t-mag .xc-cover { border-radius: 0; }
.xc-t-jade .xc-cover { border-radius: 8px; }
.xc-t-blue .xc-cover { border-radius: 2px; }
.xc-t-note .xc-cover { border-radius: 2px; }
`;
for (const k of Object.keys(TEMPLATE_UPGRADES)) TEMPLATE_UPGRADES[k] += D7_MIX;

/* ══ D8 留白与密度科学 ══ */
const D8_SPACE = `
/* 组内紧凑、组间疏朗：节标与内容 16px、条目组 18px、页脚前 42px、导语后第一节 38px 大呼吸 */
.xc-card .xc-sec-h { margin-bottom: 16px; }
.xc-card .xc-points, .xc-card .xc-actions { margin-top: 18px; }
.xc-card .xc-foot { margin-top: 42px; }
.xc-card .xc-lead + .xc-sec { margin-top: 38px; }
.xc-card .xc-stats { margin-top: 18px; }
`;
for (const k of Object.keys(TEMPLATE_UPGRADES)) TEMPLATE_UPGRADES[k] += D8_SPACE;

/* ══ D9 印刷细节 ══ */
const D9_PRINT = `
/* 页脚印刷刻度：分隔线两端短竖刻度（印刷标尺语言） */
.xc-t-paper .xc-foot::before, .xc-t-news .xc-foot::before, .xc-t-jade .xc-foot::before, .xc-t-blue .xc-foot::before {
  content: ''; position: absolute; left: 0; top: -6px; width: 1px; height: 12px;
  background: currentColor; opacity: 0.4;
}
.xc-t-paper .xc-foot::after, .xc-t-news .xc-foot::after, .xc-t-jade .xc-foot::after, .xc-t-blue .xc-foot::after {
  content: ''; position: absolute; right: 0; top: -6px; width: 1px; height: 12px;
  background: currentColor; opacity: 0.4;
}
/* 右上竖排角标：知更·精读（印刷签条） */
.xc-t-paper .xc-inner::before, .xc-t-jade .xc-inner::before {
  content: '知更 · 精读'; position: absolute; right: 8px; top: 14px;
  writing-mode: vertical-rl; font-size: 10px; letter-spacing: 0.4em;
  color: currentColor; opacity: 0.34;
}
.xc-t-news .xc-masthead { position: relative; }
.xc-t-news .xc-masthead::before {
  content: '知更 · 精读'; position: absolute; right: 6px; top: 8px;
  writing-mode: vertical-rl; white-space: nowrap;
  font-size: 9px; letter-spacing: 0.3em;
  color: currentColor; opacity: 0.4;
}
/* 纸感模板细纹 */
.xc-t-paper { background-image: repeating-linear-gradient(0deg, rgba(120,100,60,.022) 0 1px, transparent 1px 3px), linear-gradient(180deg,#faf6ec 0%,#f7f3e8 34%,#f2ecdc 100%); }
.xc-t-note { background-image: repeating-linear-gradient(0deg, rgba(160,120,60,.02) 0 1px, transparent 1px 3px), linear-gradient(180deg,#faf6ee 0%,#f8f4ea 50%,#f4eedd 100%); }
`;
for (const k of Object.keys(TEMPLATE_UPGRADES)) TEMPLATE_UPGRADES[k] += D9_PRINT;

/* ══ D10 品牌一致性 ══
   页脚治理：全部模板品牌区统一「羽图标+知更 RobinRead+英文副标」语言、
   品牌色锁定模板主色、英文字距/大小写规范、二维码白底规范。 */
const D10_BRAND = `
/* 品牌名字号/字距/大小写统一 */
.xc-card .xc-brand-name { letter-spacing: 0.12em; text-transform: none; }
.xc-card .xc-brand-sub { letter-spacing: 0.18em; text-transform: uppercase; font-size: 10.5px; }
/* 品牌羽图标语言：统一 16px、主色 */
.xc-card .xc-brand svg { width: 16px; height: 16px; }
/* 二维码白底衬托+细边（扫描可靠性） */
.xc-card .xc-qr { border: 1px solid rgba(0,0,0,0.08) !important; }
/* 品牌色收束：各模板 brand 图标锁主色（无主色声明的用羽翼橄榄绿兜底） */
.xc-t-mesh .xc-brand svg { color: #7c66dd; }
.xc-t-ink .xc-brand svg, .xc-t-aurora .xc-brand svg { color: #8f7bff; }
.xc-t-mag .xc-brand svg { color: #e0301e; }
.xc-t-news .xc-brand svg { color: #8c2f1b; }
.xc-t-jade .xc-brand svg { color: #c34a2f; }
.xc-t-blue .xc-brand svg { color: #8fd0ff; }
.xc-t-min .xc-brand svg, .xc-t-note .xc-brand svg { color: currentColor; }
`;
for (const k of Object.keys(TEMPLATE_UPGRADES)) TEMPLATE_UPGRADES[k] += D10_BRAND;

/* ══ D11 v2 题签条方案（替代 absolute 悬挂）══ */
const D11_V2 = `
.xc-card.xc-vtitle { padding-right: 0; }
.xc-card.xc-vtitle .xc-inner { margin-right: 60px; }
.xc-card.xc-vtitle .xc-cover, .xc-card.xc-vtitle .xc-cover-gen { margin-right: 60px !important; }
.xc-card.xc-vtitle .xc-title {
  writing-mode: vertical-rl; text-orientation: upright; white-space: nowrap;
  position: absolute; right: 8px; top: 40px;
  width: 40px; height: 420px; max-height: none;
  margin: 0; padding: 6px 0; box-sizing: border-box;
  font-size: 19px; letter-spacing: 5px; line-height: 28px;
  overflow: hidden;
}
.xc-card.xc-vtitle .xc-title {
  -webkit-mask-image: linear-gradient(180deg, #000 78%, transparent 99%);
  mask-image: linear-gradient(180deg, #000 78%, transparent 99%);
}
`;
for (const k of Object.keys(TEMPLATE_UPGRADES)) TEMPLATE_UPGRADES[k] += D11_V2;

/* D11 v4：mag 竖题下移至页眉带之下并去红底（!important 压制散布规则） */
const D11_MAG = `
.xc-card.xc-vtitle.xc-t-mag .xc-title { top: 118px !important; background: none !important; -webkit-text-fill-color: currentColor; }
`;
for (const k of Object.keys(TEMPLATE_UPGRADES)) TEMPLATE_UPGRADES[k] += D11_MAG;
