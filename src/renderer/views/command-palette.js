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

  dismiss() {
    if (!this.overlay) return;
    document.removeEventListener('keydown', this._escHandler);
    this.overlay.remove();
    this.overlay = null;
  }

  _filter(query) {
    const q = String(query || '').trim().toLowerCase();
    this.filtered = !q ? this.items : this.items.filter((cmd) => (
      cmd.label.toLowerCase().includes(q)
      || String(cmd.keywords || '').toLowerCase().includes(q)
    ));
    this.activeIndex = 0;
    this._render();
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
    this.filtered.forEach((cmd, index) => {
      const item = document.createElement('div');
      item.className = `cmd-item ${index === this.activeIndex ? 'active' : ''}`;
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
    });
  }
}
