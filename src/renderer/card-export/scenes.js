'use strict';
/**
 * 场景排版引擎 v2（重新设计，2026-09-30）
 *
 * 需求合同：
 *  1. 画幅 = 横纵比例约定，不限绝对尺寸；
 *  2. 所有内容完整进画幅——零截断（标题/导语/正文/步骤/标签全量）；
 *  3. 内容太大 → 画布等比放大（比例不变，字号不变，文字重排）；
 *  4. 内容不足 → 锁定基准画幅，弹性拉伸填满；
 *  5. 每个比例一套独立排版引擎，按比例动态调用；
 *  6. 排版精美（构图/节奏随比例设计）。
 *
 * 尺寸求解协议（调用方实现测量）：
 *  renderSceneCard(data, o) —— o.width 覆盖基准宽；o.height 给定则锁定画幅（弹性填充），缺省 height:auto（测自然高）。
 *  求解循环：基准宽渲染测 Hn → Hn > W*r 则 W=ceil(Hn/r) 重排（重排变矮，单调收敛）→ Hn ≤ W*r 时锁定 H=round(W*r)。
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 模板皮肤：主色 / 底色 / 深色底标记 */
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

/** 基准盒与比例（h/w）。放大时宽度可增，比例恒定。 */
export const SCENE_BOX = {
  '1:1': { w: 750, r: 1 },
  '3:4': { w: 750, r: 4 / 3 },
  '9:16': { w: 750, r: 16 / 9 },
  '4:3': { w: 1000, r: 3 / 4 },
  '16:9': { w: 1333, r: 9 / 16 },
  '2.35:1': { w: 1763, r: 1 / 2.35 },
};
export function sceneLayout(ratioId) { return Object.prototype.hasOwnProperty.call(SCENE_BOX, String(ratioId || '')); }

/* ───────── 数据整备（零截断，只做规范化与病态保护） ───────── */

const KIND_BADGE = { deepRead: '精读笔记', richSummary: '高质量摘要', summary: 'AI 摘要' };
const cap = (arr, n, label) => {
  if (!Array.isArray(arr) || arr.length <= n) return { list: arr || [], more: 0 };
  return { list: arr.slice(0, n), more: arr.length - n, label };
};

