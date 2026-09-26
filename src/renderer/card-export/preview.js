/* ==========================================================================
   知更 RobinRead — 精读卡片导出预览弹窗
   左侧模板与选项、右侧 shadow DOM 所见即所得预览；保存 PNG / 复制剪贴板。
   预览与导出走同一 renderCard 代码，保证所见即所得。
   ========================================================================== */
import { t } from '../i18n.js';
import { CARD_TEMPLATES, KIND_BADGES, CARD_WIDTH, renderCard } from './templates.js';

const PREF_KEY = 'robinread.cardExport';
const RATIOS = [
  { id: 'auto', label: '自适应', ratio: null },
  { id: '3:4', label: '3:4', ratio: 4 / 3 },
  { id: '9:16', label: '9:16', ratio: 16 / 9 },
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
`;

function sanitizeFileName(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function loadPrefs() {
  try { return { tpl: 'paper', ratio: 'auto', zoom: 2, cover: true, stats: true, qr: true, watermark: true, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; }
  catch (_) { return { tpl: 'paper', ratio: 'auto', zoom: 2, cover: true, stats: true, qr: true, watermark: true }; }
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
          <div class="cardx-side-h">${t('画幅比例')}</div>
          <div class="cardx-seg cardx-ratio"></div>
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
      <button class="btn primary cardx-save">${t('保存 PNG')}</button>
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
    templateId: state.tpl,
    cover: state.cover,
    stats: state.stats,
    watermark: state.watermark,
    qr: state.qr ? qrSvg : null,
  });

  function renderPreview() {
    const card = renderCard(data, cardOptions());
    const p = host.clientWidth ? host.clientWidth / CARD_WIDTH : 0.456;
    shadow.innerHTML = `<style>${card.css}
      .cardx-scale { zoom: ${p}; }</style>
      <div class="cardx-scale">${card.html}</div>`;
    // 画幅适配：卡片高于目标比例时整体等比缩小完整放入（与导出逻辑一致，不裁切）
    const cardEl = shadow.querySelector('.xc-card');
    const rectH = cardEl.getBoundingClientRect().height;
    const naturalH = rectH / p;
    const ratio = RATIOS.find((r) => r.id === state.ratio)?.ratio || null;
    const scaleEl = shadow.querySelector('.cardx-scale');
    const longHint = naturalH > 9000 ? ` · ${t('内容较长，已排为超长图')}` : '';
    if (ratio) {
      const targetH = Math.round(CARD_WIDTH * ratio);
      const f = Math.min(1, targetH / naturalH);
      scaleEl.style.zoom = String(p * f);
      const fit = document.createElement('div');
      fit.style.cssText = `height:${Math.round(targetH * p)}px;width:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:8px;background:${card.bg}`;
      scaleEl.parentNode.insertBefore(fit, scaleEl);
      fit.appendChild(scaleEl);
      capEl.textContent = `${t('导出尺寸')} ${CARD_WIDTH * state.zoom}×${targetH * state.zoom}px${f < 1 ? ` · ${t('长内容已等比缩放完整放入')}` : ''}${longHint}`;
    } else {
      capEl.textContent = `${t('导出尺寸')} ${CARD_WIDTH * state.zoom}×${Math.round(naturalH) * state.zoom}px · ${t('高清输出')}${state.zoom}x${longHint}`;
    }
  }

  function renderSidebar() {
    const tplBox = modal.querySelector('.cardx-tpls');
    tplBox.innerHTML = '';
    for (const tpl of CARD_TEMPLATES) {
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

  const exportPng = async () => {
    const png = unwrap(await window.robin.renderCardPng({
      templateId: state.tpl, data, options: cardOptions(), zoom: state.zoom,
      ratio: RATIOS.find((r) => r.id === state.ratio)?.ratio || null,
    }), '卡片渲染失败');
    return png;
  };

  modal.querySelector('.cardx-save').addEventListener('click', async () => {
    if (busy) return;
    try {
      const defaultName = `${t('知更')}·${KIND_BADGES[data.kind] || ''}·${sanitizeFileName(data.title)}.png`;
      const picked = await window.robin.pickSavePath(defaultName);
      const filePath = picked?.ok ? picked.data : null;
      if (!filePath) return; // 用户取消
      setBusy(true);
      setStatus(t('正在渲染高清卡片…'));
      const png = await exportPng();
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
