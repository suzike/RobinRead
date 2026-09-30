'use strict';
/**
 * 场景排版系统（R-D7，用户提案：每个尺寸一套独立排版脚本）
 * 选定画幅（非自适应）即切换到该画幅的专属版式——构图、模块取舍、字号节奏随场景变化，
 * 不再是「通用卡缩放塞进画幅」。场景卡是精选分享海报语义：长文按 line-clamp 截断，画幅永远精确。
 * 皮肤：沿用样式模板的主色/底色（TEMPLATE_SKIN），配色变体与封面滤镜在外层照常生效。
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 模板皮肤：主色 / 底色 / 深色底标记（决定场景文字用墨色还是纸色） */
const TEMPLATE_SKIN = {
  paper: { accent: '#617357', bg: '#f7f3e8', dark: false },
  ink: { accent: '#c9a86a', bg: '#1d2025', dark: true },
  mag: { accent: '#c73e3a', bg: '#ffffff', dark: false },
  note: { accent: '#a3573d', bg: '#f6efe0', dark: false },
  min: { accent: '#2a2a2a', bg: '#ffffff', dark: false },
  news: { accent: '#8c2f1b', bg: '#faf6e8', dark: false },
  aurora: { accent: '#7ee0c0', bg: '#141a2e', dark: true },
  mesh: { accent: '#8a6bc2', bg: '#f7f5fa', dark: false },
  blue: { accent: '#2a6b9c', bg: '#f0f5f9', dark: false },
  jade: { accent: '#4a7c6f', bg: '#eef2ec', dark: false },
};

/** 画幅盒（与 preview RATIOS 同表：ratio = 高/宽） */
export const SCENE_BOX = {
  '1:1': { w: 750, h: 750 },
  '3:4': { w: 750, h: 1000 },
  '9:16': { w: 750, h: 1333 },
  '4:3': { w: 1000, h: 750 },
  '16:9': { w: 1333, h: 750 },
  '2.35:1': { w: 1763, h: 750 },
};
export function sceneLayout(ratioId) { return Object.prototype.hasOwnProperty.call(SCENE_BOX, String(ratioId || '')); }

/* ───────────────────────── 公共小件 ───────────────────────── */

const clampN = (lines) => `
  display:-webkit-box; -webkit-line-clamp:${lines}; -webkit-box-orient:vertical; overflow:hidden;`;
const textOf = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const KIND_BADGE = { deepRead: '精读笔记', richSummary: '高质量摘要', summary: 'AI 摘要' };

const stepsList = (d, n, dark) => (Array.isArray(d.steps) && d.steps.length
  ? `<div class="sp-steps">${d.steps.slice(0, n).map((s, i) => `
    <div class="sp-step"><i>${i + 1}</i><div><b>${esc(textOf(s.t, 22))}</b><p>${esc(textOf(s.d, 52))}</p></div></div>`).join('')}</div>`
  : (Array.isArray(d.points) && d.points.length
    ? `<div class="sp-steps">${d.points.slice(0, n).map((s, i) => `
      <div class="sp-step"><i>${i + 1}</i><p>${esc(textOf(typeof s === 'string' ? s : s.t, 56))}</p></div>`).join('')}</div>`
    : ''));

const chipsOf = (d, n) => {
  const items = (d.concepts || []).slice(0, n).map((c) => `<span>${esc(typeof c === 'string' ? c : c.t)}</span>`).join('');
  return items ? `<div class="sp-chips">${items}</div>` : '';
};

const statsOf = (d, n) => (Array.isArray(d.stats) && d.stats.length
  ? `<div class="sp-stats">${d.stats.slice(0, n).map((s) => `<div><b>${esc(textOf(s.v, 8))}</b><span>${esc(textOf(s.l, 12))}</span></div>`).join('')}</div>`
  : '');

const wmOf = (o) => (o.watermark === false ? '' : `<div class="sp-wm">${o.watermarkStyle === 'minimal' ? '知更' : '知更 · RobinRead'}</div>`);

const qrOf = (o) => (o.qr ? `<div class="sp-qr">${o.qr}</div>` : '');

/* ───────────────────────── 六套场景版式 ───────────────────────── */

