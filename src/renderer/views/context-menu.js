'use strict';
/**
 * RobinRead（知更）— 右键菜单（支持子菜单 / 勾选态)）
 */
import { icon } from '../icons.js';

export class ContextMenu {
  static show(x, y, items) {
    ContextMenu.dismissAll();
    const menu = ContextMenu._build(items, 0);
    document.body.appendChild(menu);
    ContextMenu._place(menu, x, y);
    setTimeout(() => {
      window.addEventListener('mousedown', ContextMenu._outside, { capture: true });
      window.addEventListener('blur', ContextMenu.dismissAll);
    }, 0);
    return menu;
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
