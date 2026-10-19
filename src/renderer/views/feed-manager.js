'use strict';
/**
 * RobinRead Windows — 订阅管理浮层（R121 批量订阅治理）
 *
 * 背景：侧栏 Ctrl+点多选 + 右键批量删除早已存在，但交互不可发现——用户实报
 * 「添加进来的订阅源没法批量选择、一键移除」。本浮层把批量治理做成显式界面：
 * - 复选框列表（按账户 → 文件夹分组），行点击即选，Shift 连选区间
 * - 搜索即时过滤（标题 / 链接）
 * - 全选（可见项）/ 全不选 / 反选
 * - 批量动作：移入文件夹 / 标为已读 / 移除所选（危险色 + 二次确认）
 * 数据全部走既有通道（getSidebar / deleteFeeds / setFeedFolder / markAllRead），
 * 不新增 IPC；删除后主进程 state:changed 推动侧栏/列表自动刷新。
 */
import { t, tf } from '../i18n.js';
import { icon } from '../icons.js';
import { confirmBox, promptBox } from '../ui-prompt.js';
import { registerEscapeLayer, isTopEscapeLayer, releaseEscapeLayer } from './overlay-stack.js'; // R55 浮层秩序
import { ContextMenu } from './context-menu.js';
import { showToast } from './toast.js';

const FM_EXTRA_STYLE = `
  .fm-modal { width: min(720px, 92vw); height: min(640px, 86vh); display: flex; flex-direction: column; padding: 0; overflow: hidden; }
  .fm-head { display: flex; align-items: center; gap: 10px; padding: 14px 16px 10px; }
  .fm-title { font-size: 15px; font-weight: 700; color: var(--text-primary); flex: 0 0 auto; }
  .fm-search { flex: 1; min-width: 120px; padding: 7px 10px; border: 1px solid var(--separator); border-radius: 8px; background: transparent; color: var(--text-primary); font-size: 12.5px; }
  .fm-search::placeholder { color: var(--text-tertiary); }
  .fm-search:focus { outline: none; border-color: var(--accent); }
  .fm-close { margin-left: auto; }
  .fm-toolbar { display: flex; align-items: center; gap: 6px; padding: 0 16px 10px; flex-wrap: wrap; }
  .fm-toolbar .btn-text { font-size: 12px; }
  .fm-count { font-size: 12px; color: var(--text-secondary); margin-left: auto; font-variant-numeric: tabular-nums; }
  .fm-list { flex: 1; overflow-y: auto; padding: 0 10px 12px; }
  .fm-group-title { font-size: 11px; font-weight: 700; color: var(--text-tertiary); padding: 12px 8px 6px; letter-spacing: 0.04em; }
  .fm-row { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: 8px; cursor: pointer; }
  .fm-row:hover { background: color-mix(in srgb, var(--accent) 5%, transparent); }
  .fm-row.fm-checked { background: color-mix(in srgb, var(--accent) 9%, transparent); }
  .fm-check { flex: 0 0 auto; width: 15px; height: 15px; border-radius: 4px; border: 1.5px solid var(--separator); display: inline-flex; align-items: center; justify-content: center; color: transparent; }
  .fm-row.fm-checked .fm-check { background: var(--accent); border-color: var(--accent); color: var(--accent-ink, #fff); }
  .fm-check svg { width: 10px; height: 10px; }
  .fm-name { font-size: 12.5px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .fm-url { flex: 0 1 auto; font-size: 10.5px; color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 42%; }
  .fm-unread { flex: 0 0 auto; font-size: 10px; font-weight: 700; color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); border-radius: 999px; padding: 1px 7px; font-variant-numeric: tabular-nums; }
  .fm-empty { padding: 40px 0; text-align: center; color: var(--text-tertiary); font-size: 12.5px; }
  .fm-actions { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--separator); }
  .fm-actions .fm-sel-note { font-size: 12px; color: var(--text-secondary); margin-right: auto; font-variant-numeric: tabular-nums; }
  .fm-actions[hidden] { display: none; }
`;

