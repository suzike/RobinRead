'use strict';
/**
 * RobinRead（知更）— 设置窗口（8 分区 1:1）与 Sheet 对话框
 *
 * 分区（对应 SettingsSection）：外观 / 账号 / AI 功能 / 刷新 / 语言 / 同步 / 反馈 / 关于
 */
import { t, tf } from '../i18n.js';
import { icon } from '../icons.js';
import { FEED_REFRESH_INTERVALS_META } from '../refresh-intervals.js';
import { promptBox, confirmBox, alertBox } from '../ui-prompt.js';

const SECTIONS = [
  { id: 'appearance', title: '外观', icon: 'appearance' },
  { id: 'accounts', title: '账号', icon: 'person' },
  { id: 'ai', title: 'AI 功能', icon: 'ai' },
  { id: 'refresh', title: '刷新', icon: 'refresh' },
  { id: 'language', title: '语言', icon: 'globe' },
  { id: 'sync', title: '同步', icon: 'cloud' },
  { id: 'feedback', title: '反馈', icon: 'heart' },
  { id: 'about', title: '关于', icon: 'info' },
];

// 产品官网（关于 / 反馈页入口，主进程更新检查源同源）
const WEBSITE_URL = 'https://ronbinread-d9gmsqi2vc0a18f04-1401273698.tcloudbaseapp.com/';

function websiteButton(labelKey, url = WEBSITE_URL) {
  const button = document.createElement('button');
  button.className = 'btn-text bordered';
  button.textContent = t(labelKey);
  button.addEventListener('click', () => window.robin.openLink(url));
  return button;
}

export class SettingsView {
  constructor({ state, views, onAddFreshRSS, onReload, onRefreshState }) {
    this.state = state;
    this.views = views;
    this.handlers = { onAddFreshRSS, onReload, onRefreshState };
    this.section = 'appearance';
  }