const stripHtml = (s) => String(s || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function prepData(d) {
  const steps = Array.isArray(d.steps) && d.steps.length
    ? d.steps.map((s) => ({ t: stripHtml(s.t), dd: stripHtml(s.d) }))
    : (Array.isArray(d.points) && d.points.length
      ? d.points.map((p) => ({ t: '', dd: stripHtml(typeof p === 'string' ? p : p.t) }))
      : null);
  const paras = String(d.content || d.sections || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .split(/\n{2,}|<\/p>/i)
    .map(stripHtml)
    .filter((p) => p.length > 8);
  if (!steps && paras.length === 0 && d.lead) paras.push(stripHtml(d.lead));
  const cappedSteps = steps ? cap(steps, 32, '条要点') : null;
  const cappedParas = cap(paras, 64, '段');
  const concepts = cap((d.concepts || []).map((c) => stripHtml(typeof c === 'string' ? c : c.t)).filter(Boolean), 24, '个标签');
  return {
    badge: KIND_BADGE[d.kind] || '阅读笔记',
    title: String(d.title || ''),
    lead: stripHtml(d.lead),
    feed: stripHtml(d.feedTitle || ''),
    date: String(d.date || '').slice(0, 11),
    cover: d.cover || null,
    steps: cappedSteps,
    paras: cappedParas,
    concepts,
    stats: Array.isArray(d.stats) ? d.stats.slice(0, 6) : [],
    quotes: Array.isArray(d.quotes) ? d.quotes.map(stripHtml).filter(Boolean) : [],
    conclusion: stripHtml(d.conclusion),
  };
}

/* ───────── 区块渲染子（全量渲染，不截断） ───────── */

const stepsHtml = (p) => {
  if (!p.steps || !p.steps.list.length) return '';
  const items = p.steps.list.map((s, i) => `
    <div class="sp-step"><i>${i + 1}</i><div>${s.t ? `<b>${esc(s.t)}</b>` : ''}<p>${esc(s.dd)}</p></div></div>`).join('');
  return `<div class="sp-steps">${items}</div>${p.steps.more ? `<div class="sp-more">…另有 ${p.steps.more} ${p.steps.label}，见原文</div>` : ''}`;
};

const proseHtml = (p) => {
  if (!p.paras.list.length) return '';
  const items = p.paras.list.map((x) => `<p>${esc(x)}</p>`).join('');
  return `<div class="sp-prose">${items}</div>${p.paras.more ? `<div class="sp-more">…另有 ${p.paras.more} ${p.paras.label}，见原文</div>` : ''}`;
};

const chipsHtml = (p) => (p.concepts.list.length
  ? `<div class="sp-chips">${p.concepts.list.map((c) => `<span>${esc(c)}</span>`).join('')}</div>${p.concepts.more ? `<div class="sp-more">+${p.concepts.more} ${p.concepts.label}</div>` : ''}`
  : '');

const statsHtml = (p) => (p.stats.length
  ? `<div class="sp-stats">${p.stats.map((s) => `<div><b>${esc(String(s.v).slice(0, 10))}</b><span>${esc(String(s.l).slice(0, 16))}</span></div>`).join('')}</div>`
  : '');

const quotesHtml = (p, n) => (p.quotes.length
  ? `<div class="sp-quotes">${p.quotes.slice(0, n).map((q) => `<blockquote>“${esc(q)}”</blockquote>`).join('')}</div>`
  : '');

const wmOf = (o) => (o.watermark === false ? '' : `<div class="sp-wm">${o.watermarkStyle === 'minimal' ? '知更' : '知更 · RobinRead'}</div>`);
const qrOf = (o) => (o.qr ? `<div class="sp-qr">${o.qr}</div>` : '');

/* ───────── 六个排版引擎（每个比例独立构图；区块全弹性，可任意高拉伸） ───────── */

/** 1:1 方形卡：中轴对称。媒体区与文字区弹性分配，内容多则画布放大后文字流自然加长。 */
function square(p, o) {
  return `
  <div class="sp-card sp-square">
    ${p.cover ? `<div class="sp-media"><img src="${esc(p.cover)}" alt=""/></div>` : ''}
    <div class="sp-main">
      <div class="sp-kicker"><span class="sp-badge">${esc(p.badge)}</span><span>${esc(p.feed)}</span></div>
      <h1 class="sp-title">${esc(p.title)}</h1>
      <i class="sp-rule"></i>
      ${p.lead ? `<p class="sp-lead">${esc(p.lead)}</p>` : ''}
      ${proseHtml(p)}
      ${stepsHtml(p)}
      ${statsHtml(p)}
      ${quotesHtml(p, 1)}
      <div class="sp-foot">${esc(p.date)}${qrOf(o)}${wmOf(o)}</div>
    </div>
  </div>`;
}

/** 3:4 竖版信息流：顶部媒体 + 连续信息流（标题/导语/标签/步骤或正文）。 */
function tall(p, o) {
  return `
  <div class="sp-card sp-tall">
    ${p.cover
    ? `<div class="sp-media"><img src="${esc(p.cover)}" alt=""/></div>`
    : `<div class="sp-media sp-gen"><b>${esc(p.title.slice(0, 2))}</b></div>`}
    <div class="sp-main">
      <div class="sp-kicker"><span class="sp-badge">${esc(p.badge)}</span><span>${esc(p.feed)}</span></div>
      <h1 class="sp-title">${esc(p.title)}</h1>
      ${p.lead ? `<p class="sp-lead">${esc(p.lead)}</p>` : ''}
      ${chipsHtml(p)}
      ${stepsHtml(p)}
      ${proseHtml(p)}
      ${quotesHtml(p, 2)}
      ${statsHtml(p)}
      <div class="sp-foot">${esc(p.date)}${qrOf(o)}${wmOf(o)}</div>
    </div>
  </div>`;
}

/** 9:16 全屏海报：hero 压标题 + 数据 + 步骤/正文 + 金句。 */
function poster(p, o) {
  return `
  <div class="sp-card sp-poster">
    <div class="sp-hero">
      ${p.cover ? `<img src="${esc(p.cover)}" alt=""/>` : `<div class="sp-gen"><b>${esc(p.title.slice(0, 2))}</b></div>`}
      <div class="sp-hero-scrim"></div>
      <div class="sp-hero-in">
        <div class="sp-kicker"><span class="sp-badge">${esc(p.badge)}</span><span>${esc(p.feed)}</span></div>
        <h1 class="sp-title">${esc(p.title)}</h1>
      </div>
    </div>
    <div class="sp-main">
      ${statsHtml(p)}
      ${stepsHtml(p)}
      ${proseHtml(p)}
      ${quotesHtml(p, 2)}
      ${chipsHtml(p)}
      <div class="sp-foot">${esc(p.date)}${qrOf(o)}${wmOf(o)}</div>
    </div>
  </div>`;
}

/** 4:3 经典卡：题头 + 媒体 + 双栏（左主文流 / 右辅助数据标签）。 */
function classic(p, o) {
  const right = statsHtml(p) + chipsHtml(p) + quotesHtml(p, 1);
  return `
  <div class="sp-card sp-classic">
    <div class="sp-head">
      <div class="sp-kicker"><span class="sp-badge">${esc(p.badge)}</span><span>${esc(p.feed)} · ${esc(p.date)}</span></div>
      <h1 class="sp-title">${esc(p.title)}</h1>
      ${p.lead ? `<p class="sp-lead">${esc(p.lead)}</p>` : ''}
    </div>
    ${p.cover
    ? `<div class="sp-media"><img src="${esc(p.cover)}" alt=""/></div>`
    : `<div class="sp-media sp-gen"><b>${esc(p.title.slice(0, 3))}</b></div>`}
    <div class="sp-cols${right ? '' : ' single'}">
      <div class="sp-col-l">${stepsHtml(p)}${proseHtml(p)}</div>
      ${right ? `<div class="sp-col-r">${right}</div>` : ''}
    </div>
    <div class="sp-foot">${qrOf(o)}${wmOf(o)}</div>
  </div>`;
}

/** 16:9 幻灯片：左题区（媒体底）+ 右内容流。内容长则右侧流加长 → 画布放大 → 右流重排变矮，天然收敛。 */
function slide(p, o) {
  return `
  <div class="sp-card sp-slide">
    <div class="sp-left"${p.cover ? ` style="background:url('${String(p.cover).replace(/'/g, '%27')}') center/cover"` : ''}>
      ${p.cover ? '<div class="sp-veil"></div>' : ''}
      <div class="sp-left-in">
        <div class="sp-kicker"><span class="sp-badge">${esc(p.badge)}</span></div>
        <h1 class="sp-title">${esc(p.title)}</h1>
        ${p.lead ? `<p class="sp-lead">${esc(p.lead)}</p>` : ''}
        <div class="sp-meta">${esc(p.feed)} · ${esc(p.date)}</div>
      </div>
    </div>
    <div class="sp-right">
      ${stepsHtml(p)}
      ${proseHtml(p)}
      ${statsHtml(p)}
      ${quotesHtml(p, 1)}
      ${chipsHtml(p)}
      <div class="sp-foot">${qrOf(o)}${wmOf(o)}</div>
    </div>
  </div>`;
}

/** 2.35:1 影院横幅：全幅背景暗角 + 左安全区（题/金句）+ 右侧半透明内容流面板。 */
function cinema(p, o) {
  return `
  <div class="sp-card sp-cinema">
    ${p.cover ? `<img class="sp-bgimg" src="${esc(p.cover)}" alt=""/><div class="sp-cine-scrim"></div>` : '<div class="sp-cine-flat"></div>'}
    <div class="sp-cine-left">
      <div class="sp-kicker"><span class="sp-badge">${esc(p.badge)}</span><span>${esc(p.feed)}</span></div>
      <h1 class="sp-title">${esc(p.title)}</h1>
      ${p.lead ? `<p class="sp-quote">${esc(p.lead)}</p>` : ''}
      <div class="sp-foot">${esc(p.date)}${wmOf(o)}</div>
    </div>
    <div class="sp-cine-right">
      ${stepsHtml(p)}
      ${proseHtml(p)}
      ${quotesHtml(p, 2)}
      ${statsHtml(p)}
      ${qrOf(o)}
    </div>
  </div>`;
}

const SCENE_FN = { '1:1': square, '3:4': tall, '9:16': poster, '4:3': classic, '16:9': slide, '2.35:1': cinema };

/* ───────── CSS（弹性节奏：锁定画幅时区块拉伸，auto 时自然高） ───────── */

function sceneCss(ratioId, k) {
  const ink = k.dark ? '#f2ede1' : '#26221a';
  const sub = k.dark ? 'rgba(242,237,225,.64)' : 'rgba(38,34,26,.60)';
  const line = k.dark ? 'rgba(242,237,225,.18)' : 'rgba(38,34,26,.14)';
  const panel = k.dark ? 'rgba(255,252,244,.06)' : '#fffdf8';
  const base = `
  .sp-card{width:100%;box-sizing:border-box;background:${k.bg};color:${ink};font-family:Georgia,'Source Han Serif SC','Noto Serif SC',serif;position:relative;overflow:hidden;display:flex;flex-direction:column;}
  .sp-card *{box-sizing:border-box;}
  .sp-kicker{display:flex;align-items:center;gap:10px;color:${sub};font-size:13px;letter-spacing:.06em;}
  .sp-badge{background:${k.accent};color:${k.dark ? '#14161b' : '#fffdf8'};border-radius:999px;padding:3px 12px;font-weight:700;font-size:12px;letter-spacing:.1em;white-space:nowrap;}
  .sp-meta{color:${sub};font-size:13px;letter-spacing:.08em;}
  .sp-title{margin:0;font-weight:800;line-height:1.3;letter-spacing:.01em;text-wrap:balance;}
  .sp-lead{margin:0;color:${sub};line-height:1.8;font-size:15px;}
  .sp-rule{display:block;width:34px;height:3px;background:${k.accent};border-radius:2px;flex:none;}
  .sp-media{position:relative;overflow:hidden;flex:none;}
  .sp-media img{width:100%;height:100%;object-fit:cover;display:block;}
  .sp-gen{background:linear-gradient(140deg,${k.accent} 0%,${k.bg} 135%);display:flex;align-items:flex-end;height:100%;}
  .sp-gen b{color:${k.dark ? 'rgba(242,237,225,.24)' : 'rgba(38,34,26,.14)'};font-size:110px;line-height:.82;padding:16px 26px;letter-spacing:.04em;}
  .sp-chips{display:flex;flex-wrap:wrap;gap:8px;}
  .sp-chips span{border:1px solid ${k.accent};color:${k.accent};border-radius:999px;padding:4px 13px;font-size:12.5px;letter-spacing:.04em;}
  .sp-steps{display:flex;flex-direction:column;gap:13px;}
  .sp-step{display:flex;gap:11px;align-items:flex-start;}
  .sp-step i{flex:none;width:22px;height:22px;border-radius:50%;background:${k.accent};color:${k.dark ? '#14161b' : '#fffdf8'};font-style:normal;font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center;margin-top:2px;}
  .sp-step b{display:block;font-size:14.5px;line-height:1.4;}
  .sp-step p{margin:2px 0 0;font-size:13.5px;line-height:1.66;color:${sub};text-align:justify;}
  .sp-prose p{margin:0 0 12px;font-size:14px;line-height:1.82;color:${sub};text-align:justify;}
  .sp-prose p:last-child{margin-bottom:0;}
  .sp-more{margin-top:8px;font-size:12px;color:${sub};letter-spacing:.04em;}
  .sp-stats{display:flex;flex-wrap:wrap;gap:14px 26px;}
  .sp-stats b{display:block;font-size:23px;font-weight:800;color:${k.accent};font-variant-numeric:tabular-nums;}
  .sp-stats span{display:block;font-size:12px;color:${sub};margin-top:2px;letter-spacing:.03em;}
  .sp-quotes blockquote{margin:0;font-size:15px;line-height:1.75;font-style:italic;border-left:3px solid ${k.accent};padding-left:14px;}
  .sp-quotes blockquote + blockquote{margin-top:10px;}
  .sp-quote{margin:0;font-size:15.5px;line-height:1.7;font-style:italic;}
  .sp-wm{color:${sub};font-size:12px;letter-spacing:.16em;white-space:nowrap;}
  .sp-qr{display:flex;align-items:center;}
  .sp-qr svg,.sp-qr img{width:50px;height:50px;display:block;background:#fff;padding:4px;border-radius:6px;}
  .sp-foot{display:flex;align-items:center;gap:14px;margin-top:auto;flex:none;}`;
  const byScene = {
    '1:1': `
      .sp-square .sp-media{flex:1 1 auto;min-height:230px;}
      .sp-square .sp-main{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;text-align:center;padding:34px 54px 28px;gap:15px;justify-content:safe center;}
      .sp-square .sp-title{font-size:32px;}
      .sp-square .sp-lead,.sp-square .sp-prose p,.sp-square .sp-quotes blockquote{text-align:center;}
      .sp-square .sp-stats{justify-content:center;}
      .sp-square .sp-foot{justify-content:center;width:100%;gap:10px;color:${sub};}`,
    '3:4': `
      .sp-tall .sp-media{flex:1 1 auto;min-height:330px;}
      .sp-tall .sp-main{flex:0 0 auto;display:flex;flex-direction:column;justify-content:safe center;padding:26px 36px 24px;gap:14px;}
      .sp-tall .sp-title{font-size:26px;}
      .sp-tall .sp-lead{font-size:14.5px;}`,
    '9:16': `
      .sp-poster .sp-hero{position:relative;flex:1 1 auto;min-height:430px;}
      .sp-poster .sp-hero img{width:100%;height:100%;object-fit:cover;display:block;position:absolute;inset:0;}
      .sp-poster .sp-gen{position:absolute;inset:0;}
      .sp-hero-scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(10,10,12,.16) 0%,rgba(10,10,12,0) 36%,rgba(10,10,12,.74) 100%);}
      .sp-hero-in{position:absolute;left:30px;right:30px;bottom:20px;color:#fff;display:flex;flex-direction:column;gap:10px;}
      .sp-hero-in .sp-kicker{color:rgba(255,255,255,.85);}
      .sp-hero-in .sp-badge{background:rgba(255,255,255,.92);color:#14161b;}
      .sp-hero-in .sp-title{font-size:29px;color:#fff;text-shadow:0 2px 14px rgba(0,0,0,.45);}
      .sp-poster .sp-main{flex:0 0 auto;display:flex;flex-direction:column;justify-content:safe center;padding:24px 32px 22px;gap:16px;}
      .sp-poster .sp-stats{padding-top:14px;border-top:1px solid ${line};}`,
    '4:3': `
      .sp-classic{padding:30px 40px 24px;}
      .sp-classic .sp-head{display:flex;flex-direction:column;gap:10px;flex:none;}
      .sp-classic .sp-title{font-size:25px;}
      .sp-classic .sp-lead{font-size:13.5px;}
      .sp-classic .sp-media{flex:1 1 auto;min-height:200px;margin:14px 0 16px;border-radius:10px;}
      .sp-classic .sp-cols{flex:none;display:flex;gap:28px;}
      .sp-classic .sp-cols.single{gap:0;}
      .sp-classic .sp-col-l{flex:1.35;display:flex;flex-direction:column;justify-content:safe center;}
      .sp-classic .sp-col-r{flex:1;display:flex;flex-direction:column;gap:16px;justify-content:safe center;border-left:1px solid ${line};padding-left:26px;}
      .sp-classic .sp-foot{flex:none;padding-top:12px;border-top:1px solid ${line};}`,
    '16:9': `
      .sp-slide{flex-direction:row;}
      .sp-slide .sp-left{width:46%;position:relative;display:flex;align-items:flex-end;flex:none;}
      .sp-veil{position:absolute;inset:0;background:linear-gradient(180deg,${k.bg}F0 0%,${k.bg}D6 100%);}
      .sp-left-in{position:relative;padding:38px 30px 34px 44px;display:flex;flex-direction:column;gap:13px;width:100%;}
      .sp-slide .sp-title{font-size:30px;}
      .sp-slide .sp-lead{font-size:14px;}
      .sp-slide .sp-right{flex:1;background:${panel};border-left:1px solid ${line};padding:32px 38px 26px 32px;display:flex;flex-direction:column;gap:16px;justify-content:safe center;}`,
    '2.35:1': `
      .sp-cinema{flex-direction:row;align-items:stretch;}
      .sp-bgimg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
      .sp-cine-scrim{position:absolute;inset:0;background:linear-gradient(90deg,rgba(8,9,12,.88) 0%,rgba(8,9,12,.55) 52%,rgba(8,9,12,.34) 100%);}
      .sp-cine-flat{position:absolute;inset:0;background:linear-gradient(120deg,#101319 0%,#181c24 100%);}
      .sp-cine-flat::after{content:'';position:absolute;left:0;right:0;top:24px;bottom:24px;border:1px solid ${k.accent}55;}
      .sp-cine-left{position:relative;width:44%;flex:none;display:flex;flex-direction:column;justify-content:center;gap:15px;padding:0 0 0 76px;color:#f5f1e6;}
      .sp-cine-left .sp-kicker{color:rgba(245,241,230,.62);}
      .sp-cine-left .sp-badge{background:${k.accent};color:#101319;}
      .sp-cine-left .sp-title{font-size:40px;color:#f5f1e6;}
      .sp-cine-left .sp-quote{color:rgba(245,241,230,.8);}
      .sp-cine-left .sp-foot{color:rgba(245,241,230,.55);}
      .sp-cine-right{position:relative;flex:1;background:rgba(10,11,14,.42);backdrop-filter:blur(2px);border-left:1px solid rgba(245,241,230,.16);padding:30px 38px 26px 34px;display:flex;flex-direction:column;gap:14px;justify-content:center;color:#e9e4d6;}
      .sp-cine-right .sp-step p,.sp-cine-right .sp-prose p{color:rgba(233,228,214,.78);}
      .sp-cine-right .sp-wm{color:rgba(233,228,214,.55);}`,
  };
  return base + (byScene[ratioId] || '');
}

/* ───────── 对外接口 ───────── */

/**
 * 场景卡渲染。
 * @param {object} o { sceneId, tplId, coverFilter, qr, watermark, watermarkStyle }
 *   尺寸协议：o.width 覆盖基准宽；o.height 给定 → 锁定画幅（区块弹性拉伸填满）；缺省 → height:auto（测自然高）。
 */
export function renderSceneCard(data, o = {}) {
  const ratioId = o.sceneId || o.ratioId;
  const base = SCENE_BOX[ratioId] || SCENE_BOX['1:1'];
  const W = Math.round(o.width || base.w);
  const k = TEMPLATE_SKIN[o.tplId] || TEMPLATE_SKIN.paper;
  const p = prepData(data);
  const fn = SCENE_FN[ratioId] || square;
  const lockCss = o.height
    ? `.sp-card{height:${Math.round(o.height)}px;}`
    : '.sp-card{height:auto;}'; // 测量页纯自然高（不带 min-height，否则读数被撑高污染求解）
  const filterCss = (o.coverFilter && o.coverFilter !== 'original')
    ? `.sp-media img,.sp-hero img,.sp-bgimg{filter:${o.coverFilter} !important;}` : '';
  return {
    html: `<div style="width:${W}px">${fn(p, o)}</div>`,
    css: sceneCss(ratioId, k) + lockCss + filterCss,
    boxW: W,
    boxH: o.height ? Math.round(o.height) : null,
    bg: k.bg,
  };
}

/** 场景整页（导出）。o.width/o.height 协议同上；高度锁定页输出精确比例。 */
export function renderScenePage(data, o = {}, zoom = 2) {
  const card = renderSceneCard(data, o);
  const vf = o.variantFilterCss || '';
  return {
    html: `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:${card.bg}}
      .sp-export{width:${card.boxW}px;zoom:${zoom};${vf}}
    </style><style>${card.css}</style></head><body><div class="sp-export">${card.html}</div></body></html>`,
    bg: card.bg,
    width: Math.round(card.boxW * zoom),
    height: card.boxH != null ? Math.round(card.boxH * zoom) : null,
  };
}

/** 求解下一步宽度（纯函数，预览/导出共用）：自然高超比例 → 等比放大宽度。 */
export function nextSceneWidth(naturalH, ratio, curW) {
  return Math.max(curW + 1, Math.ceil((naturalH + 8) / ratio));
}
