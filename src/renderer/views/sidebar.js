'use strict';
/**
 * RobinRead（知更）— 侧栏视图
 *
 * - 「阅读」分组：今天 / 未读 / 收藏（三个智能行）
 * - 账户分组（可折叠，状态持久化）：根订阅 + 文件夹（DisclosureGroup 可折叠）
 * - Feed 行：favicon（失败回退首字母徽章）+ 未读数；拖拽归类到文件夹
 * - 文件夹行：单击选中；再次单击折叠/展开；右键（全部已读/重命名/删除）
 * - 底栏：设置齿轮 + NEW 版本胶囊（可忽略）
 */
import { t } from '../i18n.js';
import { icon } from '../icons.js';

export class SidebarView {
  constructor(scrollEl, footerEl, handlers) {
    this.scrollEl = scrollEl;
    this.footerEl = footerEl;
    this.handlers = handlers;
    this.handlers.onOpenStore = handlers.onOpenStore || (() => {});
    this.handlers.onOpenKnowledge = handlers.onOpenKnowledge || (() => {});
    this.handlers.onOpenEvolution = handlers.onOpenEvolution || (() => {});
    this.handlers.onOpenAihot = handlers.onOpenAihot || (() => {});
    this.collapsedAccounts = new Set(JSON.parse(localStorage.getItem('robinread.collapsedAccounts') || '[]'));
    this.collapsedFolders = new Set(JSON.parse(localStorage.getItem('robinread.collapsedFolders') || '[]'));
    this.selectedFeedIDs = new Set();
    this.lastData = null;
    this.lastCounts = null;
    this.lastScope = null;
    this._buildFooter();
  }

  // MARK: - 渲染

  render(sidebar, counts, scope) {
    this.lastData = sidebar;
    this.lastCounts = counts;
    this.lastScope = scope;
    this.scrollEl.innerHTML = '';
    this.selectedFeedIDs.clear();

    const hasAnyAccount = sidebar.length > 0;
    const hasAnyFeed = sidebar.some((account) => (account.rootFeeds?.length || 0) + (account.folders?.length || 0) > 0);
    if (!hasAnyAccount) {
      this.scrollEl.appendChild(this.emptyState(
        t('未启用任何账号'),
        t('请前往“设置 -> 账号”启用本地或 FreshRSS 订阅账号。'),
        'personX'
      ));
      return;
    }

    // 阅读（智能行）
    const readingSection = document.createElement('div');
    readingSection.className = 'sidebar-section';
    readingSection.appendChild(this.sectionHeader(t('阅读'), null));
    const readingGroup = document.createElement('div');
    readingGroup.className = 'sidebar-group';
    readingGroup.appendChild(this.smartRow('today', t('今天'), 'sun', counts?.todayUnread ?? 0, scope));
    readingGroup.appendChild(this.smartRow('unread', t('未读'), 'circle', counts?.allUnread ?? 0, scope));
    readingGroup.appendChild(this.smartRow('starred', t('收藏'), 'star', counts?.starred ?? 0, scope));
    readingSection.appendChild(readingGroup);
    this.scrollEl.appendChild(readingSection);

    if (!hasAnyFeed) {
      this.scrollEl.appendChild(this.emptyState(
        t('还没有订阅'),
        t('添加一个 RSS 地址，或导入 OPML 文件。'),
        'radioDot',
        t('添加订阅'),
        () => this.handlers.onOpenAddFeed?.()
      ));
      return;
    }

    for (const accountGroup of sidebar) {
      this.scrollEl.appendChild(this.accountSection(accountGroup, counts, scope));
    }
    bindFaviconFallback(this.scrollEl);
  }

  rerender() {
    if (this.lastData) this.render(this.lastData, this.lastCounts, this.lastScope);
  }

  sectionHeader(title, accountID) {
    const header = document.createElement('div');
    header.className = 'sidebar-header';
    if (accountID && this.collapsedAccounts.has(accountID)) header.classList.add('collapsed');
    header.innerHTML = `<span class="disclosure">${icon('chevronMenuRight')}</span><span></span>`;
    header.querySelector('span:last-child').textContent = title;
    if (accountID != null) {
      header.addEventListener('click', () => {
        this._toggleSet(this.collapsedAccounts, accountID, 'robinread.collapsedAccounts');
        header.classList.toggle('collapsed');
        const group = header.nextElementSibling;
        if (group) group.style.display = this.collapsedAccounts.has(accountID) ? 'none' : '';
      });
    }
    return header;
  }