  present(section = 'appearance') {
    this.section = SECTIONS.some((s) => s.id === section) ? section : 'appearance';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) this.dismiss();
    });

    this.modal = document.createElement('div');
    this.modal.className = 'modal';
    overlay.appendChild(this.modal);
    document.body.appendChild(overlay);
    this.overlay = overlay;

    this._esc = (event) => { if (event.key === 'Escape') this.dismiss(); };
    document.addEventListener('keydown', this._esc);
    this.render();
  }

  dismiss() {
    document.removeEventListener('keydown', this._esc);
    this.overlay?.remove();
    this.overlay = null;
  }

  refresh() {
    if (this.overlay) this.render();
  }

  render() {
    if (!this.modal) return;
    this.modal.innerHTML = '';

    const sidebar = document.createElement('div');
    sidebar.className = 'modal-sidebar';
    sidebar.innerHTML = `<h2>${escapeHTML(t('设置'))}</h2>`;
    for (const section of SECTIONS) {
      const item = document.createElement('div');
      item.className = `modal-nav-item ${section.id === this.section ? 'active' : ''}`;
      item.innerHTML = `<span class="nav-icon">${icon(section.icon)}</span><span></span>`;
      item.querySelector('span:last-child').textContent = t(section.title);
      item.addEventListener('click', () => {
        this.section = section.id;
        this.render();
      });
      sidebar.appendChild(item);
    }
    this.modal.appendChild(sidebar);

    const main = document.createElement('div');
    main.className = 'modal-main';
    const header = document.createElement('div');
    header.className = 'modal-header';
    header.innerHTML = `<h3></h3>`;
    header.querySelector('h3').textContent = t(SECTIONS.find((s) => s.id === this.section).title);
    const close = document.createElement('button');
    close.className = 'btn icon-only';
    close.innerHTML = icon('close');
    close.addEventListener('click', () => this.dismiss());
    header.appendChild(close);
    main.appendChild(header);

    const scroll = document.createElement('div');
    scroll.className = 'modal-scroll';
    main.appendChild(scroll);
    this.modal.appendChild(main);

    const prefs = this.state.snapshot?.preferences || {};
    const llm = this.state.snapshot?.llm || {};
    switch (this.section) {
      case 'appearance': this._appearance(scroll, prefs); break;
      case 'accounts': this._accounts(scroll); break;
      case 'ai': this._ai(scroll, llm); break;
      case 'refresh': this._refresh(scroll, prefs); break;
      case 'language': this._language(scroll, prefs); break;
      case 'sync': this._sync(scroll); break;
      case 'feedback': this._feedback(scroll); break;
      case 'about': this._about(scroll); break;
      default: break;
    }
  }

  // MARK: 外观

  _appearance(container, prefs) {
    container.appendChild(group(t('颜色主题'), t('选择浅色、深色或自动跟随系统的外观风格。'), [
      row(t('外观模式'), null, segmented(
        [['system', t('自动')], ['light', t('浅色')], ['dark', t('深色')]],
        prefs.appTheme || 'system',
        (value) => window.robin.setTheme(value),
      )),
    ]));

    // ── 主题（提案 + 设计器入口，独立分组）──
    const themeGroup = group(t('主题'), t('OKLCH 三通道调色 · 中国传统色 · 配色关系 · 对比度检测'), []);
    container.appendChild(themeGroup);
    const themeHost = themeGroup.querySelector('.group-rows');

    const themeEntry = document.createElement('div');
    themeEntry.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 16px;';
    const themeIcon = document.createElement('span');
    themeIcon.className = 'setting-icon';
    themeIcon.innerHTML = icon('appearance');
    const themeLabel = document.createElement('div');
    themeLabel.style.flex = '1';
    themeLabel.innerHTML = `<div class="title">${escapeHTML(t('主题设计器'))}</div><div class="desc">${escapeHTML(t('自由调色并实时预览；传统色一键应用'))}</div>`;
    const designerBtn = document.createElement('button');
    designerBtn.className = 'btn-text primary';
    designerBtn.textContent = t('打开设计器…');
    designerBtn.addEventListener('click', () => {
      import('./theme-designer.js').then(({ ThemeDesigner }) => {
        const designer = new ThemeDesigner({
          initialTokens: window.__robinCustomTokens || undefined,
          onApplied: (tokens) => {
            window.__robinCustomTokens = tokens;
            window.dispatchEvent(new CustomEvent('robinread:theme-applied', { detail: tokens }));
          },
          onReset: () => {
            window.__robinCustomTokens = null;
            window.dispatchEvent(new CustomEvent('robinread:theme-reset'));
          },
        });
        designer.present();
      });
    });
    themeEntry.append(themeIcon, themeLabel, designerBtn);
    themeHost.appendChild(themeEntry);

    const proposerHost = document.createElement('div');
    proposerHost.style.cssText = 'border-top:1px solid var(--separator);padding:10px 6px 4px;';
    themeHost.appendChild(proposerHost);
    import('./theme-designer.js').then(({ ThemeProposer }) => {
      const proposer = new ThemeProposer({
        onApply: (tokens, name) => {
          window.__robinCustomTokens = tokens;
          window.dispatchEvent(new CustomEvent('robinread:theme-applied', { detail: tokens, detailName: name }));
        },
        onReset: () => {
          window.__robinCustomTokens = null;
          window.dispatchEvent(new CustomEvent('robinread:theme-reset'));
        },
      });
      proposer.render(proposerHost);
    });

    const presets = row(t('预设字号'), null, (() => {
      const wrap = document.createElement('div');
      wrap.className = 'setting-control';
      for (const [label, size] of [[t('小 (14pt)'), 14], [t('标准 (17pt)'), 17], [t('大 (20pt)'), 20], [t('特大 (23pt)'), 23]]) {
        const button = document.createElement('button');
        button.className = 'btn-text bordered';
        button.textContent = label;
        button.style.color = (prefs.articleFontSize === size) ? 'var(--accent)' : '';
        button.addEventListener('click', async () => {
          await window.robin.setFontSize(size);
          this.handlers.onRefreshState?.();
          this.render();
        });
        wrap.appendChild(button);
      }
      return wrap;
    })());
    container.appendChild(group(t('正文字号'), t('调整文章阅读器中的正文字体大小，支持预设与微调。'), [
      presets,
      row(t('精确调节'), t('范围：13pt ~ 25pt'), (() => {
        const wrap = document.createElement('div');
        wrap.className = 'font-slider setting-control';
        wrap.innerHTML = `<span>${icon('textSmaller')}</span><input type="range" min="13" max="25" step="1"/><span>${icon('textLarger')}</span><span class="pt"></span>`;
        const range = wrap.querySelector('input');
        range.value = prefs.articleFontSize ?? 17;
        wrap.querySelector('.pt').textContent = `${prefs.articleFontSize ?? 17} pt`;
        range.addEventListener('change', async () => {
          await window.robin.setFontSize(Number(range.value));
          wrap.querySelector('.pt').textContent = `${range.value} pt`;
          this.handlers.onRefreshState?.();
        });
        return wrap;
      })()),
    ]));

    // ── 阅读排版 ──
    const layout = prefs.readerLayout || { fontFamily: 'serif', pageWidth: 'standard', lineHeight: 'standard', listDensity: 'comfortable' };
    container.appendChild(group(t('阅读排版'), t('字体、页宽、行距与列表密度，即刻生效并跨重启保持。'), [
      row(t('正文字体'), null, selectControl(
        [['serif', t('衬线（默认）')], ['sans', t('无衬线')]],
        layout.fontFamily || 'serif',
        async (value) => { await window.robin.setReaderLayout({ fontFamily: value }); this.handlers.onRefreshState?.(); },
      )),
      row(t('页面宽度'), null, selectControl(
        [['narrow', t('窄')], ['standard', t('标准')], ['wide', t('宽')]],
        layout.pageWidth || 'standard',
        async (value) => { await window.robin.setReaderLayout({ pageWidth: value }); this.handlers.onRefreshState?.(); },
      )),
      row(t('行距'), null, selectControl(
        [['compact', t('紧凑')], ['standard', t('标准')], ['loose', t('宽松')]],
        layout.lineHeight || 'standard',
        async (value) => { await window.robin.setReaderLayout({ lineHeight: value }); this.handlers.onRefreshState?.(); },
      )),
      row(t('列表密度'), t('紧凑模式隐藏摘要，仅显示标题行。'), selectControl(
        [['comfortable', t('舒适')], ['compact', t('紧凑')]],
        layout.listDensity || 'comfortable',
        async (value) => { await window.robin.setReaderLayout({ listDensity: value }); this.handlers.onRefreshState?.(); },
      )),
      toggleRow(t('英文文章自动 AI 精读'), t('默认关闭：打开英文文章不自动翻译，点阅读器「翻译」按钮手动触发；开启后打开英文文章自动翻译。'), layout.autoTranslateEnglish === true, async (v) => {
        await window.robin.setReaderLayout({ autoTranslateEnglish: v });
        this.handlers.onRefreshState?.();
      }),
      row(t('AI 精读默认模式'), t('自动精读开启时使用的显示方式；手动点击翻译按钮也从该模式开始。'), selectControl(
        [['bilingual', t('双语对照')], ['zh', t('仅中文')]],
        layout.translateMode && layout.translateMode !== 'off' ? layout.translateMode : 'bilingual',
        async (value) => { await window.robin.setReaderLayout({ translateMode: value }); this.handlers.onRefreshState?.(); },
      )),
    ]));

    // ── 过滤与降噪 ──（注意路径：filterRules 在 snapshot.preferences 下）
    const rules = this.state.snapshot?.preferences?.filterRules || { minScore: 1, blockKeywords: [], boostKeywords: [], personalization: 2 };
    container.appendChild(group(t('过滤与降噪'), t('信噪评分自动为每篇文章打 1-5 分（标题党扣分、内容充实加分）；低于阈值的内容不再出现在列表。'), [
      row(t('最低信噪分'), t('1 = 不过滤；建议 2-3 降噪。'), selectControl(
        [['1', t('1 · 全部显示')], ['2', t('2 · 轻度降噪')], ['3', t('3 · 推荐')], ['4', t('4 · 只看优质')], ['5', t('5 · 极严')]],
        String(rules.minScore ?? 1),
        async (value) => { await window.robin.setFilterRules({ minScore: Number(value) }); this.handlers.onReload?.(); },
      )),
      inputRow(t('屏蔽词'), t('命中即大幅降分。逗号或换行分隔。'), t('例如：广告, 软文, 震惊'), (rules.blockKeywords || []).join(', '),
        (value) => window.robin.setFilterRules({ blockKeywords: value })),
      inputRow(t('加权词'), t('命中即加分置前。逗号或换行分隔。'), t('例如：LLM, Rust, Simulink'), (rules.boostKeywords || []).join(', '),
        (value) => window.robin.setFilterRules({ boostKeywords: value })),
      row(t('个性化强度'), t('越强，命中你兴趣标签的文章越靠前；关闭则完全按时间/信噪排序。'), selectControl(
        [['0', t('关闭')], ['1', t('轻度')], ['2', t('标准（推荐）')], ['3', t('强')]],
        String(rules.personalization ?? 2),
        async (value) => { await window.robin.setFilterRules({ personalization: Number(value) }); this.handlers.onReload?.(); },
      )),
    ]));

    // 实时预览
    const preview = document.createElement('div');
    preview.className = 'settings-group';
    preview.innerHTML = `<div class="settings-group-header">${escapeHTML(t('实时预览'))}</div>
      <div class="live-preview" style="margin: 8px 16px 14px;">
        <h4 style="font-size:${(prefs.articleFontSize ?? 17) * 1.2}px">${escapeHTML(t('The Morning Digest · 晨间速览'))}</h4>
        <p style="font-size:${prefs.articleFontSize ?? 17}px">${escapeHTML(t('RobinRead 专为沉浸式阅读打造。在保持纸张排版美感的同时，提供舒适的长文阅读体验。字号调整会同步到所有文章。'))}</p>
      </div>`;
    container.appendChild(preview);
  }

  // MARK: 账号

  async _accounts(container) {
    const accounts = this.state.snapshot?.allAccounts || [];

    // RobinRead 账号（登录 + 资料编辑，行式，独立分组）
    const rrGroup = group(t('RobinRead 账号'), '', []);
    container.appendChild(rrGroup);
    await this._renderRobinReadAccount(rrGroup.querySelector('.group-rows'));

    // 当前账号（FreshRSS / 本地）
    const groupEl = group(t('当前账号'), t('RobinRead 支持多账号并行与按需启用。本地订阅与 FreshRSS 远端订阅相互隔离，禁用账号不会删除本地数据或凭据。'), []);
    container.appendChild(groupEl);
    const host = groupEl.querySelector('.group-rows');

    // 同步状态（异步拉取）
    window.robin.getSyncStates().then((result) => {
      if (!result.ok) return;
      for (const el of host.querySelectorAll('.account-sync-line')) {
        const state = result.data[el.dataset.accountId];
        if (!state) continue;
        if (state.lastSyncCompletedAt) {
          el.querySelector('.sync-ok').textContent = tf('上次同步：%@', new Date(state.lastSyncCompletedAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
          el.querySelector('.sync-ok').style.display = '';
        }
        if (state.lastError) {
          el.querySelector('.sync-err').textContent = state.lastError;
          el.querySelector('.sync-err').style.display = '';
        }
      }
    });

    for (const account of accounts) {
      const isLocal = account.type === 'local';
      const card = document.createElement('div');
      card.style.padding = '12px 16px';
      if (!isLocal) card.style.borderTop = '1px solid var(--separator)';
      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;">
          <span class="setting-icon">${icon(isLocal ? 'macDevices' : 'server')}</span>
          <div style="flex:1;min-width:0;">
            <div class="acct-row-title" style="font-size:13.5px;font-weight:600;"></div>
            <div class="acct-row-desc" style="font-size:11.5px;color:var(--text-secondary);"></div>
          </div>
        </div>
      `;
      card.querySelector('.acct-row-title').textContent = isLocal ? t('我的 Mac (本地账号)') : account.displayName;
      card.querySelector('.acct-row-desc').textContent = isLocal ? t('本机独立存储与离线阅读') : `${account.username || ''} @ ${account.endpointURL || ''}`;

      const toggle = toggleControl(account.isEnabled, async (value) => {
        await window.robin.setAccountEnabled(account.id, value);
        this.handlers.onReload?.();
      });
      card.firstElementChild.appendChild(toggle);

      if (!isLocal) {
        const sub = document.createElement('div');
        sub.style.cssText = 'display:flex;align-items:center;gap:8px;padding-left:40px;margin-top:8px;';
        sub.innerHTML = `
          <div class="account-sync-line" data-account-id="${attr(account.id)}" style="flex:1;min-width:0;display:flex;gap:12px;font-size:11px;color:var(--text-secondary);">
            <span class="sync-ok" style="display:none;color:#4e9c51;"></span>
            <span class="sync-err" style="display:none;color:#dd8a1e;"></span>
          </div>`;
        const syncBtn = document.createElement('button');
        syncBtn.className = 'btn-text';
        syncBtn.textContent = t('立即同步');
        syncBtn.disabled = !account.isEnabled;
        syncBtn.addEventListener('click', async () => {
          syncBtn.disabled = true;
          syncBtn.textContent = t('正在同步…');
          await window.robin.syncAccount(account.id);
          syncBtn.textContent = t('立即同步');
          syncBtn.disabled = false;
        });
        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn icon-only';
        removeBtn.innerHTML = icon('trash');
        removeBtn.style.color = '#c93b3b';
        removeBtn.title = t('移除账号');
        removeBtn.addEventListener('click', async () => {
          const ok = await confirmBox(t('确认移除账号？'), { message: t('移除此账号将清除其在 RobinRead 本地同步的数据与凭据，但不会从 FreshRSS 服务器删除或退订您的 Feed。'), okLabel: t('移除'), danger: true });
          if (ok) {
            window.robin.removeAccount(account.id);
            this.handlers.onReload?.();
            this.render();
          }
        });
        sub.append(syncBtn, removeBtn);
        card.appendChild(sub);
      }
      host.appendChild(card);
    }

    const addAction = document.createElement('button');
    addAction.className = 'btn-text primary';
    addAction.style.marginTop = '10px';
    addAction.innerHTML = `${icon('plus')}<span style="margin-left:5px"></span>`;
    addAction.querySelector('span').textContent = t('添加账号…');
    addAction.addEventListener('click', () => this.handlers.onAddFreshRSS?.());
    container.appendChild(plain(actionAddHost(addAction)));
  }

  /** RobinRead 账号：登录 + 资料编辑（头像/昵称/UID/退出登录），行式布局，与设置面板视觉一致。 */
  async _renderRobinReadAccount(host) {
    host.innerHTML = '';
    const { memberStatusLabel } = await import('./account.js');
    const [meR, cfgRaw] = await Promise.all([
      window.robin.accountMe(false).catch(() => null),
      window.robin.accountConfig().catch(() => undefined),
    ]);
    const me = (meR && meR.ok) ? meR.data : { user: null, limits: { feeds: 30, aiPerDay: 3 }, quota: { unlimited: false, used: 0, limit: 3 } };
    const cfg = cfgRaw || { offline: true, wx_login_enabled: false, pay_mock: true, plans: [] };
    const user = me.user;
    const rerender = () => this._renderRobinReadAccount(host);
    const guard = async (fn) => {
      try { await fn(); } catch (err) { await alertBox(t('更新失败'), String(err.error || err.message || err)); }
    };

    if (!user) {
      const { renderAuthForm } = await import('./account.js');
      renderAuthForm(host, { onLogged: () => rerender() });
      return;
    }

    // 头像行（图标位 = 头像，点击或「更换」换图）
    const letter = (String(user.nickname || '?').trim()[0] || '?').toUpperCase();
    const avatar = document.createElement('span');
    avatar.className = 'acct-avatar-sm acct-avatar-clickable';
    avatar.title = t('更换头像');
    avatar.innerHTML = user.avatar_url
      ? `<img src="${attr(user.avatar_url)}" referrerpolicy="no-referrer"/>`
      : escapeHTML(letter);
    avatar.addEventListener('click', () => guard(async () => {
      const dataURL = await window.robin.accountPickAvatar();
      if (!dataURL) return;
      await window.robin.accountUpdateProfile({ avatar_url: dataURL });
      rerender();
    }));
    const avatarCtrl = document.createElement('div');
    avatarCtrl.style.cssText = 'display:flex;align-items:center;gap:8px;';
    avatarCtrl.append(
      linkBtn(t('更换'), () => avatar.click()),
      linkBtn(t('清除'), () => guard(async () => {
        await window.robin.accountUpdateProfile({ avatar_url: '' });
        rerender();
      }), true),
    );
    const avatarRow = row(user.nickname || t('微信用户'), memberStatusLabel(user), avatarCtrl);
    avatarRow.classList.add('with-icon');
    avatarRow.insertBefore(avatar, avatarRow.firstChild);
    host.appendChild(avatarRow);

    // 昵称行
    host.appendChild(row(t('昵称'), user.nickname || t('未设置'), linkBtn(t('修改'), () => guard(async () => {
      const name = await promptBox(t('修改昵称'), { initial: user.nickname || '', placeholder: t('最多 24 个字') });
      if (name == null || name === (user.nickname || '')) return;
      await window.robin.accountUpdateProfile({ nickname: name });
      rerender();
    }))));

    // UID 行
    const copyBtn = linkBtn(t('复制'), async () => {
      await window.robin.copyText(user.uid || '');
      copyBtn.textContent = t('已复制');
      setTimeout(() => { copyBtn.textContent = t('复制'); }, 1200);
    });
    host.appendChild(row(t('UID'), user.uid || '', copyBtn));

    // 会员行
    host.appendChild(row(t('会员'), memberStatusLabel(user), linkBtn(t('会员与套餐'), async () => {
      const { openAccountCenter } = await import('./account.js');
      openAccountCenter();
    })));

    // 退出登录
    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'btn-text danger';
    logoutBtn.textContent = t('退出登录');
    logoutBtn.addEventListener('click', async () => {
      await window.robin.accountLogout();
      rerender();
    });
    host.appendChild(row('', '', logoutBtn));
  }

  // MARK: AI 功能

  _ai(container, llm) {
    const hasKey = this.state.snapshot?.hasAPIKey;
    // LLM 开关/输入统一：保存后刷新快照，切 section 再回来状态不丢
    const setLLMField = (patch) => async (value) => {
      await window.robin.setLLM({ [patch]: value });
      this.handlers.onRefreshState?.();
      this.state.snapshot.llm = { ...(this.state.snapshot.llm || {}), [patch]: value };
    };

    // ── 服务商与连接（多服务商管理）──
    const provGroup = group(t('服务商与连接'), t('可添加多个服务商并一键切换；API Key 只保存在这台设备。切换服务商后请填写对应的 API Key。'), []);
    container.appendChild(provGroup);
    const provHost = provGroup.querySelector('.group-rows');
    this._renderProviders(provHost, llm, hasKey);

    container.appendChild(group('阅读助手：摘要',
      llm.automaticallyGenerateSummary ? t('首次打开尚无摘要的文章时自动生成；已有缓存不会重复请求。') : t('保持手动模式，只在你点击“生成摘要”后请求模型。'), [
      toggleRow('展示 AI 摘要模块', t('关闭后，文章阅读页不显示摘要模块；已生成的摘要不会被删除。'), llm.showsAISummary !== false, setLLMField('showsAISummary')),
      toggleRow('打开文章时自动生成 AI 摘要', t('开启后，打开没有缓存摘要的文章会自动发送正文到模型。'), Boolean(llm.automaticallyGenerateSummary), setLLMField('automaticallyGenerateSummary')),
    ]));

    container.appendChild(group('阅读助手：翻译与划词', t('逐段翻译只处理当前屏幕视口内容；划词功能触发后以浮窗形式呈现。'), [
      inputRow('翻译目标语言', t('你可以自由填入你想翻译成的语言，例如中文、英语、法语等。'), '简体中文', llm.targetLanguage, setLLMField('targetLanguage')),
      toggleRow('划词解释按钮', t('开启后，划词选择文本时展示“直接解释”按钮'), llm.showsSelectionExplanation !== false, setLLMField('showsSelectionExplanation')),
      toggleRow('划词提问按钮', t('开启后，划词选择文本时展示“向 AI 提问”按钮'), llm.showsSelectionAsk !== false, setLLMField('showsSelectionAsk')),
      toggleRow('划词翻译按钮', t('开启后，划词选择文本时展示“翻译”按钮'), llm.showsSelectionTranslation !== false, setLLMField('showsSelectionTranslation')),
    ]));

    container.appendChild(group('个性化 Prompt', t('自定义指令会附加在系统默认 Prompt 之后（例如：“请用通俗易懂的口语解释”或“侧重分析工程实现细节”）。'), [
      textAreaRow(llm.customPrompt || '', setLLMField('customPrompt')),
    ]));

    container.appendChild(group('生成偏好（高级）', t('DeepSeek 会按此选项发送 thinking；选择低、中、高时也会发送对应的 reasoning_effort。'), [
      row('推理偏好', t('仅在服务商明确支持时生效；翻译和划词解释会自动关闭推理。'), selectControl(
        [['自动', t('自动')], ['关闭', t('关闭')], ['低', t('低')], ['中', t('中')], ['高', t('高')]],
        llm.reasoningMode || '自动',
        setLLMField('reasoningMode'),
      )),
    ]));

    container.appendChild(group('连接安全（高级）', t('仅用于模型 Base URL。HTTP 未加密，只有在你信任局域网环境时才建议开启。'), [
      toggleRow('允许局域网 HTTP（不安全）', null, Boolean(llm.allowInsecureLocalEndpoint), setLLMField('allowInsecureLocalEndpoint')),
    ]));
  }

  /** 服务商列表 + 激活/编辑/删除 + 连接设置。 */
  _renderProviders(host, llm, hasKey) {
    host.innerHTML = '';
    // 激活测试状态行（激活服务商后由 _renderProviders 持久渲染）
    if (this._provStatus) {
      const line = document.createElement('div');
      line.className = `prov-status ${this._provStatus.kind}`;
      line.textContent = this._provStatus.text;
      host.appendChild(line);
    }
    window.robin.llmProviders().then((snap) => {
      if (!snap) return;
      const { providers, activeProviderId } = snap;
      const active = providers.find((p) => p.id === activeProviderId) || providers[0];

      for (const p of providers) {
        const isActive = p.id === activeProviderId;
        const card = document.createElement('div');
        card.className = 'prov-card' + (isActive ? ' active' : '');
        card.innerHTML = `
          <div class="prov-card-row">
            <span class="prov-dot"></span>
            <span class="prov-name"></span>
            <span class="prov-model"></span>
            ${isActive ? `<span class="prov-active-badge">${escapeHTML(t('使用中'))}</span>` : ''}
            <span class="prov-actions">
              <button class="btn icon-only prov-edit" title="${escapeHTML(t('编辑'))}">${icon('pencil')}</button>
              ${providers.length > 1 ? `<button class="btn icon-only prov-del" title="${escapeHTML(t('删除'))}">${icon('trash')}</button>` : ''}
            </span>
          </div>`;
        card.querySelector('.prov-name').textContent = p.name;
        card.querySelector('.prov-model').textContent = p.model || '';
        if (!isActive) {
          card.addEventListener('click', async () => {
            await window.robin.llmSetActive(p.id);
            // 激活即测连接：Key 与端点不匹配（401）当场暴露，不再让用户到阅读器里撞墙
            this._provStatus = { kind: 'testing', text: t('已切换到「' + p.name + '」，正在测试连接…') };
            this.handlers.onRefreshState?.();
            this.render();
            try {
              const test = await window.robin.testAI();
              this._provStatus = test.ok
                ? { kind: 'ok', text: t('「' + p.name + '」连接正常 · ') + (test.data?.model || p.model) }
                : { kind: 'bad', text: t('「' + p.name + '」连接失败：') + (test.error || t('请检查该服务商的 Base URL 与 API Key 是否匹配')) };
            } catch (err) {
              this._provStatus = { kind: 'bad', text: t('「' + p.name + '」连接测试未完成：') + (err?.message || '') };
            }
            this.render();
          });
        }
        card.querySelector('.prov-edit').addEventListener('click', async (e) => {
          e.stopPropagation();
          const name = await promptBox(t('服务商名称'), { initial: p.name });
          if (name === null) return;
          const baseURL = await promptBox(t('Base URL'), { initial: p.baseURL || '' });
          if (baseURL === null) return;
          const modelsStr = await promptBox(t('可选模型（逗号分隔，第一个为当前使用）'), { initial: (p.models && p.models.length ? p.models : [p.model].filter(Boolean)).join(', ') });
          if (modelsStr === null) return;
          const models = modelsStr.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
          await window.robin.llmUpdateProvider(p.id, {
            name: name || p.name,
            baseURL: baseURL || p.baseURL,
            models,
            model: models[0] || p.model,
          });
          this.handlers.onRefreshState?.();
          this.render();
        });
        card.querySelector('.prov-del')?.addEventListener('click', async (e) => {
          e.stopPropagation();
          const ok = await confirmBox(t('删除服务商'), { message: t('确定删除服务商「' + p.name + '」吗？'), okLabel: t('删除'), danger: true });
          if (!ok) return;
          await window.robin.llmRemoveProvider(p.id);
          this.handlers.onRefreshState?.();
          this.render();
        });
        host.appendChild(card);
      }

      // 添加服务商
      const addBtn = document.createElement('button');
      addBtn.className = 'btn-text bordered';
      addBtn.style.margin = '10px 16px';
      addBtn.innerHTML = `${icon('plus')}<span style="margin-left:5px">${escapeHTML(t('添加服务商'))}</span>`;
      addBtn.addEventListener('click', async () => {
        const name = await promptBox(t('服务商名称'), { placeholder: '例如：OpenRouter / 本地 Ollama' });
        if (!name) return;
        const baseURL = await promptBox(t('Base URL（OpenAI 兼容）'), { placeholder: 'https://openrouter.ai/api/v1' });
        if (baseURL === null) return;
        const modelsStr = await promptBox(t('可选模型（逗号分隔）'), { placeholder: 'deepseek-chat, gpt-4o-mini' });
        const models = (modelsStr || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
        await window.robin.llmAddProvider({ name, baseURL, model: models[0] || '', models });
        this.handlers.onRefreshState?.();
        this.render();
      });
      host.appendChild(addBtn);

      // 激活服务商的连接设置
      if (active) {
        const conn = document.createElement('div');
        conn.className = 'prov-conn';
        const modelRow = (active.models && active.models.length > 1)
          ? row(t('模型'), null, selectControl(
              active.models.map((m) => [m, m]),
              active.model,
              async (value) => { await window.robin.llmUpdateProvider(active.id, { model: value }); this.handlers.onRefreshState?.(); this.render(); },
            ))
          : inputRow(t('模型'), null, '例如：gpt-4o-mini', active.model, async (value) => {
              await window.robin.llmUpdateProvider(active.id, { model: value });
              this.handlers.onRefreshState?.();
              this.state.snapshot.llm = { ...(this.state.snapshot.llm || {}), model: value };
            });
        conn.appendChild(modelRow);
        conn.appendChild(inputRow('API Key', hasKey ? t('已设置（仅保存在这台设备）') : null, '局域网模型可留空', '', async (value) => {
          await window.robin.setAPIKey(value);
          this.handlers.onRefreshState?.();
        }, { password: true, placeholderFilled: hasKey }));
        conn.appendChild(row('测试连接', t('发送一条最小请求验证服务可用性。'), (() => {
          const wrap = document.createElement('div');
          wrap.className = 'ai-test-wrap';
          const button = document.createElement('button');
          button.className = 'btn-text primary';
          button.innerHTML = `${icon('wand')}<span style="margin-left:5px"></span>`;
          button.querySelector('span').textContent = t('开始测试');
          const status = document.createElement('span');
          status.className = 'ai-test-status';
          status.setAttribute('aria-live', 'polite');
          button.addEventListener('click', async () => {
            button.disabled = true;
            button.classList.add('testing');
            button.querySelector('span').textContent = t('正在测试…');
            status.className = 'ai-test-status';
            status.textContent = '';
            const result = await window.robin.testAI();
            button.disabled = false;
            button.classList.remove('testing');
            button.querySelector('span').textContent = t('重新测试');
            if (result.ok) {
              status.className = 'ai-test-status ok';
              status.innerHTML = `${icon('checkCircle')}<span>${escapeHTML(t('连接成功'))}</span>`;
            } else {
              status.className = 'ai-test-status err';
              status.innerHTML = `${icon('questionCircle')}<span>${escapeHTML(String(result.error || t('连接失败')))}</span>`;
            }
          });
          wrap.append(button, status);
          return wrap;
        })()));
        host.appendChild(conn);
      }
    });
  }

  // MARK: 刷新 / 语言 / 同步 / 反馈 / 关于

  _refresh(container, prefs) {
    container.appendChild(group(t('自动刷新'), t('应用保持打开时按此频率检查订阅；系统后台刷新时间可能会有所延迟。'), [
      row(t('刷新频率'), null, selectControl(
        FEED_REFRESH_INTERVALS_META.map(([value]) => [value, t(value === 'manual' ? '仅手动' : intervalLabel(value))]),
        prefs.refreshInterval || 'manual',
        async (value) => { await window.robin.setRefreshInterval(value); this.handlers.onRefreshState?.(); },
      )),
      toggleRow(t('打开应用时刷新'), null, Boolean(prefs.refreshOnLaunch), async (v) => {
        await window.robin.setRefreshOnLaunch(v);
        this.handlers.onRefreshState?.();
      }),
      row(t('手动刷新'), t('立即检查所有订阅源。'), (() => {
        const button = document.createElement('button');
        button.className = 'btn-text bordered';
        button.textContent = t('刷新所有订阅');
        button.addEventListener('click', async () => {
          button.disabled = true;
          await window.robin.refresh();
          button.disabled = false;
        });
        return button;
      })()),
    ]));
  }

  _language(container, prefs) {
    container.appendChild(group(t('界面语言'), t('默认跟随系统设置；也可以随时在这里切换，应用界面会立即更新。'), [
      row(t('语言选择'), null, selectControl(
        [['system', t('跟随系统')], ['zh', '简体中文'], ['en', 'English']],
        prefs.appLanguage || 'zh',
        async (value) => {
          await window.robin.setLanguage(value === 'system' ? 'zh' : value);
          this.handlers.onRefreshState?.();
          this.render();
        },
      )),
    ]));
  }

  _sync(container) {
    const notice = document.createElement('div');
    notice.className = 'sync-unavailable';
    notice.innerHTML = `
      ${icon('clock')}
      <div><div class="title">${escapeHTML(t('同步功能暂未上线'))}</div>
      <div class="desc">${escapeHTML(t('同步功能正在完善中，正式上线前请继续使用本机数据与 FreshRSS 账号。'))}</div></div>`;
    container.appendChild(notice);

    container.appendChild(group('隐私', null, [
      row('API Key', null, staticText(t('仅存于本机，不参与同步'))),
    ]));
  }

  _feedback(container) {
    const card = document.createElement('div');
    card.className = 'settings-group';
    card.innerHTML = `<div class="settings-group-header">${escapeHTML(t('反馈与共建'))}</div>
      <div style="padding: 16px 18px; display:flex; flex-direction:column; gap:10px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="setting-icon">${icon('heart')}</span>
          <div style="flex:1;">
            <div style="font-size:13.5px;font-weight:600;">${escapeHTML(t('感谢使用 RobinRead'))}</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:3px;line-height:1.6;">${escapeHTML(t('知更是一款本地优先的纸感阅读器。你的每一条使用反馈都会让纸面更安静、更称手。'))}</div>
          </div>
        </div>
        <div style="font-size:11.5px;color:var(--text-tertiary);line-height:1.6;">${escapeHTML(t('知更 RobinRead for Windows —— 本地优先、AI 增强的纸感三栏 RSS 阅读器。'))}</div>
      </div>`;
    container.appendChild(card);

    container.appendChild(group(t('官网'), t('产品介绍、功能一览与最新版本下载。'), [
      row(t('前往官网'), null, websiteButton('前往官网')),
    ]));
  }

  _about(container) {
    const hero = document.createElement('div');
    hero.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px;padding:26px 16px 10px;';
    hero.innerHTML = `
      <img src="../../assets/icon.png" width="88" height="88" style="border-radius:22px;box-shadow:var(--shadow-card);" alt="RobinRead"/>
      <div style="display:flex;align-items:center;gap:6px;margin-top:8px;">
        <span style="font-size:22px;font-weight:700;font-family:var(--font-serif);">RobinRead</span>
        <span style="font-size:10px;font-weight:700;color:var(--accent);background:rgba(97,115,87,0.12);padding:2px 7px;border-radius:999px;">Windows</span>
      </div>
      <div style="font-size:12px;color:var(--text-secondary);">Version ${this.state?.snapshot?.version || ''} · 知更阅读器</div>
      <div style="font-size:12.5px;color:var(--text-secondary);text-align:center;margin-top:6px;">${escapeHTML(t('专为沉浸式阅读打造的 RSS 订阅与 AI 阅读助手。'))}</div>
      <div style="font-size:11.5px;color: var(--accent);">${escapeHTML(t('双语流转，克制智能化。'))}</div>`;
    const siteLink = document.createElement('a');
    siteLink.className = 'about-site-link';
    siteLink.href = WEBSITE_URL;
    siteLink.target = '_blank';
    siteLink.rel = 'noreferrer';
    siteLink.textContent = t('官网：ronbinread.tcloudbaseapp.com');
    hero.appendChild(siteLink);
    container.appendChild(hero);

    container.appendChild(group(t('功能速览'), null, [
      row(t('订阅'), t('本地 + FreshRSS 同步 · 商店 170+ 源 · OPML'), staticText('')),
      row(t('阅读'), t('三栏纸感 · TOC · 禅模式 · 双语对照 · 划词 AI'), staticText('')),
      row(t('降噪'), t('信噪评分 · 关键词规则 · 今日 AI 简报'), staticText('')),
      row(t('主题'), t('OKLCH 设计器 · 中国传统色 · 明暗并排'), staticText('')),
    ]));

    container.appendChild(group(t('官网与更新'), t('新版本发布后，应用会提示更新；也可随时前往官网下载最新安装包。'), [
      row(t('前往官网'), t('产品介绍 · 功能一览 · 下载'), websiteButton('前往官网', WEBSITE_URL)),
      row(t('下载最新版'), null, websiteButton('前往下载', `${WEBSITE_URL}#download`)),
    ]));

    container.appendChild(group(t('关于本机数据'), null, [
      row(t('数据位置'), `%APPDATA%\\RobinRead`, staticText('')),
      row(t('隐私'), t('订阅、文章与 AI 配置全部保存在本机，不经过任何第三方服务器。'), staticText('')),
    ]));
  }
}

