/* ==========================================================================
   知更 RobinRead — 精读卡片导出预览弹窗
   左侧模板与选项、右侧 shadow DOM 所见即所得预览；保存 PNG / 复制剪贴板。
   预览与导出走同一 renderCard 代码，保证所见即所得。
   ========================================================================== */
import { t } from '../i18n.js';
const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
import { CARD_TEMPLATES, KIND_BADGES, CARD_WIDTH, CARD_VARIANTS, COVER_FILTERS, DENSITY, FONT_PAIRS, renderFullPage, variantFilter, renderCard, renderCardFitted } from './templates.js';

const PREF_KEY = 'robinread.cardExport';
const CARD_FAV_KEY = 'robinread.cardExport.favs';
const loadFavs = () => { try { return JSON.parse(localStorage.getItem(CARD_FAV_KEY) || '[]'); } catch (_) { return []; } };
const saveFavs = (f) => localStorage.setItem(CARD_FAV_KEY, JSON.stringify(f));
const RATIOS = [
  { id: 'auto', label: '自适应', ratio: null },
  { id: '3:4', label: '3:4', ratio: 4 / 3 },
  { id: '9:16', label: '9:16', ratio: 16 / 9 },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 3 / 4 },
  { id: '16:9', label: '16:9', ratio: 9 / 16 },
  { id: '2.35:1', label: '2.35:1', ratio: 1 / 2.35 },
];
const TEMPLATE_SWATCH = {
  paper: ['#617357', '#f7f3e8'], ink: ['#c9a86a', '#1d2025'], mag: ['#c73e3a', '#ffffff'],
  note: ['#b23a2c', '#faf6ee'], min: ['#1f2329', '#ffffff'], news: ['#8c2f24', '#f4eeda'],
};