/** 1:1 朋友圈方卡：中轴对称、上下留白呼吸；有封面时封面占上 42%。 */
function square(d, o, k) {
  const cover = d.cover
    ? `<div class="sp-cover"><img src="${esc(d.cover)}" alt=""/></div>` : '';
  return `
  <div class="sp-card sp-square${k.dark ? ' sp-dark' : ''}${d.cover ? ' has-cover' : ''}">
    ${cover}
    <div class="sp-body">
      <div class="sp-meta">${esc(KIND_BADGE[d.kind] || '阅读笔记')} · ${esc(textOf(d.feedTitle || '知更', 16))}</div>
      <h1 class="sp-title">${esc(textOf(d.title, 64))}</h1>
      <i class="sp-rule"></i>
      <p class="sp-lead">${esc(textOf(d.lead || '', 96))}</p>
      ${statsOf(d, 3)}
      <div class="sp-foot">${esc(String(d.date || '').slice(0, 11))}${qrOf(o)}${wmOf(o)}</div>
    </div>
  </div>`;
}

/** 3:4 小红书竖版：顶图 52% + 标题 + chips + 步骤精选，自上而下信息流。 */
function tall(d, o, k) {
  const cover = d.cover
    ? `<div class="sp-cover"><img src="${esc(d.cover)}" alt=""/></div>`
    : `<div class="sp-cover sp-cover-gen"><b>${esc(textOf(d.title, 2))}</b></div>`;
  return `
  <div class="sp-card sp-tall${k.dark ? ' sp-dark' : ''}">
    ${cover}
    <div class="sp-body">
      <div class="sp-kicker"><span class="sp-badge">${esc(KIND_BADGE[d.kind] || '阅读笔记')}</span><span>${esc(textOf(d.feedTitle || '', 18))}</span></div>
      <h1 class="sp-title">${esc(textOf(d.title, 52))}</h1>
      <p class="sp-lead">${esc(textOf(d.lead || '', 84))}</p>
      ${chipsOf(d, 6)}
      ${stepsList(d, 3)}
      <div class="sp-foot">${esc(String(d.date || '').slice(0, 11))}${qrOf(o)}${wmOf(o)}</div>
    </div>
  </div>`;
}

/** 16:9 幻灯片：左标题区 / 右要点面板；有封面作左区底图加纸色蒙层。 */
function slide(d, o, k) {
  const coverCss = d.cover ? `background:url("${String(d.cover).replace(/"/g, '%22')}") center/cover;` : '';
  return `
  <div class="sp-card sp-slide${k.dark ? ' sp-dark' : ''}${d.cover ? ' has-cover' : ''}">
    <div class="sp-left" style="${coverCss}">
      <div class="sp-veil"></div>
      <div class="sp-left-in">
        <div class="sp-kicker"><span class="sp-badge">${esc(KIND_BADGE[d.kind] || '阅读笔记')}</span></div>
        <h1 class="sp-title">${esc(textOf(d.title, 56))}</h1>
        <p class="sp-lead">${esc(textOf(d.lead || '', 72))}</p>
        <div class="sp-meta">${esc(textOf(d.feedTitle || '知更', 20))} · ${esc(String(d.date || '').slice(0, 11))}</div>
      </div>
    </div>
    <div class="sp-right">
      ${stepsList(d, 4)}
      ${statsOf(d, 2)}
      ${chipsOf(d, 4)}
    </div>
    <div class="sp-footbar">${qrOf(o)}${wmOf(o)}</div>
  </div>`;
}

/** 9:16 手机全屏海报：58% hero 压标题 + 数据行 + 步骤 + 金句。 */
function poster(d, o, k) {
  const cover = d.cover
    ? `<img src="${esc(d.cover)}" alt=""/>`
    : `<div class="sp-gen"><b>${esc(textOf(d.title, 2))}</b></div>`;
  const quote = (d.quotes && d.quotes[0]) || textOf(d.conclusion || d.lead || '', 52);
  return `
  <div class="sp-card sp-poster${k.dark ? ' sp-dark' : ''}">
    <div class="sp-hero">
      ${cover}
      <div class="sp-hero-scrim"></div>
      <div class="sp-hero-in">
        <div class="sp-kicker"><span class="sp-badge">${esc(KIND_BADGE[d.kind] || '阅读笔记')}</span><span>${esc(textOf(d.feedTitle || '', 18))}</span></div>
        <h1 class="sp-title">${esc(textOf(d.title, 56))}</h1>
      </div>
    </div>
    <div class="sp-body">
      ${statsOf(d, 3)}
      ${stepsList(d, 4)}
      ${quote ? `<blockquote class="sp-quote">“${esc(textOf(quote, 60))}”</blockquote>` : ''}
      ${chipsOf(d, 5)}
      <div class="sp-foot">${esc(String(d.date || '').slice(0, 11))}${qrOf(o)}${wmOf(o)}</div>
    </div>
  </div>`;
}

