/* ==========================================================================
   知更 RobinRead — 精读/摘要卡片导出模板引擎
   纯函数模块（无 DOM 依赖）：同一份代码服务 主窗口预览 / 导出窗口 / 探针样张。
   renderCard(data, options) → { html, css, width, bg }
   ========================================================================== */

export const CARD_WIDTH = 750;

export const CARD_TEMPLATES = [
  { id: 'paper', name: '知更书页', hint: '纸感衬线 · 品牌默认 · 经典单栏' },
  { id: 'ink', name: '墨岩', hint: '暗色海报 · 居中构图 · 数据卡' },
  { id: 'mag', name: '杂志编辑', hint: '黑白红 · 跨栏 · 特大标题' },
  { id: 'note', name: '晨读手帖', hint: '楷体拼贴 · 胶带印章 · 手账' },
  { id: 'min', name: '极简白', hint: '大留白 · 左侧导轨 · 克制' },
  { id: 'news', name: '晚报', hint: '报纸双栏 · 刊头 · 半调封面' },
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
  const items = (d.stats || []).map((s) => `
    <div class="xc-stat"><div class="xc-stat-v">${esc(s.v)}</div><div class="xc-stat-l">${esc(s.l)}</div></div>`).join('');
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
  const brandRight = o.watermark === false
    ? `<div class="xc-foot-r"><div class="xc-brand-sub">${esc(d.date || '')}</div></div>`
    : `<div class="xc-foot-r">
      <div class="xc-brand">${icon('feather', 15, 2)}<span class="xc-brand-name">知更 RobinRead</span></div>
      <div class="xc-brand-sub">${esc(KIND_BADGES[d.kind] || '阅读笔记')} · ${esc(d.date || '')}</div>
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
        ${badgeRow(d)}
        <h1 class="xc-title">${esc(d.title)}</h1>
        ${metaStrip(d)}
        ${coverBlock(d, o, 3)}
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
        <div class="xc-head">
          ${badgeRow(d)}
          <h1 class="xc-title">${esc(d.title)}</h1>
          ${metaStrip(d)}
          ${coverBlock(d, o, 2)}
        </div>
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
.xc-t-mag .xc-title { margin-top:30px; font-size:44px; line-height:1.32; font-weight:700;
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
.xc-t-mag .xc-stats { margin-top:30px; border-top:1px solid #141414; border-bottom:1px solid #e2e2e2;
  padding:24px 0; display:flex; gap:12px; }
.xc-t-mag .xc-stat { flex:1; }
.xc-t-mag .xc-stat-v { font-size:34px; font-weight:700; color:#c73e3a; letter-spacing:0; }
.xc-t-mag .xc-stat-l { margin-top:6px; font-size:12px; color:#777; letter-spacing:1.5px; }
.xc-t-mag .xc-cols { margin-top:32px; columns:2; column-gap:40px; column-rule:1px solid #e6e6e6; }
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
.xc-t-mag .xc-counter { margin-top:30px; background:#f6f6f6; border-left:4px solid #c73e3a;
  padding:16px 19px; font-size:13.5px; line-height:1.9; color:#4d4d4d; }
.xc-t-mag .xc-sec-counter .xc-sec-h { color:#c73e3a; }
.xc-t-mag .xc-quote { position:relative; margin-top:30px; padding:10px 0 6px 56px; }
.xc-t-mag .xc-quote + .xc-quote { margin-top:24px; }
.xc-t-mag .xc-qmark { position:absolute; left:0; top:-10px; font-size:74px; color:#c73e3a; opacity:.9; }
.xc-t-mag .xc-quote p { font-size:19px; line-height:1.75; font-weight:700; color:#111; letter-spacing:.3px; }
.xc-t-mag .xc-actions { margin-top:14px; }
.xc-t-mag .xc-sec-actions, .xc-t-mag .xc-sec-conclusion { margin-top:34px; }
.xc-t-mag .xc-action { display:flex; align-items:flex-start; gap:11px; padding:8px 0;
  font-size:13.5px; line-height:1.8; color:#333; }
.xc-t-mag .xc-action-box { flex:none; margin-top:4px; width:16px; height:16px;
  border:1.5px solid #141414; color:#141414; display:flex; align-items:center; justify-content:center; }
.xc-t-mag .xc-conclusion { margin-top:30px; border-top:3px solid #141414; padding-top:18px;
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
      ${coverBlock(d, o, 2)}
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
.xc-t-note .xc-coverwrap { margin:26px 6px 0 -8px; width:270px; transform:rotate(1.8deg); }
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
            : `<div class="xc-cover-gen"><span class="xc-ghost">${esc(titleChars(d.title, 2))}</span></div>`}
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
.xc-t-min .xc-cover-gen { width:100%; height:100%; position:relative; overflow:hidden;
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
        ${coverBlock(d, o, 2)}
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
      ${coverBlock(d, o, 2)}
      ${statsBand}
      ${colBody ? `<div class="xc-cols">${colBody}</div>` : quotesBlock(d)}
      ${colBody ? quotesBlock(d) : ''}
      ${actionsBlock(d)}
      ${conclusionBlock(d)}
      ${proseBlock(d)}
      ${footBlock(d, o)}`;
  },
};

