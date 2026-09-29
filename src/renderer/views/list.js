'use strict';
/**
 * RobinRead（知更）— 文章列表
 *
 * EntryRow 结构（自上而下）：
 *   [未读圆点 7px] | [标题（衬线，未读 semibold/已读 regular，有摘要 2 行/无摘要 4 行）]
 *                     [摘要（2 行，仅非冗余时）]
 *                     [favicon 14 + 来源 + 账户徽标 + 星标 | 日期（今天→时间/今年→月日/更早→年月）]
 * 无限滚动：pageSize 100，末行出现时加载下一页。
 */
import { t, tf } from '../i18n.js';
import { icon } from '../icons.js';
import { EditionReader } from './edition-reader.js';
import { paperPref, setPaperPref } from './paper-pref.js';
import { feedIconURL } from './sidebar.js';

const PAGE_SIZE = 100;

export class ListView {
  constructor(scrollEl, handlers) {
    this.scrollEl = scrollEl;
    this.handlers = handlers; // onSelect / onContext / onLoadMore / onSearch / onDigest
    this.items = [];
    this.scope = null;
    this.selectedID = null;
    // R23 批量多选：选中集合 + 区间锚点（视图层状态，随重渲染清空）
    this.picked = new Set();
    this.pickAnchor = -1;
    // R33 渲染签名去重 + 新到高亮
    this._lastSig = null;
    this._sigBust = false;
    this._knownIds = new Set();
    this._markNew = false;
    // Esc 清选；Ctrl/Cmd+A 全选当前视野（R25：输入框聚焦与期刊打开时不劫持）
    this._escPick = (event) => {
      if ((event.ctrlKey || event.metaKey) && (event.key === 'a' || event.key === 'A')) {
        const el = event.target;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
        if (document.querySelector('.er-overlay')) return;
        if (!this.items.length) return;
        event.preventDefault();
        for (const it of this.items) this.picked.add(it.id);
        this._syncPickUI();
        return;
      }
      if (event.key === 'Escape') this._clearPick();
    };
    document.addEventListener('keydown', this._escPick);
    // R28 键盘导航：J/K 移动光标（enter/o 打开）。箭头键不接——_split 视图下会劫持文章滚动；
    // 输入框聚焦、命令面板/期刊打开时全部让路。光标按 id 锚定（列表刷新位移不错位）
    this.cursorID = null;
    this._navKey = (event) => {
      const el = event.target;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (document.querySelector('.er-overlay') || document.querySelector('.cmd-palette-overlay')) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      // ? 呼出列表快捷键速查（R29）
      if (event.key === '?' || (event.shiftKey && key === '/')) {
        event.preventDefault();
        this._toggleKeysPanel();
        return;
      }
      const isMove = key === 'j' || key === 'k';
      if (!isMove && !(event.key === 'Enter' || key === 'o')) return;
      const curIdx = this.items.findIndex((it) => it.id === this.cursorID);
      if (!isMove) {
        event.preventDefault();
        if (curIdx >= 0) {
          const item = this.items[curIdx];
          this.handlers.onSelect(item.id, item);
        }
        return;
      }
      if (!this.items.length) return;
      event.preventDefault();
      const atEnd = curIdx === this.items.length - 1;
      const next = Math.min(this.items.length - 1, Math.max(0, curIdx + (key === 'j' ? 1 : -1)));
      // J 触底（R29）：请求下一页，到位后继续 J 即无缝续览
      if (key === 'j' && next === curIdx && atEnd && this.handlers.onLoadMore) {
        this.handlers.onLoadMore();
        return;
      }
      if (next === curIdx) return;
      this.cursorID = this.items[next].id;
      this._syncCursor(true);
    };
    document.addEventListener('keydown', this._navKey);

    // 顶部 inset（毛玻璃 + 标题，对应 safeAreaInset header）
    this.scrollEl.innerHTML = '';
    this.topInset = document.createElement('div');
    this.topInset.className = 'list-top-inset';
    this.topInset.innerHTML = `
      <div class="list-top-title"></div>
      <div class="tb-spring"></div>
      <div class="list-search" id="list-search">
        ${icon('search')}
        <input type="text" placeholder="${escapeHTML(t('搜索…'))}" id="list-search-input" spellcheck="false"/>
        <button class="clear" id="list-search-clear">${icon('close')}</button>
      </div>
      <div class="lt-controls">
        <button class="digest-btn" id="view-mode-btn" title="${escapeHTML(t('切换列表 / 杂志视图'))}"><span></span></button>
        <button class="digest-btn" id="list-sort-btn" title="${escapeHTML(t('切换排序方式'))}"><span></span></button>
        <button class="digest-btn" id="digest-btn" title="${escapeHTML(t('AI 汇总今日全部文章'))}">${icon('spark')}<span></span></button>
        <button class="digest-btn" id="later-clean-btn" title="${escapeHTML(t('把入队超过 14 天的稍后读标记已读并移出队列'))}" style="display:none"></button>
      </div>`;
    this.topInset.querySelector('#digest-btn span').textContent = t('今日简报');
    const cleanBtn = this.topInset.querySelector('#later-clean-btn');
    cleanBtn.addEventListener('click', () => this.handlers.onCleanupLater?.(this._overdueIDs || []));
    this.sortBtn = this.topInset.querySelector('#list-sort-btn');
    this.sortBtn.addEventListener('click', () => this.handlers.onToggleSort?.());
    this.searchInput = this.topInset.querySelector('#list-search-input');
    this.searchHost = this.topInset.querySelector('#list-search');
    let searchTimer = null;
    this.searchInput.addEventListener('input', () => {
      if (this.searchInput.value) this._hideSearchHistory(); // R42：输入即收起历史下拉（不遮输入与结果）
      this.searchHost.classList.toggle('has-value', Boolean(this.searchInput.value));
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => this.handlers.onSearch?.(this.searchInput.value.trim()), 260);
    });
    this.searchInput.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { this._hideSearchHistory(); this.clearSearch(); this.handlers.onSearch?.(''); }
      else if (event.key === 'Enter') {
        // R40：下拉开着且高亮候选项时 Enter=选中该项；否则按普通提交记忆
        const hl = document.querySelector('.search-history-item.hl');
        if (hl) { hl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); return; }
        this._rememberSearch(this.searchInput.value.trim());
        this._hideSearchHistory();
      }
      else if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (!document.querySelector('.search-history')) this._showSearchHistory();
        else this._moveHistoryHighlight(1);
      }
      else if (event.key === 'ArrowUp') { event.preventDefault(); this._moveHistoryHighlight(-1); }
    });
    this.searchInput.addEventListener('focus', () => { if (this.searchInput.value) return; this._showSearchHistory(); });
    this.searchInput.addEventListener('blur', () => setTimeout(() => this._hideSearchHistory(), 150)); // 延迟让候选点击先于收起
    this.topInset.querySelector('#list-search-clear').addEventListener('click', () => {
      this.clearSearch();
      this.handlers.onSearch?.('');
    });
    this.topInset.querySelector('#digest-btn').addEventListener('click', () => this.handlers.onDigest?.());
    this.viewMode = 'list';
    this.viewBtn = this.topInset.querySelector('#view-mode-btn');
    this.viewBtn.addEventListener('click', () => this.handlers.onToggleViewMode?.());
    this.scrollEl.appendChild(this.topInset);
    this.rowsHost = document.createElement('div');
    this.scrollEl.appendChild(this.rowsHost);

    this.scrollEl.addEventListener('scroll', () => this._onScroll(), { passive: true });
  }

  /** 排序切换按钮文案（时间序 ↔ 未读优先）。 */
  setSortButton(listSort) {
    const labels = { time: t('时间序'), unreadFirst: t('未读优先'), shortFirst: t('短文优先') };
    this.sortBtn.innerHTML = `<span>${escapeHTML(labels[listSort] || labels.time)}</span>`;
    this.sortBtn.classList.toggle('active', listSort !== 'time');
  }

  /** 渲染签名（R33）：视野/选中/未读徽/视图形态 + 逐条 id 与三态，任何实质变化都换签名。 */
  _renderSig(items, scope, selectedID, hasUnread) {
    let h = `${scope?.kind || ''}|${scope?.id || scope?.name || ''}|${selectedID || ''}|${hasUnread ? 1 : 0}|${this.viewMode}`;
    for (const it of items) h += `|${it.id}:${it.isRead ? 1 : 0}${it.isStarred ? 1 : 0}${it.isLater ? 1 : 0}`;
    return h;
  }

  /** 时间线形态（list 经典列表 / magazine 沉浸杂志），切换后下一次 render 生效。 */
  setViewMode(mode) {
    this.viewMode = mode === 'magazine' ? 'magazine' : 'list';
    this._sigBust = true; // 同一签名的另一形态必须真重绘
    this.viewBtn.innerHTML = `<span>${escapeHTML(this.viewMode === 'magazine' ? t('杂志') : t('列表'))}</span>`;
    this.viewBtn.classList.toggle('active', this.viewMode === 'magazine');
  }

  render(items, scope, selectedID, hasUnread) {
    // R33 渲染签名去重：app:state 推送频繁，列表无实质变化时跳过整段重建（保滚动/选中/批量态）
    const sig = this._renderSig(items, scope, selectedID, hasUnread);
    if (sig === this._lastSig && !this._sigBust) {
      this.items = items;
      return;
    }
    this._lastSig = sig;
    this._sigBust = false;
    this._clearPick();
    this.items = items;
    this.scope = scope;
    this.selectedID = selectedID;
    // R33 新到高亮：已见识过列表（非首屏）时，不在 known 集合里的行标记 row-new
    this._markNew = this._knownIds.size > 0;
    this.topInset.querySelector('.list-top-title').textContent = this.titleForScope(scope);
    this.rowsHost.innerHTML = '';

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-empty';
      const hasFeeds = (window.__robinSidebar || []).some((a) => (a.allFeeds?.length || 0) > 0);
      if (scope?.kind === 'starred') {
        // 收藏视图空态：告诉用户「怎么收藏、收藏去哪了」
        empty.innerHTML = `<div class="glyph">${icon('star')}</div><h3></h3><p></p>`;
        empty.querySelector('h3').textContent = t('还没有收藏');
        empty.querySelector('p').textContent = t('阅读时按 M 或点工具栏 ☆ 收藏文章，收藏的文章都会保存在这里。');
      } else if (scope?.kind === 'later') {
        // 稍后读视图空态：短期待办队列已清空
        empty.innerHTML = `<div class="glyph">${icon('clock')}</div><h3></h3><p></p>`;
        empty.querySelector('h3').textContent = t('稍后读队列为空');
        empty.querySelector('p').textContent = t('读着累先存起来：右键文章或点阅读器「稍后读」，处理完移出即可。');
      } else {
        empty.innerHTML = `<div class="glyph">${icon('newspaper')}</div><h3></h3><p></p>`;
        empty.querySelector('h3').textContent = t('没有文章');
        empty.querySelector('p').textContent = t(hasFeeds ? '切换到其他分类，或等待下一次订阅更新。' : '添加订阅后，这里会显示文章。');
        // R41：有订阅源的空态提供「立即刷新」一键动作，免去去侧栏找刷新
        if (hasFeeds) {
          const refresh = document.createElement('button');
          refresh.type = 'button';
          refresh.className = 'list-empty-refresh';
          refresh.textContent = t('立即刷新');
          refresh.addEventListener('click', (event) => {
            event.stopPropagation();
            window.robin.refresh();
          });
          empty.appendChild(refresh);
        }
      }
      this.rowsHost.appendChild(empty);
      this._knownIds = new Set();
      this._markNew = false;
      return;
    }

    if (this.viewMode === 'magazine') {
      this._renderMagazine(items, selectedID);
      this._knownIds = new Set(items.map((it) => it.id));
      this._markNew = false;
      return;
    }
    // 非杂志模式：清除杂志纸张质感底色，避免纸感底泄漏进列表视图
    this.rowsHost.closest('.list-scroll')?.classList.remove('nj-mag-paper', 'nj-mag-white', 'nj-mag-book');
    const clusters = clusterSimilar(items);
    // 渐进渲染（R6）：大量条目分帧 append，避免长列表一次性阻塞主线程
    const BATCH = 60;
    const renderEntry = (entry) => entry.type === 'cluster' ? this.clusterRow(entry) : this.rowFor(entry.item);
    if (clusters.length > BATCH) {
      let idx = 0;
      // 渲染期间抑制 onLoadMore（R6 遗留）：分帧 append 不断推高 scrollHeight，
      // 滚动监听会把"还没渲染完"误判为"已到页尾"而提前翻页
      this._renderingPages = true;
      const appendNext = () => {
        const end = Math.min(clusters.length, idx + BATCH);
        const frag = document.createDocumentFragment();
        for (; idx < end; idx += 1) frag.appendChild(renderEntry(clusters[idx]));
        this.rowsHost.appendChild(frag);
        if (idx < clusters.length) requestAnimationFrame(appendNext);
        else {
          this._renderingPages = false;
          this.markSelected(selectedID); this._observeReveal(); this._mountResumeCard();
        }
      };
      appendNext();
      this._knownIds = new Set(items.map((it) => it.id));
      this._markNew = false;
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const entry of clusters) {
      if (entry.type === 'cluster') {
        fragment.appendChild(this.clusterRow(entry));
      } else {
        fragment.appendChild(this.rowFor(entry.item));
      }
    }
    this.rowsHost.appendChild(fragment);
    this.markSelected(selectedID);
    this._observeReveal();
    this._mountResumeCard();
    this._knownIds = new Set(items.map((it) => it.id));
    this._markNew = false;
  }

  titleForScope(scope) {
    if (!scope) return '';
    switch (scope.kind) {
      case 'today': return t('今天');
      case 'unread': return t('未读');
      case 'starred': return t('收藏');
      case 'later': return t('稍后读');
      case 'smart': return scope.name || t('智能文件夹');
      case 'tag':
        return `${t('标签')}：${scope.tag || ''}`;
      case 'feed': {
        for (const account of window.__robinSidebar || []) {
          const feed = (account.allFeeds || []).find((f) => f.id === scope.feedID);
          if (feed) return feed.title;
        }
        return t('订阅');
      }
      case 'feeds': {
        const n = scope.feedIDs.length;
        const template = t('%lld 个订阅');
        return template.replace('%lld', String(n));
      }
      case 'folder': return scope.folderName;
      default: return '';
    }
  }

  rowFor(item) {
    const row = document.createElement('article');
    const cleanTitle = stripHtml(item.title) || t('未命名文章');
    const cleanSummary = stripHtml(item.summaryPreview);
    const showSummary = shouldShowSummary(cleanTitle, cleanSummary);
    const isNew = this._markNew && !this._knownIds.has(item.id);
    row.className = `entry-row ${item.isRead ? 'read' : 'unread'} ${item.isStarred ? 'starred' : ''} ${item.isLater ? 'later' : ''} ${showSummary ? 'has-summary' : ''} ${isNew ? 'row-new' : ''}`;
    if (isNew) setTimeout(() => row.classList.remove('row-new'), 1800); // 动画完摘类（隐藏窗动画事件不派发，定时器可靠）
    row.dataset.entryId = item.id;
    row.dataset.isLater = item.isLater ? '1' : '0'; // 右键菜单注入「稍后读」toggle 依据

    const favicon = item.feedIconURL
      ? `<img class="entry-favicon" src="${attr(item.feedIconURL)}" referrerpolicy="no-referrer" loading="lazy"/>`
      : `<span class="entry-favicon"></span>`;
    const badge = accountBadge(item);

    row.innerHTML = `
      <span class="entry-unread-dot" title="${attr(t(item.isRead ? '已读' : '未读'))}"></span>
      <div class="entry-body">
        <div class="entry-title"></div>
        ${showSummary ? '<div class="entry-summary"></div>' : ''}
        <div class="entry-meta">
          ${favicon}
          <span class="entry-source" title="${attr(item.sourceTitle || '')}"></span>
          ${badge ? `<span class="entry-account-badge"></span>` : ''}
          ${item.isLater ? `<span class="later-mini" title="${attr(t('稍后读'))}">${icon('clock')}</span>` : ''}
          ${item.isStarred ? `<span class="star-mini" title="${attr(t('已收藏'))}">${icon('starFilled')}</span>` : ''}
          <span class="read-min-slot">${readMinutesChip(item)}</span>
          ${this.laterAgeBadge(item)}
          <span class="entry-time" title="${attr(fullTime(item.publishedAt))}">${escapeHTML(formatTime(item.publishedAt))}</span>
        </div>
      </div>
    `;
    row.querySelector('.entry-title').textContent = cleanTitle;
    if (showSummary) row.querySelector('.entry-summary').textContent = cleanSummary;
    row.querySelector('.entry-source').textContent = item.sourceTitle;
    if (badge) row.querySelector('.entry-account-badge').textContent = badge;
    // CSP 禁内联脚本：favicon 加载失败兜底在这里挂监听（含缓存已失败的同步态）
    const fav = row.querySelector('img.entry-favicon');
    if (fav) {
      const hide = () => { fav.style.display = 'none'; };
      if (fav.complete && fav.naturalWidth === 0) hide();
      else fav.addEventListener('error', hide, { once: true });
    }

    row.addEventListener('click', (event) => {
      // R23 批量多选：Ctrl/Cmd+点击单选、Shift+点击选区间；普通点击照常打开
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        event.preventDefault();
        if (event.shiftKey) this._rangePick(item.id);
        else this._togglePick(item.id);
        return;
      }
      this.handlers.onSelect(item.id, item);
    });
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.handlers.onContext(event, item);
    });
    row.appendChild(this._quickActions(item));
    return row;
  }

  /**
   * 批量多选（R23）：Ctrl+点击单选 / Shift+点击区间选，选中行左侧色条标识，
   * 底部浮出批量操作条（标已读/收藏/稍后读/取消）。选中态是视图层状态，
   * 批量动作走批设 IPC（read:*Many），完成后清选并等 app:state 回流刷新。
   */
  _togglePick(entryID) {
    if (this.picked.has(entryID)) this.picked.delete(entryID);
    else this.picked.add(entryID);
    this.pickAnchor = this.items.findIndex((it) => it.id === entryID);
    this._syncPickUI();
  }

  _rangePick(entryID) {
    const to = this.items.findIndex((it) => it.id === entryID);
    if (to < 0) return;
    const from = this.pickAnchor >= 0 ? this.pickAnchor : 0;
    const [a, b] = from <= to ? [from, to] : [to, from];
    for (let i = a; i <= b; i += 1) this.picked.add(this.items[i].id);
    this._syncPickUI();
  }

  _syncPickUI() {
    const ids = new Set(this.picked);
    this.rowsHost.querySelectorAll('.entry-row').forEach((el) => {
      el.classList.toggle('nj-picked', ids.has(el.dataset.entryId));
    });
    let bar = document.querySelector('.list-batch-bar');
    if (!this.picked.size) {
      bar?.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'list-batch-bar';
      const count = document.createElement('span');
      count.className = 'list-batch-count';
      const mk = (cls, label, title, fn) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `list-batch-btn ${cls}`;
        b.title = title;
        b.textContent = label;
        b.addEventListener('click', (event) => {
          event.stopPropagation();
          const picked = [...this.picked];
          if (!picked.length) return;
          fn(picked);
          this._clearPick();
        });
        return b;
      };
      bar.appendChild(count);
      bar.appendChild(mk('b-read', t('标为已读'), t('把选中的文章标记为已读'), (ids2) => window.robin.markMany(ids2, true)));
      // 视野智能（R25）：收藏视野主推「取消收藏」、稍后读视野主推「移出稍后读」，其余视野为加入
      if (this.scope?.kind === 'starred') {
        bar.appendChild(mk('b-star', t('取消收藏'), t('把选中的文章移出收藏'), (ids2) => window.robin.starMany(ids2, false)));
      } else {
        bar.appendChild(mk('b-star', t('收藏'), t('把选中的文章加入收藏'), (ids2) => window.robin.starMany(ids2, true)));
      }
      if (this.scope?.kind === 'later') {
        bar.appendChild(mk('b-later', t('移出稍后读'), t('把选中的文章移出稍后读'), (ids2) => window.robin.laterMany(ids2, false)));
      } else {
        bar.appendChild(mk('b-later', t('稍后读'), t('把选中的文章加入稍后读'), (ids2) => window.robin.laterMany(ids2, true)));
      }
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'list-batch-btn b-cancel';
      cancel.title = t('取消选择（Esc）');
      cancel.textContent = t('取消选择');
      cancel.addEventListener('click', (event) => {
        event.stopPropagation();
        this._clearPick();
      });
      bar.appendChild(cancel);
      document.body.appendChild(bar);
    }
    bar.querySelector('.list-batch-count').textContent = tf('已选 %lld 篇', this.picked.size);
  }

  _clearPick() {
    this.picked.clear();
    this.pickAnchor = -1;
    this._syncPickUI();
  }

  /** 键盘光标（R28）：J/K 移动的行游标；explicit 时才滚动入视野（重渲染恢复不抢滚动位置）。 */
  _syncCursor(explicit = false) {
    this.rowsHost.querySelectorAll('.entry-row.nj-cursor').forEach((el) => el.classList.remove('nj-cursor'));
    if (!this.cursorID) return;
    const row = this.rowForEntry(this.cursorID);
    if (row) {
      row.classList.add('nj-cursor');
      if (explicit) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  /** 列表快捷键速查（R29）：? 往复开合，浮层随 Esc 一并收起。 */
  _toggleKeysPanel() {
    const existing = document.querySelector('.list-keys-panel');
    if (existing) {
      existing.remove();
      if (this._keysDismiss) document.removeEventListener('keydown', this._keysDismiss);
      return;
    }
    if (!this.items.length) return;
    const panel = document.createElement('div');
    panel.className = 'list-keys-panel';
    const rows = [
      ['J / K', t('移动光标')],
      ['Enter / O', t('打开光标处文章')],
      ['Ctrl + A', t('全选当前视野')],
      ['Ctrl + 点击', t('批量单选（再点反选）')],
      ['Shift + 点击', t('批量区间选择')],
      ['Esc', t('取消选择 / 关闭')],
    ];
    const grid = document.createElement('div');
    grid.className = 'list-keys-grid';
    for (const [k, d] of rows) {
      const row = document.createElement('div');
      row.className = 'list-keys-row';
      const kbd = document.createElement('kbd');
      kbd.textContent = k;
      const desc = document.createElement('span');
      desc.textContent = d;
      row.append(kbd, desc);
      grid.appendChild(row);
    }
    const head = document.createElement('div');
    head.className = 'list-keys-head';
    head.textContent = t('键盘快捷键');
    panel.append(head, grid);
    document.body.appendChild(panel);
    this._keysDismiss = (event) => {
      if (event.key === 'Escape') this._toggleKeysPanel();
    };
    document.addEventListener('keydown', this._keysDismiss, { once: true });
  }

  /**
   * 行内快捷操作（R22）：hover / 键盘聚焦浮现 已读·收藏·稍后读 三连。
   * 走与右键菜单相同的 IPC 通路（app:state 推送回流刷新），按钮拦截 click 免触发整行打开。
   */
  _quickActions(item) {
    const bar = document.createElement('div');
    bar.className = 'row-quick';
    const mk = (cls, icon_, title, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `row-quick-btn ${cls}`;
      b.title = title;
      b.innerHTML = icon(icon_);
      b.addEventListener('click', (event) => {
        event.stopPropagation();
        onClick();
      });
      return b;
    };
    bar.appendChild(mk('q-read', item.isRead ? 'envelopeOpen' : 'checkAll',
      t(item.isRead ? '标为未读' : '标为已读'), () => window.robin.markRead(item.id, !item.isRead)));
    bar.appendChild(mk('q-star', item.isStarred ? 'starFilled' : 'star',
      t(item.isStarred ? '取消收藏' : '收藏'), () => window.robin.toggleStar(item.id)));
    bar.appendChild(mk('q-later', 'clock',
      t(item.isLater ? '移出稍后读' : '稍后读'), () => window.robin.toggleLater(item.id, !item.isLater)));
    return bar;
  }

  clusterRow(cluster) {
    const row = document.createElement('div');
    row.className = 'cluster-row';
    row.innerHTML = `<span class="cluster-count"></span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>
      <span class="cluster-hint">${escapeHTML(t('同题报道 · 点击展开'))}</span>
      <span class="entry-time" title="${attr(fullTime(cluster.items[0].publishedAt))}">${escapeHTML(formatTime(cluster.items[0].publishedAt))}</span>`;
    row.querySelector('.cluster-count').textContent = t('%lld 篇').replace('%lld', String(cluster.items.length));
    row.querySelector('span:nth-child(2)').textContent = stripHtml(cluster.items[0].title);
    row.title = t('多源相似报道，点击展开');
    // AI 对比速读（方向 14 v1）：一键融合多源同题报道（弹窗与生成在 app 层，与今日简报同管线）
    if (cluster.items.length >= 2) {
      const briefBtn = document.createElement('button');
      briefBtn.className = 'cluster-brief-btn';
      briefBtn.title = t('AI 对比速读');
      briefBtn.innerHTML = `${icon('spark')}<span></span>`;
      briefBtn.querySelector('span').textContent = t('AI 速读');
      briefBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        this.handlers.onClusterBrief?.(cluster.items);
      });
      row.appendChild(briefBtn);
    }
    row.addEventListener('click', () => {
      const host = row.parentElement;
      const children = document.createElement('div');
      children.className = 'cluster-children';
      for (const item of cluster.items) children.appendChild(this.rowFor(item));
      host.insertBefore(children, row.nextSibling);
      row.remove();
    });
    return row;
  }

  appendRows(items) {
    const empty = this.rowsHost.querySelector('.list-empty');
    if (empty) empty.remove();
    for (const item of items) this._knownIds.add(item.id); // 翻页行并入已见识（R33：不再误标新到）
    if (this.viewMode === 'magazine') {
      const grid = this.rowsHost.querySelector('.nj-mag-grid');
      if (!grid) { this._renderMagazine(items, this.selectedID); return; }
      for (const item of items) grid.appendChild(this.magCard(item));
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const item of items) fragment.appendChild(this.rowFor(item));
    this.rowsHost.appendChild(fragment);
    this._observeReveal();
  }

  /** 沉浸杂志：封面卡片网格（借鉴上游 PaperRss v1.4.0 Magazine View，Web 版本）。 */
  _renderMagazine(items, selectedID) {
    // 每日刊头（方向 6）：报头 + 封面故事 + 本期目录，置于封面卡片网格之上
    if (items.length > 0) this.rowsHost.appendChild(this.editionMasthead(items));
    const grid = document.createElement('div');
    grid.className = 'nj-mag-grid';
    grid.tabIndex = 0;
    for (const item of items) grid.appendChild(this.magCard(item));
    // D15 标题译中：英文标题异步批量翻译，注入译文副行（仅杂志模式 + 开关开启）
    if (window.__robinListTitleZh && items.some((it) => /[A-Za-z]/.test(it.title || '') && !/[\u4e00-\u9fff]/.test(it.title || ''))) {
      window.robin.translateTitlesBulk(
        items.filter((it) => /[A-Za-z]/.test(it.title || '') && !/[\u4e00-\u9fff]/.test(it.title || '')).map((it) => ({ id: it.id, title: it.title }))
      ).then((res) => {
        const map = (res && res.translations) || {};
        grid.querySelectorAll('.mag-title').forEach((el) => {
          const zh = map[el.textContent.trim()];
          if (!zh) return;
          const sub = document.createElement('div');
          sub.className = 'nj-title-zh';
          sub.textContent = zh;
          el.parentElement.insertBefore(sub, el.nextSibling);
        });
      }).catch(() => {});
    }
    // 方向键就近移动：只在一侧没有卡片时才翻滚加载（与杂志遥控式导航一致）
    grid.addEventListener('keydown', (event) => {
      const dirs = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
      if (!dirs.includes(event.key)) {
        if ((event.key === 'Enter' || event.key === ' ') && event.target?.dataset?.entryId) {
          event.preventDefault();
          const item = this.items.find((it) => it.id === event.target.dataset.entryId);
          if (item) this.handlers.onSelect(item.id, item);
        }
        return;
      }
      event.preventDefault();
      const cards = Array.from(grid.querySelectorAll('.nj-mag-card'));
      const current = event.target.classList?.contains('nj-mag-card')
        ? event.target
        : (this.rowForEntry(this.selectedID) || cards[0]);
      const next = nearestMagCard(cards, current, event.key);
      if (next) {
        next.focus();
        next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        this.handlers.onLoadMore?.(); // 已到页面边缘：加载更多再移动
      }
    });
    this.rowsHost.appendChild(grid);
    this.markSelected(selectedID);
    this._observeReveal();
    this._mountResumeCard();
  }

  /**
   * 每日刊头（方向 6，调研报告 2026-09-26）：报头双细线 + 封面故事 + 本期目录。
   * - 「本期」= 当前列表视野（分类/搜索过滤后），刊期取最新一篇的日期
   * - 封面故事：前 12 篇里第一篇带封面图的（未读优先），全图退化纯文字版式
   * - 目录：封面故事外的前 10 篇，按来源分组为「栏目」，点行即读
   */
  editionMasthead(items) {
    const mast = document.createElement('header');
    mast.className = 'nj-edition';

    // 纸张质感四选（paper/white/book/kraft；夜间独立记忆见 paper-pref.js）
    const papers = [['paper', '纸感'], ['white', '素白'], ['book', '书卷'], ['kraft', '牛皮']];
    const paperNow = paperPref();
    this.rowsHost.closest('.list-scroll')?.classList.add(`nj-mag-${paperNow}`);
    const paperBtn = document.createElement('button');
    paperBtn.className = 'nj-edition-paper';
    paperBtn.title = t('切换纸张质感');
    paperBtn.textContent = (papers.find((x) => x[0] === paperNow) || papers[0])[1];
    paperBtn.addEventListener('click', () => {
      // 实时读偏好（闭包捕获旧值会导致循环打转、切不到第三态）
      const now = paperPref();
      const idx = papers.findIndex((x) => x[0] === now);
      const next = papers[(idx + 1) % papers.length][0];
      setPaperPref(next);
      const host = this.rowsHost.closest('.list-scroll');
      papers.forEach(([id]) => host && host.classList.remove(`nj-mag-${id}`));
      host?.classList.add(`nj-mag-${next}`);
      paperBtn.textContent = (papers.find((x) => x[0] === next) || papers[0])[1];
    });

    const newest = items.reduce((acc, it) => (!acc || (it.publishedAt || 0) > (acc.publishedAt || 0) ? it : acc), null);
    const mastLine = document.createElement('div');
    mastLine.className = 'nj-edition-mast';
    const brand = document.createElement('span');
    brand.className = 'nj-edition-brand';
    brand.textContent = t('知更 · 本期');
    const dateEl = document.createElement('span');
    dateEl.className = 'nj-edition-date';
    if (newest?.publishedAt) {
      const locale = (window.__robinLanguage || 'zh') === 'zh' ? 'zh-CN' : 'en-US';
      dateEl.textContent = new Date(newest.publishedAt * 1000)
        .toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    }
    // R36 双簇布局：刊名+日期 一簇（左）、翻页阅读+纸感 一簇（右）——簇内不折行，只在簇间换行
    const brandCluster = document.createElement('span');
    brandCluster.className = 'nj-edition-brand-cluster';
    brandCluster.append(brand, dateEl);
    mastLine.appendChild(brandCluster);
    const readBtn = document.createElement('button');
    readBtn.className = 'nj-edition-paper nj-edition-read';
    readBtn.title = t('翻页阅读本期文章');
    readBtn.textContent = '翻页阅读';
    readBtn.addEventListener('click', () => {
      const er = new EditionReader({
        items,
        startIndex: 0,
        onOpen: (item) => this.handlers.onSelect(item.id, item),
        onContext: (ev, item) => this.handlers.onContext(ev, item),
        onToggleStar: (id, starred) => window.robin.toggleStar(id).then(() => this.handlers.onStarred?.(id, starred)),
        onToggleLater: (id, later) => window.robin.toggleLater(id, later).then(() => this.handlers.onLater?.(id, later)),
        feedKey: [this.scope?.kind || 'all', this.scope?.id || this.scope?.name || ''].join(':'),
      });
      er.present();
    });
    const actionsCluster = document.createElement('span');
    actionsCluster.className = 'nj-edition-actions';
    actionsCluster.append(readBtn, paperBtn);
    mastLine.appendChild(actionsCluster);
  mast.appendChild(mastLine);

    const open = (item) => this.handlers.onSelect(item.id, item);
    const pool = items.slice(0, 12);
    const cover = pool.find((it) => !it.isRead && firstImageURL(it.contentHead))
      || pool.find((it) => firstImageURL(it.contentHead))
      || pool[0];
    mast.appendChild(this.editionCoverCard(cover));

    const tocItems = items.filter((it) => it !== cover).slice(0, 10);
    if (tocItems.length > 0) mast.appendChild(this.editionTOC(tocItems, items));
    return mast;
  }

  editionCoverCard(item) {
    const card = document.createElement('article');
    card.className = 'nj-edition-cover';
    card.dataset.entryId = item.id;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');

    const caption = document.createElement('div');
    caption.className = 'nj-edition-cover-caption';
    const kicker = document.createElement('span');
    kicker.className = 'nj-edition-kicker';
    kicker.textContent = `${t('封面故事')} · ${item.sourceTitle || ''}`;
    const h2 = document.createElement('h2');
    h2.textContent = stripHtml(item.title) || t('未命名文章');
    caption.append(kicker, h2);

    const imageURL = firstImageURL(item.contentHead);
    if (imageURL) {
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.fetchPriority = 'low';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => {
        img.remove();
        card.classList.add('no-image');
      }, { once: true });
      img.src = imageURL;
      card.appendChild(img);
    } else {
      card.classList.add('no-image');
    }
    if (!item.isRead) {
      const dot = document.createElement('span');
      dot.className = 'nj-edition-cover-dot';
      dot.title = t('未读');
      card.appendChild(dot);
    }
    card.appendChild(caption);
    card.addEventListener('click', () => open(item));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open(item);
      }
    });
    return card;
  }

  editionTOC(items, allItems) {
    const toc = document.createElement('div');
    toc.className = 'nj-edition-toc';
    const head = document.createElement('div');
    head.className = 'nj-edition-toc-head';
    const label = document.createElement('span');
    label.textContent = t('本期目录');
    const headRight = document.createElement('span');
    headRight.style.cssText = 'display:inline-flex;align-items:center;gap:10px;';
    const epubBtn = document.createElement('button');
    epubBtn.className = 'nj-edition-epub-btn';
    epubBtn.innerHTML = `${icon('bookOpen')}<span></span>`;
    epubBtn.querySelector('span').textContent = t('导出本期 EPUB');
    epubBtn.title = t('把当前列表（最多 40 篇）打包为一本带目录的 EPUB 电子书');
    // 整期导出按当前视野全量（含封面故事），而非仅目录可见的 10 条
    epubBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this.handlers.onExportEdition?.((allItems || items).map((it) => it.id));
    });
    const count = document.createElement('span');
    count.textContent = t('%lld 篇').replace('%lld', String(items.length)).replace('%d', String(items.length));
    headRight.append(epubBtn, count);
    head.append(label, headRight);
    toc.appendChild(head);

    // 按来源分组为「栏目」，保持首次出现顺序
    const sections = new Map();
    for (const item of items) {
      const key = item.sourceTitle || '';
      if (!sections.has(key)) sections.set(key, []);
      sections.get(key).push(item);
    }
    for (const [source, groupItems] of sections) {
      const section = document.createElement('div');
      section.className = 'nj-edition-section';
      if (source) {
        const name = document.createElement('div');
        name.className = 'nj-edition-section-name';
        name.textContent = source;
        section.appendChild(name);
      }
      for (const item of groupItems) {
        const row = document.createElement('div');
        row.className = `nj-edition-toc-row ${item.isRead ? 'read' : 'unread'}`;
        row.dataset.entryId = item.id;
        const title = document.createElement('span');
        title.className = 'toc-title';
        title.textContent = stripHtml(item.title) || t('未命名文章');
        const dots = document.createElement('span');
        dots.className = 'toc-dots';
        const meta = document.createElement('span');
        meta.className = 'toc-meta';
        meta.textContent = formatTime(item.publishedAt);
        row.append(title, dots, meta);
        row.addEventListener('click', () => this.handlers.onSelect(item.id, item));
        section.appendChild(row);
      }
      toc.appendChild(section);
    }
    return toc;
  }

  magCard(item) {
    const card = document.createElement('article');
    card.className = `entry-row nj-mag-card ${item.isRead ? 'read' : 'unread'} ${item.isStarred ? 'starred' : ''} ${item.isLater ? 'later' : ''} ${this._markNew && !this._knownIds.has(item.id) ? 'row-new' : ''}`;
    card.dataset.entryId = item.id;
    card.dataset.isLater = item.isLater ? '1' : '0';
    card.tabIndex = -1;

    const cover = document.createElement('div');
    cover.className = 'mag-cover';
    const imageURL = firstImageURL(item.contentHead);
    if (imageURL) {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.fetchPriority = 'low'; // 封面让位于正文与视口内容（R31）
      img.referrerPolicy = 'no-referrer';
      img.alt = '';
      img.addEventListener('load', () => img.classList.add('nj-cover-loaded'), { once: true });
      if (img.complete && img.naturalWidth > 0) img.classList.add('nj-cover-loaded'); // 缓存图：load 事件可能已错过
      img.addEventListener('error', () => {
        cover.classList.add('no-image');
        img.remove();
        cover.appendChild(Object.assign(document.createElement('span'), { className: 'mag-cover-fallback' }));
        cover.querySelector('.mag-cover-fallback').innerHTML = icon('newspaper');
      }, { once: true });
      img.src = imageURL;
      cover.appendChild(img);
    } else {
      cover.classList.add('no-image');
      const fallback = document.createElement('span');
      fallback.className = 'mag-cover-fallback';
      fallback.innerHTML = icon('newspaper');
      cover.appendChild(fallback);
    }

    const body = document.createElement('div');
    body.className = 'mag-body';
    body.innerHTML = `
      <span class="entry-unread-dot"></span>
      <h3 class="mag-title"></h3>
      <div class="mag-meta">
        <span class="mag-feed" title="${attr(item.sourceTitle || "")}"></span>
        ${item.isStarred ? `<span class="star-mini" title="${attr(t("已收藏"))}">${icon('starFilled')}</span>` : ''}
        ${item.isLater ? `<span class="later-mini" title="${attr(t('稍后读'))}">${icon('clock')}</span>` : ''}
        ${readMinutesChip(item)}
        <span class="entry-time">${escapeHTML(formatTime(item.publishedAt))}</span>
      </div>`;
    body.querySelector('.mag-title').textContent = stripHtml(item.title) || t('未命名文章');
    body.querySelector('.mag-feed').textContent = item.sourceTitle || '';

    card.appendChild(cover);
    card.appendChild(body);
    card.appendChild(this._quickActions(item));
    card.addEventListener('click', (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        event.preventDefault();
        if (event.shiftKey) this._rangePick(item.id);
        else this._togglePick(item.id);
        return;
      }
      this.handlers.onSelect(item.id, item);
    });
    card.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.handlers.onContext(event, item);
    });
    return card;
  }

  markSelected(entryID) {
    this.selectedID = entryID;
    this.rowsHost.querySelectorAll('.entry-row.selected').forEach((el) => el.classList.remove('selected'));
    if (entryID) {
      const row = this.rowForEntry(entryID);
      if (row) row.classList.add('selected');
      // R28：无活动光标时光标跟随打开的文章（J/K 已有光标则不打扰）
      if (!this.cursorID) this.cursorID = entryID;
    }
    // 重渲染后恢复光标环（selectedID 为空也要恢复 J/K 光标）
    this._syncCursor(false);
  }

  rowForEntry(entryID) {
    return this.rowsHost.querySelector(`.entry-row[data-entry-id="${cssEscape(entryID)}"]`);
  }

  scrollToEntry(entryID) {
    const row = this.rowForEntry(entryID);
    if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  scrollTop() {
    this.scrollEl.scrollTop = 0;
  }

  focusSearch() {
    this.searchInput?.focus();
    this.searchInput?.select();
  }

  /**
   * 搜索历史（R26）：最近 5 个搜索词，聚焦空框或 ↓ 呼出下拉，点选即搜；
   * Enter 提交时记忆（输入过程不记，避免存进半截词），可一键清空。
   */
  get searchHistory() {
    try { return JSON.parse(localStorage.getItem('robinread.searchHistory') || '[]'); } catch (_) { return []; }
  }

  _rememberSearch(term) {
    if (!term) return;
    const list = this.searchHistory.filter((x) => x !== term);
    list.unshift(term);
    try { localStorage.setItem('robinread.searchHistory', JSON.stringify(list.slice(0, 5))); } catch (_) { /* 隐私模式：放弃 */ }
  }

  _showSearchHistory() {
    this._hideSearchHistory();
    const items = this.searchHistory;
    if (!items.length) return;
    const drop = document.createElement('div');
    drop.className = 'search-history';
    drop.setAttribute('role', 'listbox'); // R43：读屏语义
    drop.setAttribute('aria-label', t('搜索历史'));
    // 挂 body 走 fixed（工具栏 overflow:hidden 会裁剪 inset 内的绝对定位浮层），滚动即收
    const hostRect = this.searchHost.getBoundingClientRect();
    drop.style.left = `${Math.round(hostRect.left)}px`;
    drop.style.top = `${Math.round(hostRect.bottom + 6)}px`;
    drop.style.minWidth = `${Math.max(200, Math.round(hostRect.width))}px`;
    for (const term of items) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'search-history-item';
      row.setAttribute('role', 'option'); // R43：读屏语义
      row.innerHTML = `${icon('search')}<span></span>`;
      row.querySelector('span').textContent = term;
      row.addEventListener('mousedown', (event) => { // mousedown 抢在 blur 收起前
        event.preventDefault();
        this.searchInput.value = term;
        this.searchHost.classList.add('has-value');
        this._rememberSearch(term);
        this._hideSearchHistory();
        this.handlers.onSearch?.(term);
      });
      drop.appendChild(row);
    }
    const clearRow = document.createElement('button');
    clearRow.type = 'button';
    clearRow.className = 'search-history-clear';
    clearRow.textContent = t('清除搜索历史');
    clearRow.addEventListener('mousedown', (event) => {
      event.preventDefault();
      try { localStorage.removeItem('robinread.searchHistory'); } catch (_) { /* 同上 */ }
      this._hideSearchHistory();
    });
    drop.appendChild(clearRow);
    document.body.appendChild(drop);
    this._histScrollEl = () => this._hideSearchHistory();
    this.scrollEl.addEventListener('scroll', this._histScrollEl, { once: true, passive: true });
  }

  _hideSearchHistory() {
    document.querySelector('.search-history')?.remove();
    if (this._histScrollEl) { this.scrollEl?.removeEventListener('scroll', this._histScrollEl); this._histScrollEl = null; }
  }

  /** 历史候选键盘高亮（R40）：↓/↑ 在候选项间循环移动，Enter 选中高亮项。 */
  _moveHistoryHighlight(dir) {
    const items = [...document.querySelectorAll('.search-history-item')];
    if (!items.length) return;
    const cur = items.findIndex((el) => el.classList.contains('hl'));
    const next = (cur + dir + items.length) % items.length;
    items.forEach((el, i) => {
      el.classList.toggle('hl', i === next);
      el.setAttribute('aria-selected', i === next ? 'true' : 'false'); // R43：读屏语义同步
    });
    items[next].scrollIntoView({ block: 'nearest' });
  }

  clearSearch() {
    if (this.searchInput) this.searchInput.value = '';
    this.searchHost?.classList.remove('has-value');
  }

  setDigestVisible(visible) {
    const btn = this.topInset?.querySelector('#digest-btn');
    if (btn) btn.style.display = visible ? '' : 'none';
  }

  /** 智能稍后读（方向 23）：稍后读视野且存在超龄项时显示「清理超龄」。 */
  /** 滚动渐显（前端美化）：进入视口的行淡入上移一次；尊重 prefers-reduced-motion。 */
  _observeReveal() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
    this._revealObserver?.disconnect();
    const targets = this.rowsHost?.querySelectorAll('.entry-row:not(.nj-revealed), .nj-mag-card:not(.nj-revealed), .nj-edition:not(.nj-revealed)');
    if (!targets?.length) return;
    this._revealObserver = new IntersectionObserver((entries, observer) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('nj-revealed');
          observer.unobserve(entry.target);
        }
      }
    }, { root: null, rootMargin: '0px 0px -6% 0px', threshold: 0.04 });
    targets.forEach((el) => {
      el.classList.add('nj-reveal-pending');
      this._revealObserver.observe(el);
    });
  }

  /** 继续阅读卡（知识增强）：「今天」视野顶部恢复上次未读完的文。 */
  setResume(candidate) {
    this.resumeCandidate = candidate;
    this._sigBust = true; // 继续读卡依赖此数据而签名不含它（R33）
  }

  _mountResumeCard() {
    this.rowsHost?.querySelector('.nj-resume-card')?.remove();
    const candidate = this.resumeCandidate;
    if (!candidate || this.scope?.kind !== 'today') return;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'nj-resume-card';
    card.innerHTML = `
      <span class="nj-resume-icon">${icon('bookOpen')}</span>
      <span class="nj-resume-main">
        <span class="nj-resume-label">${escapeHTML(t('继续阅读'))}</span>
        <span class="nj-resume-title"></span>
        <span class="nj-resume-meta">${escapeHTML(candidate.feed || '')}</span>
      </span>
      <span class="nj-resume-pct">${candidate.pct}%</span>`;
    card.querySelector('.nj-resume-title').textContent = candidate.title || t('未命名文章');
    card.addEventListener('click', () => this.handlers.onResumeOpen?.(candidate));
    this.rowsHost.insertBefore(card, this.rowsHost.firstChild);
  }

  setLaterAges(ageMap) {
    this.laterAges = ageMap || {};
    this._sigBust = true; // 行标依赖此数据而签名不含它（R33）
  }

  /** 稍后读行标：入队超 1 天显示「已存 N 天」，超 14 天记红。 */
  laterAgeBadge(item) {
    if (!item.isLater || this.scope?.kind !== 'later') return '';
    const ts = this.laterAges?.[item.id];
    if (!ts) return '';
    const days = Math.floor((Date.now() / 1000 - ts) / 86400);
    if (days < 1) return '';
    const overdue = days >= 14 ? ' overdue' : '';
    return `<span class="later-age${overdue}" title="${attr(t('加入稍后读至今'))}">${escapeHTML(tf('已存 %lld 天', days))}</span>`;
  }

  setLaterCleanup(overdueIDs) {
    this._overdueIDs = overdueIDs || [];
    const btn = this.topInset?.querySelector('#later-clean-btn');
    if (!btn) return;
    const show = this.scope?.kind === 'later' && this._overdueIDs.length > 0;
    btn.style.display = show ? '' : 'none';
    if (show) btn.innerHTML = `${icon('clock')}<span></span>`;
    if (show) btn.querySelector('span').textContent = `${t('清理超龄')} ${this._overdueIDs.length}`;
  }

  setSearchMode(active) {
    this.topInset?.classList.toggle('search-mode', active);
  }

  /** 状态变更：仅打补丁（读/星/稍后读），不重建（对应 patchEntryState）。 */
  updateItems(items, selectedID) {
    const byID = new Map(items.map((item) => [item.id, item]));
    for (const row of this.rowsHost.querySelectorAll('.entry-row')) {
      const next = byID.get(row.dataset.entryId);
      if (!next) continue;
      this._patchRowState(row, next);
    }
    if (selectedID) this.markSelected(selectedID);
  }

  /** 状态推送增量补丁：只更新变更的条目（{id,isRead,isStarred,isLater?}[]），不做任何重拉。 */
  patchEntries(changes, selectedID) {
    const byID = new Map(changes.map((item) => [item.id, item]));
    for (const row of this.rowsHost.querySelectorAll('.entry-row')) {
      const next = byID.get(row.dataset.entryId);
      if (!next) continue;
      this._patchRowState(row, next);
    }
    if (selectedID) this.markSelected(selectedID);
  }

  /** 单行读/星/稍后读状态补丁（updateItems 与 patchEntries 共用）。 */
  _patchRowState(row, next) {
    row.classList.toggle('read', next.isRead);
    row.classList.toggle('unread', !next.isRead);
    row.classList.toggle('starred', next.isStarred);
    const star = row.querySelector('.star-mini');
    if (next.isStarred && !star) {
      const meta = row.querySelector('.entry-meta');
      const el = document.createElement('span');
      el.className = 'star-mini';
      el.innerHTML = icon('starFilled');
      meta.insertBefore(el, meta.querySelector('.entry-time'));
    } else if (!next.isStarred && star) {
      star.remove();
    }
    // 稍后读标识：仅在本行数据实际携带 isLater 时校正（增量载荷可能不含该字段）
    if (next.isLater !== undefined) {
      row.classList.toggle('later', Boolean(next.isLater));
      row.dataset.isLater = next.isLater ? '1' : '0';
      const laterMini = row.querySelector('.later-mini');
      if (next.isLater && !laterMini) {
        const meta = row.querySelector('.entry-meta');
        const el = document.createElement('span');
        el.className = 'later-mini';
        el.title = t('稍后读');
        el.innerHTML = icon('clock');
        meta.insertBefore(el, meta.querySelector('.star-mini') || meta.querySelector('.entry-time'));
      } else if (!next.isLater && laterMini) {
        laterMini.remove();
      }
    }
  }

  _onScroll() {
    // 滚动接近底部 → 加载下一页（对应 onAppear loadNextPage）
    if (this._renderingPages) return; // 渐进渲染未完成：scrollHeight 在增长，不构成"到底"
    const el = this.scrollEl;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) {
      this.handlers.onLoadMore?.();
    }
  }
}