/** 2.35:1 影院横幅：全幅背景 + 暗角 + 左侧安全区（badge/大标题/金句）。 */
function cinema(d, o, k) {
  const quote = (d.quotes && d.quotes[0]) || textOf(d.lead || '', 48);
  const bg = d.cover
    ? `<img class="sp-bgimg" src="${esc(d.cover)}" alt=""/><div class="sp-cine-scrim"></div>`
    : `<div class="sp-cine-flat"></div>`;
  return `
  <div class="sp-card sp-cinema sp-force-dark">
    ${bg}
    <div class="sp-cine-in">
      <div class="sp-kicker"><span class="sp-badge">${esc(KIND_BADGE[d.kind] || '阅读笔记')}</span><span>${esc(textOf(d.feedTitle || '', 18))}</span></div>
      <h1 class="sp-title">${esc(textOf(d.title, 44))}</h1>
      ${quote ? `<p class="sp-quote">“${esc(quote)}”</p>` : ''}
      <div class="sp-foot">${esc(String(d.date || '').slice(0, 11))}${qrOf(o)}${wmOf(o)}</div>
    </div>
  </div>`;
}

/** 4:3 经典收藏卡：上标题中封面下双栏（左步骤 / 右数据+标签）。 */
function classic(d, o, k) {
  const cover = d.cover
    ? `<div class="sp-cover"><img src="${esc(d.cover)}" alt=""/></div>`
    : `<div class="sp-cover sp-cover-gen"><b>${esc(textOf(d.title, 3))}</b></div>`;
  return `
  <div class="sp-card sp-classic${k.dark ? ' sp-dark' : ''}">
    <div class="sp-head">
      <div class="sp-kicker"><span class="sp-badge">${esc(KIND_BADGE[d.kind] || '阅读笔记')}</span><span>${esc(textOf(d.feedTitle || '', 18))} · ${esc(String(d.date || '').slice(0, 11))}</span></div>
      <h1 class="sp-title">${esc(textOf(d.title, 56))}</h1>
      <p class="sp-lead">${esc(textOf(d.lead || '', 64))}</p>
    </div>
    ${cover}
    <div class="sp-cols">
      <div class="sp-col-l">${stepsList(d, 4)}</div>
      <div class="sp-col-r">${statsOf(d, 2)}${chipsOf(d, 4)}</div>
    </div>
    <div class="sp-foot">${qrOf(o)}${wmOf(o)}</div>
  </div>`;
}

const SCENE_FN = { '1:1': square, '3:4': tall, '9:16': poster, '4:3': classic, '16:9': slide, '2.35:1': cinema };

/* ───────────────────────── 场景 CSS（每画幅独立节奏） ───────────────────────── */

