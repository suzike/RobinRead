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
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { feedIconURL } from './sidebar.js';

const PAGE_SIZE = 100;

export class ListView {
  constructor(scrollEl, handlers) {
    this.scrollEl = scrollEl;
    this.handlers = handlers; // onSelect / onContext / onLoadMore / onSearch / onDigest
    this.items = [];
    this.scope = null;
    this.selectedID = null;

    // 顶部 inset（毛玻璃 + 标题，对应 safeAreaInset header）
    this.scrollEl.innerHTML = '';
    this.topInset = document.createElement('div');
    this.topInset.className = 'list-top-inset';
    this.topInset.innerHTML = `
      <div class="list-top-title"></div>
      <div class="tb-spring"></div>
      <button class="digest-btn" id="digest-btn" title="${escapeHTML(t('AI 汇总今日全部文章'))}">${icon('spark')}<span></span></button>
      <div class="list-search" id="list-search">
        ${icon('search')}
        <input type="text" placeholder="${escapeHTML(t('搜索…'))}" id="list-search-input" spellcheck="false"/>
        <button class="clear" id="list-search-clear">${icon('close')}</button>
      </div>`;
    this.topInset.querySelector('#digest-btn span').textContent = t('今日简报');
    this.searchInput = this.topInset.querySelector('#list-search-input');
    this.searchHost = this.topInset.querySelector('#list-search');
    let searchTimer = null;
    this.searchInput.addEventListener('input', () => {
      this.searchHost.classList.toggle('has-value', Boolean(this.searchInput.value));
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => this.handlers.onSearch?.(this.searchInput.value.trim()), 260);
    });
    this.searchInput.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { this.clearSearch(); this.handlers.onSearch?.(''); }
    });
    this.topInset.querySelector('#list-search-clear').addEventListener('click', () => {
      this.clearSearch();
      this.handlers.onSearch?.('');
    });
    this.topInset.querySelector('#digest-btn').addEventListener('click', () => this.handlers.onDigest?.());
    this.scrollEl.appendChild(this.topInset);
    this.rowsHost = document.createElement('div');
    this.scrollEl.appendChild(this.rowsHost);

    this.scrollEl.addEventListener('scroll', () => this._onScroll(), { passive: true });
  }

  render(items, scope, selectedID, hasUnread) {
    this.items = items;
    this.scope = scope;
    this.selectedID = selectedID;
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
      } else {
        empty.innerHTML = `<div class="glyph">${icon('newspaper')}</div><h3></h3><p></p>`;
        empty.querySelector('h3').textContent = t('没有文章');
        empty.querySelector('p').textContent = t(hasFeeds ? '切换到其他分类，或等待下一次订阅更新。' : '添加订阅后，这里会显示文章。');
      }
      this.rowsHost.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    const clusters = clusterSimilar(items);
    for (const entry of clusters) {
      if (entry.type === 'cluster') {
        fragment.appendChild(this.clusterRow(entry));
      } else {
        fragment.appendChild(this.rowFor(entry.item));
      }
    }
    this.rowsHost.appendChild(fragment);
    this.markSelected(selectedID);
  }

  titleForScope(scope) {
    if (!scope) return '';
    switch (scope.kind) {
      case 'today': return t('今天');
      case 'unread': return t('未读');
      case 'starred': return t('收藏');
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
    const showSummary = shouldShowSummary(item.title, item.summaryPreview);
    row.className = `entry-row ${item.isRead ? 'read' : 'unread'} ${item.isStarred ? 'starred' : ''} ${showSummary ? 'has-summary' : ''}`;
    row.dataset.entryId = item.id;

    const favicon = item.feedIconURL
      ? `<img class="entry-favicon" src="${attr(item.feedIconURL)}" referrerpolicy="no-referrer" loading="lazy"/>`
      : `<span class="entry-favicon"></span>`;
    const badge = accountBadge(item);

    const totalChars = (item.title || '').length + (item.summaryPreview || '').length;
    const readMinutes = Math.max(1, Math.round(totalChars / 300));
    const score = Math.max(1, Math.min(5, item.score ?? 3));
    const dots = Array.from({ length: 5 }, (_, i) => `<i class="${i < score ? 'on' : ''}"></i>`).join('');
    row.innerHTML = `
      <span class="entry-unread-dot" title="${attr(t(item.isRead ? '已读' : '未读'))}"></span>
      <div class="entry-body">
        <div class="entry-title"></div>
        ${showSummary ? '<div class="entry-summary"></div>' : ''}
        <div class="entry-meta">
          ${favicon}
          <span class="entry-source"></span>
          ${badge ? `<span class="entry-account-badge"></span>` : ''}
          ${item.isStarred ? `<span class="star-mini">${icon('starFilled')}</span>` : ''}
          <span class="quality-dots" data-score="${score}" title="${attr(t('信噪评分'))} ${score}/5">${dots}</span>
          <span class="read-time">${readMinutes} min</span>
          <span class="entry-time">${escapeHTML(formatTime(item.publishedAt))}</span>
        </div>
      </div>
    `;
    row.querySelector('.entry-title').textContent = item.title || t('未命名文章');
    if (showSummary) row.querySelector('.entry-summary').textContent = item.summaryPreview;
    row.querySelector('.entry-source').textContent = item.sourceTitle;
    if (badge) row.querySelector('.entry-account-badge').textContent = badge;
    // CSP 禁内联脚本：favicon 加载失败兜底在这里挂监听（含缓存已失败的同步态）
    const fav = row.querySelector('img.entry-favicon');
    if (fav) {
      const hide = () => { fav.style.display = 'none'; };
      if (fav.complete && fav.naturalWidth === 0) hide();
      else fav.addEventListener('error', hide, { once: true });
    }

    row.addEventListener('click', () => this.handlers.onSelect(item.id, item));
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.handlers.onContext(event, item);
    });
    return row;
  }

  clusterRow(cluster) {
    const row = document.createElement('div');
    row.className = 'cluster-row';
    row.innerHTML = `<span class="cluster-count">${cluster.items.length}</span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>
      <span class="entry-time">${escapeHTML(formatTime(cluster.items[0].publishedAt))}</span>`;
    row.querySelector('span:nth-child(2)').textContent = cluster.items[0].title;
    row.title = t('多源相似报道，点击展开');
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
    const fragment = document.createDocumentFragment();
    for (const item of items) fragment.appendChild(this.rowFor(item));
    this.rowsHost.appendChild(fragment);
  }

  markSelected(entryID) {
    this.selectedID = entryID;
    this.rowsHost.querySelectorAll('.entry-row.selected').forEach((el) => el.classList.remove('selected'));
    if (!entryID) return;
    const row = this.rowForEntry(entryID);
    if (row) row.classList.add('selected');
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

  clearSearch() {
    if (this.searchInput) this.searchInput.value = '';
    this.searchHost?.classList.remove('has-value');
  }

  setDigestVisible(visible) {
    const btn = this.topInset?.querySelector('#digest-btn');
    if (btn) btn.style.display = visible ? '' : 'none';
  }

  setSearchMode(active) {
    this.topInset?.classList.toggle('search-mode', active);
  }

  /** 状态变更：仅打补丁（读/星），不重建（对应 patchEntryState）。 */
  updateItems(items, selectedID) {
    const byID = new Map(items.map((item) => [item.id, item]));
    for (const row of this.rowsHost.querySelectorAll('.entry-row')) {
      const next = byID.get(row.dataset.entryId);
      if (!next) continue;
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
    }
    if (selectedID) this.markSelected(selectedID);
  }

  _onScroll() {
    // 滚动接近底部 → 加载下一页（对应 onAppear loadNextPage）
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
