'use strict';
/**
 * RobinRead Windows — 知识中心
 * 高亮 / 笔记 / 间隔复习 / 收藏集 / 统计 / 标签云
 */
import { t, tf } from '../i18n.js';
import { icon } from '../icons.js';
import { promptBox, confirmBox } from '../ui-prompt.js';
import { renderMarkdown } from '../markdown.js';

const TABS = [
  { id: 'dashboard', label: '看板', icon: 'general' },
  { id: 'highlights', label: '高亮', icon: 'highlight' },
  { id: 'notes', label: '笔记', icon: 'pencil' },
  { id: 'review', label: '复习', icon: 'refresh' },
  { id: 'collections', label: '收藏集', icon: 'folder' },
  { id: 'smartfolders', label: '智能文件夹', icon: 'ai' },
  { id: 'review-daily', label: '回顾', icon: 'clock' },
  { id: 'search', label: '搜索', icon: 'search' },
  { id: 'heatmap', label: '热力图', icon: 'heart' },
  { id: 'stats', label: '统计', icon: 'general' },
  { id: 'tags', label: '标签', icon: 'globe' },
  { id: 'graph', label: '图谱', icon: 'ai' },
  { id: 'ask', label: '问知识库', icon: 'spark' },
];

function timeAgo(seconds) {
  if (!seconds) return '';
  const diff = Math.max(0, Date.now() / 1000 - seconds);
  const m = Math.floor(diff / 60), h = Math.floor(diff / 3600), d = Math.floor(diff / 86400);
  if (d > 0) return tf('%lld 天前', d);
  if (h > 0) return tf('%lld 小时前', h);
  if (m > 0) return tf('%lld 分钟前', m);
  return t('刚刚');
}