function sceneCss(ratioId, k) {
  const ink = k.dark ? '#f2ede1' : '#26221a';
  const sub = k.dark ? 'rgba(242,237,225,.62)' : 'rgba(38,34,26,.58)';
  const line = k.dark ? 'rgba(242,237,225,.18)' : 'rgba(38,34,26,.14)';
  const paper = k.dark ? '#20242b' : '#fffdf8';
  const base = `
  .sp-card{width:100%;height:100%;box-sizing:border-box;background:${k.bg};color:${ink};font-family:Georgia,'Source Han Serif SC','Noto Serif SC',serif;position:relative;overflow:hidden;display:flex;flex-direction:column;}
  .sp-card.sp-dark{}
  .sp-card *{box-sizing:border-box;}
  .sp-kicker{display:flex;align-items:center;gap:10px;color:${sub};font-size:13px;letter-spacing:.06em;}
  .sp-badge{background:${k.accent};color:${k.dark ? '#14161b' : '#fffdf8'};border-radius:999px;padding:3px 12px;font-weight:700;font-size:12px;letter-spacing:.1em;}
  .sp-meta{color:${sub};font-size:13px;letter-spacing:.08em;}
  .sp-title{margin:0;font-weight:800;line-height:1.28;letter-spacing:.01em;}
  .sp-lead{margin:0;color:${sub};line-height:1.75;}
  .sp-rule{display:block;width:34px;height:3px;background:${k.accent};border-radius:2px;}
  .sp-cover{position:relative;overflow:hidden;flex:none;}
  .sp-cover img{width:100%;height:100%;object-fit:cover;display:block;}
  .sp-cover-gen{background:linear-gradient(140deg,${k.accent} 0%,${k.bg} 130%);display:flex;align-items:flex-end;}
  .sp-cover-gen b{color:${k.dark ? 'rgba(242,237,225,.24)' : 'rgba(38,34,26,.14)'};font-size:120px;line-height:.8;padding:18px 26px;letter-spacing:.04em;}
  .sp-chips{display:flex;flex-wrap:wrap;gap:8px;}
  .sp-chips span{border:1px solid ${k.accent};color:${k.accent};border-radius:999px;padding:4px 13px;font-size:12.5px;letter-spacing:.04em;}
  .sp-steps{display:flex;flex-direction:column;gap:13px;}
  .sp-step{display:flex;gap:11px;align-items:flex-start;}
  .sp-step i{flex:none;width:22px;height:22px;border-radius:50%;background:${k.accent};color:${k.dark ? '#14161b' : '#fffdf8'};font-style:normal;font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center;margin-top:2px;}
  .sp-step b{display:block;font-size:14.5px;line-height:1.4;}
  .sp-step p{margin:2px 0 0;font-size:13px;line-height:1.55;color:${sub};}
  .sp-stats{display:flex;gap:26px;}
  .sp-stats b{display:block;font-size:24px;font-weight:800;color:${k.accent};font-variant-numeric:tabular-nums;}
  .sp-stats span{display:block;font-size:12px;color:${sub};margin-top:2px;letter-spacing:.03em;}
  .sp-quote{margin:0;font-size:15.5px;line-height:1.7;font-style:italic;}
  .sp-wm{color:${sub};font-size:12px;letter-spacing:.16em;}
  .sp-qr{display:flex;align-items:center;}
  .sp-qr svg,.sp-qr img{width:52px;height:52px;display:block;background:#fff;padding:4px;border-radius:6px;}
  .sp-foot{display:flex;align-items:center;gap:14px;margin-top:auto;}`;
  const byScene = {
    '1:1': `
      .sp-square{padding:0;}
      .sp-square.has-cover .sp-cover{height:42%;}
      .sp-square .sp-body{flex:1;display:flex;flex-direction:column;align-items:center;text-align:center;padding:36px 58px 30px;gap:16px;}
      .sp-square .sp-title{font-size:33px;${clampN(3)}text-wrap:balance;}
      .sp-square .sp-lead{font-size:14.5px;${clampN(4)}text-wrap:balance;}
      .sp-square .sp-stats{justify-content:center;margin-top:4px;}
      .sp-square .sp-foot{justify-content:center;width:100%;gap:10px;color:${sub};}`,
    '3:4': `
      .sp-tall .sp-cover{height:52%;flex:none;}
      .sp-tall .sp-body{flex:1;display:flex;flex-direction:column;padding:26px 34px 24px;gap:13px;}
      .sp-tall .sp-title{font-size:26px;${clampN(2)}}
      .sp-tall .sp-lead{font-size:14px;${clampN(3)}}
      .sp-tall .sp-steps{margin-top:4px;}`,
    '9:16': `
      .sp-poster .sp-hero{height:58%;flex:none;position:relative;}
      .sp-poster .sp-hero img{width:100%;height:100%;object-fit:cover;display:block;}
      .sp-gen{position:absolute;inset:0;background:linear-gradient(160deg,${k.accent} -20%,${k.bg} 90%);}
      .sp-gen b{position:absolute;left:30px;bottom:18px;color:rgba(255,255,255,.25);font-size:110px;line-height:.8;}
      .sp-hero-scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(10,10,12,.18) 0%,rgba(10,10,12,0) 34%,rgba(10,10,12,.72) 100%);}
      .sp-hero-in{position:absolute;left:30px;right:30px;bottom:20px;color:#fff;}
      .sp-hero-in .sp-kicker{color:rgba(255,255,255,.82);}
      .sp-hero-in .sp-badge{background:rgba(255,255,255,.92);color:#14161b;}
      .sp-hero-in .sp-title{font-size:29px;color:#fff;${clampN(3)}margin-top:10px;text-shadow:0 2px 14px rgba(0,0,0,.4);}
      .sp-poster .sp-body{flex:1;display:flex;flex-direction:column;padding:22px 32px 22px;gap:15px;}
      .sp-poster .sp-stats{padding-top:14px;border-top:1px solid ${line};}
      .sp-poster .sp-quote{border-left:3px solid ${k.accent};padding-left:14px;}
      .sp-poster .sp-lead{display:none;}`,
    '4:3': `
      .sp-classic{padding:30px 38px 24px;}
      .sp-classic .sp-head{display:flex;flex-direction:column;gap:10px;}
      .sp-classic .sp-title{font-size:25px;${clampN(2)}}
      .sp-classic .sp-lead{font-size:13.5px;${clampN(2)}}
      .sp-classic .sp-cover{height:44%;margin:14px 0 16px;border-radius:10px;}
      .sp-classic .sp-cols{flex:1;display:flex;gap:26px;min-height:0;}
      .sp-classic .sp-col-l{flex:1.35;}
      .sp-classic .sp-col-r{flex:1;display:flex;flex-direction:column;gap:14px;border-left:1px solid ${line};padding-left:24px;}
      .sp-classic .sp-foot{padding-top:12px;border-top:1px solid ${line};}`,
    '16:9': `
      .sp-slide{flex-direction:row;}
      .sp-slide .sp-left{width:52%;position:relative;display:flex;align-items:flex-end;}
      .sp-slide.has-cover .sp-veil{position:absolute;inset:0;background:linear-gradient(180deg,${k.bg}F2 0%,${k.bg}D9 100%);}
      .sp-slide:not(.has-cover) .sp-veil{display:none;}
      .sp-left-in{position:relative;padding:40px 34px 36px 46px;display:flex;flex-direction:column;gap:14px;width:100%;}
      .sp-slide .sp-title{font-size:31px;${clampN(3)}text-wrap:balance;}
      .sp-slide .sp-lead{font-size:14px;${clampN(2)}}
      .sp-slide .sp-right{flex:1;background:${paper};border-left:1px solid ${line};padding:34px 40px 30px 34px;display:flex;flex-direction:column;gap:18px;overflow:hidden;}
      .sp-slide .sp-right .sp-steps{gap:15px;}
      .sp-footbar{position:absolute;left:46px;right:40px;bottom:10px;display:flex;justify-content:flex-end;align-items:center;gap:14px;}`,
    '2.35:1': `
      .sp-cinema{align-items:center;}
      .sp-bgimg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
      .sp-cine-scrim{position:absolute;inset:0;background:linear-gradient(90deg,rgba(8,9,12,.86) 0%,rgba(8,9,12,.62) 46%,rgba(8,9,12,.24) 100%);}
      .sp-cine-flat{position:absolute;inset:0;background:linear-gradient(120deg,#101319 0%,#181c24 100%);}
      .sp-cine-flat::after{content:'';position:absolute;left:0;right:0;top:26px;bottom:26px;border:1px solid ${k.accent}55;}
      .sp-cine-in{position:relative;padding:0 0 0 84px;display:flex;flex-direction:column;gap:16px;max-width:58%;}
      .sp-cine-in .sp-title{font-size:42px;color:#f5f1e6;${clampN(2)}text-wrap:balance;}
      .sp-cine-in .sp-quote{color:rgba(245,241,230,.78);font-size:16px;${clampN(2)}}
      .sp-cine-in .sp-kicker{color:rgba(245,241,230,.6);}
      .sp-cine-in .sp-badge{background:${k.accent};color:#101319;}
      .sp-cine-in .sp-foot{color:rgba(245,241,230,.55);}`,
  };
  return base + (byScene[ratioId] || '');
}