/* ---------------------------------------------------------------- 出口 */

const TEMPLATE_MAP = { paper: PAPER, ink: INK, mag: MAG, note: NOTE, min: MIN, news: NEWS };

/**
 * 渲染卡片
 * @param {object} data 卡片数据（见 parse.js / 样例）
 *   { kind, title, feedTitle, date, cover, lead, steps:[{t,d}], points:[{t,d}],
 *     concepts:[], stats:[{v,l}], counter, quotes:[], actions:[], conclusion,
 *     prose:[], meta:{minutes,words} }
 * @param {object} options { templateId, cover:true, stats:true, qr:svgString|null, watermark:true }
 * @returns {{ html:string, css:string, width:number, bg:string }}
 */
export function renderCard(data, options = {}) {
  const tpl = TEMPLATE_MAP[options.templateId] || PAPER;
  const o = { cover: true, stats: true, watermark: true, qr: null, ...options };
  return {
    html: `<div class="xc-card xc-t-${tpl.id}">${tpl.html(data, o)}</div>`,
    css: BASE_CSS + tpl.css,
    width: CARD_WIDTH,
    bg: tpl.bg,
  };
}

/** 生成独立整页 HTML（探针 / 简单预览用）。zoom 由外层 .xc-stage 控制。 */
export function renderFullPage(data, options = {}, zoom = 1) {
  const card = renderCard(data, options);
  return {
    html: `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:${card.bg}}
      .xc-stage{zoom:${zoom}}
    </style><style>${card.css}</style></head><body><div class="xc-stage">${card.html}</div></body></html>`,
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
export function renderStagePage(data, options = {}, fit = {}) {
  const zoom = fit.zoom || 2;
  const card = renderCard(data, options);
  if (!fit.ratio || !fit.naturalHeight) {
    const page = renderFullPage(data, options, zoom);
    return { ...page, height: null };
  }
  const boxW = card.width;
  const boxH = Math.round(card.width * fit.ratio);
  const f = Math.min(1, boxH / fit.naturalHeight);
  return {
    html: `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:${card.bg}}
      .xc-export{zoom:${zoom}}
      .xc-stage{width:${boxW}px;height:${boxH}px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:${card.bg}}
      .xc-stage > .xc-card{zoom:${f}}
    </style><style>${card.css}</style></head><body><div class="xc-export"><div class="xc-stage">${card.html}</div></div></body></html>`,
    bg: card.bg,
    width: Math.round(boxW * zoom),
    height: Math.round(boxH * zoom),
  };
}
