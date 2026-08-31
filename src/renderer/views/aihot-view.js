'use strict';
/**
 * RobinRead Windows — AI 热点（AIHOT 聚合）· 大改版
 *
 * 板块：热点榜 / AI 日报 / 精选 / 收藏
 * 大功能：
 *  1. 跨板块搜索          7. 精选分类筛选
 *  2. 收藏（本地持久）     8. 导出 Markdown 到剪贴板
 *  3. 已读跟踪 + 只看未读  9. 一键复制链接
 *  4. 关注关键词 + 置顶   10. AI 深读（结构化中文解读）
 *  5. 热度条可视化        11. 故事关联跳转（storyline/related）
 *  6. 日报统计头部        12. 手动/自动刷新（10min 轮询）+ 更新时间
 * 13. 快捷键 j/k/Enter    14. 全新视觉：奖牌榜/骨架屏/计数徽标
 *
 * 交互原则：AIHot 已把内容总结成中文——一切点击先在应用内读中文，英文原文只作深挖入口。
 */
import { t, tf } from '../i18n.js';
import { icon } from '../icons.js';
import { renderMarkdown } from '../markdown.js';

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000);
  if (d > 0) return tf('%lld 天前', d);
  if (h > 0) return tf('%lld 小时前', h);
  if (m > 0) return tf('%lld 分钟前', m);
  return t('刚刚');
}
function esc(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const SECTIONS = [
  { id: 'hot', label: '热点榜', icon: 'flame' },
  { id: 'daily', label: 'AI 日报', icon: 'newspaper' },
  { id: 'selected', label: '精选', icon: 'spark' },
  { id: 'leaderboard', label: '模型榜', icon: 'ai' },
  { id: 'favorites', label: '收藏', icon: 'star' },
];

export class AihotView {
  constructor({ onOpenURL, onFeedback }) {
    this.handlers = { onOpenURL, onFeedback };
    this.section = 'hot';
    this.query = '';
    this.unreadOnly = false;
    this.category = 'all';
    this.focusedIndex = -1;
  }

  present() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) this.dismiss(); });
    this.modal = document.createElement('div');
    this.modal.className = 'modal aihot-modal';
    overlay.appendChild(this.modal);
    document.body.appendChild(overlay);
    this.overlay = overlay;
    this._esc = (e) => {
      if (e.key !== 'Escape') return;
      if (this._deepReading) { this._deepReading = false; this._renderContent(); return; }
      this.dismiss();
    };
    this._navKeys = (e) => this._handleNavKeys(e);
    document.addEventListener('keydown', this._esc);
    document.addEventListener('keydown', this._navKeys);
    this._render();
    Promise.all([window.robin.aihotSnapshot?.() || {}, this._load()]).catch(() => null);
    // 自动轮询：10 分钟静默刷新当前板块（不重建 DOM，只在数据变化时重渲染）
    this._pollTimer = setInterval(() => { this._load({ silent: true }); }, 10 * 60 * 1000);
  }

  dismiss() {
    document.removeEventListener('keydown', this._esc);
    document.removeEventListener('keydown', this._navKeys);
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = null;
    this.overlay?.remove();
    this.overlay = null;
  }

  /** 13. 快捷键：j/k 上下移动聚焦，Enter 打开聚焦卡片 */
  _handleNavKeys(e) {
    if (!this.overlay || this._inputFocused) return;
    const cards = [...this.contentHost?.querySelectorAll('.aihot-card') || []];
    if (!cards.length) return;
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      this.focusedIndex = Math.min(cards.length - 1, this.focusedIndex + 1);
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.focusedIndex = Math.max(0, this.focusedIndex - 1);
    } else if (e.key === 'Enter' && this.focusedIndex >= 0) {
      e.preventDefault();
      cards[this.focusedIndex]?.click();
      return;
    } else return;
    cards.forEach((c, i) => c.classList.toggle('kbd-focus', i === this.focusedIndex));
    cards[this.focusedIndex]?.scrollIntoView({ block: 'nearest' });
  }

  async _load({ silent = false } = {}) {
    this.local = this.local || {};
    const token = {}; // B14：请求令牌——只有最后一次 _load 的响应允许落地渲染
    this._loadToken = token;
    try {
      const snapPromise = window.robin.aihotSnapshot?.().catch(() => null);
      const loads = {
        hot: () => window.robin.aihotHotTopics(),
        daily: () => (this.dailyDate ? window.robin.aihotDailyByDate(this.dailyDate) : window.robin.aihotDaily()),
        selected: () => (this.query && this.query.length >= 2
          ? window.robin.aihotItems({ window: this.selectedWindow || '7d', q: this.query, limit: 50 })
          : window.robin.aihotItems({ window: this.selectedWindow || '7d', limit: 50 })),
        leaderboard: () => window.robin.aihotLeaderboard(),
        favorites: async () => (await snapPromise)?.favorites || [],
        story: () => window.robin.aihotStory(this._storyId),
      };
      const loader = loads[this.section];
      if (!loader) return;
      if (!silent) this._skeleton();
      const [data, snap] = await Promise.all([loader(), snapPromise]);
      if (this._loadToken !== token || !this.overlay) return; // 过期响应 / 弹层已关闭：整体丢弃
      this.data = data;
      if (snap) this.local = snap;
      this.error = null;
      this.loadedAt = Date.now();
    } catch (err) {
      if (this._loadToken !== token || !this.overlay) return;
      if (silent) return; // 静默轮询失败保留现有内容
      this.data = null;
      this.error = String(err?.message || err);
    }
    this._renderContent();
  }

  // MARK: 骨架

  _skeleton() {
    if (!this.contentHost) return;
    this.contentHost.innerHTML = '';
    for (let i = 0; i < 6; i += 1) {
      const s = document.createElement('div');
      s.className = 'aihot-skeleton';
      s.innerHTML = `<div class="aihot-skeleton-rank"></div><div class="aihot-skeleton-main"><div class="aihot-skeleton-line w70"></div><div class="aihot-skeleton-line w40"></div><div class="aihot-skeleton-line w90"></div></div>`;
      this.contentHost.appendChild(s);
    }
  }

  // MARK: 框架

  _render() {
    if (!this.modal) return;
    this.modal.innerHTML = '';
    const sidebar = document.createElement('div');
    sidebar.className = 'modal-sidebar';
    sidebar.innerHTML = `<h2>${esc(t('AI 热点'))}</h2>`;
    for (const s of SECTIONS) {
      const item = document.createElement('div');
      item.className = `modal-nav-item ${s.id === this.section ? 'active' : ''}`;
      // 徽标 span 在最后，label 必须用专属类名定位（last-child 会命中徽标本身）
      item.innerHTML = `<span class="nav-icon">${icon(s.icon)}</span><span class="nav-label"></span>${this._sectionBadge(s.id)}`;
      item.querySelector('.nav-label').textContent = t(s.label);
      item.addEventListener('click', () => {
        this.section = s.id;
        this._currentStory = null;
        this.query = '';
        this.category = 'all';
        this.dailyDate = null;
        this._selectedNextPage = null;
        this.focusedIndex = -1;
        this._render();
        this._load();
      });
      sidebar.appendChild(item);
    }
    // 关注关键词管理
    const kw = document.createElement('div');
    kw.className = 'aihot-kw-manage';
    kw.innerHTML = `<button class="btn-text bordered" style="width:100%">${icon('highlight')}<span style="margin-left:5px">${esc(t('关注关键词'))}</span></button>`;
    kw.querySelector('button').addEventListener('click', () => this._manageKeywords());
    sidebar.appendChild(kw);
    this.modal.appendChild(sidebar);

    const main = document.createElement('div');
    main.className = 'modal-main';
    const header = document.createElement('div');
    header.className = 'modal-header aihot-header';
    header.innerHTML = `<h3></h3><span class="aihot-source-tag">aihot.virxact.com</span>
      <button class="btn icon-only aihot-refresh" title="${esc(t('刷新'))}">${icon('refresh')}</button>
      <button class="btn icon-only" id="aihot-close">${icon('close')}</button>`;
    header.querySelector('h3').textContent = t(SECTIONS.find((s) => s.id === this.section)?.label || '');
    header.querySelector('.aihot-refresh').addEventListener('click', () => { this._cacheBust(); this._load(); });
    header.querySelector('#aihot-close').addEventListener('click', () => this.dismiss());
    main.appendChild(header);

    // 工具条：搜索 + 未读过滤 + 导出
    const toolbar = document.createElement('div');
    toolbar.className = 'aihot-toolbar';
    toolbar.innerHTML = `
      <div class="aihot-search">${icon('search')}<input placeholder="${esc(t('搜索热点 / 精选 / 日报…'))}"/></div>
      <button class="btn-text bordered aihot-unread" title="${esc(t('只看未读'))}">${icon('eye')}<span style="margin-left:4px">${esc(t('只看未读'))}</span></button>
      <button class="btn-text bordered aihot-export" title="${esc(t('导出为 Markdown'))}">${icon('export')}<span style="margin-left:4px">${esc(t('导出'))}</span></button>`;
    const searchInput = toolbar.querySelector('input');
    searchInput.value = this.query;
    searchInput.addEventListener('input', () => {
      this.query = searchInput.value.trim();
      // 精选页：防抖触发服务端搜索（q 参数）；其余板块走客户端过滤
      if (this.section === 'selected') {
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(() => this._load(), 350);
      } else {
        this._renderContent();
      }
    });
    searchInput.addEventListener('focus', () => { this._inputFocused = true; });
    searchInput.addEventListener('blur', () => { this._inputFocused = false; });
    const unreadBtn = toolbar.querySelector('.aihot-unread');
    unreadBtn.classList.toggle('active', this.unreadOnly);
    unreadBtn.addEventListener('click', () => { this.unreadOnly = !this.unreadOnly; unreadBtn.classList.toggle('active', this.unreadOnly); this._renderContent(); });
    toolbar.querySelector('.aihot-export').addEventListener('click', () => this._exportMarkdown());
    main.appendChild(toolbar);

    this.contentHost = document.createElement('div');
    this.contentHost.className = 'modal-scroll aihot-scroll';
    this.contentHost.innerHTML = `<div class="list-empty"><div class="glyph">${icon('spark')}</div><h3>${esc(t('加载中…'))}</h3></div>`;
    main.appendChild(this.contentHost);
    this.modal.appendChild(main);
  }

  _sectionBadge(sectionId) {
    const n = this._sectionUnread(sectionId);
    return n ? `<span class="aihot-badge">${n}</span>` : '';
  }

  _sectionUnread(sectionId) {
    // 注意：不要加「_flatHot 之类的前置缓存」条件——那些字段从未赋值，
    // 会导致徽标恒为 0。未读数基于 readIDs 与当前榜单缓存计算，
    // 已读键口径与 _markVisibleRead 一致（id || title）。
    if (!this.local?.readIDs) return 0;
    const read = new Set(this.local.readIDs);
    const count = (list) => (list || []).filter((x) => x && !read.has(x.id || x.title)).length;
    if (sectionId === 'hot') return count(this._hotCache || []);
    if (sectionId === 'selected') return count(this._selectedCache || []);
    return 0;
  }

  /** 轻量徽标刷新：数据加载/已读状态变化后只重绘各板块角标，不重建整个侧栏。 */
  _refreshBadges() {
    if (!this.modal) return;
    const items = this.modal.querySelectorAll('.modal-sidebar .modal-nav-item');
    SECTIONS.forEach((s, i) => {
      const item = items[i];
      if (!item) return;
      const old = item.querySelector('.aihot-badge');
      if (old) old.remove();
      item.insertAdjacentHTML('beforeend', this._sectionBadge(s.id));
    });
  }

  _cacheBust() {
    // 立即刷新：绕过服务端 5 分钟缓存（重新拉取）
    try { window.robin.aihotHotTopics(); } catch (_) { /* 预热 */ }
  }

  // MARK: 关键词（4）

  async _manageKeywords() {
    const current = (this.local?.keywords || []).join(', ');
    const { promptBox } = await import('../ui-prompt.js');
    const value = await promptBox(t('关注关键词'), {
      placeholder: t('逗号分隔，例如：OpenAI, 芯片, Rust'),
      initial: current,
    });
    if (value === null) return;
    this.local = (await window.robin.aihotSetKeywords(value))?.data || {};
    this.handlers.onFeedback?.(t('关注关键词已保存：') + (this.local.keywords.join('、') || t('无')));
    this._render();
    this._renderContent();
  }

  _keywords() { return this.local?.keywords || []; }

  _matchKeywords(text) {
    const v = String(text || '');
    return this._keywords().filter((k) => k && v.toLowerCase().includes(k.toLowerCase()));
  }

  // MARK: 过滤管线（1 搜索 + 3 未读 + 7 分类）

  _visibleItems(items, kind) {
    let list = items || [];
    if (this.unreadOnly) {
      const read = new Set(this.local?.readIDs || []);
      list = list.filter((it) => !read.has(it.id || it.title));
    }
    if (this.category !== 'all' && kind === 'selected') {
      list = list.filter((it) => (it.category || '') === this.category);
    }
    if (this.query) {
      const q = this.query.toLowerCase();
      list = list.filter((it) =>
        (it.title || '').toLowerCase().includes(q)
        || (it.summary || '').toLowerCase().includes(q)
        || (it.source || '').toLowerCase().includes(q));
    }
    return list;
  }

  // MARK: 内容分发

  _renderContent() {
    if (!this.contentHost) return;
    this._deepReading = false;
    this.contentHost.innerHTML = '';
    if (this.error) { this._empty('加载失败', this.error + '。请检查网络后重试。'); return; }
    if (this.section === 'hot') this._renderHot(this.data || []);
    else if (this.section === 'daily') this._renderDaily(this.data || {});
    else if (this.section === 'selected') this._renderSelected(this.data || []);
    else if (this.section === 'leaderboard') this._renderLeaderboard(this.data || []);
    else if (this.section === 'favorites') this._renderFavorites(this.data || []);
    else if (this.section === 'story') this._renderStory(this.data || {});
    this._markVisibleRead();
    this._refreshBadges();
  }

  /** 3. 已读跟踪：当前屏内容自动记为已读（下次进来可只看增量） */
  _markVisibleRead() {
    const ids = [];
    if (this.section === 'hot') (this.data || []).forEach((it) => ids.push(it.id || it.title));
    if (this.section === 'selected') (this.data || []).forEach((it) => ids.push(it.id || it.title));
    if (ids.length) window.robin.aihotMarkRead?.(ids).then((snap) => {
      this.local = snap?.data || this.local;
      this._refreshBadges(); // 记为已读后当前板块角标即时归零
    }).catch(() => null);
  }

  // MARK: 热点榜（5 热度条 + 奖牌 + 关键词置顶）

  _renderHot(items) {
    if (!items.length) { this._empty('暂无数据', '稍后再来看看。'); return; }
    this._hotCache = items;
    // B15：约定为数字的字段（rank/sourceCount）一律先数值化，远端返回字符串时退化为 0
    const counts = items.map((it) => Number(it.sourceCount) || 0);
    const maxSources = Math.max(1, ...counts);
    const hero = this._hero(items.length, counts.reduce((s, c) => s + c, 0));

    // 关注命中置顶（同样遵守 只看未读/搜索 过滤）
    const kwHits = this._visibleItems(items.filter((it) => this._matchKeywords(it.title).length), 'hot');
    if (kwHits.length) {
      const box = document.createElement('div');
      box.className = 'aihot-kw-box';
      box.innerHTML = `<div class="aihot-kw-label">${icon('highlight')} ${esc(t('关注命中'))}</div>`;
      for (const it of kwHits.slice(0, 3)) box.appendChild(this._hotCard(it, maxSources, true));
      this.contentHost.appendChild(box);
    }

    const visible = this._visibleItems(items, 'hot');
    const label = document.createElement('div');
    label.className = 'td-section-label';
    label.textContent = t('全网热度榜') + ` · ${visible.length}`;
    this.contentHost.appendChild(label);
    if (!visible.length) { this._empty('无匹配结果', '换个关键词试试。'); return; }
    for (const it of visible) this.contentHost.appendChild(this._hotCard(it, maxSources, false));
  }

  _hotCard(it, maxSources, pinned) {
    const read = new Set(this.local?.readIDs || []);
    const isRead = read.has(it.id || it.title);
    const kw = this._matchKeywords(it.title);
    const rank = Number(it.rank) || 0; // B15：数值化后再插值，杜绝字符串注入
    const sc = Number(it.sourceCount) || 0;
    const medal = rank > 0 && rank <= 3 ? `<div class="aihot-rank medal m${rank}">${rank}</div>` : `<div class="aihot-rank">${rank}</div>`;
    const heat = Math.round((sc / maxSources) * 100);
    const card = document.createElement('div');
    card.className = `aihot-card clickable${isRead ? ' is-read' : ''}${pinned ? ' is-pinned' : ''}`;
    card.innerHTML = `
      ${medal}
      <div class="aihot-main">
        <div class="aihot-title"></div>
        <div class="aihot-meta">
          <span class="aihot-heat" title="${esc(t('热度（报道源数）'))}"><i style="width:${Math.max(6, heat)}%"></i></span>
          <span class="aihot-source-count">${icon('flame')} ${sc} 源在报</span>
          ${it.latestAt ? `<span class="aihot-time">${esc(timeAgo(it.latestAt))}</span>` : ''}
          ${isRead ? `<span class="aihot-readtag">${esc(t('已读'))}</span>` : ''}
        </div>
        ${it.sourceNames?.length ? `<div class="aihot-sources">${it.sourceNames.slice(0, 5).map((s) => `<span class="fs-tag">${esc(s)}</span>`).join('')}</div>` : ''}
        ${kw.length ? `<div class="aihot-kw-hit">${esc(t('关注'))}：${kw.map(esc).join('、')}</div>` : ''}
      </div>
      <div class="aihot-card-actions">
        <button class="aihot-act aihot-fav" title="${esc(t('收藏'))}">${icon('star')}</button>
        <button class="aihot-act aihot-deep" title="${esc(t('AI 深读'))}">${icon('spark')}</button>
        ${it.originalURL ? `<button class="aihot-act aihot-copy" title="${esc(t('复制链接'))}">${icon('copy')}</button>` : ''}
      </div>`;
    card.querySelector('.aihot-title').textContent = it.title;
    const key = it.id || it.title;
    const favActive = (this.local?.favorites || []).some((f) => f.key === key);
    if (favActive) card.querySelector('.aihot-fav').classList.add('active');
    card.addEventListener('click', () => this._openReader({
      key,
      title: it.title,
      summary: '',
      meta: `${sc} 个来源正在报道此事`,
      sourceNames: it.sourceNames || [],
      originalURL: it.originalURL,
      storyURL: it.storyURL,
      context: it.sourceNames?.slice(0, 8).join('、') + ' 等多源报道：' + it.title,
    }));
    card.querySelector('.aihot-fav').addEventListener('click', async (e) => {
      e.stopPropagation();
      this.local = (await window.robin.aihotToggleFavorite({
        key, title: it.title, meta: `${sc} 源`, originalURL: it.originalURL, storyURL: it.storyURL,
      }))?.data || this.local;
      e.currentTarget.classList.toggle('active');
    });
    card.querySelector('.aihot-deep').addEventListener('click', (e) => { e.stopPropagation(); this._deepRead(it.title, it.sourceNames?.slice(0, 8).join('、') + '：' + it.title); });
    card.querySelector('.aihot-copy')?.addEventListener('click', (e) => { e.stopPropagation(); this._copy(it.originalURL); });
    return card;
  }

  // MARK: AI 日报（6 统计头部 + 归档期数切换）

  async _renderDaily(daily) {
    if (!daily || (!daily.sections?.length && !daily.flashes?.length)) {
      this._empty('暂无日报', 'AIHOT 每天生成一期 AI 日报，稍后再来。');
      return;
    }
    const itemCount = (daily.sections || []).reduce((s, sec) => s + (sec.items || []).length, 0);
    const head = document.createElement('div');
    head.className = 'aihot-daily-head2';
    head.innerHTML = `
      <div class="aihot-daily-title2">${esc(t('AI 日报'))}<span>${esc(daily.date || '')}${this.dailyDate ? ' · ' + esc(t('往期')) : ''}</span></div>
      <div class="aihot-daily-stats">
        <span>${icon('newspaper')} ${(daily.sections || []).length} ${esc(t('个板块'))}</span>
        <span>${icon('flame')} ${itemCount} ${esc(t('条要闻'))}</span>
        <span>${icon('clock')} ${daily.flashes?.length || 0} ${esc(t('条快讯'))}</span>
      </div>`;
    this.contentHost.appendChild(head);

    // 归档期数（近 14 期，可点击切换）
    if (window.robin.aihotDailyIndex) {
      try {
        const index = await window.robin.aihotDailyIndex(14) || [];
        if (index.length > 1) {
          const chips = document.createElement('div');
          chips.className = 'aihot-chips';
          for (const it of index) {
            const c = document.createElement('button');
            const active = this.dailyDate ? this.dailyDate === it.date : index[0].date === it.date;
            c.className = `aihot-chip${active ? ' active' : ''}`;
            c.textContent = it.date.slice(5); // MM-DD
            c.title = it.leadTitle || it.date;
            c.addEventListener('click', () => { this.dailyDate = it.date; this._load(); });
            chips.appendChild(c);
          }
          this.contentHost.appendChild(chips);
        }
      } catch (_) { /* 归档索引失败不影响当日内容 */ }
    }

    if (daily.lead?.paragraph) {
      const lead = document.createElement('div');
      lead.className = 'aihot-digest';
      lead.innerHTML = `<div class="aihot-digest-label">${icon('spark')} ${esc(t('今日导语'))}</div><div class="aihot-digest-text"></div>`;
      lead.querySelector('.aihot-digest-text').textContent = daily.lead.paragraph || daily.lead.title || '';
      this.contentHost.appendChild(lead);
    }
    if (daily.flashes?.length) {
      const lbl = document.createElement('div');
      lbl.className = 'td-section-label';
      lbl.style.marginTop = '14px';
      lbl.textContent = t('快讯');
      this.contentHost.appendChild(lbl);
      for (const f of this._visibleItems(daily.flashes.map((x, i) => ({ ...x, key: `flash-${i}` })), 'daily')) {
        const card = document.createElement('div');
        card.className = 'aihot-card flash clickable';
        card.innerHTML = `<div class="aihot-main"><div class="aihot-title"></div>${f.summary ? '<div class="aihot-summary"></div>' : ''}</div>`;
        card.querySelector('.aihot-title').textContent = f.title;
        if (f.summary) card.querySelector('.aihot-summary').textContent = f.summary;
        if (f.url) card.addEventListener('click', () => this.handlers.onOpenURL?.(f.url));
        this.contentHost.appendChild(card);
      }
    }
    for (const sec of this._visibleItems(daily.sections || [], 'daily-sections')) {
      const lbl = document.createElement('div');
      lbl.className = 'td-section-label';
      lbl.style.marginTop = '14px';
      lbl.textContent = `${sec.title || ''} · ${(sec.items || []).length}`;
      this.contentHost.appendChild(lbl);
      for (const it of this._visibleItems(sec.items || [], 'daily')) {
        const card = document.createElement('div');
        card.className = 'aihot-card clickable';
        card.innerHTML = `<div class="aihot-main"><div class="aihot-title"></div>${it.summary ? '<div class="aihot-summary"></div>' : ''}</div>
          <div class="aihot-card-actions">${it.url ? `<button class="aihot-act aihot-copy" title="${esc(t('复制链接'))}">${icon('copy')}</button>` : ''}</div>`;
        card.querySelector('.aihot-title').textContent = it.title;
        if (it.summary) card.querySelector('.aihot-summary').textContent = it.summary;
        if (it.url) card.addEventListener('click', () => this.handlers.onOpenURL?.(it.url));
        card.querySelector('.aihot-copy')?.addEventListener('click', (e) => { e.stopPropagation(); this._copy(it.url); });
        this.contentHost.appendChild(card);
      }
    }
  }

  // MARK: 精选（7 分类筛选 + 时间窗 + 服务端搜索 + 加载更多）

  _renderSelected(items) {
    if (!items.length) { this._empty('暂无数据', '稍后再来看看。'); return; }
    this._selectedCache = items;
    this.contentHost.appendChild(this._hero(items.length, null));
    // 时间窗筛选（服务端 window 参数）
    const windows = [['24h', '24 小时'], ['72h', '3 天'], ['7d', '7 天'], ['30d', '30 天']];
    const winChips = document.createElement('div');
    winChips.className = 'aihot-chips';
    for (const [id, label] of windows) {
      const c = document.createElement('button');
      c.className = `aihot-chip${(this.selectedWindow || '7d') === id ? ' active' : ''}`;
      c.textContent = t(label);
      c.addEventListener('click', () => { this.selectedWindow = id; this._selectedNextPage = null; this._load(); });
      winChips.appendChild(c);
    }
    this.contentHost.appendChild(winChips);
    // 分类筛选（客户端）
    const cats = [...new Set(items.map((it) => it.category).filter(Boolean))];
    if (cats.length > 1) {
      const chips = document.createElement('div');
      chips.className = 'aihot-chips';
      const mk = (id, label) => {
        const c = document.createElement('button');
        c.className = `aihot-chip${this.category === id ? ' active' : ''}`;
        c.textContent = label;
        c.addEventListener('click', () => { this.category = id; this._renderContent(); });
        return c;
      };
      chips.appendChild(mk('all', t('全部')));
      for (const cat of cats) chips.appendChild(mk(cat, cat));
      this.contentHost.appendChild(chips);
    }
    const searching = this.query && this.query.length >= 2;
    const visible = searching ? items : this._visibleItems(items, 'selected');
    if (!visible.length) { this._empty('无匹配结果', '换个筛选条件试试。'); return; }
    for (const it of visible) this.contentHost.appendChild(this._selectedCard(it));
    // 加载更多（归档分页；服务端搜索时不分页）
    if (!searching) {
      const more = document.createElement('button');
      more.className = 'btn-text bordered aihot-loadmore';
      more.style.cssText = 'margin: 4px auto 14px; display: block;';
      more.textContent = t('加载更多（全量归档）');
      more.addEventListener('click', () => this._loadMoreSelected());
      this.contentHost.appendChild(more);
    }
  }

  async _loadMoreSelected() {
    const token = this._loadToken; // B14：沿用当前板块令牌——切板块后旧分页响应作废，不得 push 进新板块数据
    try {
      const page = await window.robin.aihotSelectedPage({ limit: 50, page: this._selectedNextPage || null });
      if (this._loadToken !== token || !this.overlay) return;
      const more = page?.items || [];
      // 第一次点「加载更多」也走合并：归档流数据（快照比 items 窗口更全）追加在当前列表之后
      this.data = [...(this.data || []), ...more];
      this._selectedNextPage = page?.hasMore ? page.nextPage : null;
      if (!more.length) this.handlers.onFeedback?.(t('没有更多了'));
      this._renderContent();
    } catch (err) {
      if (this._loadToken !== token) return;
      this.handlers.onFeedback?.(t('加载更多失败：') + (err?.message || err));
    }
  }

  _selectedCard(it) {
    const read = new Set(this.local?.readIDs || []);
    const key = it.id || it.title;
    const score = it.score == null ? null : (Number(it.score) || 0); // B15：数值化后再插值
    const card = document.createElement('div');
    card.className = `aihot-card clickable${read.has(key) ? ' is-read' : ''}`;
    card.innerHTML = `
      <div class="aihot-main">
        <div class="aihot-title"></div>
        ${it.summary ? '<div class="aihot-summary"></div>' : ''}
        <div class="aihot-meta">
          ${it.source ? `<span class="aihot-source">${esc(it.source)}</span>` : ''}
          ${it.category ? `<span class="fs-tag">${esc(it.category)}</span>` : ''}
          ${score != null ? `<span class="aihot-score">信噪 ${score}</span>` : ''}
          ${it.publishedAt ? `<span class="aihot-time">${esc(timeAgo(it.publishedAt))}</span>` : ''}
        </div>
      </div>
      <div class="aihot-card-actions">
        <button class="aihot-act aihot-fav" title="${esc(t('收藏'))}">${icon('star')}</button>
        <button class="aihot-act aihot-deep" title="${esc(t('AI 深读'))}">${icon('spark')}</button>
        ${it.originalURL ? `<button class="aihot-act aihot-copy" title="${esc(t('复制链接'))}">${icon('copy')}</button>` : ''}
      </div>`;
    card.querySelector('.aihot-title').textContent = it.title;
    if (it.summary) card.querySelector('.aihot-summary').textContent = it.summary;
    if ((this.local?.favorites || []).some((f) => f.key === key)) card.querySelector('.aihot-fav').classList.add('active');
    card.addEventListener('click', () => this._openReader({
      key,
      title: it.title,
      summary: it.summary,
      reason: it.reason,
      meta: it.source,
      originalURL: it.originalURL,
      context: `${it.source}：${it.title}\n${it.summary || ''}${it.reason ? '\n入选理由：' + it.reason : ''}`,
    }));
    card.querySelector('.aihot-fav').addEventListener('click', async (e) => {
      e.stopPropagation();
      const r = await window.robin.aihotToggleFavorite({ key, title: it.title, summary: it.summary, meta: it.source, originalURL: it.originalURL });
      this.local = r?.data || this.local;
      e.currentTarget.classList.toggle('active');
    });
    card.querySelector('.aihot-deep').addEventListener('click', (e) => { e.stopPropagation(); this._deepRead(it.title, `${it.source}：${it.title}\n${it.summary || ''}`); });
    card.querySelector('.aihot-copy')?.addEventListener('click', (e) => { e.stopPropagation(); this._copy(it.originalURL); });
    return card;
  }

  // MARK: 收藏（2）

  _renderFavorites(items) {
    if (!items.length) { this._empty('还没有收藏', '在热点榜 / 精选卡片上点 ⭐ 收藏，会保存在本机。'); return; }
    const lbl = document.createElement('div');
    lbl.className = 'td-section-label';
    lbl.textContent = t('我的收藏') + ` · ${items.length}`;
    this.contentHost.appendChild(lbl);
    for (const it of items) {
      const card = document.createElement('div');
      card.className = 'aihot-card clickable saved';
      card.innerHTML = `
        <div class="aihot-main">
          <div class="aihot-title"></div>
          ${it.summary ? '<div class="aihot-summary"></div>' : ''}
          <div class="aihot-meta">${it.meta ? `<span class="aihot-source">${esc(it.meta)}</span>` : ''}<span class="aihot-time">${esc(timeAgo(it.savedAt))}</span></div>
        </div>
        <div class="aihot-card-actions">
          <button class="aihot-act aihot-unfav active" title="${esc(t('取消收藏'))}">${icon('star')}</button>
          ${it.originalURL ? `<button class="aihot-act aihot-copy" title="${esc(t('复制链接'))}">${icon('copy')}</button>` : ''}
        </div>`;
      card.querySelector('.aihot-title').textContent = it.title;
      if (it.summary) card.querySelector('.aihot-summary').textContent = it.summary;
      card.addEventListener('click', () => this._openReader({
        key: it.key,
        title: it.title,
        summary: it.summary || '',
        meta: it.meta || '',
        originalURL: it.originalURL,
        storyURL: it.storyURL,
        context: it.title,
      }));
      card.querySelector('.aihot-unfav').addEventListener('click', async (e) => {
        e.stopPropagation();
        const r = await window.robin.aihotToggleFavorite(it);
        this.data = r?.data?.favorites || [];
        this.local.favorites = this.data;
        this._renderContent();
      });
      card.querySelector('.aihot-copy')?.addEventListener('click', (e) => { e.stopPropagation(); this._copy(it.originalURL); });
      this.contentHost.appendChild(card);
    }
  }

  // MARK: 统计条

  _hero(topics, sources) {
    const nTopics = Number(topics) || 0; // B15：统计值数值化后再插值
    const nSources = sources == null ? null : (Number(sources) || 0);
    const hero = document.createElement('div');
    hero.className = 'aihot-hero';
    const parts = [`<span>${icon('flame')} <b>${nTopics}</b> ${esc(t('条内容'))}</span>`];
    if (nSources != null) parts.push(`<span>${icon('globe')} <b>${nSources}</b> ${esc(t('报道源'))}</span>`);
    if (this.loadedAt) parts.push(`<span>${icon('clock')} ${esc(t('更新于'))} ${esc(timeAgo(this.loadedAt))}</span>`);
    hero.innerHTML = parts.join('');
    return hero;
  }

  // MARK: AI 深读（10）

  async _deepRead(title, context) {
    if (window.__robinLLM?.__hasKey === false) {
      this.handlers.onFeedback?.(t('AI 深读需要先配置 API Key（设置 → AI）。'));
      return;
    }
    this._deepReading = true;
    this.contentHost.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'aihot-deep';
    wrap.innerHTML = `
      <button class="btn-text bordered aihot-back2">${icon('chevronMenuRight')}<span style="margin-left:4px">${esc(t('返回'))}</span></button>
      <div class="aihot-deep-title"></div>
      <div class="aihot-deep-body loading"><span class="robin-spinner"></span> ${esc(t('AI 正在生成深度解读…'))}</div>`;
    wrap.querySelector('.aihot-deep-title').textContent = title;
    wrap.querySelector('.aihot-back2').addEventListener('click', () => { this._deepReading = false; this._renderContent(); });
    this.contentHost.appendChild(wrap);
    const body = wrap.querySelector('.aihot-deep-body');
    try {
      const result = await window.robin.aihotDeepRead({ title, context });
      if (!this._deepReading) return;
      body.className = 'aihot-deep-body rendered';
      body.innerHTML = renderMarkdown(result.data || result);
    } catch (err) {
      if (!this._deepReading) return;
      body.className = 'aihot-deep-body error';
      body.textContent = `${t('AI 深读失败')}：${err?.message || err}`;
    }
  }

  // MARK: 模型榜（排行榜页解析：排名/厂商/评分/价格/上线日）

  _renderLeaderboard(models) {
    if (!models.length) { this._empty('暂无榜单', 'AIHOT 模型排行榜暂时无法获取。'); return; }
    const maxScore = Math.max(1, ...models.map((m) => Number(m.score) || 0));
    const lbl = document.createElement('div');
    lbl.className = 'td-section-label';
    lbl.textContent = t('AIHOT 模型综合榜') + ` · ${models.length}`;
    this.contentHost.appendChild(lbl);
    const hint = document.createElement('div');
    hint.className = 'aihot-hint';
    hint.textContent = t('点击卡片查看完整评测页（浏览器打开）；价格为一百万 token 的输入/输出价。');
    this.contentHost.appendChild(hint);
    for (const m of models) {
      const rank = Number(m.rank) || 0; // B15：数值化后再插值，杜绝字符串注入
      const score = Number(m.score) || 0;
      const heat = Math.round((score / maxScore) * 100);
      const medal = rank > 0 && rank <= 3 ? `medal m${rank}` : '';
      const card = document.createElement('div');
      card.className = 'aihot-card clickable aihot-lb-card';
      card.innerHTML = `
        <div class="aihot-rank ${medal}">${String(rank).padStart(2, '0')}</div>
        <div class="aihot-main">
          <div class="aihot-lb-head">
            ${m.logoURL ? `<img class="aihot-lb-logo" src="${esc(m.logoURL)}" alt="" referrerpolicy="no-referrer"/>` : ''}
            <span class="aihot-title"></span>
            <span class="aihot-lb-vendor"></span>
          </div>
          <div class="aihot-meta">
            <span class="aihot-heat" title="${esc(t('综合评分'))}"><i style="width:${Math.max(6, heat)}%"></i></span>
            <span class="aihot-lb-score"><b></b> ${esc(t('分'))}</span>
            ${m.releaseDate ? `<span class="aihot-time">${esc(t('上线'))} ${esc(m.releaseDate)}</span>` : ''}
            ${m.completeness ? `<span class="aihot-lb-comp">${esc(t('评测完整度'))} ${esc(m.completeness)}%</span>` : ''}
          </div>
          ${(m.inputPrice || m.outputPrice) ? `<div class="aihot-lb-prices">${m.inputPrice ? `<span>${esc(t('输入'))} <b>${esc(m.inputPrice)}</b></span>` : ''}${m.outputPrice ? `<span>${esc(t('输出'))} <b>${esc(m.outputPrice)}</b></span>` : ''}<span class="aihot-lb-unit">/1M tokens</span></div>` : ''}
        </div>`;
      card.querySelector('.aihot-title').textContent = m.name;
      card.querySelector('.aihot-lb-vendor').textContent = m.vendor || '';
      card.querySelector('.aihot-lb-score b').textContent = score ? String(score) : '—';
      card.addEventListener('click', () => this.handlers.onOpenURL?.(m.detailURL));
      this.contentHost.appendChild(card);
    }
  }

  // MARK: 原文应用内精读（AIHot 卡片 → 抓取原文 + 重排渲染）

  async _readOriginal(originalURL, title) {
    if (!originalURL) return;
    this._deepReading = true;
    this.contentHost.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'aihot-deep';
    wrap.innerHTML = `
      <button class="btn-text bordered aihot-back2">${icon('chevronMenuRight')}<span style="margin-left:4px">${esc(t('返回'))}</span></button>
      <div class="aihot-deep-title"></div>
      <div class="aihot-original-loading"><span class="robin-spinner"></span> ${esc(t('正在抓取原文并重新排版…'))}</div>
      <div class="aihot-original-body"></div>`;
    wrap.querySelector('.aihot-deep-title').textContent = title || originalURL;
    wrap.querySelector('.aihot-back2').addEventListener('click', () => { this._deepReading = false; this._renderContent(); });
    this.contentHost.appendChild(wrap);
    const body = wrap.querySelector('.aihot-original-body');
    const loadingEl = wrap.querySelector('.aihot-original-loading');
    try {
      const result = await window.robin.aihotExtractURL(originalURL);
      loadingEl.remove();
      body.innerHTML = result?.html || `<p>${esc(t('原文提取失败（站点限制或需要登录）。'))}</p>`;
      // 原文重排（复用阅读器的结构规整思路：标题/列表/图片/垃圾尾）
      this._restructureOriginal(body);
    } catch (err) {
      loadingEl.remove();
      body.innerHTML = `<p class="aihot-original-error">${esc(t('原文抓取失败'))}：${esc(String(err?.message || err))}</p>`;
    }
  }

  /** 原文面板轻量重排：图片规整 + 垃圾尾清理（提取器已做主体净化）。 */
  _restructureOriginal(body) {
    body.querySelectorAll('a').forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (href === '#' || href === '' || /^javascript:/i.test(href)) a.replaceWith(...a.childNodes);
    });
    const junkRe = /^(相关文章|相关阅读|延伸阅读|related posts?|share this|subscribe|newsletter|分享到|订阅|read more)\s*$/i;
    const children = [...body.children];
    let cutting = false;
    for (const el of children) {
      const ownText = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('').trim();
      if (!cutting && junkRe.test(ownText) && children.indexOf(el) >= Math.floor(children.length * 0.6)) cutting = true;
      if (cutting) el.remove();
    }
    body.querySelectorAll('img').forEach((img) => { img.referrerPolicy = 'no-referrer'; img.loading = 'lazy'; });
  }

  // MARK: 应用内阅读 + 故事关联（11）

  _openReader({ key, title, summary = '', reason = '', meta = '', sourceNames = [], originalURL = null, storyURL = null, context = '' }) {
    this.contentHost.innerHTML = '';
    const back = document.createElement('button');
    back.className = 'btn-text bordered';
    back.style.marginBottom = '12px';
    back.innerHTML = `${icon('chevronMenuRight')}<span style="margin-left:4px">${esc(t('返回'))}</span>`;
    back.addEventListener('click', () => { this._render(); this._load({ silent: true }); });
    this.contentHost.appendChild(back);

    const view = document.createElement('div');
    view.className = 'aihot-reader';
    const metaParts = [meta, sourceNames.length ? `${sourceNames.length} 个来源` : ''].filter(Boolean);
    view.innerHTML = `
      <div class="aihot-reader-title"></div>
      ${metaParts.length ? `<div class="aihot-meta">${metaParts.map((m) => `<span>${esc(m)}</span>`).join('')}</div>` : ''}
      ${summary ? `<div class="aihot-digest"><div class="aihot-digest-label">${icon('spark')} ${esc(t('AI 中文摘要'))}</div><div class="aihot-digest-text"></div></div>` : ''}
      ${reason ? `<div class="aihot-reason">${icon('spark')}<span></span></div>` : ''}
      ${sourceNames.length ? `<div class="aihot-sources">${sourceNames.map((s) => `<span class="fs-tag">${esc(s)}</span>`).join('')}</div>` : ''}
      <div class="aihot-reader-actions">
        <button class="btn-text primary aihot-act-deep2">${icon('spark')}<span style="margin-left:5px">${esc(t('AI 深度解读'))}</span></button>
        ${storyURL ? `<button class="btn-text bordered aihot-act-story">${icon('refresh')}<span style="margin-left:5px">${esc(t('查看事件时间线'))}</span></button>` : ''}
        ${originalURL ? `<button class="btn-text bordered aihot-act-original">${icon('globe')}<span style="margin-left:5px">${esc(t('英文原文（浏览器打开）'))}</span></button>` : ''}
        ${originalURL ? `<button class="btn-text bordered aihot-act-copy2">${icon('copy')}<span style="margin-left:5px">${esc(t('复制链接'))}</span></button>` : ''}
      </div>`;
    view.querySelector('.aihot-reader-title').textContent = title;
    if (summary) view.querySelector('.aihot-digest-text').textContent = summary;
    if (reason) view.querySelector('.aihot-reason span').textContent = t('为什么值得读：') + reason;
    view.querySelector('.aihot-act-deep2').addEventListener('click', () => this._deepRead(title, context || (summary || title)));
    view.querySelector('.aihot-act-story')?.addEventListener('click', () => this._openStory(storyURL));
    view.querySelector('.aihot-act-original')?.addEventListener('click', () => this.handlers.onOpenURL?.(originalURL));
    view.querySelector('.aihot-act-copy2')?.addEventListener('click', () => this._copy(originalURL));
    this.contentHost.appendChild(view);
  }

  async _openStory(storyURL) {
    const publicId = String(storyURL || '').split('/').filter(Boolean).pop();
    if (!publicId) return;
    const token = {}; // B14：故事加载与 _load 共用令牌语义——切板块后旧故事响应作废
    this._loadToken = token;
    this.section = 'story';
    this._storyId = publicId;
    this._render();
    this.contentHost.innerHTML = `<div class="list-empty"><div class="glyph">${icon('spark')}</div><h3>${esc(t('加载故事…'))}</h3></div>`;
    try {
      const data = await window.robin.aihotStory(publicId);
      if (this._loadToken !== token || !this.overlay) return;
      this.data = data;
      this.error = null;
    } catch (err) {
      if (this._loadToken !== token || !this.overlay) return;
      this.error = String(err?.message || err);
      this.data = null;
    }
    this._renderContent();
  }

  _renderStory(story) {
    const srcCount = Number(story.sourceCount) || 0; // B15：数值化后再插值
    const repCount = Number(story.reportCount) || 0;
    const head = document.createElement('div');
    head.className = 'aihot-story-head';
    head.innerHTML = `
      <button class="btn-text bordered aihot-back">${icon('chevronMenuRight')}<span style="margin-left:4px">${esc(t('返回热点榜'))}</span></button>
      <div class="aihot-story-title"></div>
      <div class="aihot-meta"><span>${srcCount} 源 · ${repCount} 报道</span>${story.latestAt ? `<span>${esc(timeAgo(story.latestAt))}</span>` : ''}</div>`;
    head.querySelector('.aihot-back').addEventListener('click', () => { this.section = 'hot'; this._currentStory = null; this._render(); this._load(); });
    head.querySelector('.aihot-story-title').textContent = story.title;
    this.contentHost.appendChild(head);

    if (story.digest) {
      const digest = document.createElement('div');
      digest.className = 'aihot-digest';
      digest.innerHTML = `<div class="aihot-digest-label">${icon('spark')} AI 事件综述</div><div class="aihot-digest-text"></div>`;
      digest.querySelector('.aihot-digest-text').textContent = story.digest;
      this.contentHost.appendChild(digest);
    }

    // 11. 关联事件跳转（storyline / related）
    const relations = [...(story.storyline || []), ...(story.related || [])].filter((n) => n?.publicId && n.publicId !== story.publicId);
    if (relations.length) {
      const lbl = document.createElement('div');
      lbl.className = 'td-section-label';
      lbl.style.marginTop = '14px';
      lbl.textContent = t('关联事件');
      this.contentHost.appendChild(lbl);
      const chips = document.createElement('div');
      chips.className = 'aihot-chips wrap';
      for (const n of relations.slice(0, 12)) {
        const c = document.createElement('button');
        c.className = 'aihot-chip relation';
        c.textContent = (n.relation ? `[${n.relation}] ` : '') + n.title;
        c.addEventListener('click', () => this._openStory(n.publicId));
        chips.appendChild(c);
      }
      this.contentHost.appendChild(chips);
    }

    if (story.reports?.length) {
      const lbl = document.createElement('div');
      lbl.className = 'td-section-label';
      lbl.style.marginTop = '14px';
      lbl.textContent = t('报道时间线') + ` · ${story.reports.length}`;
      this.contentHost.appendChild(lbl);
      for (const r of story.reports) {
        const card = document.createElement('div');
        card.className = 'aihot-card clickable';
        card.innerHTML = `
          <div class="aihot-main">
            <div class="aihot-title"></div>
            ${r.summary ? '<div class="aihot-summary"></div>' : ''}
            <div class="aihot-meta">${r.source ? `<span class="aihot-source">${esc(r.source)}</span>` : ''}${r.publishedAt ? `<span class="aihot-time">${esc(timeAgo(r.publishedAt))}</span>` : ''}</div>
          </div>
          ${r.links?.original ? `<div class="aihot-card-actions"><button class="aihot-act aihot-copy" title="${esc(t('复制链接'))}">${icon('copy')}</button></div>` : ''}`;
        card.querySelector('.aihot-title').textContent = r.title;
        if (r.summary) card.querySelector('.aihot-summary').textContent = r.summary;
        if (r.links?.original) {
          card.addEventListener('click', () => this.handlers.onOpenURL?.(r.links.original));
          card.querySelector('.aihot-copy').addEventListener('click', (e) => { e.stopPropagation(); this._copy(r.links.original); });
        }
        this.contentHost.appendChild(card);
      }
    }
  }

  // MARK: 导出 / 复制（8 / 9）

  /** 写剪贴板：优先页面 API，失败（窗口失焦/隐藏）时走主进程 Electron clipboard 兜底。 */
  async _writeClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      try { await window.robin.copyText(text); return true; } catch (_) { return false; }
    }
  }

  _exportMarkdown() {
    const lines = [`# AI 热点 · ${SECTIONS.find((s) => s.id === this.section)?.label || ''}`, `> ${new Date().toLocaleString()}`, ''];
    if (this.section === 'hot') {
      for (const it of this._visibleItems(this.data || [], 'hot')) {
        lines.push(`${it.rank}. **${it.title}**（${it.sourceCount} 源${it.latestAt ? ' · ' + timeAgo(it.latestAt) : ''}）`);
        if (it.originalURL) lines.push(`   ${it.originalURL}`);
      }
    } else if (this.section === 'selected') {
      for (const it of this._visibleItems(this.data || [], 'selected')) {
        lines.push(`- **${it.title}**${it.source ? `（${it.source}）` : ''}`);
        if (it.summary) lines.push(`  ${it.summary}`);
      }
    } else if (this.section === 'favorites') {
      for (const it of this.data || []) lines.push(`- **${it.title}**${it.meta ? `（${it.meta}）` : ''}`);
    } else if (this.section === 'daily') {
      const d = this.data || {};
      if (d.lead?.paragraph) lines.push(`> ${d.lead.paragraph}`, '');
      for (const sec of d.sections || []) {
        lines.push(`## ${sec.title || ''}`);
        for (const it of sec.items || []) lines.push(`- **${it.title}**${it.summary ? '：' + it.summary : ''}`);
        lines.push('');
      }
    } else { this.handlers.onFeedback?.(t('当前板块不支持导出')); return; }
    const text = lines.join('\n');
    this._writeClipboard(text).then(
      (ok) => this.handlers.onFeedback?.(ok ? t('已复制 Markdown 到剪贴板（') + text.length + t(' 字）') : t('复制失败')),
      () => this.handlers.onFeedback?.(t('复制失败')),
    );
  }

  _copy(url) {
    if (!url) return;
    this._writeClipboard(url).then(
      (ok) => this.handlers.onFeedback?.(ok ? t('链接已复制') : t('复制失败')),
      () => this.handlers.onFeedback?.(t('复制失败')),
    );
  }

  _empty(title, desc) {
    this.contentHost.innerHTML = `<div class="list-empty"><div class="glyph">${icon('spark')}</div><h3>${esc(t(title))}</h3><p>${esc(t(desc))}</p></div>`;
  }
}