function trigrams(text) {
  const clean = String(text || '').replace(/\s+/g, '');
  const set = new Set();
  for (let i = 0; i < clean.length - 2; i += 1) set.add(clean.slice(i, i + 3));
  return set;
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const gram of a) if (b.has(gram)) hit += 1;
  return hit / (a.size + b.size - hit);
}
/** 相似报道聚类：同标题语义（3-gram Jaccard>0.55）折叠为一行。 */
/** 剥标签+解实体+折叠空白（R31）：摘要/标题统一净化，RSS 里混进的片段 HTML 不再当文本显示。 */
/** 完整日期时间（R39）：列表相对日期悬停显示全量时间。 */
function fullTime(ts) {
  if (!ts) return "";
  const locale = (window.__robinLanguage || "zh") === "zh" ? "zh-CN" : "en-US";
  try { return new Date(ts * 1000).toLocaleString(locale, { year: "numeric", month: "long", day: "numeric", weekday: "long", hour: "2-digit", minute: "2-digit" }); } catch (_) { return ""; }
}

function stripHtml(s) {
  return String(s ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    // 短锚文本整块丢弃（「阅读全文 / Read more」类导航样板不残留），长链接保留文字
    .replace(/<a\s[^>]*>\s*[^<]{0,10}?\s*<\/a>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#0?39;/g, "'").replace(/&hellip;/gi, '…')
    .replace(/\s+/g, ' ').trim();
}

function clusterSimilar(items) {
  const out = [];
  const grams = items.map((item) => trigrams(item.title));
  const used = new Array(items.length).fill(false);
  for (let i = 0; i < items.length; i += 1) {
    if (used[i]) continue;
    const group = [items[i]];
    used[i] = true;
    for (let j = i + 1; j < items.length; j += 1) {
      if (used[j]) continue;
      if (jaccard(grams[i], grams[j]) > 0.55) {
        group.push(items[j]);
        used[j] = true;
      }
    }
    if (group.length >= 2) out.push({ type: 'cluster', items: group });
    else out.push({ type: 'single', item: group[0] });
  }
  return out;
}

function shouldShowSummary(title, summary) {
  const normTitle = String(title ?? '').trim().replace(/\s+/g, ' ');
  const normSummary = String(summary ?? '').trim().replace(/\s+/g, ' ');
  if (!normSummary) return false;
  if (!normTitle) return true;
  if (normSummary === normTitle) return false;
  let strippedTitle = '';
  if (normTitle.endsWith('…')) strippedTitle = normTitle.slice(0, -1).trim();
  else if (normTitle.endsWith('...')) strippedTitle = normTitle.slice(0, -3).trim();
  if (strippedTitle && normSummary.startsWith(strippedTitle)) return false;
  return true;
}

function accountBadge(item) {
  if (item.accountType === 'local' || item.accountID === 'local-default') return '';
  if (item.accountDisplayName && item.accountDisplayName.length) return item.accountDisplayName;
  return t('FreshRSS');
}

/** 日期格式 1:1：今天→时间；今年→月日；更早→年月。 */
export function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const locale = (window.__robinLanguage || 'zh') === 'zh' ? 'zh-CN' : 'en-US';
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'short' });
}