// MARK: - Sheet 对话框（AddFeed / AddFolder / RenameFolder / FreshRSS 账号）

export function showAddFeed(folders, onDone) {
  const { overlay, modal } = smallModal(t('添加订阅'));
  const body = modal.querySelector('.sheet-body');

  const urlInput = field(body, t('订阅地址'), 'link', 'https://example.com/feed.xml');
  let httpWarn = null;
  urlInput.addEventListener('input', () => {
    const insecure = urlInput.value.trim().toLowerCase().startsWith('http://');
    if (insecure && !httpWarn) {
      httpWarn = document.createElement('div');
      httpWarn.className = 'http-warning';
      httpWarn.innerHTML = `${icon('info')}<span></span>`;
      httpWarn.querySelector('span').textContent = t('这是未加密的 HTTP 地址，内容可能被网络中间人篡改。仅在你信任该来源时使用。');
      body.insertBefore(httpWarn, urlInput.closest('.sheet-field').nextSibling);
    } else if (!insecure && httpWarn) {
      httpWarn.remove();
      httpWarn = null;
    }
  });
  const folderSelect = selectField(body, t('可选分类'), 'folder',
    [['', t('无分类')], ...folders.map((f) => [f.name, f.name])]);
  hint(body, t('保存后会立即抓取一次 Feed。RobinRead 只保存订阅地址、文章和阅读状态。'));

  submitBar(modal, t('取消'), t('添加'), async () => {
    const url = urlInput.value.trim();
    if (!url) return false;
    const result = await window.robin.addFeed(url, folderSelect.value || null);
    if (!result.ok) {
      // 免费版订阅源达上限 → 转升级引导（比报错更清晰的路径）
      if (/会员/.test(String(result.error))) {
        overlay.remove();
        const { showUpgradeGate } = await import('./account.js');
        showUpgradeGate({ message: String(result.error) });
        return true;
      }
      await alertBox(t('添加失败'), String(result.error));
      return false;
    }
    onDone?.();
    return true;
  });
  setTimeout(() => urlInput.focus(), 50);
}

