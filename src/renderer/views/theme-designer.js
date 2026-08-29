'use strict';
/**
 * RobinRead Windows — 主题提案 + 主题设计器（超越参考版）
 *
 * 在 freestyle-dsh-theme 三通道/配色关系/变体/锁定/JSON 能力之上：
 * - 中国传统色彩美学：传统色精选主题（诗意命名 + 注解）+ 传统色板即点即用
 * - OKLCH 色轮：画布色相环，直接拖拽/点选设定色相
 * - 视觉测试：WCAG 对比度实时检测（正文/主色/副色/按钮字 × AA/AAA）
 * - 色盲模拟：红色盲/绿色盲/蓝色盲 对预览实时滤镜
 * - 明暗并排：浅色与深色两套预览同屏对照
 * - 最近应用：主题历史快速回溯
 * - 应用主题时整窗淡入过渡
 */
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import {
  HARMONIES, huesForHarmony, harmonyLabel, randomBatch,
  fullPalette, applyPalette, clearPalette, defaultTokens, switchModeTokens,
  normalizeTokens, applyVariant, persistTokens, clearTokens, hueName,
  hexToOklch, oklchToHex, auditPalette, TRADITIONAL_COLORS, TRADITIONAL_THEMES,
  tokensFromTraditionalColor, pushRecent, recentThemes,
} from './theme-engine.js';

const MODE_LIGHT = { l1: 0.5, l2: 0.56, bg: 0.952, tx: 0.16, sb: 0.929 };
const MODE_DARK = { l1: 0.74, l2: 0.7, bg: 0.155, tx: 0.93, sb: 0.185 };

function paletteFor(tokens, mode) {
  return fullPalette({ ...tokens, ...(mode === 'light' ? MODE_LIGHT : MODE_DARK), mode });
}

// MARK: - 微缩三栏预览

function miniPreview(palette, { compact = false } = {}) {
  const m = palette._meta;
  const sep = palette['--separator'];
  const dot = palette['--unread-dot'];
  const wrap = document.createElement('div');
  wrap.className = 'td-preview' + (compact ? ' compact' : '');
  wrap.style.background = m.page;
  wrap.style.borderColor = sep;

  const toolbar = document.createElement('div');
  toolbar.className = 'td-preview-toolbar';
  toolbar.innerHTML = `
    <span style="flex:0 0 34%;background:${m.side}"></span>
    <span style="flex:0 0 40%;background:${m.list}"></span>
    <span style="flex:1;background:${m.page}"></span>`;
  wrap.appendChild(toolbar);

  const columns = document.createElement('div');
  columns.className = 'td-preview-columns';

  const side = document.createElement('div');
  side.className = 'td-preview-side';
  side.style.background = m.side;
  side.innerHTML = `
    <div class="td-bar" style="width:64%;height:6px;background:${m.ink};opacity:.55"></div>
    ${[0.2, 0.2].map((op) => `<div class="td-side-row"><span class="td-dot" style="background:${dot};opacity:.35"></span><span class="td-bar" style="flex:1;background:${m.ink};opacity:${op}"></span></div>`).join('')}
    <div class="td-side-row selected" style="background:${palette['--row-selected']}"><span class="td-dot" style="background:${m.accent}"></span><span class="td-bar" style="flex:1;background:${m.accent};opacity:.75"></span></div>
    <div class="td-side-row"><span class="td-dot" style="background:${dot};opacity:.35"></span><span class="td-bar" style="flex:1;background:${m.ink};opacity:.2"></span></div>`;
  columns.appendChild(side);

  const list = document.createElement('div');
  list.className = 'td-preview-list';
  list.style.background = m.list;
  const entry = (unread) => `
    <div class="td-entry">
      <span class="td-dot" style="background:${dot};visibility:${unread ? 'visible' : 'hidden'}"></span>
      <div style="flex:1;display:flex;flex-direction:column;gap:3px">
        <span class="td-bar" style="height:5px;width:88%;background:${m.ink};opacity:${unread ? 0.75 : 0.4}"></span>
        <span class="td-bar" style="height:4px;width:60%;background:${m.ink};opacity:.22"></span>
        <span class="td-bar" style="height:3px;width:40%;background:${m.accent};opacity:.5"></span>
      </div>
    </div>`;
  list.innerHTML = entry(true) + entry(true) + entry(false) + entry(false);
  columns.appendChild(list);

  const reader = document.createElement('div');
  reader.className = 'td-preview-reader';
  reader.style.background = m.page;
  reader.innerHTML = `
    <span class="td-bar" style="height:7px;width:82%;background:${m.ink};opacity:.85"></span>
    <span class="td-bar" style="height:4px;width:34%;background:${m.ink};opacity:.3"></span>
    <div class="td-note" style="background:${m.note};border-color:${palette['--note-border']}">
      <span class="td-bar" style="height:3px;width:26%;background:${m.accent}"></span>
      <span class="td-bar" style="height:4px;width:88%;background:${m.ink};opacity:.35"></span>
      <span class="td-bar" style="height:4px;width:64%;background:${m.ink};opacity:.25"></span>
    </div>
    <span class="td-bar" style="height:4px;width:96%;background:${m.ink};opacity:.3"></span>
    <span class="td-bar" style="height:4px;width:92%;background:${m.ink};opacity:.22"></span>
    <span class="td-bar" style="height:4px;width:78%;background:${m.ink};opacity:.22"></span>`;
  columns.appendChild(reader);

  wrap.appendChild(columns);
  return wrap;
}