export class FeedManager {
  /** @param {{ unreadByFeed?: Object<string, number>, folderNames?: string[], onFeedsChanged?: Function }} ctx */
  constructor({ unreadByFeed = {}, folderNames = [], onFeedsChanged = null } = {}) {
    this.unreadByFeed = unreadByFeed;
    this.folderNames = folderNames;
    this.onFeedsChanged = onFeedsChanged;
    this.query = '';
    this.selected = new Set(); // feedID set
    this.groups = [];         // [{ key, title, feeds: [...] }]（渲染分组，扁平顺序即连选顺序）
    this._lastClicked = -1;   // shift 连选锚点（groups 扁平下标）
    this._mutated = false;    // 本会话发生过批量动作（dismiss 时统一通知外层刷新）
  }

  present() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) this.dismiss();
    });
    this.modal = document.createElement('div');
    this.modal.className = 'modal fm-modal';
    overlay.appendChild(this.modal);
    document.body.appendChild(overlay);
    this.overlay = overlay;
    this._esc = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (!isTopEscapeLayer(this._escLayer)) return; // R55：顶层先关（一次 Esc 只关一层）
      event.preventDefault();
      this.dismiss();
    };
    document.addEventListener('keydown', this._esc);
    this._escLayer = registerEscapeLayer({ id: 'feed-manager', isAlive: () => Boolean(this.overlay) });
    if (!document.getElementById('fm-extra-style')) {
      const styleEl = document.createElement('style');
      styleEl.id = 'fm-extra-style';
      styleEl.textContent = FM_EXTRA_STYLE;
      document.head.appendChild(styleEl);
    }
    // 常驻壳：头部（搜索框）与三块容器只建一次——_render 只填容器，
    // 搜索防抖重渲染不换 <input>，焦点与 IME 组字不丢（审查 P1）
    const head = document.createElement('div');
    head.className = 'fm-head';
    head.innerHTML = `<span class="fm-title"></span>
      <input class="fm-search" type="text" />
      <button class="btn icon-only fm-close"></button>`;
    head.querySelector('.fm-title').textContent = t('订阅管理');
    const search = head.querySelector('.fm-search');
    search.placeholder = t('搜索订阅（标题 / 链接）');
    let searchTimer = null;
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { this.query = search.value; this._lastClicked = -1; this._render(); }, 140);
    });
    const closeBtn = head.querySelector('.fm-close');
    closeBtn.title = t('关闭');
    closeBtn.innerHTML = icon('close');
    closeBtn.addEventListener('click', () => this.dismiss());
    this.toolbarEl = document.createElement('div');
    this.toolbarEl.className = 'fm-toolbar';
    this.listEl = document.createElement('div');
    this.listEl.className = 'fm-list';
    this.actionsEl = document.createElement('div');
    this.actionsEl.className = 'fm-actions';
    this.modal.append(head, this.toolbarEl, this.listEl, this.actionsEl);
    this._load();
  }

  dismiss() {
    document.removeEventListener('keydown', this._esc);
    releaseEscapeLayer(this._escLayer);
    this._escLayer = null;
    this.overlay?.remove();
    this.overlay = null;
    if (this._mutated && this.onFeedsChanged) this.onFeedsChanged(); // 有过批量操作：收尾统一通知
    this.selected.clear();
  }

  async _load() {
    const result = await window.robin.getSidebar();
    if (!result.ok || !this.overlay) return;
    this._lastClicked = -1; // 行序可能重排（移文件夹/删源）：连选锚点必须作废，防错区间批量误删
    this.groups = [];
    for (const acct of result.data || []) {
      const name = acct.account?.displayName || acct.account?.username || acct.account?.id || '';
      for (const folder of acct.folders || []) {
        if (folder.feeds?.length) this.groups.push({ key: `${acct.account.id}:f:${folder.id}`, title: `${name} · ${folder.name}`, feeds: folder.feeds });
      }
      if (acct.rootFeeds?.length) this.groups.push({ key: `${acct.account.id}:root`, title: name ? `${name} · ${t('未分类')}` : t('未分类'), feeds: acct.rootFeeds });
    }
    this._render();
  }

  /** 搜索过滤后的扁平可见行（连选顺序基准）。 */
  _visibleFeeds() {
    const q = this.query.trim().toLowerCase();
    const out = [];
    for (const g of this.groups) {
      for (const feed of g.feeds) {
        if (!q || (feed.title || '').toLowerCase().includes(q) || (feed.feedURL || '').toLowerCase().includes(q)) out.push(feed);
      }
    }
    return out;
  }

  /**
   * 只重建工具条/列表/动作条；头部（标题+搜索框）常驻——重渲染不打断输入焦点
   * 与中文输入法组字（审查 P1：搜索防抖重渲染曾把焦点连根拔掉）。
   */
  _render() {
    if (!this.overlay) return;
    this.toolbarEl.textContent = '';
    this.listEl.textContent = '';
    this.actionsEl.textContent = '';
    const toolbar = this.toolbarEl;
    const mkBtn = (labelKey, onClick) => {
      const b = document.createElement('button');
      b.className = 'btn-text';
      b.textContent = t(labelKey);
      b.addEventListener('click', onClick);
      toolbar.appendChild(b);
      return b;
    };
    const visible = this._visibleFeeds();
    mkBtn('全选', () => { for (const f of visible) this.selected.add(f.id); this._render(); });
    mkBtn('全不选', () => { this.selected.clear(); this._render(); });
    mkBtn('反选', () => { for (const f of visible) { if (this.selected.has(f.id)) this.selected.delete(f.id); else this.selected.add(f.id); } this._render(); });
    const count = document.createElement('span');
    count.className = 'fm-count';
    count.textContent = tf('%lld 个订阅', visible.length);
    toolbar.appendChild(count);

    const list = this.listEl;
    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'fm-empty';
      empty.textContent = this.query ? t('没有匹配的订阅') : t('还没有订阅');
      list.appendChild(empty);
    } else {
      const visibleSet = new Set(visible);
      let flatIndex = -1;
      for (const g of this.groups) {
        const feeds = g.feeds.filter((f) => visibleSet.has(f));
        if (!feeds.length) continue;
        const gt = document.createElement('div');
        gt.className = 'fm-group-title';
        gt.textContent = g.title;
        list.appendChild(gt);
        for (const feed of feeds) {
          flatIndex += 1;
          const idx = flatIndex;
          const row = document.createElement('div');
          row.className = 'fm-row' + (this.selected.has(feed.id) ? ' fm-checked' : '');
          row.dataset.feedId = feed.id;
          const unread = this.unreadByFeed?.[feed.id] || 0;
          row.innerHTML = `<span class="fm-check">${icon('checkCircle')}</span>
            <span class="fm-name"></span>
            <span class="fm-url"></span>
            ${unread ? '<span class="fm-unread"></span>' : ''}`;
          row.querySelector('.fm-name').textContent = feed.title || feed.feedURL;
          row.querySelector('.fm-url').textContent = feed.feedURL || '';
          if (unread) row.querySelector('.fm-unread').textContent = String(unread);
          row.addEventListener('click', (event) => {
            if (event.shiftKey && this._lastClicked >= 0 && this._lastClicked !== idx) {
              // Shift 连选：锚点到当前行的可见区间整体置为当前行目标态
              const [a, b] = this._lastClicked < idx ? [this._lastClicked, idx] : [idx, this._lastClicked];
              const target = !this.selected.has(feed.id);
              for (let i = a; i <= b; i += 1) {
                const f = visible[i];
                if (target) this.selected.add(f.id); else this.selected.delete(f.id);
              }
            } else {
              if (this.selected.has(feed.id)) this.selected.delete(feed.id);
              else this.selected.add(feed.id);
            }
            this._lastClicked = idx;
            this._refreshSelectionUI(); // 轻量：只翻行态与计数，不重建列表（大订阅库点击不卡）
          });
          list.appendChild(row);
        }
      }
    }

    const actions = this.actionsEl;
    actions.hidden = this.selected.size === 0;
    const selNote = document.createElement('span');
    selNote.className = 'fm-sel-note';
    selNote.textContent = tf('已选 %lld 项', this.selected.size);
    actions.appendChild(selNote);

    const moveBtn = document.createElement('button');
    moveBtn.className = 'btn-text';
    moveBtn.textContent = t('移入文件夹');
    moveBtn.addEventListener('click', (event) => {
      const ids = [...this.selected];
      const items = [{ label: t('无分类'), onClick: () => this._applyFolder(ids, null) }];
      if (this.folderNames.length) items.push({ type: 'separator' });
      for (const name of this.folderNames) items.push({ label: name, onClick: () => this._applyFolder(ids, name) });
      items.push({ type: 'separator' });
      items.push({ label: t('新建文件夹…'), icon: 'folderPlus', onClick: () => { this.dismiss(); this._promptFolder(ids); } });
      ContextMenu.show(event.clientX, event.clientY, items);
    });
    actions.appendChild(moveBtn);

    const readBtn = document.createElement('button');
    readBtn.className = 'btn-text';
    readBtn.textContent = t('标为已读');
    readBtn.addEventListener('click', async () => {
      const ids = [...this.selected];
      await window.robin.markAllRead({ kind: 'feeds', feedIDs: ids });
      for (const id of ids) this.unreadByFeed[id] = 0; // 徽标即时归零（审查 P2：曾等到重开浮层才更新）
      this._mutated = true;
      showToast(tf('已将 %lld 个订阅标为已读', this.selected.size));
      this._load();
    });
    actions.appendChild(readBtn);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-text danger';
    removeBtn.textContent = t('移除所选');
    removeBtn.addEventListener('click', () => this._confirmRemove());
    actions.appendChild(removeBtn);
  }

  /** 选择态轻量刷新：行勾选类 + 已选计数 + 动作条显隐（免整树重建）。 */
  _refreshSelectionUI() {
    if (!this.overlay) return;
    for (const row of this.modal.querySelectorAll('.fm-row')) {
      row.classList.toggle('fm-checked', this.selected.has(row.dataset.feedId));
    }
    const selNote = this.modal.querySelector('.fm-sel-note');
    if (selNote) selNote.textContent = tf('已选 %lld 项', this.selected.size);
    const actions = this.modal.querySelector('.fm-actions');
    if (actions) actions.hidden = this.selected.size === 0;
  }

  async _applyFolder(ids, folderName) {
    await window.robin.setFeedFolder(ids, folderName);
    this._mutated = true;
    showToast(tf('已移动 %lld 个订阅', ids.length));
    this._load();
  }

  /** 新建文件夹并立即移入（复用主进程 ensureFolder 语义：setFeedFolder 传新名字自动建）。 */
  async _promptFolder(ids) {
    const name = await promptBox(t('新建文件夹'), { placeholder: t('文件夹名称') });
    if (!name || !String(name).trim()) return;
    await window.robin.setFeedFolder(ids, String(name).trim());
    this._mutated = true;
    showToast(tf('已移动 %lld 个订阅', ids.length));
    this.onFeedsChanged?.();
  }

  async _confirmRemove() {
    const ids = [...this.selected];
    const message = tf('确定要删除选中的 %lld 个订阅源及其所有文章吗？此操作无法撤销。', ids.length);
    const ok = await confirmBox(t('删除订阅'), { message, okLabel: t('删除'), danger: true });
    if (!ok) return;
    await window.robin.deleteFeeds(ids);
    this.selected.clear();
    this._lastClicked = -1;
    this._mutated = true;
    showToast(tf('已移除 %lld 个订阅', ids.length));
    this._load();
  }
}