export function showAddFolder(onDone) {
  const { overlay, modal } = smallModal(t('新建文件夹'));
  const body = modal.querySelector('.sheet-body');
  const input = field(body, t('文件夹名称'), 'folder', t('例如：科技、新闻、设计'));
  hint(body, t('创建后可以将订阅源拖拽归类到此文件夹中。'));
  submitBar(modal, t('取消'), t('创建'), async () => {
    const name = input.value.trim();
    if (!name) return false;
    const result = await window.robin.addFolder(name);
    if (!result.ok) return false;
    onDone?.();
    return true;
  });
  setTimeout(() => input.focus(), 50);
}

export async function showRenameFolder(folder, onDone) {
  const { overlay, modal } = smallModal(t('重命名文件夹'));
  const body = modal.querySelector('.sheet-body');
  const input = field(body, t('新文件夹名称'), 'pencil', t('文件夹名称'));
  input.value = folder.name;
  submitBar(modal, t('取消'), t('保存'), async () => {
    const name = input.value.trim();
    if (!name || name === folder.name) return false;
    const result = await window.robin.renameFolder(folder.id, name);
    if (!result.ok) return false;
    onDone?.(name);
    return true;
  });
  setTimeout(() => { input.focus(); input.select(); }, 50);
}

export function showFreshRSSAccount(onAdded) {
  const { overlay, modal } = smallModal(t('添加 FreshRSS 账号'));
  const body = modal.querySelector('.sheet-body');
  const nameInput = field(body, t('显示名称'), 'person', 'FreshRSS');
  const endpointInput = field(body, t('服务器地址'), 'server', 'https://freshrss.example.com');
  const userInput = field(body, t('用户名'), 'person', 'api_user');
  const passwordInput = field(body, t('应用专用密码'), 'general', '', true);
  hint(body, t('在 FreshRSS 网页「设置 → 账户 → API 管理」中开启 API 并生成应用专用密码。'));

  submitBar(modal, t('取消'), t('验证并添加'), async (button) => {
    const payload = {
      displayName: nameInput.value.trim() || 'FreshRSS',
      endpointURL: endpointInput.value.trim(),
      username: userInput.value.trim(),
      password: passwordInput.value,
    };
    if (!payload.endpointURL || !payload.username || !payload.password) return false;
    button.textContent = t('正在验证…');
    const validate = await window.robin.validateFreshRSS(payload);
    if (!validate.ok) {
      button.textContent = t('验证并添加');
      await alertBox(t('验证失败'), String(validate.error));
      return false;
    }
    const result = await window.robin.addFreshRSSAccount(payload);
    button.textContent = t('验证并添加');
    if (!result.ok) {
      await alertBox(t('添加失败'), String(result.error));
      return false;
    }
    onAdded?.();
    return true;
  });
}