const STYLE_CSS = `
.cardx-modal { width: min(960px, calc(100vw - 72px)); height: min(700px, calc(100vh - 72px)); flex-direction: column; display: flex; }
.cardx-head { display: flex; align-items: center; padding: 14px 20px 12px; border-bottom: 1px solid var(--separator); }
.cardx-head h3 { font-size: 14px; font-weight: 700; flex: 1; margin: 0; }
.cardx-close { border: 0; background: none; color: var(--text-tertiary); cursor: pointer; padding: 4px; border-radius: 6px; }
.cardx-close:hover { color: var(--text-primary); background: var(--row-hover); }
.cardx-body { flex: 1; display: flex; min-height: 0; }
.cardx-side { width: 216px; flex-shrink: 0; background: var(--sidebar-background); border-right: 1px solid var(--separator);
  overflow-y: auto; padding: 14px 10px; scrollbar-width: thin; }
.cardx-side-h { font-size: 11px; font-weight: 700; letter-spacing: 2px; color: var(--text-tertiary); padding: 4px 8px 8px; }
.cardx-tpl { display: flex; align-items: center; gap: 9px; padding: 7px 9px; border-radius: 8px; cursor: default; }
.cardx-tpl:hover { background: var(--row-hover); }
.cardx-tpl.active { background: var(--row-selected); }
.cardx-swatch { flex: none; width: 22px; height: 22px; border-radius: 6px; border: 1px solid var(--note-border);
  display: flex; align-items: center; justify-content: center; }
.cardx-swatch i { display: block; width: 10px; height: 10px; border-radius: 50%; }
.cardx-tpl-name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.cardx-tpl.active .cardx-tpl-name { color: var(--accent); }
.cardx-tpl-hint { font-size: 10.5px; color: var(--text-tertiary); margin-top: 1px; }
.cardx-optgroup { border-top: 1px solid var(--separator); margin-top: 10px; padding-top: 10px; }
.cardx-seg { display: flex; gap: 4px; padding: 0 8px 6px; }
.cardx-seg button { flex: 1; border: 1px solid var(--note-border); background: transparent; color: var(--text-secondary);
  font-size: 11.5px; padding: 4px 0; border-radius: 6px; cursor: pointer; }
.cardx-seg button.active { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.cardx-check { display: flex; align-items: center; gap: 8px; padding: 5px 10px; font-size: 12.5px;
  color: var(--text-secondary); cursor: default; border-radius: 6px; }
.cardx-check:hover { background: var(--row-hover); }
.cardx-check input { accent-color: var(--accent); }
.cardx-preview-wrap { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--chrome-background); }
.cardx-preview { flex: 1; overflow: auto; padding: 18px; display: flex; justify-content: center; align-items: flex-start; }
.cardx-preview::-webkit-scrollbar { width: 8px; }
.cardx-preview::-webkit-scrollbar-thumb { background: var(--separator); border-radius: 4px; }
.cardx-host { width: 342px; flex: none; }
.cardx-cap { text-align: center; font-size: 11px; color: var(--text-tertiary); padding: 8px 0 10px; }
.cardx-foot { display: flex; align-items: center; gap: 10px; padding: 12px 20px; border-top: 1px solid var(--separator); }
.cardx-status { flex: 1; font-size: 12.5px; color: var(--text-secondary); }
.cardx-status.err { color: #c93b3b; }
.cardx-foot .btn { min-width: 96px; }
.cardx-more { border-top: 1px solid var(--separator); margin-top: 12px; padding-top: 10px; }
.cardx-more summary { list-style: none; cursor: pointer; font-size: 11px; font-weight: 700; letter-spacing: 2px;
  color: var(--text-tertiary); padding: 4px 8px 8px; display: flex; align-items: center; gap: 6px; }
.cardx-more summary::-webkit-details-marker { display: none; }
.cardx-more summary::before { content: '▸'; font-size: 10px; transition: transform var(--dur-fast) var(--ease-out); }
.cardx-more[open] summary::before { transform: rotate(90deg); }
.cardx-more[open] summary { color: var(--accent); }
.cardx-more .cardx-side-h { margin-top: 10px; }
.cardx-more .cardx-side-h:first-child { margin-top: 2px; }
.cardx-side-h.cardx-variant-h { margin-top: 12px; }
.cardx-seg { flex-wrap: wrap; }
.cardx-seg button { white-space: nowrap; flex: 1 1 auto; min-width: 44px; padding: 4px 8px; }
.cardx-fav { width: 100%; margin: 8px 0 2px; padding: 6px 9px; border: 1px dashed var(--note-border); border-radius: 8px;
  background: transparent; color: var(--text-tertiary); font-size: 11.5px; cursor: pointer; text-align: left; }
.cardx-fav:hover { color: var(--accent); border-color: var(--accent); }
.cardx-fav.on { color: var(--accent); border-style: solid; font-weight: 600; }
`;

