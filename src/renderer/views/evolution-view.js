'use strict';
/**
 * RobinRead Windows — 自进化诊断面板
 * 源健康 / 兴趣画像 / 个性化推荐 / AI 反馈 / 自诊断 / 信息密度
 */
import { t } from '../i18n.js';
import { icon } from '../icons.js';

function timeAgo(seconds) {
  if (!seconds) return '—';
  const diff = Math.max(0, Date.now() / 1000 - seconds);
  const m = Math.floor(diff / 60), h = Math.floor(diff / 3600), d = Math.floor(diff / 86400);
  if (d > 0) return `${d} 天前`;
  if (h > 0) return `${h} 小时前`;
  if (m > 0) return `${m} 分钟前`;
  return '刚刚';
}

export class EvolutionView {
  constructor({ onOpenArticle }) {
    this.handlers = { onOpenArticle };
    this.section = 'diagnose';
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
      diagnose: async () => window.robin.evoDiagnose(),
      health: async () => window.robin.evoHealth(),
      profile: async () => window.robin.evoProfile(),
      recommend: async () => window.robin.evoRecommend(12),
      feedback: async () => window.robin.evoFeedbackSummary(),
      density: async () => ({ byFeed: await window.robin.evoDensityByFeed(14), byDay: await window.robin.evoDensityByDay(14) }),
    };
    const loader = loads[this.section];
    if (!loader) return;
    const result = await loader();
    this.data = result;
    this._renderContent();
  }

  _render() {
    if (!this.modal) return;
    this.modal.innerHTML = '';
    const sidebar = document.createElement('div');
    sidebar.className = 'modal-sidebar';
    sidebar.innerHTML = `<h2>${escapeHTML(t('自进化'))}</h2>`;
    const sections = [
      { id: 'diagnose', label: '诊断', icon: 'heart' },
      { id: 'health', label: '源健康', icon: 'radioDot' },
      { id: 'profile', label: '兴趣画像', icon: 'person' },
      { id: 'recommend', label: '推荐', icon: 'spark' },
      { id: 'feedback', label: 'AI 反馈', icon: 'bubble' },
      { id: 'density', label: '信息密度', icon: 'general' },
    ];
    for (const s of sections) {
      const item = document.createElement('div');
      item.className = `modal-nav-item ${s.id === this.section ? 'active' : ''}`;
      item.innerHTML = `<span class="nav-icon">${icon(s.icon)}</span><span></span>`;
      item.querySelector('span:last-child').textContent = t(s.label);
      item.addEventListener('click', () => { this.section = s.id; this._render(); this._load(); });
      sidebar.appendChild(item);
    }
    this.modal.appendChild(sidebar);
    const main = document.createElement('div');
    main.className = 'modal-main';
    const header = document.createElement('div');
    header.className = 'modal-header';
    header.innerHTML = `<h3>${escapeHTML(t(sections.find((x) => x.id === this.section)?.label || ''))}</h3>`;
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

  _renderContent() {
    if (!this.contentHost) return;
    this.contentHost.innerHTML = '';
    switch (this.section) {
      case 'diagnose': this._renderDiagnose(this.data); break;
      case 'health': this._renderHealth(this.data || []); break;
      case 'profile': this._renderProfile(this.data || {}); break;
      case 'recommend': this._renderRecommend(this.data || []); break;
      case 'feedback': this._renderFeedback(this.data || {}); break;
      case 'density': this._renderDensity(this.data || {}); break;
    }
  }

  _renderDiagnose(d) {
    if (!d) return;
    const el = document.createElement('div');
    const summary = document.createElement('div');
    summary.className = 'evo-summary';
    const ok = d.okCount === d.total;
    summary.innerHTML = `
      <div class="evo-score ${ok ? 'ok' : 'warn'}">
        <span class="evo-score-num">${d.okCount}/${d.total}</span>
        <span class="evo-score-label">${ok ? '一切正常' : '有事项需要关注'}</span>
      </div>
      <div class="evo-summary-stats">
        <span>${d.feedCount} 源</span><span>${d.unreadCount} 未读</span><span>${(d.deadFeeds || []).length} 失效</span>
      </div>`;
    el.appendChild(summary);
    for (const c of d.checks || []) {
      const row = document.createElement('div');
      row.className = 'evo-check' + (c.ok ? ' ok' : ' bad');
      row.innerHTML = `<span class="evo-check-icon">${c.ok ? icon('checkCircle') : icon('questionCircle')}</span>
        <span class="evo-check-label">${escapeHTML(labelForCheck(c.id))}</span>
        <span class="evo-check-detail">${escapeHTML(c.detail || '')}</span>`;
      el.appendChild(row);
    }
    if ((d.deadFeeds || []).length) {
      const lbl = document.createElement('div');
      lbl.className = 'td-section-label';
      lbl.style.marginTop = '16px';
      lbl.textContent = t('失效源');
      el.appendChild(lbl);
      for (const f of d.deadFeeds) {
        const row = document.createElement('div');
        row.className = 'evo-dead-feed';
        row.innerHTML = `<span>${icon('radioDot')}</span><span>${escapeHTML(f.title)}</span>`;
        el.appendChild(row);
      }
    }
    this.contentHost.appendChild(el);
  }

  _renderHealth(rows) {
    const el = document.createElement('div');
    if (!rows.length) { this._empty(el, '暂无健康数据', '刷新订阅后自动累积抓取成功率。'); this.contentHost.appendChild(el); return; }
    for (const h of rows) {
      const row = document.createElement('div');
      row.className = 'evo-feed' + (h.isDead ? ' dead' : '');
      const rel = Math.round((h.reliability || 1) * 100);
      row.innerHTML = `
        <span class="evo-feed-status ${h.isDead ? 'bad' : 'ok'}"></span>
        <span class="evo-feed-name"></span>
        <div class="evo-feed-bar"><i style="width:${rel}%"></i></div>
        <span class="evo-feed-rel">${rel}%</span>
        <span class="evo-feed-last">${escapeHTML(timeAgo(h.lastSuccessAt))}</span>`;
      row.querySelector('.evo-feed-name').textContent = h.title;
      row.title = h.lastError ? `最近错误：${h.lastError}` : '';
      el.appendChild(row);
    }
    this.contentHost.appendChild(el);
  }

  _renderProfile(p) {
    const el = document.createElement('div');
    const head = document.createElement('div');
    head.className = 'kb-daily-head';
    head.innerHTML = `<span class="kb-daily-title">${escapeHTML(t('兴趣标签'))}</span><span class="kb-daily-sub">${escapeHTML(t('从你的阅读行为学习'))}</span>`;
    el.appendChild(head);
    if (!(p.tags || []).length) {
      this._empty(el, '画像还是空的', '多读几篇、收藏或高亮文章后，这里会浮现你的兴趣。');
      this.contentHost.appendChild(el);
      return;
    }
    const tagCloud = document.createElement('div');
    tagCloud.className = 'evo-tag-cloud';
    const maxW = Math.max(1, ...(p.tags || []).map((x) => x.weight));
    for (const tag of p.tags.slice(0, 20)) {
      const chip = document.createElement('span');
      chip.className = 'evo-tag';
      chip.style.fontSize = `${12 + (tag.weight / maxW) * 12}px`;
      chip.style.opacity = String(0.5 + (tag.weight / maxW) * 0.5);
      chip.textContent = tag.tag;
      tagCloud.appendChild(chip);
    }
    el.appendChild(tagCloud);
    if ((p.feeds || []).length) {
      const lbl = document.createElement('div');
      lbl.className = 'td-section-label';
      lbl.style.marginTop = '16px';
      lbl.textContent = t('偏好的源');
      el.appendChild(lbl);
      for (const f of p.feeds.slice(0, 10)) {
        const row = document.createElement('div');
        row.className = 'evo-pref-feed';
        row.innerHTML = `<span class="evo-pref-name">${escapeHTML(f.feedID)}</span><span class="evo-pref-w">${f.weight.toFixed(1)}</span>`;
        el.appendChild(row);
      }
    }
    this.contentHost.appendChild(el);
  }

  _renderRecommend(items) {
    const el = document.createElement('div');
    if (!items.length) {
      this._empty(el, '暂无推荐', '先阅读一些文章，让画像成长起来。');
      this.contentHost.appendChild(el);
      return;
    }
    for (const it of items) {
      const card = document.createElement('div');
      card.className = 'kb-card';
      card.innerHTML = `<div class="kb-note-content"></div><div class="kb-card-source">${icon('newspaper')}<span></span></div>`;
      card.querySelector('.kb-note-content').textContent = it.title;
      card.querySelector('.kb-card-source span').textContent = it.feed_title || '';
      card.addEventListener('click', () => this.handlers.onOpenArticle?.(it.id));
      el.appendChild(card);
    }
    this.contentHost.appendChild(el);
  }

  _renderFeedback(f) {
    const el = document.createElement('div');
    el.innerHTML = `
      <div class="kb-stats-grid">
        <div class="kb-stat-card"><span class="kb-stat-num">${f.total || 0}</span><span class="kb-stat-label">总反馈</span></div>
        <div class="kb-stat-card"><span class="kb-stat-num">${f.likes || 0}</span><span class="kb-stat-label">👍 点赞</span></div>
        <div class="kb-stat-card"><span class="kb-stat-num">${f.dislikes || 0}</span><span class="kb-stat-label">👎 点踩</span></div>
      </div>`;
    if ((f.byKind || []).length) {
      const lbl = document.createElement('div');
      lbl.className = 'td-section-label';
      lbl.style.marginTop = '16px';
      lbl.textContent = t('按功能');
      el.appendChild(lbl);
      for (const k of f.byKind) {
        const row = document.createElement('div');
        row.className = 'evo-feedback-row';
        row.innerHTML = `<span>${escapeHTML(k.kind)}</span><span>${k.n} 次 · ${k.likes || 0} 👍</span>`;
        el.appendChild(row);
      }
    }
    this.contentHost.appendChild(el);
  }

  _renderDensity(d) {
    const el = document.createElement('div');
    const byDay = d.byDay || [];
    if (byDay.length) {
      const lbl = document.createElement('div');
      lbl.className = 'td-section-label';
      lbl.textContent = t('近 14 天信息流');
      el.appendChild(lbl);
      const chart = document.createElement('div');
      chart.className = 'kb-chart';
      const max = Math.max(1, ...byDay.map((x) => x.count));
      for (const day of byDay) {
        const bar = document.createElement('div');
        bar.className = 'kb-chart-bar';
        bar.title = `${day.day} · ${day.count} 篇`;
        bar.style.height = `${Math.max(4, (day.count / max) * 72)}px`;
        chart.appendChild(bar);
      }
      el.appendChild(chart);
    }
    const byFeed = d.byFeed || [];
    if (byFeed.length) {
      const lbl = document.createElement('div');
      lbl.className = 'td-section-label';
      lbl.style.marginTop = '16px';
      lbl.textContent = t('按源产出');
      el.appendChild(lbl);
      for (const f of byFeed.slice(0, 12)) {
        const row = document.createElement('div');
        row.className = 'evo-feedback-row';
        row.innerHTML = `<span>${escapeHTML(f.title || f.feedID)}</span><span>${f.entryCount} 篇</span>`;
        el.appendChild(row);
      }
    }
    this.contentHost.appendChild(el);
  }

  _empty(host, title, desc) {
    host.innerHTML = `<div class="list-empty"><div class="glyph">${icon('spark')}</div><h3>${escapeHTML(t(title))}</h3><p>${escapeHTML(t(desc))}</p></div>`;
  }
}

function labelForCheck(id) {
  const map = {
    'db-integrity': '数据库完整性',
    'dead-feeds': '失效源',
    'unread-backlog': '未读堆积',
    'ai-config': 'AI 配置',
    'feed-count': '订阅源数量',
  };
  return t(map[id] || id);
}

function escapeHTML(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