// MARK: - 构建工具

function group(title, footer, rows) {
  const el = document.createElement('div');
  el.className = 'settings-group';
  el.innerHTML = `<div class="settings-group-header"></div><div class="group-rows"></div>`;
  el.querySelector('.settings-group-header').textContent = title;
  for (const rowEl of rows) el.querySelector('.group-rows').appendChild(rowEl);
  if (footer) {
    const footerEl = document.createElement('div');
    footerEl.className = 'settings-group-footer';
    footerEl.textContent = footer;
    el.appendChild(footerEl);
  }
  return el;
}

function row(title, desc, control) {
  const el = document.createElement('div');
  el.className = 'setting-row';
  el.innerHTML = `<div class="setting-label"><div class="title"></div><div class="desc" style="display:none"></div></div>`;
  el.querySelector('.title').textContent = title;
  if (desc) {
    el.querySelector('.desc').textContent = desc;
    el.querySelector('.desc').style.display = '';
  }
  if (control) {
    const wrap = document.createElement('div');
    wrap.className = 'setting-control';
    wrap.appendChild(control);
    el.appendChild(wrap);
  }
  return el;
}

function iconRow(iconName, title, desc, control) {
  const el = row(title, desc, control);
  const iconEl = document.createElement('span');
  iconEl.className = 'setting-icon';
  iconEl.innerHTML = icon(iconName);
  el.insertBefore(iconEl, el.firstChild);
  el.classList.add('with-icon');
  return el;
}

