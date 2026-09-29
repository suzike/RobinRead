'use strict';
/**
 * command-palette.js — 命令面板（方向 22，调研报告 2026-09-26）
 *
 * Ctrl/Cmd+Shift+P 唤起；命令 = { label, keywords?, icon?, hint?, action }。
 * 子串过滤（标签+关键词，大小写不敏感），↑↓ 选择、Enter 执行、Esc 关闭，鼠标点选可用。
 * 零业务依赖：命令注册表由 app 层注入。
 */
import { icon } from '../icons.js';
import { t } from '../i18n.js';

const RECENT_KEY = 'robinread.palette.recent';

export class CommandPalette {
  constructor() {
    this.items = [];
    this.filtered = [];
    this.activeIndex = 0;
    this.overlay = null;
  }

  present(commands) {
    if (this.overlay) this.dismiss();
    this.items = commands || [];
    this.filtered = this.items;
    this.activeIndex = 0;
    try { this.recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (_) { this.recent = []; }

    const overlay = document.createElement('div');
    overlay.className = 'cmd-palette-overlay';
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) this.dismiss(); });

    const palette = document.createElement('div');
    palette.className = 'cmd-palette';
    palette.innerHTML = `
      <input type="text" placeholder="${t('输入命令或搜索…')}" />
      <div class="cmd-palette-list"></div>
      <div class="cmd-palette-foot">
        <span>↑↓ ${t('选择')}</span><span>Enter ${t('执行')}</span><span>Esc ${t('关闭')}</span>
      </div>`;
    this.input = palette.querySelector('input');
    this.listHost = palette.querySelector('.cmd-palette-list');

    this.input.addEventListener('input', () => this._filter(this.input.value));
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); this._move(1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); this._move(-1); }
      else if (event.key === 'Enter') { event.preventDefault(); this._run(this.filtered[this.activeIndex]); }
      else if (event.key === 'Escape') { event.preventDefault(); this.dismiss(); }
    });
    this._escHandler = (event) => { if (event.key === 'Escape') this.dismiss(); };
    document.addEventListener('keydown', this._escHandler);

    overlay.appendChild(palette);
    document.body.appendChild(overlay);
    this.overlay = overlay;
    this._render();
    this.input.focus();
  }

  /** 列表可视高度取整行数倍（R21）：面板 62vh 截断整行导致末行切半。 */
  _fitListHeight() {
    if (!this.overlay) return;
    const list = this.listHost;
    const items = [...list.querySelectorAll('.cmd-item')];
    if (!items.length) return;
    const rowH = items[0].getBoundingClientRect().height;
    if (!(rowH > 4)) return;
    const headHs = [...list.querySelectorAll('.cmd-group-head')].map((h) => h.getBoundingClientRect().height + 9);
    const avail = Math.max(120, Math.floor(window.innerHeight * 0.62) - list.getBoundingClientRect().top - 34);
    let budget = avail - 12;
    let lastGroup = null;
    let hi = 0;
    let used = 0;
    let rows = 0;
    for (const cmd of this.filtered) {
      const g = cmd.group || null;
      let cost = rowH;
      if (g && g !== lastGroup) { cost += headHs[hi] || 0; hi += 1; }
      lastGroup = g;
      if (rows > 0 && budget - cost < 0) break;
      budget -= cost;
      used += cost;
      rows += 1;
    }
    if (rows > 0) list.style.maxHeight = `${Math.round(used + 12)}px`;
    list.style.overflowY = 'auto';
  }

  dismiss() {
    if (!this.overlay) return;
    document.removeEventListener('keydown', this._escHandler);
    this.overlay.remove();
    this.overlay = null;
  }

  _filter(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) {
      // 空查询：最近使用置顶，其余保持注册序
      const recentSet = new Set(this.recent);
      this.filtered = [...this.items.filter((c) => recentSet.has(c.label)), ...this.items.filter((c) => !recentSet.has(c.label))];
      this.activeIndex = 0;
      this._render();
      return;
    }
    // 记分：前缀命中(3) > 标签包含(2) > 关键词包含(1) > 组名包含(0.5)；同分保持注册序
    const scored = [];
    this.items.forEach((cmd, order) => {
      const label = cmd.label.toLowerCase();
      const keywords = String(cmd.keywords || '').toLowerCase();
      const group = String(cmd.group || '').toLowerCase();
      let score = 0;
      if (label.startsWith(q)) score = 3;
      else if (label.includes(q)) score = 2;
      else if (keywords.includes(q)) score = 1;
      else if (group && group.includes(q)) score = 0.5;
      // 搜组名意为整组导航（R21 验收附注）：label 顺带含组名的命令降权到组名命中之后，
      // 避免「退出期刊」这类敏感命令在输入「期刊」时被默认聚焦
      if (score === 2 && group && group.includes(q)) score = 0.4;
      if (score > 0) scored.push({ cmd, score, order });
    });
    scored.sort((a, b) => b.score - a.score || a.order - b.order);
    this.filtered = scored.map((x) => x.cmd);
    this.activeIndex = 0;
    this._render();
  }

  /** 命令执行后记录最近使用（去重、上限 5）。 */
  _rememberRecent(cmd) {
    try {
      const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter((x) => x !== cmd.label);
      list.unshift(cmd.label);
      localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 5)));
    } catch (_) { /* 隐私模式：放弃 */ }
  }

  _move(delta) {
    if (!this.filtered.length) return;
    this.activeIndex = (this.activeIndex + delta + this.filtered.length) % this.filtered.length;
    this._render();
    const active = this.listHost.querySelector('.cmd-item.active');
    active?.scrollIntoView({ block: 'nearest' });
  }

  _run(cmd) {
    if (!cmd) return;
    this._rememberRecent(cmd);
    this.dismiss();
    try { cmd.action?.(); } catch (_) { /* 单条命令失败不破坏面板生命周期 */ }
  }

  _render() {
    this.listHost.innerHTML = '';
    if (!this.filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'cmd-empty';
      empty.textContent = t('没有匹配的命令');
      this.listHost.appendChild(empty);
      return;
    }
    // 分组小节头（R21）：相邻同组命令前插入组名行；键盘导航越过组头行
    let lastGroup = null;
    let itemIndex = 0;
    this.filtered.forEach((cmd, index) => {
      const group = cmd.group || null;
      if (group && group !== lastGroup) {
        const head = document.createElement('div');
        head.className = 'cmd-group-head';
        head.textContent = group;
        this.listHost.appendChild(head);
      }
      lastGroup = group;
      const item = document.createElement('div');
      item.className = `cmd-item ${index === this.activeIndex ? 'active' : ''}`;
      item.dataset.index = String(index);
      const iconEl = document.createElement('span');
      iconEl.className = 'cmd-icon';
      iconEl.innerHTML = cmd.icon ? icon(cmd.icon) : '';
      const label = document.createElement('span');
      label.className = 'cmd-label';
      label.textContent = cmd.label;
      item.append(iconEl, label);
      if (cmd.hint) {
        const hint = document.createElement('span');
        hint.className = 'cmd-hint';
        hint.textContent = cmd.hint;
        item.appendChild(hint);
      }
      item.addEventListener('click', () => this._run(cmd));
      item.addEventListener('mousemove', () => {
        if (this.activeIndex !== index) { this.activeIndex = index; this._render(); }
      });
      this.listHost.appendChild(item);
      itemIndex += 1;
    });
    // 隐藏窗 rAF 冻结：直接同步取整（首渲染后 listHost 已在 DOM 且有尺寸）
    this._fitListHeight();
  }
}