/* ───────────────────────── 对外接口 ───────────────────────── */

/**
 * 场景卡渲染（预览用：html 片段 + css + 精确画幅）。
 * @param {string} ratioId 画幅 id（'1:1' / '3:4' / …）
 */
export function renderSceneCard(data, o = {}) {
  const ratioId = o.sceneId || o.ratioId;
  const box = SCENE_BOX[ratioId] || SCENE_BOX['1:1'];
  const k = TEMPLATE_SKIN[o.tplId] || TEMPLATE_SKIN.paper;
  const fn = SCENE_FN[ratioId] || square;
  const filterCss = (o.coverFilter && o.coverFilter !== 'original')
    ? `.sp-cover img,.sp-hero img,.sp-bgimg{filter:${o.coverFilter} !important;}` : '';
  return {
    html: fn(data, o, k),
    css: sceneCss(ratioId, k) + filterCss,
    boxW: box.w, boxH: box.h,
    bg: k.bg,
  };
}

/** 场景整页（导出用：body 直挂 + 外层 zoom；输出尺寸精确 = 画幅 × zoom）。 */
export function renderScenePage(data, o = {}, zoom = 2) {
  const card = renderSceneCard(data, o);
  const vf = o.variantFilterCss || '';
  return {
    html: `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:${card.bg}}
      .sp-export{width:${card.boxW}px;height:${card.boxH}px;zoom:${zoom};${vf}}
    </style><style>${card.css}</style></head><body><div class="sp-export">${card.html}</div></body></html>`,
    bg: card.bg,
    width: Math.round(card.boxW * zoom),
    height: Math.round(card.boxH * zoom),
  };
}
