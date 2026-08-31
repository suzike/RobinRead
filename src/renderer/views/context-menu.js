'use strict';
/**
 * RobinRead（知更）— 右键菜单（支持子菜单 / 勾选态)）
 */
import { icon } from '../icons.js';
import { t } from '../i18n.js';

// 最近一次右键命中的列表行（list.js 行元素带 data-entry-id）。
// capture 监听先于行级 contextmenu 处理器执行，同步链路内 show() 可安全读取；
// show() 消费后立即清空，避免残留上下文误注入后续程序化打开的菜单。
let _lastEntryRow = null;
document.addEventListener('contextmenu', (event) => {
  _lastEntryRow = event.target?.closest?.('[data-entry-id]') || null;
}, { capture: true });

export class ContextMenu {
  static show(x, y, items) {
    ContextMenu.dismissAll();
    const injected = ContextMenu._injectEntryIDItem(ContextMenu._injectLaterToggleItem(items));
    _lastEntryRow = null; // 一次性消费
    const menu = ContextMenu._build(injected, 0);
    document.body.appendChild(menu);
    ContextMenu._place(menu, x, y);
    setTimeout(() => {
      window.addEventListener('mousedown', ContextMenu._outside, { capture: true });
      window.addEventListener('blur', ContextMenu.dismissAll);
    }, 0);
    return menu;
  }

  /**
   * 列表行右键时在菜单末尾追加「复制文章 ID」（不显眼位置）。
   * 非列表行上下文（侧栏源/文件夹/程序化菜单）不注入；已有同类项时去重。
   */
  static _injectEntryIDItem(items) {
    const entryID = _lastEntryRow?.dataset?.entryId;
    if (!entryID) return items;
    const list = [...(items || [])];
    const label = t('复制文章 ID');
    if (list.some((it) => it?.label === label)) return list;
    if (list.length > 0 && list[list.length - 1]?.type !== 'separator') {
      list.push({ type: 'separator' });
    }
    list.push({
      label,
      icon: 'copy',
      onClick: () => { window.robin?.copyText(entryID); },
    });
    return list;
  }

  /**
   * 列表行右键时在菜单顶部注入「稍后读 / 移出稍后读」toggle（本地待办，短期待办队列）。
   * 文案按该行当前状态切换：行 DOM 带 data-is-later（list.js rowFor 写入并随状态补丁刷新）。
   * 非列表行上下文不注入；已有同类项时去重。
   */
  static _injectLaterToggleItem(items) {
    const row = _lastEntryRow;
    const entryID = row?.dataset?.entryId;
    if (!entryID) return items;
    const isLater = row.dataset.isLater === '1';
    const label = isLater ? t('移出稍后读') : t('稍后读');
    const list = [...(items || [])];
    if (list.some((it) => it?.label === label)) return list;
    list.unshift({
      label,
      icon: 'clock',
      onClick: () => { window.robin?.toggleLater(entryID, !isLater); },
    });
    return list;
  }

  static _build(items, depth) {
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.dataset.depth = String(depth);
    for (const item of items) {
      if (item.type === 'separator') {
        const separator = document.createElement('div');
        separator.className = 'context-menu-separator';
        menu.appendChild(separator);
        continue;
      }
      const row = document.createElement('div');
      row.className = `context-menu-item ${item.destructive ? 'destructive' : ''} ${item.disabled ? 'disabled' : ''}`;
      row.innerHTML = `${item.icon ? icon(item.icon) : '<span style="width:15px"></span>'}<span class="label"></span>${item.checked ? `<span class="check">✓</span>` : ''}${item.children ? `<span class="check" style="color:var(--text-tertiary)">${icon('chevronMenuRight')}</span>` : ''}`;
      row.querySelector('.label').textContent = item.label;

      if (item.disabled) {
        menu.appendChild(row);
        continue;
      }
      if (item.children) {
        const sub = ContextMenu._build(item.children, depth + 1);
        sub.style.visibility = 'hidden';
        sub.style.left = '100%';
        sub.style.top = '0';
        menu.appendChild(sub);
        row.addEventListener('mouseenter', () => {
          menu.querySelectorAll(':scope > .context-menu').forEach((m) => { m.style.visibility = 'hidden'; });
          const rowRect = row.getBoundingClientRect();
          const menuRect = menu.getBoundingClientRect();
          sub.style.left = `${rowRect.right - menuRect.left}px`;
          sub.style.top = `${rowRect.top - menuRect.top}px`;
          sub.style.visibility = 'visible';
        });
      } else {
        row.addEventListener('mouseenter', () => {
          menu.querySelectorAll(':scope > .context-menu').forEach((m) => { m.style.visibility = 'hidden'; });
        });
        row.addEventListener('click', (event) => {
          event.stopPropagation();
          ContextMenu.dismissAll();
          item.onClick?.();
        });
      }
      menu.appendChild(row);
    }
    return menu;
  }

  static _place(menu, x, y) {
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    let left = Math.min(x, window.innerWidth - rect.width - 8);
    let top = Math.min(y, window.innerHeight - Math.min(rect.height, window.innerHeight - 16) - 8);
    menu.style.left = `${Math.max(4, left)}px`;
    menu.style.top = `${Math.max(4, top)}px`;
    // 子菜单越界翻转
    if (menu.getBoundingClientRect().right > window.innerWidth - 180) {
      menu.querySelectorAll(':scope > .context-menu').forEach((sub) => { sub.dataset.flip = '1'; });
    }
  }

  static _outside(event) {
    if (!event.target.closest?.('.context-menu')) ContextMenu.dismissAll();
  }

  static dismissAll() {
    document.querySelectorAll('.context-menu').forEach((el) => el.remove());
    window.removeEventListener('mousedown', ContextMenu._outside, { capture: true });
    window.removeEventListener('blur', ContextMenu.dismissAll);
  }
}