function toggleRow(title, desc, initial, onChange) {
  return row(title, desc, toggleControl(initial, onChange));
}

function inputRow(title, desc, placeholder, initial, onChange, options = {}) {
  const input = document.createElement('input');
  input.className = 'control';
  input.style.minWidth = '200px';
  input.placeholder = placeholder || '';
  if (options.password) input.type = 'password';
  if (options.placeholderFilled && initial == null && options.password) input.placeholder = '••••••••';
  input.value = initial ?? '';
  let timer = null;
  input.addEventListener('input', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => onChange(input.value), 600);
  });
  return row(title, desc, input);
}

function textAreaRow(initial, onChange) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'padding: 4px 16px 10px;';
  const area = document.createElement('textarea');
  area.className = 'control';
  area.style.cssText = 'width:100%;min-height:70px;max-height:120px;resize:vertical;line-height:1.5;';
  area.value = initial;
  let timer = null;
  area.addEventListener('input', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => onChange(area.value), 600);
  });
  wrap.appendChild(area);
  return plain(wrap);
}

function segmented(options, current, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'segmented';
  for (const [value, label] of options) {
    const button = document.createElement('button');
    button.textContent = label;
    button.classList.toggle('active', value === current);
    button.addEventListener('click', () => {
      wrap.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      button.classList.add('active');
      onChange(value);
    });
    wrap.appendChild(button);
  }
  return wrap;
}