/** 完整日期（阅读器头部：yyyy-MM-dd HH:mm）。 */
export function formatFullDate(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function cssEscape(value) {
  return (window.CSS && CSS.escape) ? CSS.escape(value) : String(value).replace(/"/g, '\\"');
}

function escapeHTML(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function attr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** 从 content_head（正文前 1600 字节）提取第一张封面图；仅接受 http(s) 绝对地址。 */
function firstImageURL(contentHead) {
  const match = /<img\b[^>]*?\bsrc\s*=\s*["']?([^"'\s>]+)/i.exec(String(contentHead || ''));
  if (!match) return '';
  const url = match[1].replace(/&amp;/g, '&');
  return /^https?:\/\//i.test(url) ? url : '';
}

/** 阅读时长小标（方向 12/23 体系）：无估算值时返回空串。 */
function readMinutesChip(item) {
  const minutes = Number(item.readMinutes) || 0;
  if (minutes <= 0) return '';
  const fast = minutes <= 2 ? ' fast' : '';
  return `<span class="read-min${fast}" title="${attr(t('预计阅读时长'))}">${icon('clock')}${Math.min(999, minutes)}</span>`;
}

/** 杂志网格遥控式就近移动：目标方向没有卡片时返回 null（由调用方翻页/加载更多）。 */
function nearestMagCard(cards, from, key) {
  if (!from || cards.length < 2) return null;
  const rect = from.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  const sign = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1;
  let best = null;
  let bestScore = Infinity;
  for (const card of cards) {
    if (card === from) continue;
    const r = card.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const primary = (horizontal ? (x - cx) : (y - cy)) * sign;
    if (primary <= 4) continue; // 只朝按键方向移动，不折返
    const cross = horizontal ? Math.abs(y - cy) : Math.abs(x - cx);
    const score = primary + cross * 2;
    if (score < bestScore) { bestScore = score; best = card; }
  }
  return best;
}