function downloadText(filename, content, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export class KnowledgeCenter {
  constructor({ onOpenArticle, onOpenSmartFolder }) {
    this.handlers = { onOpenArticle, onOpenSmartFolder };
    this.tab = 'highlights';
    this.data = {};
  }

  present() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) this.dismiss(); });
    this.modal = document.createElement('div');
    this.modal.className = 'modal';
    overlay.appendChild(this.modal);
    document.body.appendChild(overlay);
    this.overlay = overlay;
    this._esc = (e) => { if (e.key === 'Escape') this.dismiss(); };
    document.addEventListener('keydown', this._esc);
    this._render();
    this._load();
  }

  dismiss() {
    document.removeEventListener('keydown', this._esc);
    this.overlay?.remove();
    this.overlay = null;
  }

  async _load() {
    const loads = {
      dashboard: async () => window.robin.kbDashboard(),
      highlights: async () => (await window.robin.kbAllHighlights()).slice(0, 100),
      notes: async () => (await window.robin.kbNotes()).slice(0, 80),
      review: async () => window.robin.kbDueReviews(),
      collections: async () => window.robin.kbCollections(),
      smartfolders: async () => window.robin.kbSmartFolders(),
      'review-daily': async () => window.robin.kbDailyReview(),
      search: async () => ({ query: '' }),
      heatmap: async () => window.robin.kbHeatmap(120),
      stats: async () => window.robin.kbStats(30),
      tags: async () => window.robin.kbTags(),
      graph: async () => window.robin.kbGraph(240),
      ask: async () => ({}),
    };
    const loader = loads[this.tab];
    if (!loader) return;
    const result = await loader();
    this.data[this.tab] = result;
    this._renderContent();
  }

  _render() {
    if (!this.modal) return;
    this.modal.innerHTML = '';
    const sidebar = document.createElement('div');
    sidebar.className = 'modal-sidebar';
    sidebar.innerHTML = `<h2>${escapeHTML(t('知识中心'))}</h2>`;
    for (const tab of TABS) {
      const item = document.createElement('div');
      item.className = `modal-nav-item ${tab.id === this.tab ? 'active' : ''}`;
      item.innerHTML = `<span class="nav-icon">${icon(tab.icon)}</span><span></span>`;
      item.querySelector('span:last-child').textContent = t(tab.label);
      item.addEventListener('click', () => { this.tab = tab.id; this._render(); this._load(); });
      sidebar.appendChild(item);
    }
    this.modal.appendChild(sidebar);
    const main = document.createElement('div');
    main.className = 'modal-main';
    const header = document.createElement('div');
    header.className = 'modal-header';
    header.innerHTML = `<h3>${escapeHTML(t(TABS.find((x) => x.id === this.tab)?.label || ''))}</h3>`;
    const exportBtn = document.createElement('button');
    exportBtn.className = 'btn-text bordered';
    exportBtn.innerHTML = `${icon('export')}<span style="margin-left:5px">${escapeHTML(t('导出'))}</span>`;
    exportBtn.addEventListener('click', (event) => this._showExportMenu(event, exportBtn));
    header.appendChild(exportBtn);
    const close = document.createElement('button');
    close.className = 'btn icon-only';
    close.innerHTML = icon('close');
    close.addEventListener('click', () => this.dismiss());
    header.appendChild(close);
    main.appendChild(header);
    this.contentHost = document.createElement('div');
    this.contentHost.className = 'modal-scroll';
    this.contentHost.innerHTML = `<div class="list-empty"><div class="glyph">${icon('spark')}</div><h3>${escapeHTML(t('加载中…'))}</h3></div>`;
    main.appendChild(this.contentHost);
    this.modal.appendChild(main);
  }

  async _showExportMenu(event, anchor) {
    const rect = anchor.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = `${rect.right - 180}px`;
    menu.style.top = `${rect.bottom + 6}px`;
    const items = [
      { label: t('导出 Markdown'), icon: 'pencil', action: async () => { const md = await window.robin.kbExportNotes(); downloadText('robinread-knowledge.md', md, 'text/markdown'); } },
      { label: t('导出 JSON'), icon: 'import', action: async () => { const json = await window.robin.kbExportJSON(); downloadText('robinread-knowledge.json', json, 'application/json'); } },
      { label: t('导出 HTML'), icon: 'globe', action: async () => { const html = await window.robin.kbExportHTML(); downloadText('robinread-knowledge.html', html, 'text/html'); } },
      { label: t('导出 Anki 卡片'), icon: 'refresh', action: async () => { const tsv = await window.robin.kbExportAnki(); downloadText('robinread-anki.txt', tsv, 'text/tab-separated-values'); } },
    ];
    for (const it of items) {
      const row = document.createElement('button');
      row.className = 'context-menu-item';
      row.innerHTML = `<span class="nav-icon">${icon(it.icon)}</span><span>${escapeHTML(it.label)}</span>`;
      row.addEventListener('click', async () => { menu.remove(); await it.action(); });
      menu.appendChild(row);
    }
    document.body.appendChild(menu);
    const dismiss = (e) => { if (!menu.contains(e.target) && e.target !== anchor) { menu.remove(); document.removeEventListener('mousedown', dismiss); } };
    setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
  }

  _renderContent() {
    if (!this.contentHost) return;
    const data = this.data[this.tab];
    this.contentHost.innerHTML = '';
    switch (this.tab) {
      case 'dashboard': this._renderDashboard(data || {}); break;
      case 'highlights': this._renderHighlights(data || []); break;
      case 'notes': this._renderNotes(data || []); break;
      case 'review': this._renderReview(data || []); break;
      case 'collections': this._renderCollections(data || []); break;
      case 'smartfolders': this._renderSmartFolders(data || []); break;
      case 'review-daily': this._renderDaily(data || {}); break;
      case 'search': this._renderSearch(); break;
      case 'heatmap': this._renderHeatmap(data || {}); break;
      case 'stats': this._renderStats(data || {}); break;
      case 'tags': this._renderTags(data || []); break;
      case 'graph': this._renderGraph(data || {}); break;
      case 'ask': this._renderAsk(); break;
    }
  }

  // ── 看板 ──
  _renderDashboard(d) {
    const el = document.createElement('div');
    el.className = 'kb-stats';
    el.innerHTML = `
      <div class="kb-stats-grid">
        <div class="kb-stat-card"><span class="kb-stat-num">${d.highlights || 0}</span><span class="kb-stat-label">高亮</span></div>
        <div class="kb-stat-card"><span class="kb-stat-num">${d.notes || 0}</span><span class="kb-stat-label">笔记</span></div>
        <div class="kb-stat-card"><span class="kb-stat-num">${d.review || 0}</span><span class="kb-stat-label">复习卡片</span></div>
        <div class="kb-stat-card"><span class="kb-stat-num">${d.due || 0}</span><span class="kb-stat-label">今日待复习</span></div>
        <div class="kb-stat-card"><span class="kb-stat-num">${d.collections || 0}</span><span class="kb-stat-label">收藏集</span></div>
        <div class="kb-stat-card"><span class="kb-stat-num">${d.tags || 0}</span><span class="kb-stat-label">标签</span></div>
        <div class="kb-stat-card"><span class="kb-stat-num">${d.streak || 0}</span><span class="kb-stat-label">连续天数</span></div>
      </div>`;
    if (d.due > 0) {
      const cta = document.createElement('button');
      cta.className = 'btn-text primary';
      cta.style.marginTop = '16px';
      cta.textContent = t('去复习（有 ' + d.due + ' 张卡片到期）');
      cta.addEventListener('click', () => { this.tab = 'review'; this._render(); this._load(); });
      el.appendChild(cta);
    }
    this.contentHost.appendChild(el);
  }

  // ── 每日回顾 ──
  _renderDaily(review) {
    const wrap = document.createElement('div');
    const head = document.createElement('div');
    head.className = 'kb-daily-head';
    head.innerHTML = `<span class="kb-daily-title">${escapeHTML(t('每日回顾'))}</span><span class="kb-daily-sub">${escapeHTML(review.date || '')} · ${review.total || 0} 条知识</span>`;
    wrap.appendChild(head);
    if (!review.highlights?.length && !review.notes?.length) {
      this._emptyIn(wrap, '今天还没有知识沉淀', '阅读时高亮或记笔记，晚上回来回顾。');
      this.contentHost.appendChild(wrap);
      return;
    }
    if (review.highlights?.length) {
      const lbl = document.createElement('div'); lbl.className = 'td-section-label'; lbl.textContent = t('高亮');
      wrap.appendChild(lbl);
      for (const hl of review.highlights) {
        const card = document.createElement('div');
        card.className = 'kb-card';
        card.innerHTML = `<div class="kb-card-source">${icon('newspaper')}<span></span></div><div class="kb-hl-text" style="border-left:3px solid var(--accent)"></div>`;
        card.querySelector('.kb-card-source span').textContent = hl.article_title || '';
        card.querySelector('.kb-hl-text').textContent = hl.text;
        card.addEventListener('click', () => this.handlers.onOpenArticle?.(hl.item_id));
        wrap.appendChild(card);
      }
    }
    if (review.notes?.length) {
      const lbl = document.createElement('div'); lbl.className = 'td-section-label'; lbl.textContent = t('笔记');
      wrap.appendChild(lbl);
      for (const n of review.notes) {
        const card = document.createElement('div');
        card.className = 'kb-card';
        card.innerHTML = `<div class="kb-card-source">${icon('newspaper')}<span></span></div><div class="kb-note-content"></div>`;
        card.querySelector('.kb-card-source span').textContent = n.article_title || '';
        card.querySelector('.kb-note-content').textContent = n.content;
        card.addEventListener('click', () => this.handlers.onOpenArticle?.(n.item_id));
        wrap.appendChild(card);
      }
    }
    this.contentHost.appendChild(wrap);
  }

  // ── 知识搜索 ──
  _renderSearch() {
    const wrap = document.createElement('div');
    const bar = document.createElement('div');
    bar.className = 'kb-search-bar';
    bar.innerHTML = `${icon('search')}<input type="text" placeholder="${attr(t('搜索高亮与笔记内容…'))}"/>`;
    const input = bar.querySelector('input');
    const resultHost = document.createElement('div');
    resultHost.className = 'kb-search-results';
    wrap.append(bar, resultHost);

    const run = async (q) => {
      if (!q.trim()) { resultHost.innerHTML = ''; return; }
      const result = await window.robin.kbSearchKnowledge(q, { limit: 50 });
      resultHost.innerHTML = '';
      if (!result.total) { this._emptyIn(resultHost, '没有匹配', '换个关键词试试。'); return; }
      const lbl = document.createElement('div');
      lbl.className = 'td-section-label';
      lbl.textContent = t(`找到 ${result.total} 条结果`);
      resultHost.appendChild(lbl);
      for (const n of result.notes || []) {
        const card = document.createElement('div');
        card.className = 'kb-card';
        card.innerHTML = `<div class="kb-card-source">${icon('pencil')}<span></span></div><div class="kb-note-content"></div>`;
        card.querySelector('.kb-card-source span').textContent = n.articleTitle || t('笔记');
        card.querySelector('.kb-note-content').textContent = n.content;
        card.addEventListener('click', () => this.handlers.onOpenArticle?.(n.itemID));
        resultHost.appendChild(card);
      }
      for (const hl of result.highlights || []) {
        const card = document.createElement('div');
        card.className = 'kb-card';
        card.innerHTML = `<div class="kb-card-source">${icon('highlight')}<span></span></div><div class="kb-hl-text" style="border-left:3px solid var(--accent)"></div>`;
        card.querySelector('.kb-card-source span').textContent = hl.articleTitle || t('高亮');
        card.querySelector('.kb-hl-text').textContent = hl.text;
        card.addEventListener('click', () => this.handlers.onOpenArticle?.(hl.itemID));
        resultHost.appendChild(card);
      }
    };
    let timer = null;
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => run(input.value), 300); });
    setTimeout(() => input.focus(), 50);
    this.contentHost.appendChild(wrap);
  }

  // ── 阅读热力图 ──
  _renderHeatmap(data) {
    const wrap = document.createElement('div');
    const head = document.createElement('div');
    head.className = 'kb-daily-head';
    head.innerHTML = `<span class="kb-daily-title">${escapeHTML(t('阅读热力图'))}</span><span class="kb-daily-sub">${escapeHTML(t('近 120 天活跃度'))}</span>`;
    wrap.appendChild(head);
    const map = data.map || {};
    const grid = document.createElement('div');
    grid.className = 'kb-heatmap';
    const today = new Date();
    let max = 1;
    for (const v of Object.values(map)) max = Math.max(max, v.intensity || 0);
    // 按周排列：列=周，行=星期
    const weeks = [];
    let cur = [];
    const start = new Date(today); start.setDate(start.getDate() - 119);
    // 对齐到周日
    start.setDate(start.getDate() - start.getDay());
    for (let i = 0; i < 120; i += 7) {
      weeks.push([]);
    }
    const cells = [];
    for (let d = 0; d < 120; d++) {
      const dt = new Date(start); dt.setDate(start.getDate() + d);
      const key = dt.toISOString().slice(0, 10);
      const v = map[key];
      const intensity = v ? v.intensity : 0;
      cells.push({ key, intensity, date: dt });
    }
    for (const c of cells) {
      const cell = document.createElement('div');
      cell.className = 'kb-heat-cell';
      cell.title = `${c.key} · 活跃度 ${c.intensity}`;
      const level = c.intensity === 0 ? 0 : Math.min(4, Math.ceil((c.intensity / max) * 4));
      cell.dataset.level = String(level);
      grid.appendChild(cell);
    }
    wrap.appendChild(grid);
    const legend = document.createElement('div');
    legend.className = 'kb-heat-legend';
    legend.innerHTML = `<span>少</span>${[0,1,2,3,4].map((i) => `<i data-level="${i}"></i>`).join('')}<span>多</span>`;
    wrap.appendChild(legend);
    this.contentHost.appendChild(wrap);
  }

  _emptyIn(host, title, desc) {
    host.innerHTML = `<div class="list-empty"><div class="glyph">${icon('spark')}</div><h3>${escapeHTML(t(title))}</h3><p>${escapeHTML(t(desc))}</p></div>`;
  }

  _renderHighlights(items) {
    if (!items.length) { this._empty('还没有高亮', '在阅读器中选中文字后点击高亮按钮。'); return; }
    for (const hl of items) {
      const card = document.createElement('div');
      card.className = 'kb-card';
      card.innerHTML = `
        ${hl.articleTitle ? `<div class="kb-card-source">${icon('newspaper')}<span></span></div>` : ''}
        <div class="kb-hl-text" style="border-left: 3px solid ${hl.color === 'blue' ? 'var(--accent)' : '#d4a834'};"></div>
        ${hl.note ? `<div class="kb-hl-note">${escapeHTML(hl.note)}</div>` : ''}
        <div class="kb-card-foot">
          ${hl.createdAt ? `<span class="kb-card-time">${escapeHTML(timeAgo(hl.createdAt))}</span>` : ''}
          <span class="kb-card-actions">
            <button class="btn icon-only kb-edit" data-id="${attr(hl.id)}" title="${attr(t('编辑备注'))}">${icon('pencil')}</button>
            <button class="btn icon-only kb-del" data-id="${attr(hl.id)}" title="${attr(t('删除高亮'))}">${icon('trash')}</button>
          </span>
        </div>`;
      if (hl.articleTitle) card.querySelector('.kb-card-source span').textContent = hl.articleTitle;
      card.querySelector('.kb-hl-text').textContent = hl.text;
      card.querySelector('.kb-edit').addEventListener('click', async (e) => {
        e.stopPropagation();
        const note = await promptBox(t('编辑高亮备注'), { initial: hl.note || '', multiline: true });
        if (note === null) return;
        await window.robin.kbUpdateHighlight(hl.id, { note: note });
        this._load();
      });
      card.querySelector('.kb-del').addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await confirmBox(t('删除高亮'), { message: t('确定删除这条高亮吗？此操作无法撤销。'), okLabel: t('删除'), danger: true });
        if (!ok) return;
        await window.robin.kbRemoveHighlight(hl.id);
        this._load();
      });
      card.addEventListener('click', () => this.handlers.onOpenArticle?.(hl.itemID));
      this.contentHost.appendChild(card);
    }
  }

  _renderNotes(notes) {
    if (!notes.length) { this._empty('还没有笔记', '在阅读器中点笔记按钮添加你的第一条笔记。'); return; }
    for (const note of notes) {
      const card = document.createElement('div');
      card.className = 'kb-card';
      const hasWikiLinks = /\[\[[^\]]+\]\]/.test(note.content || '');
      card.innerHTML = `
        ${note.articleTitle ? `<div class="kb-card-source">${icon('newspaper')}<span></span></div>` : ''}
        <div class="kb-note-content"></div>
        ${note.tags.length ? `<div class="kb-note-tags">${note.tags.map((tag) => `<span class="fs-tag">${escapeHTML(tag)}</span>`).join('')}</div>` : ''}
        <div class="kb-card-foot">
          ${note.updatedAt ? `<span class="kb-card-time">${escapeHTML(timeAgo(note.updatedAt))}</span>` : ''}
          <span class="kb-card-actions">
            ${hasWikiLinks ? `<button class="btn-text bordered kb-links-btn" title="${attr(t('查看反向链接'))}">${escapeHTML(t('反链'))}</button>` : ''}
            <button class="btn icon-only kb-edit" data-id="${attr(note.id)}" title="${attr(t('编辑笔记'))}">${icon('pencil')}</button>
            <button class="btn icon-only kb-del" data-id="${attr(note.id)}" title="${attr(t('删除笔记'))}">${icon('trash')}</button>
          </span>
        </div>`;
      if (note.articleTitle) card.querySelector('.kb-card-source span').textContent = note.articleTitle;
      card.querySelector('.kb-note-content').textContent = note.content;
      const linksBtn = card.querySelector('.kb-links-btn');
      if (linksBtn) {
        linksBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await window.robin.kbRefreshLinks(note.id);
          this._viewBacklinks(note);
        });
      }
      card.querySelector('.kb-edit').addEventListener('click', async (e) => {
        e.stopPropagation();
        const content = await promptBox(t('编辑笔记'), { initial: note.content, multiline: true });
        if (content === null) return;
        await window.robin.kbUpdateNote(note.id, { content });
        this._load();
      });
      card.querySelector('.kb-del').addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await confirmBox(t('删除笔记'), { message: t('确定删除这条笔记吗？此操作无法撤销。'), okLabel: t('删除'), danger: true });
        if (!ok) return;
        await window.robin.kbDeleteNote(note.id);
        this._load();
      });
      card.addEventListener('click', () => this.handlers.onOpenArticle?.(note.itemID));
      this.contentHost.appendChild(card);
    }
  }

  /** 查看某条笔记的反向链接。 */
  async _viewBacklinks(note) {
    const backlinks = await window.robin.kbBacklinks(note.id);
    this.contentHost.innerHTML = '';
    const back = document.createElement('button');
    back.className = 'btn-text bordered';
    back.style.marginBottom = '12px';
    back.innerHTML = `${icon('chevronMenuRight')}<span style="margin-left:4px">${escapeHTML(t('返回笔记'))}</span>`;
    back.addEventListener('click', () => { this.tab = 'notes'; this._render(); this._load(); });
    this.contentHost.appendChild(back);
    const lbl = document.createElement('div');
    lbl.className = 'td-section-label';
    lbl.textContent = t('反向链接（' + (backlinks || []).length + '）');
    this.contentHost.appendChild(lbl);
    if (!backlinks?.length) {
      this._emptyIn(this.contentHost, '还没有反链', '其他笔记用 [[链接]] 引用这条笔记后，会出现在这里。');
      return;
    }
    for (const bl of backlinks) {
      const card = document.createElement('div');
      card.className = 'kb-card';
      card.innerHTML = `<div class="kb-note-content"></div>`;
      card.querySelector('.kb-note-content').textContent = bl.fromContent || '';
      card.addEventListener('click', () => this.handlers.onOpenArticle?.(bl.itemID));
      this.contentHost.appendChild(card);
    }
  }

  _renderReview(items) {
    if (!items.length) { this._empty('复习队列空了', '高亮一篇文章的重要段落并加入复习，它会按记忆曲线回来。'); return; }
    for (const item of items) {
      const card = document.createElement('div');
      card.className = 'kb-card kb-review-card';
      const reps = item.repetitions || 0;
      const interval = item.intervalDays || 1;
      card.innerHTML = `
        <div class="kb-review-head">
          <span class="kb-review-title"></span>
          <span class="kb-review-meta">${icon('clock')}<span>${interval} 天 · ${reps} 次复习</span></span>
        </div>
        ${item.highlightText ? `<div class="kb-hl-text"></div>` : ''}
        <div class="kb-review-actions">
          <button class="btn-text" data-q="0">😅 忘了</button>
          <button class="btn-text" data-q="3">🤔 想起来了</button>
          <button class="btn-text primary" data-q="5">😎 简单</button>
          <button class="btn-text danger kb-review-remove" title="${attr(t('移出复习队列'))}">${escapeHTML(t('移除'))}</button>
        </div>`;
      card.querySelector('.kb-review-title').textContent = item.articleTitle || t('未知文章');
      if (item.highlightText) card.querySelector('.kb-hl-text').textContent = item.highlightText;
      card.querySelector('.kb-review-remove').addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await confirmBox(t('移出复习'), { message: t('确定把这张卡片移出复习队列吗？'), okLabel: t('移除'), danger: true });
        if (!ok) return;
        await window.robin.kbRemoveFromReview(item.id);
        card.style.opacity = '0.3';
        setTimeout(() => card.remove(), 300);
      });
      card.querySelectorAll('[data-q]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const q = Number(btn.dataset.q);
          await window.robin.kbReview(item.id, q);
          btn.closest('.kb-review-card').style.opacity = '0.3';
          setTimeout(() => btn.closest('.kb-review-card')?.remove(), 300);
        });
      });
      this.contentHost.appendChild(card);
    }
  }

  async _renderCollections(collections) {
    if (!collections.length) {
      this._empty('还没有收藏集', '收藏集帮助你按主题归档文章，可从阅读器加入。');
      const create = document.createElement('button');
      create.className = 'btn-text primary';
      create.style.marginTop = '12px';
      create.textContent = t('新建收藏集');
      create.addEventListener('click', () => this._promptNewCollection());
      this.contentHost.appendChild(create);
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'kb-col-grid';
    for (const col of collections) {
      const card = document.createElement('div');
      card.className = 'kb-col-card';
      card.innerHTML = `
        <div class="kb-col-top">
          <div class="kb-col-icon">${icon('folder')}</div>
          <span class="kb-card-actions">
            <button class="btn icon-only kb-col-rename" title="${attr(t('重命名'))}">${icon('pencil')}</button>
            <button class="btn icon-only kb-col-del" title="${attr(t('删除收藏集'))}">${icon('trash')}</button>
          </span>
        </div>
        <div class="kb-col-name"></div>
        ${col.description ? `<div class="kb-col-desc"></div>` : ''}
        <div class="kb-col-count">${col.item_count || 0} 篇文章</div>`;
      card.querySelector('.kb-col-name').textContent = col.name;
      if (col.description) card.querySelector('.kb-col-desc').textContent = col.description;
      card.querySelector('.kb-col-rename').addEventListener('click', async (e) => {
        e.stopPropagation();
        const name = await promptBox(t('重命名收藏集'), { initial: col.name });
        if (!name?.trim() || name === col.name) return;
        const desc = await promptBox(t('描述（可选）'), { initial: col.description || '' });
        if (desc === null) return;
        await window.robin.kbUpdateCollection(col.id, { name: name.trim(), description: desc.trim() });
        this._load();
      });
      card.querySelector('.kb-col-del').addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await confirmBox(t('删除收藏集'), { message: t('确定删除「' + col.name + '」吗？其中的文章不会被删除。'), okLabel: t('删除'), danger: true });
        if (!ok) return;
        await window.robin.kbDeleteCollection(col.id);
        this._load();
      });
      card.addEventListener('click', async () => this._openCollection(col));
      grid.appendChild(card);
    }
    this.contentHost.appendChild(grid);
    const add = document.createElement('button');
    add.className = 'btn-text bordered';
    add.style.marginTop = '14px';
    add.textContent = t('新建收藏集');
    add.addEventListener('click', () => this._promptNewCollection());
    this.contentHost.appendChild(add);
  }

  async _promptNewCollection() {
    const name = await promptBox(t('收藏集名称'));
    if (!name?.trim()) return;
    const desc = (await promptBox(t('描述（可选）'))) || '';
    await window.robin.kbCreateCollection(name.trim(), desc.trim());
    this._load();
  }

  async _openCollection(col) {
    const items = await window.robin.kbCollectionItems(col.id);
    if (!items.length) { this._empty('收藏集是空的', '从阅读器或列表中把文章加入这个收藏集。'); return; }
    this.contentHost.innerHTML = '';
    const back = document.createElement('button');
    back.className = 'btn-text bordered';
    back.style.marginBottom = '12px';
    back.innerHTML = `${icon('chevronMenuRight')}<span style="margin-left:4px">${escapeHTML(t('返回收藏集'))}</span>`;
    back.addEventListener('click', () => this._load());
    this.contentHost.appendChild(back);
    for (const it of items) {
      const card = document.createElement('div');
      card.className = 'kb-card';
      card.innerHTML = `<div class="kb-note-content"></div>
        <div class="kb-card-foot">
          <div class="kb-card-source">${icon('newspaper')}<span></span></div>
          <button class="btn icon-only kb-item-remove" title="${attr(t('移出收藏集'))}">${icon('trash')}</button>
        </div>`;
      card.querySelector('.kb-note-content').textContent = it.title;
      card.querySelector('.kb-card-source span').textContent = it.feed_title || '';
      card.querySelector('.kb-item-remove').addEventListener('click', async (e) => {
        e.stopPropagation();
        await window.robin.kbRemoveFromCollection(col.id, it.id);
        card.style.opacity = '0.3';
        setTimeout(() => card.remove(), 250);
      });
      card.addEventListener('click', () => this.handlers.onOpenArticle?.(it.id));
      this.contentHost.appendChild(card);
    }
  }

  _renderStats(data) {
    const totals = data.totals || {};
    const daily = data.daily || [];
    const el = document.createElement('div');
    el.className = 'kb-stats';
    el.innerHTML = `
      <div class="kb-stats-grid">
        <div class="kb-stat-card"><span class="kb-stat-num">${totals.read || 0}</span><span class="kb-stat-label">已读文章</span></div>
        <div class="kb-stat-card"><span class="kb-stat-num">${data.streak || 0}</span><span class="kb-stat-label">连续阅读天数</span></div>
        <div class="kb-stat-card"><span class="kb-stat-num">${totals.highlights || 0}</span><span class="kb-stat-label">高亮次数</span></div>
        <div class="kb-stat-card"><span class="kb-stat-num">${totals.notes || 0}</span><span class="kb-stat-label">笔记条数</span></div>
        <div class="kb-stat-card"><span class="kb-stat-num">${totals.ai || 0}</span><span class="kb-stat-label">AI 摘要</span></div>
        <div class="kb-stat-card"><span class="kb-stat-num">${daily.length}</span><span class="kb-stat-label">活跃天数</span></div>
      </div>`;
    if (daily.length) {
      const chart = document.createElement('div');
      chart.className = 'kb-chart';
      const max = Math.max(1, ...daily.map((d) => Math.max(d.articles_read || 0, d.highlights_made || 0)));
      for (const d of daily.slice(-30)) {
        const bar = document.createElement('div');
        bar.className = 'kb-chart-bar';
        bar.title = `${d.date} · 阅读 ${d.articles_read || 0} · 高亮 ${d.highlights_made || 0}`;
        const v = Math.max(d.articles_read || 0, d.highlights_made || 0);
        bar.style.height = `${Math.max(4, (v / max) * 72)}px`;
        bar.style.opacity = v > 0 ? '1' : '0.25';
        chart.appendChild(bar);
      }
      el.appendChild(chart);
    }
    this.contentHost.appendChild(el);
  }

  // ── 图谱（知识增强）：标签 ↔ 文章 canvas 力导向图 ──
  _renderGraph(data) {
    const el = document.createElement('div');
    if (!data?.edges?.length) {
      this._empty('图谱还是空的', '阅读时高亮、打标签或生成 AI 摘要，知识节点会在这里生长。');
      return;
    }
    const head = document.createElement('div');
    head.className = 'kb-graph-head';
    head.innerHTML = `<span class="kb-daily-title">${escapeHTML(t('知识图谱'))}</span><span class="kb-graph-legend">${escapeHTML(t('大节点 = 高频标签 · 悬停高亮关联 · 点击文章节点直达'))}</span>`;
    el.appendChild(head);

    const wrap = document.createElement('div');
    wrap.className = 'kb-graph-wrap';
    const canvas = document.createElement('canvas');
    canvas.className = 'kb-graph-canvas';
    wrap.appendChild(canvas);
    el.appendChild(wrap);
    this.contentHost.appendChild(el);

    // 主题取色（canvas 不能直接用 CSS 变量）
    const css = getComputedStyle(document.documentElement);
    const palette = {
      ink: css.getPropertyValue('--text-primary').trim() || '#333',
      muted: css.getPropertyValue('--text-secondary').trim() || '#888',
      accent: css.getPropertyValue('--accent').trim() || '#617357',
      paper: css.getPropertyValue('--page-background').trim() || '#faf7ee',
      line: css.getPropertyValue('--note-border').trim() || '#ddd',
    };

    // 节点/边构建
    const nodes = [];
    const nodeByKey = new Map();
    const addNode = (key, kind, label, weight) => {
      let node = nodeByKey.get(key);
      if (!node) {
        node = { key, kind, label, weight: 0, x: 0, y: 0, vx: 0, vy: 0 };
        nodeByKey.set(key, node);
        nodes.push(node);
      }
      node.weight += weight;
      return node;
    };
    for (const tg of data.tags || []) addNode(`tag:${tg.tag}`, 'tag', tg.tag, tg.count);
    for (const a of data.articles || []) addNode(`art:${a.id}`, 'article', a.title || a.id, 1);
    const edges = (data.edges || []).map((e) => ({
      a: nodeByKey.get(`tag:${e.tag}`),
      b: nodeByKey.get(`art:${e.id}`),
    })).filter((e) => e.a && e.b);

    // 初始布局：同心圆撒点
    const W = Math.max(420, wrap.clientWidth || 760);
    const H = 460;
    nodes.forEach((node, i) => {
      const angle = (i / nodes.length) * Math.PI * 2;
      const radius = node.kind === 'tag' ? 90 : 180;
      node.x = W / 2 + Math.cos(angle) * radius * (0.6 + 0.4 * Math.sin(i * 7));
      node.y = H / 2 + Math.sin(angle) * radius * (0.6 + 0.4 * Math.cos(i * 5));
    });

    // 力导向模拟（固定迭代成静态图；悬停仅视觉高亮，不重排）
    const REPULSION = 2600;
    const SPRING = 0.015;
    const REST = 86;
    const CENTER = 0.012;
    for (let iter = 0; iter < 160; iter += 1) {
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let dist2 = dx * dx + dy * dy;
          if (dist2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; dist2 = 1; }
          const force = REPULSION / dist2;
          const dist = Math.sqrt(dist2);
          const fx = (dx / dist) * Math.min(force, 12);
          const fy = (dy / dist) * Math.min(force, 12);
          a.vx += fx; a.vy += fy;
          b.vx -= fx; b.vy -= fy;
        }
      }
      for (const edge of edges) {
        const dx = edge.b.x - edge.a.x;
        const dy = edge.b.y - edge.a.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const force = (dist - REST) * SPRING;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        edge.a.vx += fx; edge.a.vy += fy;
        edge.b.vx -= fx; edge.b.vy -= fy;
      }
      for (const node of nodes) {
        node.vx += (W / 2 - node.x) * CENTER;
        node.vy += (H / 2 - node.y) * CENTER;
        node.vx *= 0.82; node.vy *= 0.82;
        node.x = Math.max(26, Math.min(W - 26, node.x + Math.max(-9, Math.min(9, node.vx))));
        node.y = Math.max(22, Math.min(H - 22, node.y + Math.max(-9, Math.min(9, node.vy))));
      }
    }

    // 绘制
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const radiusOf = (node) => (node.kind === 'tag' ? Math.min(20, 6 + Math.sqrt(node.weight) * 3.2) : 5);
    let hover = null;
    const related = (node) => {
      const set = new Set([node]);
      for (const edge of edges) {
        if (edge.a === node) set.add(edge.b);
        if (edge.b === node) set.add(edge.a);
      }
      return set;
    };
    let hoverSet = null;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      for (const edge of edges) {
        const hot = hover && (edge.a === hover || edge.b === hover);
        ctx.strokeStyle = hot ? palette.accent : palette.line;
        ctx.globalAlpha = hover ? (hot ? 0.9 : 0.15) : 0.55;
        ctx.beginPath();
        ctx.moveTo(edge.a.x, edge.a.y);
        ctx.lineTo(edge.b.x, edge.b.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (const node of nodes) {
        const r = radiusOf(node);
        const dim = hoverSet ? !hoverSet.has(node) : false;
        ctx.globalAlpha = dim ? 0.15 : 1;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        if (node.kind === 'tag') {
          ctx.fillStyle = palette.accent;
          ctx.fill();
        } else {
          ctx.fillStyle = palette.paper;
          ctx.fill();
          ctx.strokeStyle = palette.muted;
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }
        const showLabel = node.kind === 'tag' ? (node.weight >= 3 || hoverSet?.has(node)) : hoverSet?.has(node);
        if (showLabel) {
          ctx.globalAlpha = dim ? 0.25 : 0.92;
          ctx.fillStyle = palette.ink;
          ctx.font = `${node.kind === 'tag' ? 600 : 400} 11px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          const label = node.label.length > 18 ? `${node.label.slice(0, 17)}…` : node.label;
          ctx.fillText(label, node.x, node.y - r - 5);
        }
        ctx.globalAlpha = 1;
      }
    };
    draw();

    // 交互：悬停高亮关联子图 + 点击文章节点直达
    const nodeAt = (evt) => {
      const rect = canvas.getBoundingClientRect();
      const x = evt.clientX - rect.left;
      const y = evt.clientY - rect.top;
      let best = null;
      let bestDist = 24;
      for (const node of nodes) {
        const d = Math.hypot(node.x - x, node.y - y);
        if (d < Math.max(radiusOf(node) + 6, 12) && d < bestDist) { best = node; bestDist = d; }
      }
      return best;
    };
    canvas.addEventListener('mousemove', (event) => {
      const node = nodeAt(event);
      if (node !== hover) {
        hover = node;
        hoverSet = node ? related(node) : null;
        canvas.style.cursor = node ? 'pointer' : 'default';
        draw();
      }
    });
    canvas.addEventListener('mouseleave', () => { hover = null; hoverSet = null; draw(); });
    canvas.addEventListener('click', (event) => {
      const node = nodeAt(event);
      if (node?.kind === 'article') this.handlers.onOpenArticle?.(node.key.slice(4));
    });
  }

  // ── 问知识库（知识增强）：以高亮 + 笔记为材料的流式问答 ──
  _renderAsk() {
    const el = document.createElement('div');
    const head = document.createElement('div');
    head.className = 'kb-graph-head';
    head.innerHTML = `<span class="kb-daily-title">${escapeHTML(t('问知识库'))}</span><span class="kb-graph-legend">${escapeHTML(t('以你的高亮与笔记为材料作答，句末 [n] 可点击跳来源'))}</span>`;
    el.appendChild(head);

    const inputRow = document.createElement('div');
    inputRow.className = 'kb-ask-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'kb-ask-input';
    input.placeholder = t('例如：我收藏过哪些关于写作的建议？');
    const askBtn = document.createElement('button');
    askBtn.className = 'btn-text primary kb-ask-btn';
    askBtn.textContent = t('提问');
    inputRow.append(input, askBtn);
    el.appendChild(inputRow);

    const answer = document.createElement('div');
    answer.className = 'kb-ask-answer';
    el.appendChild(answer);
    const refsHost = document.createElement('div');
    refsHost.className = 'kb-ask-refs';
    el.appendChild(refsHost);
    this.contentHost.appendChild(el);

    let busy = false;
    const submit = async () => {
      const question = input.value.trim();
      if (!question || busy) return;
      busy = true;
      askBtn.disabled = true;
      answer.className = 'kb-ask-answer';
      answer.innerHTML = '<div class="robin-spinner"></div>';
      refsHost.innerHTML = '';
      let streamed = '';
      const unsubscribe = window.robin.onAIDelta?.((payload) => {
        if (payload?.key !== 'kb:ask') return;
        streamed += payload.delta || '';
        answer.innerHTML = renderMarkdown(streamed);
      });
      try {
        const result = await window.robin.kbAsk(question);
        if (result && result.ok === false) throw new Error(result.error || t('生成失败'));
        const content = result?.content || streamed;
        answer.className = 'kb-ask-answer';
        answer.innerHTML = renderMarkdown(content);
        for (const ref of result?.refs || []) {
          const chip = document.createElement('button');
          chip.className = 'dg-ref';
          chip.textContent = String(ref.n);
          chip.title = `${ref.kind} · ${ref.title || ''}`;
          chip.addEventListener('click', () => this.handlers.onOpenArticle?.(ref.itemID));
          refsHost.appendChild(chip);
        }
        if (!content.trim()) answer.textContent = t('（空回答）');
      } catch (error) {
        answer.className = 'kb-ask-answer kb-ask-error';
        answer.textContent = String(error?.message || error) || t('生成失败');
      } finally {
        unsubscribe?.();
        busy = false;
        askBtn.disabled = false;
      }
    };
    askBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') submit(); });
  }

  _renderTags(tags) {
    if (!tags.length) { this._empty('还没有标签', 'AI 质量评估会自动生成标签，也可以手动添加。'); return; }
    const wrap = document.createElement('div');
    const head = document.createElement('div');
    head.className = 'kb-daily-head';
    head.innerHTML = `<span class="kb-daily-title">${escapeHTML(t('标签云'))}</span><span class="kb-daily-sub">${escapeHTML(t('点击标签查看相关文章 · 字号与色深代表文章数'))}</span>`;
    wrap.appendChild(head);
    const cloud = document.createElement('div');
    cloud.className = 'kb-tag-cloud';
    const max = Math.max(1, ...tags.map((x) => x.count));
    for (const { tag, count } of tags.slice(0, 80)) {
      // 四档字号（对数分层，头部标签明显更大）；色相由标签名散列（稳定不变）
      const tier = count >= Math.max(4, max * 0.5) ? 't1' : count >= 3 ? 't2' : count >= 2 ? 't3' : 't4';
      let hash = 0;
      for (const ch of tag) hash = (hash * 31 + ch.codePointAt(0)) % 360;
      const chip = document.createElement('button');
      chip.className = `kb-tag2 ${tier}`;
      chip.style.setProperty('--tag-h', String((hash * 47) % 360));
      const label = document.createElement('span');
      label.className = 'kb-tag2-label';
      label.textContent = tag;
      const badge = document.createElement('i');
      badge.className = 'kb-tag2-n';
      badge.textContent = count;
      chip.append(label, badge);
      chip.title = t('点击查看「' + tag + '」的相关文章');
      chip.addEventListener('click', () => this._viewTagArticles(tag));
      cloud.appendChild(chip);
    }
    wrap.appendChild(cloud);
    this.contentHost.appendChild(wrap);
  }

  /** 点击标签 → 列出带该标签的文章（article_tags 真关系查询）。 */
  async _viewTagArticles(tag) {
    this.contentHost.innerHTML = '';
    const back = document.createElement('button');
    back.className = 'btn-text bordered';
    back.style.marginBottom = '12px';
    back.innerHTML = `${icon('chevronMenuRight')}<span style="margin-left:4px">${escapeHTML(t('返回标签云'))}</span>`;
    back.addEventListener('click', () => { this.tab = 'tags'; this._render(); this._load(); });
    this.contentHost.appendChild(back);
    const lbl = document.createElement('div');
    lbl.className = 'td-section-label';
    lbl.textContent = t('标签「' + tag + '」');
    this.contentHost.appendChild(lbl);
    const items = (await window.robin.kbEntriesForTag(tag, 30)) || [];
    if (!items.length) {
      this._emptyIn(this.contentHost, '暂无相关文章', '这个标签还没有关联文章。');
      return;
    }
    for (const it of items) {
      const card = document.createElement('div');
      card.className = 'kb-card';
      card.innerHTML = `<div class="kb-note-content"></div><div class="kb-card-source">${icon('newspaper')}<span></span></div>`;
      card.querySelector('.kb-note-content').textContent = it.title || it.id;
      card.querySelector('.kb-card-source span').textContent = it.feed_title || '';
      card.addEventListener('click', () => this.handlers.onOpenArticle?.(it.id));
      this.contentHost.appendChild(card);
    }
  }

  /** 智能文件夹：列出 + 新建 + 删除。 */
  _renderSmartFolders(folders) {
    const wrap = document.createElement('div');
    const head = document.createElement('div');
    head.className = 'kb-daily-head';
    head.innerHTML = `<span class="kb-daily-title">${escapeHTML(t('智能文件夹'))}</span><span class="kb-daily-sub">${escapeHTML(t('按关键词自动归档'))}</span>`;
    wrap.appendChild(head);
    if (!folders.length) {
      this._emptyIn(wrap, '还没有智能文件夹', '创建一个按关键词自动聚合文章的智能文件夹。');
    }
    for (const f of folders) {
      const row = document.createElement('div');
      row.className = 'evo-feedback-row';
      row.innerHTML = `<span style="display:flex;align-items:center;gap:8px">${icon('ai')}<b>${escapeHTML(f.name)}</b></span>
        <span style="display:flex;align-items:center;gap:8px"><span style="color:var(--text-tertiary)">${escapeHTML(f.query || '')}</span>
        <button class="btn-text" data-open="${attr(f.id)}">${escapeHTML(t('打开'))}</button>
        <button class="btn icon-only" data-del="${attr(f.id)}" title="${attr(t('删除'))}">${icon('trash')}</button></span>`;
      row.querySelector('[data-open]').addEventListener('click', () => {
        this.handlers.onOpenSmartFolder?.({ name: f.name, query: f.query || '' });
      });
      row.querySelector('[data-del]').addEventListener('click', async (e) => {
        e.stopPropagation();
        await window.robin.kbDeleteSmartFolder(f.id);
        this._load();
      });
      wrap.appendChild(row);
    }
    const add = document.createElement('button');
    add.className = 'btn-text primary';
    add.style.marginTop = '14px';
    add.textContent = t('新建智能文件夹');
    add.addEventListener('click', () => this._promptNewSmartFolder());
    wrap.appendChild(add);
    this.contentHost.appendChild(wrap);
  }

  async _promptNewSmartFolder() {
    const name = await promptBox(t('智能文件夹名称'));
    if (!name?.trim()) return;
    const query = await promptBox(t('关键词（匹配文章标题/标签，逗号分隔）'));
    if (query === null) return;
    await window.robin.kbCreateSmartFolder(name.trim(), (query || '').trim());
    this._load();
  }

  _empty(title, desc) {
    this.contentHost.innerHTML = `<div class="list-empty"><div class="glyph">${icon('spark')}</div><h3>${escapeHTML(t(title))}</h3><p>${escapeHTML(t(desc))}</p></div>`;
  }
}

function escapeHTML(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function attr(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