function swatchStrip(palette) {
  const m = palette._meta;
  const strip = document.createElement('div');
  strip.className = 'td-swatches';
  for (const [label, hex] of [['主色', m.accent], ['副色', m.secondary], ['纸面', m.page], ['侧栏', m.side], ['墨色', m.ink]]) {
    const chip = document.createElement('div');
    chip.className = 'td-swatch';
    chip.innerHTML = `<span class="td-swatch-dot" style="background:${hex}"></span><span class="td-swatch-label"></span><span class="td-swatch-hex">${hex}</span>`;
    chip.querySelector('.td-swatch-label').textContent = label;
    chip.title = `${label} ${hex}`;
    strip.appendChild(chip);
  }
  return strip;
}

// MARK: - 对比度检测面板（视觉测试）

function auditPanel(palette) {
  const audits = auditPalette(palette);
  const panel = document.createElement('div');
  panel.className = 'td-audit';
  const head = document.createElement('div');
  head.className = 'td-audit-head';
  head.innerHTML = `<span>${escapeHTML(t('视觉测试 · WCAG 对比度'))}</span>`;
  panel.appendChild(head);
  for (const audit of audits) {
    const row = document.createElement('div');
    row.className = 'td-audit-row';
    row.innerHTML = `
      <span class="td-audit-pair">
        <span class="td-audit-chip" style="background:${audit.bg}"><i style="background:${audit.fg}"></i></span>
        <span class="td-audit-label"></span>
      </span>
      <span class="td-audit-ratio">${audit.ratio.toFixed(2)}</span>
      <span class="td-audit-badges">
        <span class="td-badge ${audit.aa ? 'ok' : 'bad'}">AA</span>
        <span class="td-badge ${audit.aaa ? 'ok' : 'bad'}">AAA</span>
      </span>`;
    row.querySelector('.td-audit-label').textContent = audit.label;
    row.title = `${audit.label}：${audit.ratio.toFixed(2)}:1（${audit.pass ? '达标' : '建议调整明度差'}）`;
    panel.appendChild(row);
  }
  const note = document.createElement('div');
  note.className = 'td-audit-note';
  note.textContent = t('正文要求 AA≥4.5；强调色与大号文字 ≥3.0。未达标时可拉开墨色与纸面明度。');
  panel.appendChild(note);
  return panel;
}

// MARK: - OKLCH 色轮