  accountSection(accountGroup, counts, scope) {
    const account = accountGroup.account;
    const isLocal = account.type === 'local';
    const section = document.createElement('div');
    section.className = 'sidebar-section';

    section.appendChild(this.sectionHeader(isLocal ? t('我的 Mac') : account.displayName, account.id));

    const group = document.createElement('div');
    group.className = 'sidebar-group';
    if (this.collapsedAccounts.has(account.id)) group.style.display = 'none';

    // 根订阅（在文件夹之前，对应 store.rootFeeds + onMove）
    for (const feed of accountGroup.rootFeeds || []) {
      group.appendChild(this.feedRow(feed, account, counts, scope, { inFolder: false }));
    }

    // 文件夹
    for (const folder of accountGroup.folders || []) {
      group.appendChild(this.folderRow(folder, accountGroup, counts, scope));
    }

    section.appendChild(group);
    return section;
  }

  smartRow(kind, label, iconName, count, scope) {
    const row = document.createElement('div');
    row.className = 'sidebar-row';
    row.dataset.scope = kind;
    if (scope?.kind === kind) row.classList.add('selected');
    row.innerHTML = `${icon(iconName)}<span class="sidebar-label"></span><span class="sidebar-count" style="visibility:hidden"></span>`;
    row.querySelector('.sidebar-label').textContent = label;
    this._bindCount(row, count);
    row.addEventListener('click', () => this.handlers.onSelect({ kind }));
    return row;
  }