function toggleControl(initial, onChange) {
  const toggle = document.createElement('button');
  toggle.className = `toggle ${initial ? 'on' : ''}`;
  toggle.addEventListener('click', async () => {
    const next = !toggle.classList.contains('on');
    toggle.classList.toggle('on', next);
    await onChange(next);
  });
  return toggle;
}

function selectControl(options, current, onChange) {
  const select = document.createElement('select');
  select.className = 'control';
  for (const [value, label] of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = String(value) === String(current);
    select.appendChild(option);
  }
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

function staticText(text) {
  const el = document.createElement('span');
  el.style.cssText = 'font-size:12px;color:var(--text-secondary);max-width:240px;text-align:right;';
  el.textContent = text;
  return el;
}

function linkBtn(label, onClick, bordered = false) {
  const button = document.createElement('button');
  button.className = `btn-text ${bordered ? 'bordered' : 'primary'}`;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function plain(el) {
  const wrap = document.createElement('div');
  wrap.style.marginBottom = '14px';
  wrap.appendChild(el);
  return wrap;
}

function actionAddHost(button) {
  const wrap = document.createElement('div');
  wrap.style.padding = '0 4px';
  wrap.appendChild(button);
  return wrap;
}

function intervalLabel(rawValue) {
  const map = {
    thirtyMinutes: '每 30 分钟', oneHour: '每小时', twoHours: '每 2 小时',
    fourHours: '每 4 小时', eightHours: '每 8 小时',
  };
  return t(map[rawValue] || rawValue);
}

// MARK: - Sheet 工具

function smallModal(title) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  const modal = document.createElement('div');
  modal.className = 'modal small';
  modal.innerHTML = `
    <div class="modal-main">
      <div class="modal-header"><h3></h3></div>
      <div class="sheet-body"></div>
      <div class="modal-footer"></div>
    </div>`;
  modal.querySelector('h3').textContent = title;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const esc = (event) => {
    if (event.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', esc);
    }
  };
  document.addEventListener('keydown', esc);
  return { overlay, modal };
}

function field(container, label, iconName, placeholder, password = false) {
  const wrap = document.createElement('label');
  wrap.className = 'sheet-field';
  wrap.innerHTML = `<label></label>`;
  const labelEl = document.createElement('div');
  labelEl.className = '';
  labelEl.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;';
  labelEl.innerHTML = `${icon(iconName)}<span></span>`;
  labelEl.querySelector('span').textContent = label;
  wrap.innerHTML = '';
  const input = document.createElement('input');
  input.className = 'control wide';
  input.placeholder = placeholder || '';
  if (password) input.type = 'password';
  wrap.append(labelEl, input);
  container.appendChild(wrap);
  return input;
}

function selectField(container, label, iconName, options) {
  const wrap = document.createElement('label');
  wrap.className = 'sheet-field';
  const labelEl = document.createElement('div');
  labelEl.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;';
  labelEl.innerHTML = `${icon(iconName)}<span></span>`;
  labelEl.querySelector('span').textContent = label;
  const select = document.createElement('select');
  select.className = 'control wide';
  for (const [value, text] of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    select.appendChild(option);
  }
  wrap.append(labelEl, select);
  container.appendChild(wrap);
  return select;
}

function hint(container, text) {
  const el = document.createElement('p');
  el.className = 'sheet-hint';
  el.textContent = text;
  container.appendChild(el);
}

function submitBar(modal, cancelLabel, confirmLabel, onSubmit) {
  const footer = modal.querySelector('.modal-footer');
  const cancelButton = document.createElement('button');
  cancelButton.className = 'btn-text';
  cancelButton.textContent = cancelLabel;
  cancelButton.addEventListener('click', () => modal.closest('.modal-overlay').remove());

  const confirmButton = document.createElement('button');
  confirmButton.className = 'btn-text primary';
  confirmButton.textContent = confirmLabel;
  confirmButton.addEventListener('click', async () => {
    confirmButton.disabled = true;
    const original = confirmButton.textContent;
    try {
      const ok = await onSubmit(confirmButton);
      if (ok !== false) modal.closest('.modal-overlay').remove();
      else confirmButton.disabled = false;
    } catch (err) {
      await alertBox(t('出错了'), String(err?.message || err));
      confirmButton.disabled = false;
    } finally {
      confirmButton.textContent = original;
    }
  });
  footer.append(cancelButton, confirmButton);
}

function escapeHTML(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function attr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