class HueWheel {
  constructor(size, getTokenValue, onHue) {
    this.size = size;
    this.onHue = onHue;
    this.canvas = document.createElement('canvas');
    this.canvas.width = size * 2;
    this.canvas.height = size * 2;
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    this.canvas.className = 'td-wheel';
    this._hue = 0;
    this._c = 0.1;
    this._l = 0.5;

    const setFromEvent = (event) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left - rect.width / 2;
      const y = event.clientY - rect.top - rect.height / 2;
      let angle = (Math.atan2(y, x) * 180) / Math.PI;
      angle = (angle + 360) % 360;
      this.onHue(Math.round(angle));
    };
    let dragging = false;
    this.canvas.addEventListener('mousedown', (event) => {
      dragging = true;
      setFromEvent(event);
    });
    window.addEventListener('mousemove', (event) => {
      if (dragging) setFromEvent(event);
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }

  update(hue, c, l) {
    this._hue = hue;
    this._c = c;
    this._l = l;
    const ctx = this.canvas.getContext('2d');
    const s = this.size * 2;
    const cx = s / 2;
    const cy = s / 2;
    const outer = s / 2 - 8;
    const inner = outer - 46;
    ctx.clearRect(0, 0, s, s);
    for (let angle = 0; angle < 360; angle += 1) {
      const start = ((angle - 1.2) * Math.PI) / 180;
      const end = ((angle + 1.2) * Math.PI) / 180;
      ctx.beginPath();
      ctx.arc(cx, cy, (outer + inner) / 2, start, end);
      ctx.strokeStyle = oklchHexSafe(this._l, this._c, angle);
      ctx.lineWidth = outer - inner;
      ctx.stroke();
    }
    // 指示点
    const rad = (this._hue * Math.PI) / 180;
    const r = (outer + inner) / 2;
    const px = cx + Math.cos(rad) * r;
    const py = cy + Math.sin(rad) * r;
    ctx.beginPath();
    ctx.arc(px, py, 11, 0, Math.PI * 2);
    ctx.fillStyle = oklchHexSafe(this._l, this._c, this._hue);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.stroke();
    // 内圈说明文字
    ctx.fillStyle = oklchHexSafe(this._l, this._c, this._hue);
    ctx.beginPath();
    ctx.arc(cx, cy, inner - 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = this._l > 0.62 ? 'rgba(20,18,14,0.75)' : 'rgba(255,255,255,0.82)';
    ctx.font = `600 ${Math.round(s * 0.075)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(this._hue)}°`, cx, cy - s * 0.035);
    ctx.font = `500 ${Math.round(s * 0.052)}px sans-serif`;
    ctx.fillText(hueName(this._hue), cx, cy + s * 0.05);
  }
}

function oklchHexSafe(L, C, H) {
  return oklchToHex(L, C, H);
}


// MARK: - 提案卡片

function proposalCard(proposal, mode, active, onApply) {
  const card = document.createElement('div');
  card.className = 'td-card' + (active ? ' active' : '');
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  const palette = paletteFor(proposal.tokens, mode);
  card.appendChild(miniPreview(palette, { compact: true }));
  const name = document.createElement('div');
  name.className = 'td-card-name';
  name.textContent = proposal.name;
  card.appendChild(name);
  const meta = document.createElement('div');
  meta.className = 'td-card-meta';
  meta.textContent = proposal.note
    ? proposal.note
    : `${Math.round(proposal.th)}° · ${harmonyLabel(proposal.harmony)}${active ? ` · ${t('已应用')}` : ''}`;
  card.appendChild(meta);
  card.addEventListener('click', () => onApply(proposal));
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') onApply(proposal);
  });
  return card;
}

// MARK: - 主题提案（设置页嵌入）

export class ThemeProposer {
  constructor({ onApply, onReset }) {
    this.handlers = { onApply, onReset };
    this.harmony = 'random';
    this.batch = randomBatch('random', 8);
    this.mode = 'light';
    this.appliedKey = null;
  }

  render(container) {
    container.innerHTML = '';
    const section = document.createElement('div');
    section.className = 'settings-group';
    section.innerHTML = `<div class="settings-group-header">${escapeHTML(t('主题提案'))}</div>`;

    const body = document.createElement('div');
    body.style.padding = '0 16px 14px';

    // 工具行
    const head = document.createElement('div');
    head.className = 'td-propose-head';
    const harmonyChips = document.createElement('div');
    harmonyChips.className = 'td-chips';
    const chipsLabel = document.createElement('span');
    chipsLabel.className = 'td-chips-label';
    chipsLabel.textContent = t('配色关系');
    harmonyChips.appendChild(chipsLabel);
    for (const h of HARMONIES) {
      const chip = document.createElement('button');
      chip.className = 'td-chip' + (this.harmony === h.key ? ' on' : '');
      chip.textContent = h.label;
      chip.addEventListener('click', () => {
        this.harmony = h.key;
        harmonyChips.querySelectorAll('.td-chip').forEach((c) => c.classList.remove('on'));
        chip.classList.add('on');
      });
      harmonyChips.appendChild(chip);
    }
    head.appendChild(harmonyChips);
    const actions = document.createElement('div');
    actions.className = 'td-propose-actions';
    const modeBtn = mkBtn(t(this.mode === 'light' ? '预览深色' : '预览浅色'), () => {
      this.mode = this.mode === 'light' ? 'dark' : 'light';
      this.render(container);
    });
    const moreBtn = mkBtn(t('换一批'), () => {
      this.batch = randomBatch(this.harmony, 8);
      this.render(container);
    });
    const resetBtn = mkBtn(t('恢复默认'), () => {
      this.appliedKey = null;
      this.handlers.onReset();
      this.render(container);
    });
    actions.append(modeBtn, moreBtn, resetBtn);
    head.appendChild(actions);
    body.appendChild(head);

    // 传统色精选
    body.appendChild(sectionLabel(t('中国传统色 · 精选')));
    const tradGrid = document.createElement('div');
    tradGrid.className = 'td-grid';
    for (const proposal of TRADITIONAL_THEMES) {
      tradGrid.appendChild(proposalCard(proposal, this.mode, this.appliedKey === proposal.key, (p) => {
        this.appliedKey = p.key;
        this.handlers.onApply({ ...p.tokens, mode: this.mode }, p.name);
        this.render(container);
      }));
    }
    body.appendChild(tradGrid);

    // 传统色板
    body.appendChild(sectionLabel(t('传统色板 · 点色即换主色')));
    const paletteGrid = document.createElement('div');
    paletteGrid.className = 'td-trad-grid';
    for (const entry of TRADITIONAL_COLORS) {
      const chip = document.createElement('button');
      chip.className = 'td-trad-chip';
      chip.title = `${entry.name} · ${entry.cat}`;
      chip.innerHTML = `<span class="td-trad-dot" style="background:${entry.hex}"></span><span class="td-trad-name"></span>`;
      chip.querySelector('.td-trad-name').textContent = entry.name;
      chip.addEventListener('click', () => {
        this.handlers.onApply(tokensFromTraditionalColor(entry), entry.name);
      });
      paletteGrid.appendChild(chip);
    }
    body.appendChild(paletteGrid);

    // 灵感提案
    body.appendChild(sectionLabel(t('灵感提案 · 点击卡片即应用'), '12px'));
    const smartGrid = document.createElement('div');
    smartGrid.className = 'td-grid';
    for (const proposal of this.batch) {
      smartGrid.appendChild(proposalCard(proposal, this.mode, this.appliedKey === proposal.key, (p) => {
        this.appliedKey = p.key;
        this.handlers.onApply({ ...p.tokens, mode: this.mode }, p.name);
        this.render(container);
      }));
    }
    body.appendChild(smartGrid);

    section.appendChild(body);
    container.appendChild(section);
  }
}