  folderRow(folder, accountGroup, counts, scope) {
    const account = accountGroup.account;
    const key = `${account.id}::${folder.name}`;
    const collapsed = this.collapsedFolders.has(key);

    const wrapper = document.createElement('div');
    wrapper.className = `sidebar-folder ${collapsed ? 'collapsed' : ''}`;
    wrapper.dataset.folderId = folder.id;

    // 「订阅源」拖拽头（仅本地账户根区展示，对应 SubscriptionsHeaderView 的移出文件夹语义放在文件夹内）
    const row = document.createElement('div');
    row.className = 'sidebar-row sidebar-folder-row';
    const selected = scope?.kind === 'folder' && scope.accountID === account.id && scope.folderName === folder.name;
    if (selected) row.classList.add('selected');

    const folderCount = counts?.unreadByFolder?.[`${account.id}::${folder.name}`] ?? 0;
    row.innerHTML = `
      <span class="sidebar-disclosure">${icon('chevronMenuRight')}</span>
      ${icon('folder')}
      <span class="sidebar-label"></span>
      <span class="sidebar-count" style="visibility:hidden"></span>
    `;
    row.querySelector('.sidebar-label').textContent = folder.name;
    this._bindCount(row, folderCount);

    // 单击选中；选中态再次单击切换折叠（1:1 对应 folderRow.onTapGesture）
    row.addEventListener('click', (event) => {
      if (event.target.closest('.sidebar-disclosure')) {
        this.toggleFolder(key, wrapper);
        return;
      }
      const isCurrent = scope?.kind === 'folder' && scope.accountID === account.id && scope.folderName === folder.name;
      if (isCurrent) {
        this.toggleFolder(key, wrapper);
      } else {
        this.handlers.onSelect({ kind: 'folder', accountID: account.id, folderName: folder.name });
      }
    });
    row.querySelector('.sidebar-disclosure').addEventListener('click', (event) => {
      event.stopPropagation();
      this.toggleFolder(key, wrapper);
    });
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.handlers.onFolderContext(event, { folder, account });
    });
    this._bindDrop(row, (feedIDs) => this.handlers.onMoveFeeds(feedIDs, folder.name), () => {
      this._removeFromCollapsed(key);
    });
    wrapper.appendChild(row);

    const children = document.createElement('div');
    children.className = 'sidebar-folder-children';
    if (collapsed) children.style.display = 'none';
    for (const feed of folder.feeds || []) {
      children.appendChild(this.feedRow(feed, account, counts, scope, { inFolder: true }));
    }
    wrapper.appendChild(children);
    return wrapper;
  }

  toggleFolder(key, wrapper) {
    const collapsed = !this.collapsedFolders.has(key);
    this._toggleSet(this.collapsedFolders, key, 'robinread.collapsedFolders', collapsed);
    wrapper.classList.toggle('collapsed', collapsed);
    const children = wrapper.querySelector('.sidebar-folder-children');
    if (children) children.style.display = collapsed ? 'none' : '';
  }

  _removeFromCollapsed(key) {
    this.collapsedFolders.delete(key);
    this._persist('robinread.collapsedFolders', this.collapsedFolders);
  }

  feedRow(feed, account, counts, scope, { inFolder }) {
    const row = document.createElement('div');
    row.className = 'sidebar-row';
    row.dataset.feedId = feed.id;
    row.dataset.accountId = account.id;
    if (scope?.kind === 'feed' && scope.feedID === feed.id) row.classList.add('selected');

    const iconHTML = faviconHTML(feed);
    row.innerHTML = `${iconHTML}<span class="sidebar-label"></span><span class="sidebar-count" style="visibility:hidden"></span>`;
    row.querySelector('.sidebar-label').textContent = feed.title;
    this._bindCount(row, counts?.unreadByFeed?.[feed.id] ?? 0);

    row.addEventListener('click', (event) => {
      if (event.ctrlKey || event.metaKey) {
        // 多选（对应 List 多选 → .feeds scope）
        if (this.selectedFeedIDs.has(feed.id)) this.selectedFeedIDs.delete(feed.id);
        else this.selectedFeedIDs.add(feed.id);
        this._refreshMultiSelect();
        if (this.selectedFeedIDs.size >= 2) {
          this.handlers.onSelect({ kind: 'feeds', feedIDs: [...this.selectedFeedIDs] });
        } else if (this.selectedFeedIDs.size === 1) {
          this.handlers.onSelect({ kind: 'feed', feedID: [...this.selectedFeedIDs][0] });
        }
        return;
      }
      this.selectedFeedIDs.clear();
      this._refreshMultiSelect();
      this.handlers.onSelect({ kind: 'feed', feedID: feed.id });
    });
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.handlers.onFeedContext(event, { feed, selectedFeedIDs: this.selectedFeedIDs, account });
    });

    // 拖拽源（对应 .draggable）
    row.draggable = true;
    row.addEventListener('dragstart', (event) => {
      const ids = this.selectedFeedIDs.has(feed.id) && this.selectedFeedIDs.size > 1
        ? [...this.selectedFeedIDs] : [feed.id];
      event.dataTransfer.setData('application/x-robinread-feeds', JSON.stringify(ids));
      event.dataTransfer.effectAllowed = 'move';
    });

    // 根区行作为「移出文件夹」目标（对应根 Section 的 dropDestination）
    if (!inFolder) {
      this._bindDrop(row, (feedIDs) => this.handlers.onMoveFeeds(feedIDs, null));
    }
    return row;
  }

  _refreshMultiSelect() {
    this.scrollEl.querySelectorAll('.sidebar-row[data-feed-id]').forEach((row) => {
      row.classList.toggle('selected', this.selectedFeedIDs.has(row.dataset.feedId));
    });
  }

  _bindCount(row, count) {
    const el = row.querySelector('.sidebar-count');
    if (count > 0) {
      el.textContent = count > 999 ? '999+' : String(count);
      el.style.visibility = 'visible';
    } else {
      el.style.visibility = 'hidden';
    }
  }

  _bindDrop(element, onDrop, onDropSuccess) {
    element.addEventListener('dragover', (event) => {
      if (event.dataTransfer.types.includes('application/x-robinread-feeds')) {
        event.preventDefault();
        element.classList.add('drop-target');
      }
    });
    element.addEventListener('dragleave', () => element.classList.remove('drop-target'));
    element.addEventListener('drop', (event) => {
      element.classList.remove('drop-target');
      const raw = event.dataTransfer.getData('application/x-robinread-feeds');
      if (!raw) return;
      event.preventDefault();
      try {
        const ids = JSON.parse(raw);
        if (Array.isArray(ids) && ids.length) {
          onDrop(ids);
          onDropSuccess?.();
        }
      } catch (_) { /* 忽略非法数据 */ }
    });
  }

  _toggleSet(set, key, storageKey, force) {
    const shouldCollapse = force !== undefined ? force : !set.has(key);
    if (shouldCollapse) set.add(key);
    else set.delete(key);
    this._persist(storageKey, set);
  }

  _persist(storageKey, set) {
    localStorage.setItem(storageKey, JSON.stringify([...set]));
  }

  emptyState(title, message, glyph, actionLabel, onAction) {
    const el = document.createElement('div');
    el.className = 'list-empty';
    el.innerHTML = `<div class="glyph">${icon(glyph)}</div><h3></h3><p></p>`;
    el.querySelector('h3').textContent = title;
    el.querySelector('p').textContent = message;
    if (actionLabel) {
      const button = document.createElement('button');
      button.className = 'btn-text primary';
      button.textContent = actionLabel;
      button.addEventListener('click', onAction);
      el.appendChild(button);
    }
    return el;
  }

  // MARK: - 底栏（settingsFooter 1:1）

  _buildFooter() {
    this.footerEl.innerHTML = '';

    const nav = document.createElement('div');
    nav.className = 'footer-nav';

    // 账号入口（导航条首位，头像/人形图标按钮，与其它入口同占一列，
    // 详细信息放 title，避免挤占侧栏横向空间）
    this.accountBtn = document.createElement('button');
    this.accountBtn.className = 'footer-nav-btn footer-account-btn';
    nav.appendChild(this.accountBtn);
    this.updateAccount(null);

    const storeBtn = document.createElement('button');
    storeBtn.className = 'footer-nav-btn';
    storeBtn.title = t('浏览订阅商店');
    storeBtn.innerHTML = `${icon('store')}<span class="nav-label"></span>`;
    storeBtn.querySelector('.nav-label').textContent = t('商店');
    storeBtn.addEventListener('click', () => this.handlers.onOpenStore());
    nav.appendChild(storeBtn);

    const aihotBtn = document.createElement('button');
    aihotBtn.className = 'footer-nav-btn';
    aihotBtn.title = t('AI 热点榜');
    aihotBtn.innerHTML = `${icon('flame')}<span class="nav-label"></span>`;
    aihotBtn.querySelector('.nav-label').textContent = t('热点');
    aihotBtn.addEventListener('click', () => this.handlers.onOpenAihot());
    nav.appendChild(aihotBtn);

    const knowledgeBtn = document.createElement('button');
    knowledgeBtn.className = 'footer-nav-btn';
    knowledgeBtn.title = t('知识中心 (Ctrl+K)');
    knowledgeBtn.innerHTML = `${icon('spark')}<span class="nav-label"></span>`;
    knowledgeBtn.querySelector('.nav-label').textContent = t('知识');
    knowledgeBtn.addEventListener('click', () => this.handlers.onOpenKnowledge());
    nav.appendChild(knowledgeBtn);

    const evoBtn = document.createElement('button');
    evoBtn.className = 'footer-nav-btn';
    evoBtn.title = t('自进化面板');
    evoBtn.innerHTML = `${icon('heart')}<span class="nav-label"></span>`;
    evoBtn.querySelector('.nav-label').textContent = t('进化');
    evoBtn.addEventListener('click', () => this.handlers.onOpenEvolution());
    nav.appendChild(evoBtn);

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'footer-nav-btn';
    settingsBtn.title = t('设置');
    settingsBtn.innerHTML = `${icon('gear')}<span class="nav-label"></span>`;
    settingsBtn.querySelector('.nav-label').textContent = t('设置');
    settingsBtn.addEventListener('click', () => this.handlers.onOpenSettings());
    nav.appendChild(settingsBtn);

    this.footerEl.appendChild(nav);
    this.updateBadgeHost = document.createElement('span');
    this.footerEl.appendChild(this.updateBadgeHost);
  }

  /** 账号入口按钮：未登录=人形图标；已登录=头像（会员加金圈）。昵称与状态放 title。 */
  updateAccount(account) {
    if (!this.accountBtn) return;
    const btn = this.accountBtn;
    btn.classList.toggle('is-member', !!(account && account.is_member));
    if (account) {
      btn.title = `${account.nickname || t('已登录')} · ${
        account.is_member ? (account.member_until === 'lifetime' ? t('终身会员') : t('会员有效')) : t('免费版')}`;
      btn.innerHTML = account.avatar_url
        ? `<span class="acct-mini-avatar"><img src="${attr(account.avatar_url)}" referrerpolicy="no-referrer"/></span>`
        : icon('person');
    } else {
      btn.title = t('登录 / 开通会员');
      btn.innerHTML = icon('person');
    }
    if (!btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => this.handlers.onOpenAccount?.());
    }
  }

  showUpdateBadge(release) {
    if (!this.updateBadgeHost) return;
    const version = String(release.tagName || '').replace(/^v/i, '');
    const capsule = document.createElement('span');
    capsule.className = 'update-capsule';
    capsule.title = tf_('点击前往下载新版本 v{0}', version);
    capsule.innerHTML = `<span>NEW</span><span class="ver"></span><span class="dismiss" title="${attr(t('不再提示此版本更新'))}">✕</span>`;
    capsule.querySelector('.ver').textContent = `v${version}`;
    capsule.addEventListener('click', (event) => {
      if (event.target.closest('.dismiss')) {
        this.handlers.onIgnoreVersion(release.tagName || version);
        capsule.remove();
        return;
      }
      this.handlers.onOpenUpdate(release.htmlURL);
    });
    this.updateBadgeHost.innerHTML = '';
    this.updateBadgeHost.appendChild(capsule);
  }

  // 轻量计数更新（不重建 DOM）
  updateCounts(counts, updateInfo) {
    this.lastCounts = counts;
    this.scrollEl.querySelectorAll('.sidebar-row[data-feed-id]').forEach((row) => {
      this._bindCount(row, counts?.unreadByFeed?.[row.dataset.feedId] ?? 0);
    });
    const smartRows = this.scrollEl.querySelectorAll('.sidebar-row[data-scope]');
    const map = { today: counts?.todayUnread ?? 0, unread: counts?.allUnread ?? 0, starred: counts?.starred ?? 0 };
    smartRows.forEach((row) => this._bindCount(row, map[row.dataset.scope] ?? 0));
  }
}

