'use strict';
/**
 * RobinRead Windows — 键盘快捷键帮助
 * 1:1 移植自 KeyboardShortcutHelpView.swift 的分组与说明。
 */
import { t } from '../i18n.js';

const Ctrl = window.navigator.platform.includes('Win') ? 'Ctrl' : '⌘';

const SECTIONS = [
  {
    title: t('文章阅读'),
    shortcuts: [
      { keys: ['C'], title: t('切换对照翻译'), detail: t('开启或关闭逐段对照翻译。') },
      { keys: ['V'], title: t('查看 AI 摘要'), detail: t('优先显示已有摘要；没有缓存时开始生成。') },
      { keys: ['B', 'B'], title: t('查看上一篇'), detail: t('在当前列表中再次按 B 确认，不循环。') },
      { keys: ['N', 'N'], title: t('查看下一篇'), detail: t('在当前列表中再次按 N 确认，不循环。') },
      { keys: ['M'], title: t('切换收藏'), detail: t('收藏或取消收藏当前文章；收藏后可点提示中的「查看收藏」，或到侧栏「收藏」。') },
      { keys: ['H'], title: t('高亮选中文字'), detail: t('先选中正文文字再按 H，快速加黄色高亮；划词菜单可选其他颜色、写批注笔记。') },
      { keys: ['Space'], title: t('向下阅读'), detail: t('滚动正文；到达底部后再次按空格切换下一篇。') },
    ],
  },
  {
    title: t('栏目导航'),
    shortcuts: [
      { keys: ['←'], title: t('移到左侧栏目'), detail: t('在订阅源、文章列表和正文之间移动焦点。') },
      { keys: ['→'], title: t('移到右侧栏目'), detail: t('在订阅源、文章列表和正文之间移动焦点。') },
    ],
  },
  {
    title: t('全局'),
    shortcuts: [
      { keys: [Ctrl, '⇧', 'R'], title: t('刷新全部订阅'), detail: t('立即检查所有订阅源。') },
      { keys: [Ctrl, '+'], title: t('放大正文字号'), detail: t('增大文章正文的显示字号。') },
      { keys: [Ctrl, '−'], title: t('缩小正文字号'), detail: t('减小文章正文的显示字号。') },
      { keys: [Ctrl, '0'], title: t('默认正文字号'), detail: t('恢复默认文章正文字号。') },
      { keys: [Ctrl, '/'], title: t('打开快捷键帮助'), detail: t('显示这个帮助窗口。') },
    ],
  },
];

export class ShortcutsView {
  present() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) overlay.remove();
    });
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-main">
        <div class="modal-header"><h3>${escapeHTML(t('键盘快捷键'))}</h3></div>
        <div class="modal-scroll" style="padding-top:24px;"></div>
      </div>
    `;
    const scroll = modal.querySelector('.modal-scroll');

    const intro = document.createElement('p');
    intro.style.cssText = 'font-size:12.5px; color:var(--text-secondary); line-height:1.6; margin-bottom:20px;';
    intro.textContent = t('C、V、B、N、M 等裸键只在文章 Feed 阅读界面有效。输入文字、选择正文或打开 AI 交互弹层时不会触发；Ctrl+C 与 Ctrl+V 始终保留系统复制、粘贴行为。');
    scroll.appendChild(intro);

    for (const section of SECTIONS) {
      const block = document.createElement('div');
      block.className = 'setting-section';
      const heading = document.createElement('h4');
      heading.style.cssText = 'font-size:13px; font-weight:700; margin-bottom:10px; color:var(--text-primary);';
      heading.textContent = section.title;
      block.appendChild(heading);

      const list = document.createElement('div');
      list.style.cssText = 'background:var(--note-background); border:1px solid var(--note-border); border-radius:14px; overflow:hidden;';
      section.shortcuts.forEach((shortcut, index) => {
        const rowEl = document.createElement('div');
        rowEl.className = 'shortcut-row';
        if (index > 0) rowEl.style.borderTop = '1px solid var(--separator)';
        rowEl.innerHTML = `
          <div class="shortcut-info">
            <div class="title"></div>
            <div class="detail"></div>
          </div>
          <div class="shortcut-keys"></div>
        `;
        rowEl.querySelector('.title').textContent = shortcut.title;
        rowEl.querySelector('.detail').textContent = shortcut.detail;
        const keys = rowEl.querySelector('.shortcut-keys');
        for (const key of shortcut.keys) {
          const kbd = document.createElement('span');
          kbd.className = 'kbd';
          kbd.textContent = key;
          if (key === 'Space') kbd.style.minWidth = '62px';
          keys.appendChild(kbd);
        }
        list.appendChild(rowEl);
      });
      block.appendChild(list);
      scroll.appendChild(block);
    }

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', function esc(event) {
      if (event.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', esc);
      }
    });
  }
}

function escapeHTML(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