// MARK: - 主题设计器

const CHANNELS = [
  { key: 'th', label: '主色', hueKey: 'th', cKey: 'c1', lKey: 'l1', cMax: 0.24, lRange: [0.28, 0.95] },
  { key: 'th2', label: '副色', hueKey: 'th2', cKey: 'c2', lKey: 'l2', cMax: 0.26, lRange: [0.05, 0.97] },
  { key: 'ths', label: '面板', hueKey: 'ths', cKey: 'sc', lKey: 'bg', cMax: 0.09, lRange: null },
];

const SIMULATIONS = [
  { key: 'none', label: '正常视觉' },
  { key: 'protanopia', label: '红色盲' },
  { key: 'deuteranopia', label: '绿色盲' },
  { key: 'tritanopia', label: '蓝色盲' },
];

export class ThemeDesigner {
  constructor({ initialTokens, onApplied, onReset }) {
    this.tokens = initialTokens || defaultTokens('light');
    this.channel = 'th';
    this.locks = { th: false, th2: false, ths: false };
    this.livePreview = true;
    this.sideBySide = false;
    this.simulation = 'none';
    this.customName = null;
    this.handlers = { onApplied, onReset };
  }

  present() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) this.dismiss();
    });
    this.modal = document.createElement('div');
    this.modal.className = 'modal td-modal';
    overlay.appendChild(this.modal);
    document.body.appendChild(overlay);
    this.overlay = overlay;
    this._esc = (event) => { if (event.key === 'Escape') this.dismiss(); };
    document.addEventListener('keydown', this._esc);
    this._render();
  }

  dismiss() {
    document.removeEventListener('keydown', this._esc);
    this.overlay?.remove();
    this.overlay = null;
  }

  commit(next) {
    this.tokens = next;
    if (this.livePreview) applyPalette(fullPalette(this.tokens));
    this._render();
  }

  patch(partial) {
    this.commit({ ...this.tokens, ...partial });
  }

  _render() {
    if (!this.modal) return;
    this.modal.innerHTML = '';

    // 色盲模拟滤镜（一次性注入）
    ensureSimulationFilters();

    // ══ 左：预览 ══
    const left = document.createElement('div');
    left.className = 'td-left';

    const previewTitle = document.createElement('div');
    previewTitle.className = 'td-left-title';
    previewTitle.innerHTML = `<span>${escapeHTML(t('实时预览'))}</span>`;
    const sideBySideWrap = document.createElement('label');
    sideBySideWrap.className = 'td-mini-toggle';
    sideBySideWrap.innerHTML = `<span>${escapeHTML(t('明暗并排'))}</span>`;
    const sbsToggle = document.createElement('button');
    sbsToggle.className = `toggle${this.sideBySide ? ' on' : ''}`;
    sbsToggle.style.transform = 'scale(0.82)';
    sbsToggle.addEventListener('click', () => {
      this.sideBySide = !this.sideBySide;
      this._render();
    });
    sideBySideWrap.appendChild(sbsToggle);
    previewTitle.appendChild(sideBySideWrap);
    left.appendChild(previewTitle);

    const previewHost = document.createElement('div');
    previewHost.className = 'td-left-preview';
    previewHost.style.filter = this.simulation === 'none' ? '' : `url(#td-sim-${this.simulation})`;
    previewHost.appendChild(miniPreview(fullPalette(this.tokens)));
    if (this.sideBySide) {
      const other = this.tokens.mode === 'light' ? 'dark' : 'light';
      const otherPalette = fullPalette(switchModeTokens(this.tokens, other));
      const pair = document.createElement('div');
      pair.className = 'td-preview-pair';
      // 重建：两个并排
      previewHost.innerHTML = '';
      pair.appendChild(miniPreview(fullPalette(this.tokens)));
      pair.appendChild(miniPreview(otherPalette));
      previewHost.appendChild(pair);
    }
    left.appendChild(previewHost);

    // 色盲模拟
    const simRow = document.createElement('div');
    simRow.className = 'td-sim-row';
    simRow.innerHTML = `<span class="td-chips-label">${escapeHTML(t('色盲模拟'))}</span>`;
    for (const sim of SIMULATIONS) {
      const chip = document.createElement('button');
      chip.className = 'td-chip' + (this.simulation === sim.key ? ' on' : '');
      chip.textContent = t(sim.label);
      chip.addEventListener('click', () => {
        this.simulation = sim.key;
        this._render();
      });
      simRow.appendChild(chip);
    }
    left.appendChild(simRow);

    left.appendChild(swatchStrip(fullPalette(this.tokens)));

    // 对比度检测
    left.appendChild(auditPanel(fullPalette(this.tokens)));

    // 最近应用
    const recents = recentThemes();
    if (recents.length) {
      const recentRow = document.createElement('div');
      recentRow.className = 'td-recent';
      const recentLabel = document.createElement('div');
      recentLabel.className = 'td-section-label';
      recentLabel.textContent = t('最近应用');
      recentRow.appendChild(recentLabel);
      const chipsHost = document.createElement('div');
      chipsHost.className = 'td-recent-chips';
      for (const item of recents) {
        const palette = fullPalette(item.tokens);
        const chip = document.createElement('button');
        chip.className = 'td-recent-chip';
        chip.title = item.name;
        chip.innerHTML = `
          <span class="td-recent-strip">
            <i style="background:${palette._meta.page}"></i><i style="background:${palette._meta.side}"></i><i style="background:${palette._meta.accent}"></i><i style="background:${palette._meta.ink}"></i>
          </span><span class="td-recent-name"></span>`;
        chip.querySelector('.td-recent-name').textContent = item.name;
        chip.addEventListener('click', () => this.commit(normalizeTokens(item.tokens)));
        chipsHost.appendChild(chip);
      }
      recentRow.appendChild(chipsHost);
      left.appendChild(recentRow);
    }

    // ══ 右：控制 ══
    const right = document.createElement('div');
    right.className = 'td-right';

    const header = document.createElement('div');
    header.className = 'td-header';
    const nameEl = document.createElement('div');
    nameEl.className = 'td-name';
    nameEl.innerHTML = `<span class="td-name-dot" style="background:${fullPalette(this.tokens)._meta.accent}"></span><span></span>`;
    nameEl.querySelector('span:last-child').textContent = this.customName
      || `${hueName(this.tokens.th)} · ${harmonyLabel(this._harmonyGuess())}`;
    const modeSeg = document.createElement('div');
    modeSeg.className = 'segmented';
    for (const mode of ['light', 'dark']) {
      const button = document.createElement('button');
      button.textContent = t(mode === 'light' ? '浅色' : '深色');
      button.classList.toggle('active', this.tokens.mode === mode);
      button.addEventListener('click', () => this.commit(switchModeTokens(this.tokens, mode)));
      modeSeg.appendChild(button);
    }
    const close = document.createElement('button');
    close.className = 'btn icon-only';
    close.innerHTML = icon('close');
    close.addEventListener('click', () => this.dismiss());
    header.append(nameEl, modeSeg, close);
    right.appendChild(header);

    const scroll = document.createElement('div');
    scroll.className = 'td-scroll';
    right.appendChild(scroll);

    // 色轮 + 通道
    const wheelRow = document.createElement('div');
    wheelRow.className = 'td-wheel-row';
    const channel = CHANNELS.find((c) => c.key === this.channel);
    this.wheel = new HueWheel(148, null, (hue) => {
      this.patch({ [channel.hueKey]: hue });
    });
    this.wheel.update(
      this.tokens[channel.hueKey],
      Math.min(this.tokens[channel.cKey] * (channel.key === 'ths' ? 5 : 1) + (channel.key === 'ths' ? 0.02 : 0), 0.16),
      channel.key === 'ths' ? this.tokens.bg : this.tokens[channel.lKey],
    );
    wheelRow.appendChild(this.wheel.canvas);

    const channelsCol = document.createElement('div');
    channelsCol.className = 'td-channels-col';
    for (const ch of CHANNELS) {
      const isActive = this.channel === ch.key;
      const isLocked = this.locks[ch.key];
      const hex = oklchToHex(
        this.tokens[ch.lKey],
        Math.min(this.tokens[ch.cKey] * (ch.key === 'ths' ? 5 : 1) + (ch.key === 'ths' ? 0.02 : 0), 0.2),
        this.tokens[ch.hueKey],
      );
      const item = document.createElement('div');
      item.className = 'td-channel' + (isActive ? ' active' : '');
      item.innerHTML = `
        <span class="td-channel-dot" style="background:${hex}"></span>
        <span class="td-channel-label">${escapeHTML(t(ch.label))}</span>
        <span class="td-channel-hex">${hex}</span>
        <button class="td-lock${isLocked ? ' locked' : ''}" title="${escapeHTML(t('锁定后随机与配色关系跳过该通道'))}">${icon('lock')}</button>`;
      item.addEventListener('click', (event) => {
        if (event.target.closest('.td-lock')) return;
        this.channel = ch.key;
        this._render();
      });
      item.querySelector('.td-lock').addEventListener('click', () => {
        this.locks[ch.key] = !this.locks[ch.key];
        this._render();
      });
      channelsCol.appendChild(item);
    }
    wheelRow.appendChild(channelsCol);
    scroll.appendChild(wheelRow);

    // H/C/L 滑杆
    const lightRange = channel.lRange || (this.tokens.mode === 'light' ? [0.68, 0.98] : [0.04, 0.30]);
    const sliders = document.createElement('div');
    sliders.className = 'td-sliders';
    sliders.appendChild(slider(t('色相'), 0, 360, 1, this.tokens[channel.hueKey], `${Math.round(this.tokens[channel.hueKey])}°`, true,
      (v) => this.patch({ [channel.hueKey]: v })));
    sliders.appendChild(slider(t('彩度'), 0.004, channel.cMax, 0.002, this.tokens[channel.cKey], this.tokens[channel.cKey].toFixed(3), false,
      (v) => this.patch({ [channel.cKey]: v })));
    sliders.appendChild(slider(t('明度'), lightRange[0], lightRange[1], 0.005, this.tokens[channel.lKey], this.tokens[channel.lKey].toFixed(2), false,
      (v) => this.patch({ [channel.lKey]: v })));
    scroll.appendChild(sliders);

    // 传统色快捷（主色通道时显示）
    if (this.channel === 'th') {
      const tradLabel = document.createElement('div');
      tradLabel.className = 'td-section-label';
      tradLabel.textContent = t('传统色直选');
      scroll.appendChild(tradLabel);
      const tradChips = document.createElement('div');
      tradChips.className = 'td-trad-grid td-trad-grid-mini';
      for (const entry of TRADITIONAL_COLORS) {
        const chip = document.createElement('button');
        chip.className = 'td-trad-chip';
        chip.title = `${entry.name} · ${entry.hex}`;
        chip.innerHTML = `<span class="td-trad-dot" style="background:${entry.hex}"></span><span class="td-trad-name"></span>`;
        chip.querySelector('.td-trad-name').textContent = entry.name;
        chip.addEventListener('click', () => {
          const ok = hexToOklch(entry.hex);
          this.customName = entry.name;
          this.patch({ th: Math.round(ok.h), c1: Number(ok.c.toFixed(3)), l1: Number(ok.l.toFixed(2)) });
        });
        tradChips.appendChild(chip);
      }
      scroll.appendChild(tradChips);
    }

    // 配色关系 + 随机
    scroll.appendChild(sectionLabel(t('配色关系（派生未锁定通道）')));
    const harmonyChips = document.createElement('div');
    harmonyChips.className = 'td-chips';
    for (const h of HARMONIES) {
      if (h.key === 'random') continue;
      const chip = document.createElement('button');
      chip.className = 'td-chip';
      chip.textContent = h.label;
      chip.addEventListener('click', () => {
        const related = huesForHarmony(this.tokens.th, h.key);
        const next = {};
        if (!this.locks.th2) next.th2 = related.th2;
        if (!this.locks.ths) next.ths = related.ths;
        this.patch(next);
      });
      harmonyChips.appendChild(chip);
    }
    const randomChip = document.createElement('button');
    randomChip.className = 'td-chip td-chip-accent';
    randomChip.textContent = t('随机');
    randomChip.addEventListener('click', () => {
      const hh = HARMONIES[Math.floor(Math.random() * 4)].key;
      const related = huesForHarmony(this.tokens.th, hh);
      const next = {};
      if (!this.locks.th) { next.th = Math.floor(Math.random() * 360); next.c1 = Number((0.05 + Math.random() * 0.12).toFixed(3)); }
      if (!this.locks.th2) { next.th2 = related.th2; next.c2 = Number((0.05 + Math.random() * 0.12).toFixed(3)); }
      if (!this.locks.ths) { next.ths = related.ths; next.sc = Number((0.01 + Math.random() * 0.035).toFixed(3)); }
      this.customName = null;
      this.patch(next);
    });
    harmonyChips.appendChild(randomChip);
    scroll.appendChild(harmonyChips);

    // 快速变体
    scroll.appendChild(sectionLabel(t('快速变体')));
    const variants = document.createElement('div');
    variants.className = 'td-chips';
    for (const [kind, label] of [['soft', t('柔和')], ['vivid', t('鲜明')], ['bright', t('提亮')], ['deep', t('压暗')], ['swap', t('主副互换')]]) {
      const chip = document.createElement('button');
      chip.className = 'td-chip';
      chip.textContent = label;
      chip.addEventListener('click', () => {
        if (kind === 'swap' && (this.locks.th || this.locks.th2)) return;
        this.commit(applyVariant(this.tokens, kind, this.locks));
      });
      variants.appendChild(chip);
    }
    scroll.appendChild(variants);

    // JSON
    scroll.appendChild(sectionLabel(t('主题令牌 · JSON 导入 / 导出 / 分享')));
    const jsonCard = document.createElement('div');
    jsonCard.className = 'td-json-card';
    const jsonHead = document.createElement('div');
    jsonHead.className = 'td-json-head';
    const jsonTitle = document.createElement('span');
    jsonTitle.className = 'td-json-title';
    jsonTitle.textContent = t('令牌 JSON');
    const jsonHint = document.createElement('span');
    jsonHint.className = 'td-json-hint';
    jsonHint.textContent = t('可复制分享，或粘贴他人主题后导入');
    jsonHead.append(jsonTitle, jsonHint);
    jsonCard.appendChild(jsonHead);

    const jsonText = document.createElement('textarea');
    jsonText.className = 'td-json-text';
    jsonText.spellcheck = false;
    jsonText.placeholder = '{ "th": 142, "th2": 42, "ths": 92, ... }';
    jsonText.value = JSON.stringify(this._inputTokens(), null, 2);
    jsonCard.appendChild(jsonText);

    const jsonStatus = document.createElement('div');
    jsonStatus.className = 'td-json-status';
    jsonStatus.setAttribute('aria-live', 'polite');

    const jsonBtns = document.createElement('div');
    jsonBtns.className = 'td-json-btns';
    const setStatus = (text, ok = true) => {
      jsonStatus.textContent = text;
      jsonStatus.className = `td-json-status ${ok ? 'ok' : 'err'}`;
      clearTimeout(this._jsonStatusTimer);
      this._jsonStatusTimer = setTimeout(() => {
        if (jsonStatus.textContent === text) jsonStatus.className = 'td-json-status';
      }, 2600);
    };
    const importBtn = mkBtn(`${icon('import')}<span>${escapeHTML(t('导入'))}</span>`, () => {
      try {
        const parsed = JSON.parse(jsonText.value);
        if (!parsed || typeof parsed !== 'object' || parsed.th == null) throw new Error('bad');
        this.customName = null;
        this.commit(normalizeTokens(parsed));
        setStatus(`✓ ${t('已导入并实时预览')}`, true);
      } catch (_) {
        setStatus(`✗ ${t('JSON 格式无效，请检查后重试')}`, false);
      }
    }, 'primary');
    const copyBtn = mkBtn(`${icon('export')}<span>${escapeHTML(t('复制'))}</span>`, async () => {
      try {
        await navigator.clipboard.writeText(jsonText.value);
        setStatus(`✓ ${t('已复制到剪贴板')}`, true);
      } catch (_) {
        setStatus(`✗ ${t('复制失败，请手动选择复制')}`, false);
      }
    });
    const formatBtn = mkBtn(`${icon('refresh')}<span>${escapeHTML(t('格式化'))}</span>`, () => {
      try {
        const parsed = JSON.parse(jsonText.value);
        jsonText.value = JSON.stringify(parsed, null, 2);
        setStatus(`✓ ${t('已格式化')}`, true);
      } catch (_) {
        setStatus(`✗ ${t('JSON 格式无效，无法格式化')}`, false);
      }
    });
    const downloadBtn = mkBtn(`${icon('import')}<span>${escapeHTML(t('导出文件'))}</span>`, () => {
      const blob = new Blob([jsonText.value], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `robinread-theme-${hueName(this.tokens.th)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      setStatus(`✓ ${t('已导出 JSON 文件')}`, true);
    });
    jsonBtns.append(importBtn, copyBtn, formatBtn, downloadBtn);
    jsonCard.appendChild(jsonBtns);
    jsonCard.appendChild(jsonStatus);
    scroll.appendChild(jsonCard);

    // 底部操作
    const footer = document.createElement('div');
    footer.className = 'td-footer';
    const liveWrap = document.createElement('label');
    liveWrap.className = 'td-live';
    liveWrap.innerHTML = `<span>${escapeHTML(t('实时预览'))}</span>`;
    const liveToggle = document.createElement('button');
    liveToggle.className = `toggle${this.livePreview ? ' on' : ''}`;
    liveToggle.addEventListener('click', () => {
      this.livePreview = !this.livePreview;
      liveToggle.classList.toggle('on', this.livePreview);
    });
    liveWrap.appendChild(liveToggle);
    const footerBtns = document.createElement('div');
    footerBtns.style.cssText = 'display:flex;gap:8px;';
    const applyBtn = mkBtn(t('应用主题'), () => {
      const palette = fullPalette(this.tokens);
      applyWithTransition(palette);
      persistTokens(this.tokens);
      pushRecent(this.tokens, this.customName || `${hueName(this.tokens.th)} · ${harmonyLabel(this._harmonyGuess())}`);
      this.handlers.onApplied?.(this.tokens);
    }, 'primary');
    const resetBtn = mkBtn(t('恢复默认'), () => {
      clearPalette();
      clearTokens();
      this.customName = null;
      this.tokens = defaultTokens(this.tokens.mode);
      this.handlers.onReset?.();
      this._render();
    });
    footerBtns.append(applyBtn, resetBtn);
    footer.append(liveWrap, footerBtns);
    right.appendChild(footer);

    this.modal.append(left, right);
  }

  _harmonyGuess() {
    const th = this.tokens.th;
    for (const h of HARMONIES) {
      if (h.key === 'random') continue;
      const related = huesForHarmony(th, h.key);
      if (Math.abs(related.th2 - this.tokens.th2) < 3) return h.key;
    }
    return 'analogous';
  }

  _inputTokens() {
    const t0 = this.tokens;
    return {
      version: 1, mode: t0.mode,
      th: Math.round(t0.th), th2: Math.round(t0.th2), ths: Math.round(t0.ths),
      c1: Number(t0.c1.toFixed(3)), c2: Number(t0.c2.toFixed(3)), sc: Number(t0.sc.toFixed(3)),
      l1: Number(t0.l1.toFixed(2)), l2: Number(t0.l2.toFixed(2)), bg: Number(t0.bg.toFixed(2)),
      tx: Number(t0.tx.toFixed(2)), sb: Number(t0.sb.toFixed(2)),
    };
  }
}

// MARK: - 工具

function ensureSimulationFilters() {
  if (document.getElementById('td-sim-filters')) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'td-sim-filters';
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  const matrices = {
    protanopia: '0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0',
    deuteranopia: '0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0',
    tritanopia: '0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0',
  };
  svg.innerHTML = Object.entries(matrices).map(([key, values]) =>
    `<filter id="td-sim-${key}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${values}"/></filter>`
  ).join('');
  document.body.appendChild(svg);
}

/** 应用调色板并带 240ms 交叉淡入（超越参考的应用体验）。 */
function applyWithTransition(palette) {
  const veil = document.createElement('div');
  veil.style.cssText = 'position:fixed;inset:0;background:var(--page-background);opacity:0;pointer-events:none;z-index:2000;transition:opacity 0.12s ease;';
  document.body.appendChild(veil);
  requestAnimationFrame(() => {
    veil.style.opacity = '0.35';
    setTimeout(() => {
      applyPalette(palette);
      veil.style.opacity = '0';
      setTimeout(() => veil.remove(), 150);
    }, 120);
  });
}

function sectionLabel(text, marginTop = '0') {
  const el = document.createElement('div');
  el.className = 'td-section-label';
  el.textContent = text;
  if (marginTop) el.style.marginTop = marginTop;
  return el;
}

function mkBtn(label, onClick, style = 'bordered') {
  const button = document.createElement('button');
  button.className = `btn-text ${style}`;
  if (label.includes('<')) {
    button.innerHTML = label;
    button.classList.add('icon-label');
  } else {
    button.textContent = label;
  }
  button.addEventListener('click', onClick);
  return button;
}

function slider(label, min, max, step, value, display, hue, onChange) {
  const row = document.createElement('div');
  row.className = 'td-slider';
  const labelEl = document.createElement('span');
  labelEl.className = 'td-sl';
  labelEl.textContent = label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  if (hue) input.classList.add('td-range-hue');
  const val = document.createElement('span');
  val.className = 'td-val';
  val.textContent = display;
  input.addEventListener('input', () => {
    val.textContent = hue ? `${input.value}°` : Number(input.value).toFixed(step < 0.01 ? 3 : 2);
    onChange(Number(input.value));
  });
  row.append(labelEl, input, val);
  return row;
}

function escapeHTML(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