function faviconHTML(feed) {
  const url = feedIconURL(feed);
  if (url) {
    // CSP 禁内联脚本：失败兜底（替换为首字母徽标）由 bindFaviconFallback 统一挂载
    return `<span class="sidebar-icon"><img src="${attr(url)}" referrerpolicy="no-referrer" loading="lazy" data-fallback-letter="${attr(letter(feed.title))}"/></span>`;
  }
  return `<span class="sidebar-icon"><span class="favicon-badge">${attr(letter(feed.title))}</span></span>`;
}

/** favicon 加载失败 → 首字母徽标（含缓存已失败的同步态）。 */
export function bindFaviconFallback(scope) {
  (scope || document).querySelectorAll('img[data-fallback-letter]').forEach((img) => {
    if (img.dataset.fallbackBound === '1') return;
    img.dataset.fallbackBound = '1';
    const swap = () => {
      const badge = document.createElement('span');
      badge.className = 'favicon-badge';
      badge.textContent = img.dataset.fallbackLetter || '?';
      img.replaceWith(badge);
    };
    if (img.complete && img.naturalWidth === 0) swap();
    else img.addEventListener('error', swap, { once: true });
  });
}

export function feedIconURL(feed) {
  if (feed.storedIconURL) return feed.storedIconURL;
  let host = null;
  try {
    host = (feed.siteURL ? new URL(feed.siteURL).hostname : null)
      || (feed.feedURL ? new URL(feed.feedURL).hostname : null);
  } catch (_) { host = null; }
  if (!host) return null;
  host = host.toLowerCase();
  const path = (feed.feedURL || '').toLowerCase();
  if (host.includes('twitter.com') || host.includes('x.com') || path.includes('/twitter/') || path.startsWith('/twitter') || path.includes('/x/')) {
    return 'https://abs.twimg.com/favicons/twitter.3.ico';
  }
  return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
}

function letter(title) {
  return (String(title || '?').trim()[0] || '?').toUpperCase();
}

function attr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function tf_(template, ...args) {
  let index = 0;
  return template.replace(/\{0\}|%lld|%@/g, () => String(args[index++] ?? ''));
}