function sanitizeFileName(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function loadPrefs() {
  try { return { tpl: 'paper', ratio: 'auto', zoom: 2, cover: true, stats: true, qr: true, watermark: true, variant: 'original', coverFilter: 'original', density: 'standard', fontPair: 'default', watermarkStyle: 'brand', lengthMode: 'standard', format: 'png', verticalTitle: false, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; }
  catch (_) { return { tpl: 'paper', ratio: 'auto', zoom: 2, cover: true, stats: true, qr: true, watermark: true, variant: 'original', coverFilter: 'original', density: 'standard', fontPair: 'default', watermarkStyle: 'brand', lengthMode: 'standard', format: 'png', verticalTitle: false }; }
}

let qrCache = { link: null, svg: null };
async function getQrSvg(link) {
  if (!link) return null;
  if (qrCache.link === link && qrCache.svg) return qrCache.svg;
  try {
    const mod = await import('../vendor/qrcode.js');
    const qrcode = mod.default;
    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    qrCache = { link, svg: qr.createSvgTag(4, 0) };
    return qrCache.svg;
  } catch (_) { return null; }
}

/**
 * 打开导出预览弹窗。
 * @param {object} p { data: 卡片数据(含 title/feedTitle/date/cover/正文结构), link: 原文链接 }
 */
export async function openCardExportModal({ data, link = '' }) {
  const prefs = loadPrefs();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal cardx-modal';
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  if (!document.getElementById('robin-cardx-style')) {
    const style = document.createElement('style');
    style.id = 'robin-cardx-style';
    style.textContent = STYLE_CSS;
    document.head.appendChild(style);
  }

  const state = { ...prefs };
  let busy = false;
  let qrSvg = null;

  const dismiss = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') dismiss();
    else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); modal.querySelector('.cardx-save')?.click(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C') && !String(window.getSelection && window.getSelection() || '')) { e.preventDefault(); modal.querySelector('.cardx-copy')?.click(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const idx = CARD_TEMPLATES.findIndex((tpl) => tpl.id === state.tpl);
      const next = CARD_TEMPLATES[(idx + (e.key === 'ArrowRight' ? 1 : CARD_TEMPLATES.length - 1)) % CARD_TEMPLATES.length];
      state.tpl = next.id;
      persist();
      renderSidebar();
      renderPreview();
    }
  };
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) dismiss(); });
  document.addEventListener('keydown', onKey);

  modal.innerHTML = `
    <div class="cardx-head">
      <h3>${t('导出精读卡片图')}</h3>
      <button class="cardx-close" title="${t('关闭')}">✕</button>
    </div>
    <div class="cardx-body">
      <div class="cardx-side">
        <div class="cardx-side-h">${t('样式模板')}</div>
        <div class="cardx-tpls"></div>
        <div class="cardx-optgroup">
          <div class="cardx-side-h">${t('画幅与配色')}</div>
          <div class="cardx-seg cardx-ratio"></div>
          <div class="cardx-side-h cardx-variant-h">${t('配色变体')}</div>
          <div class="cardx-seg cardx-variant"></div>
        </div>
        <details class="cardx-more">
          <summary>${t('更多设置')}</summary>
          <div class="cardx-side-h">${t('封面滤镜')}</div>
          <div class="cardx-seg cardx-filter"></div>
          <div class="cardx-side-h">${t('排版密度')}</div>
          <div class="cardx-seg cardx-density"></div>
          <div class="cardx-side-h">${t('字体搭配')}</div>
          <div class="cardx-seg cardx-fontpair"></div>
          <div class="cardx-side-h">${t('水印样式')}</div>
          <div class="cardx-seg cardx-wmstyle"></div>
          <div class="cardx-side-h">${t('内容长度')}</div>
          <div class="cardx-seg cardx-lenmode"></div>
          <label class="cardx-check"><input type="checkbox" data-opt="vtitle-check" ${state.verticalTitle ? 'checked' : ''}/>${escapeHTML(t('竖排标题'))}</label>
        </details>
        <div class="cardx-optgroup">
          <div class="cardx-side-h">${t('清晰度')}</div>
          <div class="cardx-seg cardx-zoom"></div>
        </div>
        <div class="cardx-optgroup">
          <div class="cardx-side-h">${t('内容选项')}</div>
          <label class="cardx-check"><input type="checkbox" data-opt="cover">${t('文章配图')}</label>
          <label class="cardx-check"><input type="checkbox" data-opt="stats">${t('数据高亮卡')}</label>
          <label class="cardx-check"><input type="checkbox" data-opt="qr">${t('原文二维码')}</label>
          <label class="cardx-check"><input type="checkbox" data-opt="watermark">${t('知更水印')}</label>
        </div>
      </div>
      <div class="cardx-preview-wrap">
        <div class="cardx-preview"><div class="cardx-host"></div></div>
        <div class="cardx-cap"></div>
      </div>
    </div>
    <div class="cardx-foot">
      <span class="cardx-status"></span>
      <button class="btn cardx-copy">${t('复制到剪贴板')}</button>
      <button class="btn cardx-html">${t('保存 HTML')}</button>
      <button class="btn cardx-batch">${t('打包全部模板')}</button>
      <button class="btn primary cardx-save">${t('保存图片')}</button>
    </div>`;
  modal.querySelector('.cardx-close').addEventListener('click', dismiss);

  const host = modal.querySelector('.cardx-host');
  const capEl = modal.querySelector('.cardx-cap');
  const statusEl = modal.querySelector('.cardx-status');
  const shadow = host.attachShadow({ mode: 'open' });

  const setStatus = (msg, isErr = false) => {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('err', isErr);
  };

  const cardOptions = () => ({
    orientation: (() => { const r = RATIOS.find((x) => x.id === state.ratio)?.ratio; return r && r < 1 ? 'landscape' : 'portrait'; })(),
    templateId: state.tpl,
    variant: state.variant,
    cover: state.cover,
    stats: state.stats,
    watermark: state.watermark,
    coverFilter: state.coverFilter,
    density: state.density,
    fontPair: state.fontPair,
    watermarkStyle: state.watermarkStyle,
    lengthMode: state.lengthMode,
    verticalTitle: state.verticalTitle,
    accentColor: state.accentColor || null,
    qr: state.qr ? qrSvg : null,
  });

  let previewSeq = 0;
  function renderPreview() {
    const seq = ++previewSeq;
    const ratio = RATIOS.find((x) => x.id === state.ratio)?.ratio ?? null;
    if (ratio != null) return renderFittedPreview(ratio, seq);
    const card = renderCard(data, cardOptions());
    const p = host.clientWidth ? host.clientWidth / CARD_WIDTH : 0.456;
    shadow.innerHTML = `<style>${card.css}
      .cardx-scale { zoom: ${p}; }</style>
      <div class="cardx-scale">${card.html}</div>`;
    const cardEl = shadow.querySelector('.xc-card');
    // 取色（C4）：有封面时提取主色做卡片底部色带
    if (data.cover && data.cover.startsWith('data:image') && !state.accentColor) {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = 24; c.height = 24;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0, 24, 24);
          const px = ctx.getImageData(0, 0, 24, 24).data;
          let r = 0, g = 0, b = 0, n = 0;
          for (let i = 0; i < px.length; i += 4) {
            const [R, G, B] = [px[i], px[i + 1], px[i + 2]];
            const sat = Math.max(R, G, B) - Math.min(R, G, B);
            if (sat < 12 && R > 235) continue; // 跳过近白
            r += R; g += G; b += B; n += 1;
          }
          if (n > 0) {
            state.accentColor = '#' + [r / n, g / n, b / n].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
            renderPreview();
          }
        } catch (_) { /* 取色失败不阻塞 */ }
      };
      img.src = data.cover;
    }
    // 卡上双击编辑（C6）：双击标题/导语改字，失焦写回数据并重渲染
    cardEl.addEventListener('dblclick', (e) => {
      const el = e.target.closest('.xc-title, .xc-lead');
      if (!el || el.isContentEditable) return;
      el.contentEditable = 'true';
      el.focus();
      const done = () => {
        el.contentEditable = 'false';
        const txt = el.textContent.trim();
        if (el.classList.contains('xc-title')) data.title = txt;
        else if (el.classList.contains('xc-lead')) data.lead = txt;
        renderPreview();
      };
      el.addEventListener('blur', done, { once: true });
      el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); } });
    });
    capEl.classList.add('cardx-editable-hint');
    const rectH = cardEl.getBoundingClientRect().height;
    const naturalH = rectH / p;
    const longHint = naturalH > 9000 ? ` · ${t('内容较长，已排为超长图')}` : '';
    capEl.textContent = `${t('导出尺寸')} ${CARD_WIDTH * state.zoom}×${Math.round(naturalH) * state.zoom}px · ${t('高清输出')}${state.zoom}x${longHint}`;
  }

  /** 固定画幅预览（与导出 fit-to-fill 同一渲染参数）：实测内容高 → 填充/紧凑注入 → 弹性铺满画幅。 */
  function renderFittedPreview(ratio, seq) {
    const measure = (html, css) => {
      shadow.innerHTML = `<style>${css}</style><div style="position:absolute;left:-99999px;top:0;width:${Math.round(CARD_WIDTH / (ratio < 1 ? ratio : 1))}px;">${html}</div>`;
      const el = shadow.querySelector('.xc-card');
      return el ? Math.ceil(el.getBoundingClientRect().height) : 0;
    };
    const paint = (fitted, finalZoom = 1) => {
      const p = host.clientWidth ? host.clientWidth / fitted.boxW : 0.4;
      const vf = variantFilter(state.variant);
      // contain 用 transform:scale（不与 density 内联 zoom / 外层 zoom 合成链相互干扰）
      shadow.innerHTML = `<style>${fitted.css}
        .cardx-scale { zoom: ${p}; }
        .cardx-stage { width:${fitted.boxW}px; height:${fitted.boxH}px; display:flex; align-items:flex-start; justify-content:center; overflow:hidden; background:${fitted.bg}; ${vf !== 'none' ? `filter:${vf}` : ''} }
        .cardx-stage > .xc-card { width:${fitted.boxW}px; flex:none; transform: scale(${finalZoom}); transform-origin: top center; }
        .cardx-stage { border-radius: 8px; }</style>
        <div class="cardx-scale"><div class="cardx-stage">${fitted.html}</div></div>`;
      capEl.classList.add('cardx-editable-hint');
      capEl.textContent = `${t('导出尺寸')} ${fitted.boxW * state.zoom}×${fitted.boxH * state.zoom}px · ${t('画幅铺满')}`;
    };
    // pass1：自然内容高
    const nat = renderCardFitted(data, cardOptions(), { ratio });
    requestAnimationFrame(() => {
      if (seq !== previewSeq) return;
      const natH = measure(nat.html, nat.css);
      if (natH > 0 && natH < nat.boxH * 0.965) {
        // 内容不足 → 填充：s 直达 boxH/natH，两轮 refine 收敛（溢出回退 / spacer 补足）
        let s = Math.min(1.8, nat.boxH / natH);
        let round = 0;
        const apply = (sc) => {
          const f2 = renderCardFitted(data, cardOptions(), { ratio, fill: { scale: sc } });
          paint(f2);
          return f2;
        };
        let fitted = apply(s);
        const refine = () => {
          if (seq !== previewSeq || round >= 2) return;
          const cardEl = shadow.querySelector('.xc-card');
          const sp = shadow.querySelector('.xc-fill-spacer');
          if (!cardEl) return;
          const over = cardEl.scrollHeight > cardEl.clientHeight + 2;
          const spH = sp ? Math.ceil(sp.getBoundingClientRect().height) : 0;
          if (over) { round += 1; s = Math.max(1.001, s * (nat.boxH / cardEl.scrollHeight)); fitted = apply(s); requestAnimationFrame(refine); }
          else if (spH > nat.boxH * 0.03) { round += 1; s = Math.min(1.8, s * (1 + (spH / nat.boxH) * 0.9)); fitted = apply(s); requestAnimationFrame(refine); }
          void fitted;
        };
        requestAnimationFrame(refine);
      } else if (natH > nat.boxH * 1.02) {
        // 内容超出 → 紧凑注入；真实内容高用 auto 布局测量（multicol/锁高均不可靠）→ 多栏铺满 / contain 缩放进画幅
        const fa = renderCardFitted(data, cardOptions(), { ratio, fill: { compact: true, auto: true } });
        const H2 = measure(fa.html, fa.css);
        // 多栏铺满 + 双杠杆 ladder（hero 高度 → 字号/间距）：
        // 每档 auto+balance 测「每栏均衡高 colH」，选 colH≈画幅高（填满）的档，再锁高正式渲染；仍超回退 contain
        const cols = Math.min(4, Math.max(2, Math.ceil(H2 / nat.boxH)));
        const Hmax = Math.round(nat.boxH * 0.42);
        const ladder = [
          { boost: 1, heroH: 170 },
          { boost: 1, heroH: Math.round(Hmax * 0.6) },
          { boost: 1, heroH: Hmax },
          { boost: 1.18, heroH: Hmax },
          { boost: 1.32, heroH: Hmax },
        ];
        let chosen = null;
        let colH = Infinity;
        for (const step of ladder) {
          const fTry = renderCardFitted(data, cardOptions(), { ratio, fill: { compact: true, density: 2, cols, ...step, auto: true } });
          colH = measure(fTry.html, fTry.css + '.xc-card{column-fill:balance !important;}'); // balance 后容器高 = 每栏均衡高
          chosen = { ...step };
          if (colH <= nat.boxH * 1.03) break;
        }
        if (colH <= nat.boxH * 1.03) {
          const f3 = renderCardFitted(data, cardOptions(), { ratio, fill: { compact: true, density: 2, cols, ...chosen } });
          paintCols(f3, cols);
        } else {
          // 超载回落：自然高度长图（竖版流式、宽 750×zoom、内容完整字号正常）——同导出 ratio:null 通道
          const natV = renderCardFitted(data, cardOptions(), {});
          const p2 = host.clientWidth ? host.clientWidth / CARD_WIDTH : 0.4;
          shadow.innerHTML = `<style>${natV.css}
            .cardx-scale { zoom: ${p2}; }
            .cardx-stage { width:${CARD_WIDTH}px; overflow:hidden; background:${natV.bg}; border-radius: 8px; }
            </style>
            <div class="cardx-scale"><div class="cardx-stage">${natV.html}</div></div>`;
          host.scrollTop = 0; // 回落长图重渲后回到顶部
          capEl.classList.add('cardx-editable-hint');
          capEl.textContent = `${t('导出尺寸')} ${CARD_WIDTH * state.zoom}×${t('自然高度')}px · ${t('超载回落长图')}`;
        }
      } else {
        paint(nat);
      }
    });
  }

  /** 多栏铺满预览：超载长文按画幅高切栏，字号保持不缩。 */
  function paintCols(fitted, cols) {
    const p = host.clientWidth ? host.clientWidth / fitted.boxW : 0.4;
    const vf = variantFilter(state.variant);
    shadow.innerHTML = `<style>${fitted.css}
      .cardx-scale { zoom: ${p}; }
      .cardx-stage { width:${fitted.boxW}px; height:${fitted.boxH}px; overflow:hidden; background:${fitted.bg}; ${vf !== 'none' ? `filter:${vf}` : ''} border-radius: 8px; }
      .cardx-stage > .xc-card { width:${fitted.boxW}px; height:${fitted.boxH}px; box-sizing:border-box; padding:22px 38px 0; column-count:${cols}; column-gap:34px; column-fill:auto; overflow:hidden; display:block !important; transform:none !important; }
      .cardx-stage > .xc-card > .xc-inner { display:block !important; }
      .cardx-stage > .xc-card > .xc-hero, .cardx-stage > .xc-card > .xc-cover, .cardx-stage > .xc-card > .xc-title, .cardx-stage > .xc-card > .xc-meta { column-span: all; }
      </style>
      <div class="cardx-scale"><div class="cardx-stage">${fitted.html}</div></div>`;
    capEl.classList.add('cardx-editable-hint');
    capEl.textContent = `${t('导出尺寸')} ${fitted.boxW * state.zoom}×${fitted.boxH * state.zoom}px · ${t('多栏铺满')}`;
  }

  function renderSidebar() {
    const tplBox = modal.querySelector('.cardx-tpls');
    const sideEl = tplBox.parentElement;
    tplBox.innerHTML = '';
    const favs0 = loadFavs();
    const orderedTpls = [...CARD_TEMPLATES].sort((x, y) => (favs0.includes(y.id) ? 1 : 0) - (favs0.includes(x.id) ? 1 : 0));
    for (const tpl of orderedTpls) {
      const item = document.createElement('div');
      item.className = `cardx-tpl${tpl.id === state.tpl ? ' active' : ''}`;
      const [fg, bg] = TEMPLATE_SWATCH[tpl.id] || ['#888', '#fff'];
      item.innerHTML = `<span class="cardx-swatch" style="background:${bg}"><i style="background:${fg}"></i></span>
        <span><span class="cardx-tpl-name">${t(tpl.name)}</span><div class="cardx-tpl-hint">${t(tpl.hint)}</div></span>`;
      item.addEventListener('click', () => { state.tpl = tpl.id; persist(); renderSidebar(); renderPreview(); });
      tplBox.appendChild(item);
    }
    const ratioBox = modal.querySelector('.cardx-ratio');
    ratioBox.innerHTML = '';
    for (const r of RATIOS) {
      const b = document.createElement('button');
      b.textContent = r.label;
      b.className = r.id === state.ratio ? 'active' : '';
      b.addEventListener('click', () => { state.ratio = r.id; persist(); renderSidebar(); renderPreview(); });
      ratioBox.appendChild(b);
    }

    const variantBox = modal.querySelector('.cardx-variant');
    variantBox.innerHTML = '';
    for (const v of CARD_VARIANTS) {
      const b = document.createElement('button');
      b.textContent = v.label;
      b.className = v.id === state.variant ? 'active' : '';
      b.addEventListener('click', () => { state.variant = v.id; persist(); renderSidebar(); renderPreview(); });
      variantBox.appendChild(b);
    }
    const segDef = [
      ['cardx-filter', COVER_FILTERS, 'coverFilter'],
      ['cardx-density', DENSITY, 'density'],
      ['cardx-fontpair', FONT_PAIRS, 'fontPair'],
      ['cardx-wmstyle', [{ id: 'brand', label: '标准' }, { id: 'minimal', label: '极简' }], 'watermarkStyle'],
      ['cardx-lenmode', [{ id: 'short', label: '短' }, { id: 'standard', label: '标准' }, { id: 'long', label: '长' }], 'lengthMode'],
    ];
    for (const [cls, list, key] of segDef) {
      const box = modal.querySelector('.' + cls);
      box.innerHTML = '';
      for (const it of list) {
        const b = document.createElement('button');
        b.textContent = it.label;
        b.className = it.id === state[key] ? 'active' : '';
        b.addEventListener('click', () => { state[key] = it.id; persist(); renderSidebar(); renderPreview(); });
        box.appendChild(b);
      }
    }
    const vt = modal.querySelector('[data-opt="vtitle-check"]');
    if (vt) vt.addEventListener('change', () => { state.verticalTitle = vt.checked; persist(); renderPreview(); });

    // ── 模板收藏（星标置顶）──
    const favs = loadFavs();
    const favBtn = document.createElement('button');
    favBtn.className = 'cardx-fav' + (favs.includes(state.tpl) ? ' on' : '');
    favBtn.textContent = favs.includes(state.tpl) ? '★ 已收藏' : '☆ 收藏此模板';
    favBtn.addEventListener('click', () => {
      const f = loadFavs();
      const i = f.indexOf(state.tpl);
      if (i >= 0) f.splice(i, 1); else f.push(state.tpl);
      saveFavs(f);
      renderSidebar();
    });
    tplBox.appendChild(favBtn);

    const zoomBox = modal.querySelector('.cardx-zoom');
    zoomBox.innerHTML = '';
    for (const z of [{ id: 2, label: '2x' }, { id: 3, label: '3x' }]) {
      const b = document.createElement('button');
      b.textContent = z.label;
      b.className = z.id === state.zoom ? 'active' : '';
      b.addEventListener('click', () => { state.zoom = z.id; persist(); renderSidebar(); renderPreview(); });
      zoomBox.appendChild(b);
    }
    for (const input of modal.querySelectorAll('[data-opt]')) {
      const key = input.dataset.opt;
      input.checked = Boolean(state[key]);
      input.onchange = () => { state[key] = input.checked; persist(); refreshQrAndPreview(); };
    }
  }

  function persist() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(state)); } catch (_) { /* 忽略 */ }
  }

  async function refreshQrAndPreview() {
    qrSvg = state.qr ? await getQrSvg(link) : null;
    renderPreview();
  }

  const setBusy = (v) => {
    busy = v;
    modal.querySelector('.cardx-save').disabled = v;
    modal.querySelector('.cardx-copy').disabled = v;
  };

  // invoke 返回 {ok, data} 原始信封：统一在此解包，失败抛错
  const unwrap = (res, fallbackMsg) => {
    if (!res || res.ok !== true) throw new Error((res && res.error) || fallbackMsg);
    return res.data;
  };

  const exportPng = async (format = 'png') => {
    const png = unwrap(await window.robin.renderCardPng({
      templateId: state.tpl, data, options: cardOptions(), zoom: state.zoom,
      ratio: RATIOS.find((r) => r.id === state.ratio)?.ratio || null,
      format,
    }), '卡片渲染失败');
    return png;
  };

  modal.querySelector('.cardx-html').addEventListener('click', async () => {
    if (busy) return;
    try {
      setBusy(true);
      const page = renderFullPage(data, cardOptions(), state.zoom);
      const picked = await window.robin.pickSavePath('robinread-card.html');
      const filePath = picked?.ok ? picked.data : null;
      if (!filePath) { setBusy(false); return; }
      const b64 = btoa(unescape(encodeURIComponent(page.html)));
      unwrap(await window.robin.writeBinaryFile(filePath, b64), '保存失败');
      setStatus(t('已保存 HTML') + ' ✓');
    } catch (e) { setStatus(e?.message || String(e), true); } finally { setBusy(false); }
  });

  modal.querySelector('.cardx-batch').addEventListener('click', async () => {
    if (busy) return;
    try {
      setBusy(true);
      setStatus(t('正在渲染全部模板…'));
      const zip = unwrap(await window.robin.renderAllTemplates({ data, options: cardOptions(), zoom: state.zoom, ratio: RATIOS.find((r) => r.id === state.ratio)?.ratio || null }), '批量渲染失败');
      const picked = await window.robin.pickSavePath('robinread-cards-all-templates.zip');
      const filePath = picked?.ok ? picked.data : null;
      if (!filePath) { setBusy(false); return; }
      unwrap(await window.robin.writeBinaryFile(filePath, zip.base64), '保存失败');
      setStatus(t('已打包') + ' ' + zip.count + ' ' + t('张模板卡片') + ' ✓');
    } catch (e) { setStatus(e?.message || String(e), true); } finally { setBusy(false); }
  });

  modal.querySelector('.cardx-save').addEventListener('click', async () => {
    if (busy) return;
    try {
      const defaultName = `${t('知更')}·${KIND_BADGES[data.kind] || ''}·${sanitizeFileName(data.title)}.png`;
      const isJpeg = state.format === 'jpeg';
      const picked = await window.robin.pickSavePath(defaultName);
      const filePath = picked?.ok ? picked.data : null;
      if (!filePath) return; // 用户取消
      setBusy(true);
      setStatus(t('正在渲染高清卡片…'));
      const png = await exportPng(state.format);
      unwrap(await window.robin.writeBinaryFile(filePath, png.base64), '保存失败');
      setStatus(`${t('已保存')} ✓  ${png.width}×${png.height}px${png.truncated ? ` · ${t('注意：内容超长，尾部已截断')}` : ''}`);
    } catch (e) {
      setStatus(e?.message || String(e), true);
    } finally {
      setBusy(false);
    }
  });

  modal.querySelector('.cardx-copy').addEventListener('click', async () => {
    if (busy) return;
    try {
      setBusy(true);
      setStatus(t('正在渲染高清卡片…'));
      const png = await exportPng();
      unwrap(await window.robin.copyImage(png.base64), '复制失败');
      setStatus(`${t('已复制到剪贴板，可直接粘贴分享')} ✓`);
    } catch (e) {
      setStatus(e?.message || String(e), true);
    } finally {
      setBusy(false);
    }
  });

  renderSidebar();
  await refreshQrAndPreview();
}
