'use strict';
/**
 * RobinRead（知更）— 阅读器
 *
 * - 头部构建（PaperReaderHeaderBuilder 1:1）：衬线标题链接 / meta / 摘要卡 / 渐变分隔线
 * - 摘要卡三态：未生成（点击发送）/ 生成中（spinner）/ 已生成（折叠预览首句 + 展开全文）
 * - 视口驱动的逐段对照翻译：可见段落 ±30% 预载，批 ≤6，失败计数 ≤2，译文按段落 ID 注入
 * - 划词：胶囊（解释/提问/翻译，按设置开关显隐）→ 弹层流式结果 → 注释图标锚点恢复
 * - 图片灯箱、TOC 轨道（悬停波峰/视线重心）、浮动滚动条（透明度 0/.18/.28/.36）
 * - 空格：滚动 38.2% 视口；到底后翻下一篇（由 app 层做双击确认）
 */
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { formatFullDate } from './list.js';
import { renderMarkdown } from '../markdown.js';
import { ContextMenu } from './context-menu.js';

const MAX_TRANSLATION_FAILURES = 2;
// 逐句双语：视口批量按「句」计（一段约 3-6 句），调大批次减少往返
const VISIBLE_BATCH = 24;
// 阅读位置持久化：localStorage 键与条目上限（FIFO，超出删最早写入的）
const SCROLL_POSITIONS_KEY = 'robinread.scrollPositions';
const SCROLL_POSITIONS_LIMIT = 300;

// MARK: - TTS 朗读（听文章）常量
// 引擎：window.speechSynthesis（Chromium 内置，Windows 本地语音，离线零成本）。
// 长文本必须按句切块入队：Chromium 对超长 utterance 会截断/吞字。
const TTS_CHUNK_MAX = 120;
const TTS_RATES = [0.75, 1, 1.25, 1.5];
const TTS_RATE_KEY = 'robinread.tts.rate';
const TTS_VOICE_KEY = 'robinread.tts.voice';

/** 内联 SVG（不依赖 icons.js，喇叭/播放/暂停/停止）。 */
const TTS_SPEAKER_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.2 6.1v3.8h2.5L8.2 13V3L4.7 6.1H2.2z"/><path d="M10.6 5.4a3.7 3.7 0 0 1 0 5.2M12.6 3.6a6.3 6.3 0 0 1 0 8.8"/></svg>';
const TTS_PLAY_SVG = '<svg viewBox="0 0 16 16" fill="currentColor" stroke="none"><path d="M5 3.2v9.6l7.6-4.8z"/></svg>';
const TTS_PAUSE_SVG = '<svg viewBox="0 0 16 16" fill="currentColor" stroke="none"><path d="M4.6 3h2.3v10H4.6zM9.1 3h2.3v10H9.1z"/></svg>';
const TTS_STOP_SVG = '<svg viewBox="0 0 16 16" fill="currentColor" stroke="none"><rect x="3.8" y="3.8" width="8.4" height="8.4" rx="1.2"/></svg>';

export class ReaderView {
  constructor(scrollEl, refs, handlers) {
    this.scrollEl = scrollEl;
    this.tocRail = refs.tocRail;
    this.tocTrack = refs.tocTrack;
    this.tocPeak = refs.tocPeak;
    this.scrollbar = refs.scrollbar;
    this.thumb = refs.thumb;
    this.handlers = handlers;

    this.entryID = null;
    this.entry = null;
    this.feed = null;
    this.html = null;
    this.paragraphs = [];
    this.visibleIDs = [];
    this.pendingIDs = new Set();
    this.failedIDs = new Map();
    this.bilingualActive = false;
    this.segments = [];
    this.summary = { expanded: false, artifact: null, generating: false, streaming: '' };
    this.selectionEl = null;
    this.popover = null;
    this.highlights = [];
    this.notes = [];
    this._scrollPositions = new Map(); // entryID -> scrollTop（阅读位置记忆，跨会话持久化到 localStorage）
    this._loadScrollPositions();
    this._scrollTick = false;
    this._thumbState = 'idle';
    this._hideTimer = null;

    // TTS 朗读：状态机在 _tts 内（null = 空闲）；_ttsGen 使在途 utterance 回调失效
    this._tts = null;
    this._ttsGen = 0;
    this._ttsHeaderBtn = null;
    // R（读/停）与 Esc（停止）在 reader 内部监听：仅在阅读器聚焦且无更高优先级弹层时消费
    document.addEventListener('keydown', (event) => this._onTTSKeyDown(event));
    // 语音列表异步加载（voiceschanged）：就绪后刷新头部「听」按钮可用态；
    // 已触发过事件但仍为空 = 系统确认无语音 → 置灰
    try {
      const synth = window.speechSynthesis;
      synth?.addEventListener?.('voiceschanged', () => {
        try { this._ttsVoicesConfirmedEmpty = ((synth.getVoices?.() || []).length === 0); } catch (_) { /* 忽略 */ }
        this._ttsRefreshButtonAvailability();
      });
    } catch (_) { /* mock/精简引擎无 addEventListener：点击时仍会兜底提示 */ }

    this.scrollEl.addEventListener('scroll', () => this._onScroll(), { passive: true });
    document.addEventListener('selectionchange', () => this._onSelectionChange());
    this.progressEl = document.getElementById('reading-progress');
    // mouseup 兜底：部分场景 selectionchange 不触发（合成选区/快速点击）
    document.addEventListener('mouseup', () => setTimeout(() => this._onSelectionChange(), 10));
    this._buildScrollbarGestures();
    this._buildTOCGestures();
    this.clear();
  }

  // MARK: - 打开 / 清空

  async open(entryID) {
    const sameEntry = this.entryID === entryID;
    // 切换文章前记住当前阅读位置，回来时恢复
    if (!sameEntry && this.entryID && this.scrollEl) {
      this._rememberScrollPosition(this.entryID, this.scrollEl.scrollTop);
    }
    this.entryID = entryID;
    this.bilingualActive = sameEntry ? this.bilingualActive : false;
    if (!sameEntry) this._translateMode = 'off';
    if (!sameEntry) {
      this._ttsStop(); // 切换文章：朗读必须停止并清队（旧段落锚点已失效）
      this.visibleIDs = [];
      this.pendingIDs.clear();
      this.failedIDs.clear();
      this.segments = [];
      this._translateAll = false;
      this._translationErrorShown = false;
      this.summary = { expanded: false, artifact: null, generating: false, streaming: '', error: null };
    }
    this._showLoading();
    // 渲染期任何异常（怪异 DOM 结构等）都不能让「正在准备正文…」遮罩永久卡死——
    // 那正是「文章界面没了、翻译无反应、无报错」的来源
    try {
      await this._openBody(entryID);
    } catch (err) {
      // 竞态守卫：抓取/读库 reject 时文章可能已切换，旧文章的兜底内容不得覆盖新文章
      if (this.entryID !== entryID) return;
      console.error('[reader] open failed:', err);
      // 兜底渲染：至少把标题 + 摘要显示出来，绝不让阅读区空白
      try {
        this.html = `<p>${escapeHTML(this.entry?.summary || this.html || t('正文加载失败'))}</p>`;
        this._render();
      } catch (_) { /* 连兜底都失败时只能提示 */ }
      this.handlers.onFeedback?.(t('正文渲染遇到问题，已显示摘要兜底。'));
    } finally {
      this._hideLoading();
    }

    // 竞态守卫：_openBody 因切换文章提前返回时，不能拿新文章的 entryID 误触发自动摘要
    // （会与文章 B 自己的触发相撞，弹「已有 AI 摘要任务正在进行」误报）
    if (this.entryID !== entryID) return;
    // 自动摘要：无缓存、或上次生成被中断（isComplete=false）都自动重生成
    const llm = window.__robinLLM || {};
    const summaryMissing = !this.summary.artifact || this.summary.artifact.isComplete === false;
    if (llm.automaticallyGenerateSummary && summaryMissing && this._articleText().length > 0) {
      this.generateSummary(false);
    }
  }

  async _openBody(entryID) {
    const result = await window.robin.getReader(entryID);
    if (!result.ok || !result.data || this.entryID !== entryID) return;
    const data = result.data;
    this.entry = data.entry;
    this.feed = data.feed;
    this.summary.artifact = data.summary;

    let html = data.content?.html;
    if (data.content?.needsExtraction && this.entry.url) {
      const extracted = await window.robin.extractArticle(entryID);
      // 同样的质量门槛：抓回内容须有起码篇幅（≥120 字），防拦截壳顶掉可用正文
      if (extracted.ok && extracted.data?.html && plainLen(extracted.data.html) >= 120 && this.entryID === entryID) {
        html = extracted.data.html;
      }
    }
    // 显示不全治理：feed 正文过短（摘要截断）时，抓取原网页补全
    if (this.entry.url && html && plainLen(html) < 400) {
      const extracted = await window.robin.extractArticle(entryID);
      if (extracted.ok && extracted.data?.html && plainLen(extracted.data.html) > Math.max(plainLen(html), 150) && this.entryID === entryID) {
        html = extracted.data.html;
      }
    }
    if (!html) {
      html = `<p>${escapeHTML(this.entry.summary || '')}</p>`;
    }
    // 无内容治理（MathWorks 博客等「标题有、正文空」的源）：
    // 1) 抓取后仍过短 → 用更长的摘要兜底；2) 连摘要都没有 → 明确提示 + 打开原文入口
    const finalLen = plainLen(html);
    const summaryLen = plainLen(this.entry.summary || '');
    if (finalLen < 80 && summaryLen > finalLen) {
      html = `<p>${escapeHTML(this.entry.summary)}</p>`;
    }
    if (plainLen(html) < 10) {
      const url = /^https?:/i.test(this.entry.url || '') ? this.entry.url : '';
      html = `<p>${escapeHTML(t('这篇文章没有可提取的正文（可能为纯图片、需登录或站点限制抓取）。'))}</p>`
        + (url ? `<p><a href="${attr(url)}">${escapeHTML(t('在浏览器中打开原文 →'))}</a></p>` : '');
    }
    // 竞态守卫：上方两次 extractArticle 可能耗时数秒，期间用户已切到别的文章时，
    // 不能让旧文章的正文覆盖新选中文章（界面与数据失配且不自愈）
    if (this.entryID !== entryID) return;
    this.html = removingDuplicateLeadingHeading(html, this.entry.title);
    this.annotations = data.annotations || [];
    // 批注（高亮/笔记）：与正文同步拉取，渲染时按锚点重新着色/插桩
    {
      const [hls, notes] = await Promise.all([
        window.robin.kbHighlights(entryID).catch(() => null),
        window.robin.kbNotes(entryID).catch(() => null),
      ]);
      if (this.entryID === entryID) {
        this.highlights = Array.isArray(hls) ? hls : [];
        this.notes = Array.isArray(notes) ? notes : [];
      }
    }
    if (this.entryID !== entryID) return;
    this._render();

    // 翻译策略：默认不翻译（手动点击翻译按钮触发）；仅当设置里显式开启「自动精读」才自动翻译
    {
      const layout = window.__robinReaderLayout || {};
      const defaultMode = layout.translateMode && layout.translateMode !== 'off'
        ? layout.translateMode : 'bilingual';
      const autoOn = layout.autoTranslateEnglish === true;
      const aiReady = window.__robinLLM?.__hasKey !== false;
      const isEn = this._isEnglishArticle();
      if (isEn && autoOn && !aiReady) {
        // 设置开了自动精读但 AI 未就绪（当前服务商未配置 Key）：给出明确指引
        this.handlers.onFeedback?.(t('已开启自动精读，但 AI 尚未配置 API Key。请到 设置 → AI 填写后重试。'));
      } else if (isEn && autoOn && aiReady && this.translateMode === 'off') {
        this._setTranslateMode(defaultMode, { silent: true });
        this.handlers.onFeedback?.(t('检测到英文文章，已开启 AI 精读翻译（点击翻译按钮可切换模式）'));
      } else if (!isEn && this.translateMode !== 'off') {
        // 换到非英文文章：翻译模式跟随文章语言，重置为关闭
        this._setTranslateMode('off', { silent: true });
      }
    }

    // 刷新已缓存的对照翻译
    if (this.bilingualActive) {
      const cached = await window.robin.cachedBilingual(entryID, this._annotatedHTML());
      if (cached.ok && cached.data?.segments?.length && this.entryID === entryID) {
        this.segments = cached.data.segments;
        this._injectTranslations(this.segments.map((s) => s.id));
      }
      this._requestVisibleTranslations();
    }
  }

  /**
   * 应用内原文精读：抓取原网页 → 提取正文 → 版面重排 → 在阅读器渲染。
   * 翻译/摘要/划词/高亮等全部功能对新内容自动可用（同一管线）。
   */
  async openOriginal() {
    if (!this.entryID || !this.entry?.url) {
      this.handlers.onFeedback?.(t('这篇文章没有原文链接。'));
      return;
    }
    this.handlers.onFeedback?.(t('正在抓取原文并重新排版…'));
    const result = await window.robin.extractArticle(this.entryID);
    if (this.entryID && result.ok && result.data?.html) {
      const html = removingDuplicateLeadingHeading(result.data.html, this.entry.title);
      const gotLen = plainLen(html);
      const haveLen = plainLen(this.html || '');
      // 抓取质量门槛：抓回正文明显短于现有正文（多为站点拦截壳/登录页）时绝不切换，
      // 否则「原文精读」会把 RSS 的好正文顶换成一小段空壳（表现为“原文功能失效”）
      const longEnough = gotLen > 40 && gotLen >= Math.max(200, haveLen * 0.4);
      if (longEnough) {
        // 内容态复位（新 contentHash 下翻译/摘要按新内容工作）
        this.html = html;
        this.segments = [];
        this.failedIDs.clear();
        this.pendingIDs.clear();
        this.visibleIDs = [];
        this._translateAll = false;
        this._translateMode = 'off';
        this.bilingualActive = false;
        this.summary = { expanded: false, artifact: null, generating: false, streaming: '', error: null };
        this._render();
        this.handlers.onFeedback?.(t('已切换到原文精读（排版已重整；翻译 / 摘要 / 划词全功能可用）'));
        const llm = window.__robinLLM || {};
        if (llm.automaticallyGenerateSummary && this._articleText().length > 0) this.generateSummary(false);
        return;
      }
      if (gotLen > 40 && haveLen > 400) {
        this.handlers.onFeedback?.(t('原文抓取不完整（站点可能限制了抓取），已保留当前正文；可点地球按钮在浏览器中打开原文。'));
        return;
      }
    }
    this.handlers.onFeedback?.(t('原文抓取失败（站点限制或需要登录），已保留当前内容。'));
  }

  // MARK: - 导出（复制 Markdown / 保存文件 / 打印 PDF）

  /** 头部「导出」按钮弹出的小菜单。动作用 ContextMenu，选择后自动关闭。 */
  _showExportMenu(x, y) {
    if (!this.entryID) return;
    ContextMenu.show(x, y, [
      { label: t('复制全文 Markdown'), icon: 'copy', onClick: () => this._copyArticleMarkdown() },
      { label: t('导出为 Markdown 文件'), icon: 'docText', onClick: () => this._exportMarkdownFile() },
      { type: 'separator' },
      { label: t('打印 / 存为 PDF'), icon: 'newspaper', onClick: () => window.print() },
    ]);
  }

  /** 复制全文 Markdown（kb:exportMarkdown → KnowledgeEngine.exportToMarkdown 返回纯字符串）。 */
  async _copyArticleMarkdown() {
    try {
      const md = await window.robin.kbExportMarkdown(this.entryID);
      if (!md || typeof md !== 'string') {
        this.handlers.onFeedback?.(t('导出失败：没有可导出的内容。'));
        return;
      }
      await window.robin.copyText(md);
      this.handlers.onFeedback?.(t('已复制'));
    } catch (err) {
      this.handlers.onFeedback?.(`${t('导出失败')}：${err?.message || err}`);
    }
  }

  /** 另存为 Markdown 文件：pickSavePath → writeTextFile；取消静默，失败提示。 */
  async _exportMarkdownFile() {
    try {
      const md = await window.robin.kbExportMarkdown(this.entryID);
      if (!md || typeof md !== 'string') {
        this.handlers.onFeedback?.(t('导出失败：没有可导出的内容。'));
        return;
      }
      const rawName = (this.entry?.title || '').trim() || t('未命名文章');
      // Windows 文件名非法字符替换 + 截断，防路径注入与超长文件名
      const safeName = rawName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 80) || t('未命名文章');
      const picked = await window.robin.pickSavePath(`${safeName}.md`);
      const filePath = picked?.ok ? picked.data : null;
      if (!filePath) return; // 用户取消
      const written = await window.robin.writeTextFile(filePath, md);
      if (!written?.ok) throw new Error(written?.error || t('写入文件失败'));
      this.handlers.onFeedback?.(t('已导出'));
    } catch (err) {
      this.handlers.onFeedback?.(`${t('导出失败')}：${err?.message || err}`);
    }
  }

  clear() {
    this._ttsStop(); // 清空阅读器：停朗读、清队、移除播放器
    if (this.entryID && this.scrollEl) {
      this._rememberScrollPosition(this.entryID, this.scrollEl.scrollTop);
    }
    this._imgObserver?.disconnect();
    this.entryID = null;
    this.entry = null;
    this.feed = null;
    this.html = null;
    this.paragraphs = [];
    this.bilingualActive = false;
    this._translateMode = 'off';
    this.highlights = [];
    this.notes = [];
    this._dismissSelection();
    this._dismissPopover();
    this._dismissHighlightMenu();
    document.getElementById('nj-annot-panel')?.remove();
    this.scrollEl.innerHTML = `
      <div class="reader-empty">
        <div class="glyph">${icon('newspaper')}</div>
        <h3>${escapeHTML(t('选择一篇文章'))}</h3>
        <p>${escapeHTML(t('从列表中打开文章开始阅读。'))}</p>
      </div>`;
    this.tocRail.classList.add('hidden-rail');
    this.scrollbar.style.display = 'none';
  }

  // MARK: - 阅读位置持久化（localStorage 跨会话）

  /** 构造时从 localStorage 恢复位置表（JSON 对象，键序即写入序）。 */
  _loadScrollPositions() {
    try {
      const raw = localStorage.getItem(SCROLL_POSITIONS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      for (const [id, top] of Object.entries(parsed)) {
        if (typeof top === 'number' && Number.isFinite(top) && top >= 0) this._scrollPositions.set(id, top);
      }
    } catch (_) { /* 隐私模式 / 数据损坏：忽略，退化为纯内存记忆 */ }
  }

  /** 记录阅读位置并同步写回 localStorage。 */
  _rememberScrollPosition(entryID, scrollTop) {
    if (!entryID || !Number.isFinite(scrollTop)) return;
    this._scrollPositions.set(entryID, scrollTop);
    this._persistScrollPositions();
  }

  /** 写回 localStorage：上限 300 条（FIFO，按插入序删最早写入的）；失败不致命。 */
  _persistScrollPositions() {
    try {
      while (this._scrollPositions.size > SCROLL_POSITIONS_LIMIT) {
        const oldest = this._scrollPositions.keys().next().value;
        if (oldest === undefined) break;
        this._scrollPositions.delete(oldest);
      }
      localStorage.setItem(SCROLL_POSITIONS_KEY, JSON.stringify(Object.fromEntries(this._scrollPositions)));
    } catch (_) { /* 隐私模式 / 超配额：写不进去就算了，内存记忆仍在 */ }
  }

  _showLoading() {
    this._hideLoading();
    const overlay = document.createElement('div');
    overlay.className = 'reader-loading';
    overlay.id = 'reader-loading';
    overlay.innerHTML = `<div class="spinner"></div><span>${escapeHTML(t('正在准备正文…'))}</span>`;
    this.scrollEl.parentElement.appendChild(overlay);
  }

  _hideLoading() {
    document.getElementById('reader-loading')?.remove();
  }

  // MARK: - 渲染

  _render() {
    this._ttsStop(); // 正文重排（打开新文/原文精读）：段落锚点重建，朗读必须先停
    this.scrollEl.scrollTop = 0;
    this.scrollEl.innerHTML = '';

    const article = document.createElement('div');
    article.className = 'reader-article';
    article.appendChild(this._buildHeader());
    this.body = document.createElement('div');
    article.appendChild(this.body);
    this.scrollEl.appendChild(article);

    // 正文：注入段落 ID + 版面重排 + 句子包裹 + 缓存译文 + 恢复划词注释锚点
    this._setBodyHTML(this.html);
    this._normalizeArticle();
    this._restructureArticle();
    // 代码高亮与公式渲染必须在段落标注（data-nj-id）/批注锚点之前完成：
    // 两者都只做「节点内部」的文本拆分与包裹，不改块结构，不会使后续锚点失效
    this._highlightCodeBlocks();
    this._renderMath();
    this._annotateParagraphs();
    this._wrapSentenceUnits();
    this.paragraphs = collectParagraphs(this.body, this.entry?.title);
    this._injectTranslations(this.segments.map((s) => s.id));
    this._restoreAnnotations();
    this._applyHighlights();
    this._renderNoteMarkers();
    this._interceptLinks();
    this._bindImages();

    this._buildTOC();
    requestAnimationFrame(() => {
      this._onScroll();
      this._publishVisible();
      // 阅读位置记忆：等布局稳定（double rAF）后恢复，避免 scrollHeight 未撑开时被 clamp 到 0
      requestAnimationFrame(() => {
        const saved = this._scrollPositions.get(this.entryID);
        if (saved && saved > 0) {
          const max = this.scrollEl.scrollHeight - this.scrollEl.clientHeight;
          if (max > 0) this.scrollEl.scrollTop = Math.min(saved, max);
        }
      });
    });
  }

  _buildHeader() {
    const entry = this.entry;
    const header = document.createElement('header');
    header.className = 'robin-header-container';

    const h1 = document.createElement('h1');
    h1.className = 'robin-header-title';
    h1.dataset.njId = 'title';
    if (entry.url) {
      const link = document.createElement('a');
      link.href = '#';
      link.textContent = entry.title || t('未命名文章');
      link.title = t('在阅读器内打开原文并重新排版');
      link.addEventListener('click', (event) => {
        event.preventDefault();
        this.openOriginal();
      });
      h1.appendChild(link);
    } else {
      h1.textContent = entry.title || t('未命名文章');
    }
    header.appendChild(h1);

    const meta = document.createElement('div');
    meta.className = 'robin-header-meta';
    const parts = [];
    if (this.feed?.title) parts.push(escapeHTML(this.feed.title));
    if (entry.author) parts.push(escapeHTML(entry.author));
    if (entry.publishedAt) parts.push(escapeHTML(formatFullDate(entry.publishedAt)));
    meta.innerHTML = parts.join(' &bull; ');
    // 头部操作区：「听」（TTS 朗读，只要有正文就提供）+ 应用内精读 + 浏览器打开（次）
    {
      const actions = document.createElement('span');
      actions.className = 'robin-header-original-actions';
      this._ttsAppendHeaderButton(actions);
      if (entry.url) {
        const readBtn = document.createElement('button');
        readBtn.className = 'btn-text bordered';
        readBtn.innerHTML = `${icon('globe')}<span style="margin-left:4px">${escapeHTML(t('阅读原文'))}</span>`;
        readBtn.title = t('在阅读器内打开原文：自动抓取 + 版面重排 + 翻译/摘要/划词全功能');
        readBtn.addEventListener('click', () => this.openOriginal());
        const browserBtn = document.createElement('button');
        browserBtn.className = 'btn-text bordered';
        browserBtn.innerHTML = icon('export');
        browserBtn.title = t('在浏览器中打开');
        browserBtn.addEventListener('click', () => window.robin.openLink(entry.url));
        // 导出菜单（仅在有正文时显示）：复制 Markdown / 导出文件 / 打印 PDF
        if (plainLen(this.html || '') > 0) {
          const exportBtn = document.createElement('button');
          exportBtn.className = 'btn-text bordered';
          exportBtn.dataset.role = 'export';
          exportBtn.innerHTML = `${icon('export')}<span style="margin-left:4px">${escapeHTML(t('导出'))}</span>`;
          exportBtn.title = t('导出：复制 Markdown / 保存为文件 / 打印为 PDF');
          exportBtn.addEventListener('click', () => {
            const rect = exportBtn.getBoundingClientRect();
            this._showExportMenu(rect.left, rect.bottom + 6);
          });
          actions.appendChild(exportBtn);
        }
        actions.appendChild(readBtn);
        actions.appendChild(browserBtn);
      }
      if (actions.childNodes.length > 0) meta.appendChild(actions);
    }
    header.appendChild(meta);

    // AI 摘要卡（showsAISummary 时才渲染）
    this.summaryCard = document.createElement('div');
    // 点击监听只在建卡时绑定一次：_renderSummaryCard 会被流式 delta 高频重绘，
    // 在那里 addEventListener 会无限叠加（点一次触发 N 次，偶数次表现为点了没反应）
    this.summaryCard.addEventListener('click', (event) => {
      if (event.target.closest('[data-action="regenerate"]')) {
        this.generateSummary(true);
        return;
      }
      if (event.target.closest('[data-action="feedback"]')) {
        const btn = event.target.closest('[data-action="feedback"]');
        const rating = Number(btn.dataset.rating);
        this._submitFeedback('summary', rating, btn);
        return;
      }
      if (this.summary.artifact?.content || this.summary.streaming) {
        this.toggleSummary();
      } else if (!this.summary.generating) {
        this.generateSummary(false);
      }
    });
    header.appendChild(this.summaryCard);
    this._renderSummaryCard();

    const divider = document.createElement('hr');
    divider.className = 'robin-header-divider';
    header.appendChild(divider);
    return header;
  }

  _setBodyHTML(html) {
    this.body.innerHTML = html;
    this._normalizeArticle();
    // 段落收集移至 _render（需先完成句子包裹，保证句级单元口径一致）
  }

  /**
   * 正文排版归一化：治理脏 feed HTML。
   * - 删除空块（无文字无图的 p/div）与 1x1 跟踪像素
   * - 折叠连续 <br>
   * - 拍平「纯包裹 div」（div 内只有一个块级子元素时以子元素替换）
   * - 超宽表格包一层横向滚动容器
   */
  _normalizeArticle() {
    if (!this.body) return;
    // 图片地址修复：相对路径 / 协议相对路径在本地页面下无法解析 → 用源站地址补全
    const base = this.feed?.siteURL || this.entry?.url || '';
    if (base) {
      this.body.querySelectorAll('img').forEach((img) => {
        const raw = (img.getAttribute('src') || '').trim();
        if (!raw) {
          const lazy = ['data-src', 'data-original', 'data-lazy-src', 'data-lazyload', 'data-actualsrc'].map((a) => img.getAttribute(a)).find(Boolean);
          if (lazy) img.setAttribute('src', lazy);
          else img.remove();
          return;
        }
        try {
          const resolved = new URL(raw, base);
          if (resolved.protocol === 'http:' || resolved.protocol === 'https:') img.src = resolved.href;
          else img.remove();
        } catch (_) { /* 无法解析的地址保留原样 */ }
      });
    }
    // 1x1 跟踪像素
    this.body.querySelectorAll('img').forEach((img) => {
      img.referrerPolicy = 'no-referrer'; // 绕过源站防盗链（Referer 校验）
      const w = Number(img.getAttribute('width'));
      const h = Number(img.getAttribute('height'));
      if ((w === 1 && h === 1) || /pixel|track|beacon|spacer/i.test(img.src || '')) img.remove();
    });
    // 空块（两轮，处理删空后产生的新的空块）
    for (let round = 0; round < 2; round += 1) {
      this.body.querySelectorAll('p, div').forEach((el) => {
        const hasMedia = el.querySelector('img, video, iframe, table, pre');
        const hasText = (el.textContent || '').trim().length > 0;
        if (!hasMedia && !hasText) el.remove();
      });
    }
    // 连续 <br> 折叠到最多 2 个：单个 = 换行（诗歌/地址），两个 = 分段信号（供重排层拆段）
    this.body.querySelectorAll('br').forEach((br) => {
      let next = br.nextSibling;
      while (next && next.nodeType === Node.TEXT_NODE && !next.textContent.trim()) next = next.nextSibling;
      let run = 0;
      let cursor = br;
      while (cursor.nextElementSibling && cursor.nextElementSibling.nodeName === 'BR' && run < 1) {
        const del = cursor.nextElementSibling;
        cursor = del;
        run += 1;
      }
      // cursor 现在指向本 run 的最后一个 br；删除其后所有连续 br
      let after = cursor.nextElementSibling;
      while (after && after.nodeName === 'BR') {
        const del = after;
        after = after.nextElementSibling;
        del.remove();
      }
      void next;
    });
    // 拍平纯包裹 div（div 的唯一子节点是块级元素 → 用子元素替换 div）。
    // 循环到无变化为止（mdnice/飞书等编辑器会产出 10+ 层嵌套 div，固定轮数拍不平）
    for (let round = 0; round < 20; round += 1) {
      let changed = false;
      this.body.querySelectorAll('div').forEach((div) => {
        const children = [...div.childNodes].filter((n) => !(n.nodeType === Node.TEXT_NODE && !n.textContent.trim()));
        if (children.length === 1 && children[0].nodeType === Node.ELEMENT_NODE) {
          const child = children[0];
          const tag = child.tagName.toLowerCase();
          if (['p', 'div', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'figure', 'pre', 'ul', 'ol', 'table'].includes(tag)) {
            div.replaceWith(child);
            changed = true;
          }
        }
      });
      if (!changed) break;
    }
    // 超宽表格包滚动容器
    this.body.querySelectorAll('table').forEach((table) => {
      if (table.parentElement?.classList.contains('table-scroll')) return;
      const wrap = document.createElement('div');
      wrap.className = 'table-scroll';
      table.replaceWith(wrap);
      wrap.appendChild(table);
    });
  }

  /**
   * 版面重排引擎：把任意「烂排版」正文规整为纸感博文版式。
   * 只做高置信变换，任何子步骤失败只跳过该步、绝不破坏内容：
   * 1. 标题层级规整（h1~h6 重映射为从 h2 开始的连续层级，h1 留给文章标题）
   * 2. 伪段落重建（<br><br> 分段 / 裸 div 文本 → <p>；段内空白折叠）
   * 3. 文本列表识别（•/-/* 行 → <ul>；1. 2. 行 → <ol>）
   * 4. 图片规整（纯图段落 → <figure>，有 alt 时加 figcaption）
   * 5. 垃圾清理（空链接、分享/订阅/相关文章尾巴）
   * 6. 多图并排（连续纯图块 → .nj-img-row 画廊行，一组上限 6）
   */
  _restructureArticle() {
    if (!this.body) return;
    try { this._stripJunkTail(); } catch (_) { /* 跳过 */ }
    try { this._restructureHeadings(); } catch (_) { /* 跳过 */ }
    try { this._restructureParagraphs(); } catch (_) { /* 跳过 */ }
    try { this._restructureTextLists(); } catch (_) { /* 跳过 */ }
    try { this._restructureFigures(); } catch (_) { /* 跳过 */ }
    try { this._restructureGalleryRows(); } catch (_) { /* 跳过 */ }
  }

  /** 1. 标题层级：收集用到的级别 → 稳定排序 → 映射为 h2/h3/h4 连续层级。 */
  _restructureHeadings() {
    const headings = [...this.body.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    if (headings.length === 0) return;
    const levelsUsed = [...new Set(headings.map((h) => Number(h.tagName.slice(1))))].sort((a, b) => a - b);
    const map = new Map(levelsUsed.map((lv, i) => [lv, Math.min(6, 2 + i)]));
    for (const h of headings) {
      const target = map.get(Number(h.tagName.slice(1))) || 2;
      if (h.tagName !== `H${target}`) {
        const next = document.createElement(`h${target}`);
        next.append(...h.childNodes);
        // 保留 h 上已有的划词注释图标等锚点
        h.replaceWith(next);
      }
    }
  }

  /** 2. 段落重建：<br><br> 伪分段与裸文本 div → 标准 <p>。 */
  _restructureParagraphs() {
    // 2a. 段内 <br><br>（或连续多个 <br>，_normalizeArticle 已折叠为单个，此处处理「段间」意图）：
    //     单 <br> 保留（诗歌/地址），两个及以上视为分段 → 拆成独立 <p>
    for (const p of [...this.body.querySelectorAll('p')]) {
      const html = p.innerHTML;
      if (!/<br\s*\/?>\s*<br/i.test(html)) continue;
      const chunks = html.split(/<br\s*\/?>\s*<br(?:\s*\/?>)?/i)
        .map((c) => c.replace(/^(?:<br\s*\/?>|\s)+/i, '').replace(/(?:<br\s*\/?>|\s)+$/i, '').trim())
        .filter(Boolean);
      if (chunks.length < 2) continue;
      const frag = document.createDocumentFragment();
      for (const chunk of chunks) {
        const np = document.createElement('p');
        np.innerHTML = chunk;
        frag.appendChild(np);
      }
      p.replaceWith(frag);
    }
    // 2b. 直接包含文本的 div（无块级子元素、非结构容器）→ 就地转为 <p>
    for (const div of [...this.body.querySelectorAll('div')]) {
      if (div.querySelector('p,div,ul,ol,table,pre,figure,blockquote,h1,h2,h3,h4,h5,h6,img,video,iframe')) continue;
      const text = (div.textContent || '').trim();
      if (!text) { div.remove(); continue; }
      const p = document.createElement('p');
      p.append(...div.childNodes);
      div.replaceWith(p);
    }
  }

  /** 3. 文本列表：连续「• / - / * / 1.」开头的段落 → 语义列表。 */
  _restructureTextLists() {
    const UL_RE = /^[•·▪◦‣∙-]\s+/;
    const OL_RE = /^(\d{1,3})[.、)]\s+/;
    const blocks = [...this.body.children];
    let list = null; // 当前正在构建的 ul/ol
    const flush = () => { list = null; };
    for (const block of blocks) {
      if (block.tagName !== 'P') { flush(); continue; }
      const text = (block.textContent || '').trim();
      const ulMatch = text.match(UL_RE);
      const olMatch = text.match(OL_RE);
      if (!ulMatch && !olMatch) { flush(); continue; }
      const isOL = !ulMatch && olMatch;
      const tagName = isOL ? 'OL' : 'UL';
      if (!list || list.tagName !== tagName) {
        flush();
        list = document.createElement(tagName);
        block.replaceWith(list);
      } else {
        block.remove();
      }
      const li = document.createElement('li');
      // 保留行内格式，仅去掉列表标记
      const markerLen = (ulMatch ? ulMatch[0] : olMatch[0]).length;
      const clone = block.cloneNode(true);
      // 从第一个文本节点里剥掉标记
      const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
      const firstText = walker.nextNode();
      if (firstText) firstText.textContent = firstText.textContent.slice(markerLen);
      li.append(...clone.childNodes);
      list.appendChild(li);
    }
  }

  /** 4. 图片规整：只含图片（±空白文本）的段落 → <figure> + figcaption。 */
  _restructureFigures() {
    for (const p of [...this.body.querySelectorAll('p')]) {
      const imgs = p.querySelectorAll('img');
      if (imgs.length === 0) continue;
      const text = (p.textContent || '').trim();
      if (text.length > 0) continue; // 图文混排保持原样
      const fig = document.createElement('figure');
      fig.append(...p.childNodes);
      const alt = imgs[0]?.getAttribute('alt') || '';
      if (alt.trim() && alt.trim().length < 120) {
        const cap = document.createElement('figcaption');
        cap.textContent = alt.trim();
        fig.appendChild(cap);
      }
      p.replaceWith(fig);
    }
  }

  /**
   * 6. 多图并排画廊行：把「视觉上相邻」的连续纯图片块（p/div/figure 仅含 img、无文本）
   *    包进 .nj-img-row（flex 等高裁剪；≥3 张按两列换行，一组上限 6）。
   *    - 图文混排（img 与文本同块）绝不归组；中间隔着标题/文本块即断开
   *    - 打包只移动块位置、不改 img 节点本身：后续 _bindImages 仍直接在 img 上绑灯箱/懒加载
   *    - 在段落标注（_annotateParagraphs）之前执行，wrapper 不影响 data-nj-id 锚点
   */
  _restructureGalleryRows() {
    if (!this.body) return;
    const isPureImageBlock = (el) => {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
      const tag = el.tagName;
      if (tag !== 'P' && tag !== 'DIV' && tag !== 'FIGURE') return false;
      if (!el.querySelector('img')) return false;
      if ((el.textContent || '').trim().length > 0) return false; // 含任何文本（含 figcaption）不归组
      // 不允许携带其它结构（嵌套图组/代码/表格等）
      if (el.querySelector('pre, code, table, video, iframe, blockquote, ul, ol, dl, h1, h2, h3, h4, h5, h6, figure, figcaption, button, a.nj-annotation-icon')) return false;
      return true;
    };
    const blocks = [...this.body.children];
    let run = [];
    const flush = () => {
      // ≥2 才成行；一组最多 6 张，超过切成多组，切剩的单张保持原样
      while (run.length >= 2) {
        const group = run.slice(0, 6);
        run = run.slice(6);
        const row = document.createElement('div');
        row.className = 'nj-img-row' + (group.length > 2 ? ' nj-img-row-multi' : '');
        group[0].parentNode.insertBefore(row, group[0]);
        for (const block of group) row.appendChild(block);
      }
      run = [];
    };
    for (const block of blocks) {
      if (isPureImageBlock(block)) { run.push(block); continue; }
      flush();
    }
    flush();
  }

  /**
   * 代码语法高亮（vendor/highlight/highlight.min.js，UMD → window.hljs，CSP script-src 'self' 合法）。
   * 两级门控（对齐上游 PaperRss 的「language-* 门控」，并适配本项目实际）：
   * 1) pre > code（或 pre 上）带 language-* / lang-* 类 → 按语言精确高亮；
   * 2) 无标注块：仅当启发式判定「像多行代码」（CODE_HINT_RE + ≥2 行）才走 hljs.highlightAuto，
   *    且 relevance 达标才应用——入库 sanitizer（禁改）会剥掉 class 属性，RSS 链路拿不到语言
   *    标注，保守 auto 是该链路唯一可达的高亮路径；普通文本 relevance 极低，不会被误着色。
   * 高亮发生在段落标注 / 批注锚点之前；hljs 只拆分包裹文本节点、不改文本内容，
   * 因此翻译快照（plainText 去标签）与高亮重放（文本匹配包裹 mark）均不受影响。
   */
  _highlightCodeBlocks() {
    if (!this.body || typeof window.hljs === 'undefined' || !window.hljs.highlightElement) return;
    for (const block of this.body.querySelectorAll('pre > code')) {
      if (block.dataset.njHighlighted === '1') continue; // 重放幂等（hljs 自身也有 data-highlighted 守卫）
      // 语言类可能在 code 上，也可能写在 pre 上（个别 feed 的写法）
      const host = block.parentElement?.tagName === 'PRE' ? block.parentElement : null;
      const langClass = [...block.classList, ...(host ? [...host.classList] : [])]
        .find((c) => /^(?:language|lang)-[\w+#.-]+$/.test(c));
      try {
        if (langClass) {
          const lang = langClass.slice(langClass.indexOf('-') + 1).toLowerCase();
          if (!window.hljs.getLanguage(lang)) continue; // 未知语言标注：保守跳过，绝不高亮炸内容
          window.hljs.highlightElement(block);
          block.dataset.njHighlighted = '1';
        } else if (looksLikeCode(block.textContent)) {
          // 排除 markdown/plaintext：这两个语言对「任意英文文本」都能吃出非零 relevance，
          // 会把散文误着色；其余语言作为 auto 检测子集（构建缺失时 listLanguages 兜底为空 → 全量）
          const subset = (typeof window.hljs.listLanguages === 'function')
            ? window.hljs.listLanguages().filter((l) => !CODE_AUTO_NOISE_LANGS.has(l))
            : [];
          const result = window.hljs.highlightAuto(block.textContent, subset);
          if (result && result.value && result.relevance >= CODE_AUTO_MIN_RELEVANCE) {
            block.innerHTML = result.value; // hljs 输出：内部已转义原文，仅注入 hljs span
            block.classList.add('hljs');
            block.dataset.njHighlighted = '1';
            block.dataset.njAutoHighlighted = '1';
          }
        }
      } catch (_) { /* 单块失败不影响其余 */ }
    }
  }

  /**
   * 数学公式（KaTeX，stretch 能力）：仅当正文文本检测到 TeX 分隔符
   * （$$...$$ / \[...\] / \(...\)）才动态注入 vendor 资源并渲染——普通文章零开销。
   * 渲染只替换文本节点为 .nj-katex span：在代码高亮之后、批注锚点之前发起；
   * 加载是异步的，但替换不触碰块结构，data-nj-id 锚点与翻译收集不受影响。
   * 单 $ 分隔符误判风险大，刻意不支持。失败（vendor 缺失/公式非法）回退原文本。
   */
  _renderMath() {
    if (!this.body || this.body.dataset.njMathDone === '1') return;
    const text = this.body.textContent || '';
    if (!KATEX_DETECT_RE.test(text)) return; // 无公式：一次正则即返回
    this.body.dataset.njMathDone = '1';
    ensureKatexReady()
      .then((katex) => this._applyMath(katex))
      .catch(() => { /* vendor 缺失或加载失败：保留原文本 */ });
  }

  _applyMath(katex) {
    if (!this.body || !katex?.render) return;
    const walker = document.createTreeWalker(this.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const el = node.parentElement;
        // 跳过代码块（pre/code 内的 $$ 是代码不是公式）与已渲染节点
        if (!el || el.closest('pre, code, .nj-katex')) return NodeFilter.FILTER_REJECT;
        return KATEX_SPAN_RE.test(node.textContent) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
    for (const node of nodes) {
      if (!node.parentNode) continue;
      try {
        const frag = katexReplacementFragments(katex, node.textContent);
        if (frag) node.parentNode.replaceChild(frag, node);
      } catch (_) { /* 单节点公式非法：整节点回退原文本 */ }
    }
  }

  /** 5. 尾部垃圾：空链接、分享/订阅/相关文章区块（保守关键词）。 */
  _stripJunkTail() {
    // 空链接
    this.body.querySelectorAll('a').forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (href === '#' || href === '' || /^javascript:/i.test(href)) {
        a.replaceWith(...a.childNodes);
      }
    });

    // wechat2rss 桥接残留：「跳转微信打开」链接（整段剥掉）
    this.body.querySelectorAll('a').forEach((a) => {
      if ((a.textContent || '').trim() === '跳转微信打开') {
        const p = a.closest('p');
        if (p && (p.textContent || '').trim() === '跳转微信打开') p.remove();
        else a.replaceWith(...a.childNodes);
      }
    });

    // 微信/公众号文章开头的元信息头：「原创 作者 YYYY-MM-DD HH:mm 地点」或「来源名 日期 时间 地点」
    // （wechat2rss 抓取时把微信的元信息混进了正文前几段）。遍历前 3 个段，只做高置信剥离。
    const leadBlocks = [...this.body.querySelectorAll('p')].slice(0, 3);
    for (const p of leadBlocks) {
      let text = (p.textContent || '').trim();
      if (!text) continue;
      // 1) 剥「原创 作者 YYYY-MM-DD HH:mm」元信息前缀（到时间戳为止）+ 紧随的地点
      const metaMatch = text.match(/^[\s\S]{0,80}?\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/);
      if (metaMatch) {
        text = text.slice(metaMatch[0].length).trim();
        text = text.replace(/^[\u4e00-\u9fff]{1,3}(?=\s|$)/, '').trim();
      }
      // 2) 剥完后是纯地点（1-4 字中文）→ 整段删
      if (text && /^[\u4e00-\u9fff]{1,4}$/.test(text)) { p.remove(); continue; }
      // 3) 整段是纯来源标注「出品|作者|编辑|头图|来源」（竖线密集且短）→ 整段删
      if (text && /出品|作者|编辑|头图|来源/.test(text)
        && (text.match(/[|｜:：]/g) || []).length >= 2 && text.length < 150) {
        p.remove(); continue;
      }
      // 4) AIHOT item 页元信息片段：AI 编辑部评分 / 相对时间 / AI 导读标签（Readability 提取时混入的 UI 元素）
      text = text
        .replace(/\d*\s*AI\s*编辑部评分[，,：:]?\s*满分\s*\d+/g, ' ')
        .replace(/·\s*\d+\s*(?:分钟|小时|天)前/g, ' ')
        .replace(/AI\s*导读/g, ' ')
        .replace(/\s{2,}/g, ' ').trim();
      // 5) 回写（仅当有变化）
      if (text !== (p.textContent || '').trim()) p.textContent = text;
    }

    // 公众号/媒体尾部声明、推广、订阅垃圾（仅在文末 30% 区域，保守剔除）。
    // ⚠️ 只处理叶子块（p/li/blockquote/figure），绝不碰容器 div——正文可能整体包在一个大 div 里，
    // 遍历 children 会把整个容器当垃圾删掉（APPSO 曾被删到只剩 36 字）。
    const tailJunk = /(跳转微信打开|©\s*THE\s*END|转载请联系|未经允许不得转载|授权事宜请联系|点击下方|看完记得|添加到我的小程序|欢迎留言一起参与讨论|本内容未经允许|本文阅读时间：约|投稿或寻求报道|简历投递邮箱|邮件标题|我们正在招募|sign\s*up|subscribe|newsletter|follow\s*us|share\s*this|related\s*posts?)/i;
    const leafs = [...this.body.querySelectorAll('p, li, blockquote, figcaption')];
    for (let i = leafs.length - 1; i >= Math.max(0, leafs.length * 0.7); i--) {
      const el = leafs[i];
      const text = (el.textContent || '').trim();
      if (text && text.length < 200 && tailJunk.test(text)) el.remove();
    }

    // 「相关文章 / Related posts / 分享 / 订阅」类尾部区块
    const junkRe = /^(相关文章|相关阅读|延伸阅读|related posts?|share this|subscribe|newsletter|分享到|订阅|read more|继续阅读|查看更多)\s*$/i;
    const blocks = [...this.body.children];
    let cutting = false;
    for (const el of blocks) {
      const ownText = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('').trim();
      const headingText = /^H[1-6]$/.test(el.tagName) ? (el.textContent || '').trim() : '';
      if (!cutting && (junkRe.test(ownText) || junkRe.test(headingText))) {
        // 标题命中且位于文末 40% 区域才切断，避免误伤正文小节
        const index = blocks.indexOf(el);
        if (index >= Math.floor(blocks.length * 0.6)) cutting = true;
      }
      if (cutting) el.remove();
    }
  }

  _annotateParagraphs() {
    if (!this.body) return;
    const blocks = this.body.querySelectorAll('p,div,li,blockquote,pre,h1,h2,h3,h4,h5,h6,figcaption,dt,dd');
    let index = 0;
    for (const block of blocks) {
      if (!block.dataset.njId) {
        block.dataset.njId = `p${index}`;
        index += 1;
      }
    }
  }

  /**
   * 逐句双语：把英文正文的叶子段落按句子包进 <span class="nj-s" data-sent="pNsM">。
   * - 只在英文文章上包裹（中文文章不翻译，无需扰动 DOM）
   * - 只处理「叶子」块（无嵌套块级内容、非 pre/table/媒体）
   * - 句界只落在顶层文本节点上；行内元素（链接/加粗）整体归属其所在句，绝不被切断
   * - 包裹是确定性的：同一正文重复打开得到相同的句 ID（缓存可复用）
   */
  _wrapSentenceUnits() {
    if (!this.body || !this._isEnglishArticle()) return;
    for (const block of this.body.querySelectorAll('[data-nj-id]')) {
      if (block.querySelector('[data-nj-id]')) continue; // 容器块：只翻叶子
      if (block.querySelector('pre, table, img, video, iframe, figure')) continue;
      const text = (block.textContent || '').trim();
      if (text.length < 2) continue;
      try {
        this._wrapBlockSentences(block);
      } catch (_) {
        // 单块包裹失败（怪异 DOM）：清理半包状态，降级为整段翻译单元
        block.querySelectorAll('.nj-s[data-sent]').forEach((span) => {
          const parent2 = span.parentNode;
          if (!parent2) return;
          while (span.firstChild) parent2.insertBefore(span.firstChild, span);
          span.remove();
        });
      }
    }
  }

  _wrapBlockSentences(block) {
    const pid = block.dataset.njId;
    const INLINE_TAGS = new Set(['A', 'STRONG', 'B', 'EM', 'I', 'CODE', 'SPAN', 'SMALL', 'SUB', 'SUP', 'U', 'MARK', 'ABBR', 'CITE', 'Q', 'TIME', 'S', 'DEL', 'INS', 'KBD', 'SAMP', 'VAR']);
    // 把子节点组织为若干「行内片段 run」（连续的文本/行内元素），块级子节点作为 run 边界
    const runs = [];
    let current = null;
    for (const node of [...block.childNodes]) {
      const isInline = node.nodeType === Node.TEXT_NODE
        || (node.nodeType === Node.ELEMENT_NODE && INLINE_TAGS.has(node.tagName) && node.tagName !== 'BR');
      if (node.nodeName === 'BR') {
        current = null; // <br> 视为句界
        continue;
      }
      if (isInline) {
        if (!current) { current = { nodes: [] }; runs.push(current); }
        current.nodes.push(node);
      } else {
        current = null;
      }
    }
    let sentNo = 0;
    for (const run of runs) {
      // run 的拼接文本 + 每个原子的区间
      let text = '';
      const atoms = run.nodes.map((node) => {
        const atom = { node, start: text.length, end: text.length + node.textContent.length, isText: node.nodeType === Node.TEXT_NODE };
        text += node.textContent;
        return atom;
      });
      if (!text.trim()) continue;
      // 占位标记：构建 frag 过程中原子节点会被移走，用 marker 固定插入点
      const anchor = run.nodes[0];
      const parent = anchor.parentNode;
      const marker = document.createComment('nj-wrap');
      parent.insertBefore(marker, anchor);
      const boundaries = sentenceBoundaries(text); // 升序的句尾偏移（相对 run 文本）
      const frag = document.createDocumentFragment();
      const makeSpan = () => {
        const span = document.createElement('span');
        span.className = 'nj-s';
        span.dataset.sent = `${pid}s${sentNo}`;
        sentNo += 1;
        return span;
      };
      let span = makeSpan();
      let consumed = 0; // 已消费的 boundary 数
      const closeSpan = () => { frag.appendChild(span); span = makeSpan(); };
      for (const atom of atoms) {
        if (atom.isText) {
          let node = atom.node;
          let base = atom.start;
          while (node) {
            const len = node.textContent.length;
            let cut = null;
            while (consumed < boundaries.length && boundaries[consumed] <= base) consumed += 1;
            for (let k = consumed; k < boundaries.length; k += 1) {
              if (boundaries[k] > base && boundaries[k] < base + len) { cut = boundaries[k] - base; consumed = k; break; }
            }
            if (cut == null) { span.appendChild(node); break; }
            const rest = node.splitText(cut);
            span.appendChild(node);
            closeSpan();
            node = rest; base += cut;
          }
        } else {
          span.appendChild(atom.node);
          // 行内元素整体归属当前句：吞掉其内部的边界，句界顺延到元素末尾
          while (consumed < boundaries.length && boundaries[consumed] < atom.end) consumed += 1;
          if (consumed < boundaries.length && boundaries[consumed] === atom.end) { closeSpan(); consumed += 1; }
        }
      }
      frag.appendChild(span);
      parent.replaceChild(frag, marker);
    }
  }

  _interceptLinks() {
    this.body.querySelectorAll('a[href]').forEach((anchor) => {
      anchor.addEventListener('click', (event) => {
        event.preventDefault();
        const href = anchor.getAttribute('href');
        if (href && /^https?:/i.test(href)) window.robin.openLink(href);
      });
    });
  }

  _bindImages() {
    this._imgObserver?.disconnect();
    // 懒加载策略：前 4 张（首屏）立即加载，其余用 IntersectionObserver 在接近视口时预加载——
    // 避免全部 eager 导致几十张图并发请求（wechat2rss 等代理慢时反而更卡）
    if (!('IntersectionObserver' in window)) {
      this.body.querySelectorAll('img').forEach((img) => { img.loading = 'eager'; this._decorateImage(img); });
      return;
    }
    this._imgObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const img = entry.target;
          img.loading = 'eager';
          this._imgObserver.unobserve(img);
        }
      }
    }, { rootMargin: '900px 0px' });
    const imgs = this.body.querySelectorAll('img');
    imgs.forEach((img, idx) => {
      this._decorateImage(img);
      if (idx < 4) img.loading = 'eager';
      else { img.loading = 'lazy'; this._imgObserver.observe(img); }
    });
  }

  _decorateImage(img) {
    img.decoding = 'async';
    img.classList.add('nj-img');
    let src = (img.getAttribute('src') || '').trim();
    // 绕过 wechat2rss img-proxy：直接加载真实图片（mmbiz.qpic.cn 等）。
    // 该代理是境外服务器且 k token 会过期（403），是微信图片加载慢/失败的根源。
    if (/img-proxy/.test(src)) {
      try {
        const decoded = src.replace(/&amp;/g, '&');
        const u = new URL(decoded).searchParams.get('u');
        if (u) {
          const real = decodeURIComponent(u);
          if (/^https?:\/\//.test(real)) { src = real; img.src = real; }
        }
      } catch (_) { /* 解析失败保持原样 */ }
    }
    if (!src || /^data:|1x1|pixel|blank/i.test(src)) {
      for (const attr of ['data-src', 'data-original', 'data-lazy-src', 'data-actualsrc', 'data-imgurl']) {
        const real = img.getAttribute(attr);
        if (real) { img.src = real; break; }
      }
    }
    // 加载状态：加载中 shimmer 占位 / 失败优雅兜底（不再显示浏览器破图图标）
    const markState = () => {
      if (img.complete) {
        if (img.naturalWidth > 0) img.classList.remove('nj-img-loading', 'nj-img-failed');
        else img.classList.add('nj-img-failed');
      } else {
        img.classList.add('nj-img-loading');
      }
    };
    img.addEventListener('load', () => img.classList.remove('nj-img-loading', 'nj-img-failed'));
    img.addEventListener('error', () => {
      img.classList.remove('nj-img-loading');
      img.classList.add('nj-img-failed');
      img.title = t('图片加载失败（可能是源站防盗链或代理失效）');
    });
    markState();
    img.addEventListener('click', () => {
      if (img.naturalWidth > 0) this._showLightbox(img.src, img.alt || '');
    });
  }

  // MARK: - 摘要卡（summaryCardHTML 三态 1:1）

  _renderSummaryCard() {
    const card = this.summaryCard;
    const llm = window.__robinLLM || {};
    if (!llm.showsAISummary) {
      card.style.display = 'none';
      return;
    }
    card.style.display = '';
    card.className = 'robin-summary-card';
    card.id = 'robin-summary-card';
    card.title = `${t('AI 摘要')} (V)`;

    const artifact = this.summary.streaming
      ? { content: this.summary.streaming, isComplete: false }
      : this.summary.artifact;

    if (artifact && artifact.content) {
      const expanded = this.summary.expanded;
      card.classList.add(expanded ? 'is-expanded' : 'is-collapsed');
      const preview = firstSentence(artifact.content);
      const subtext = expanded ? '' : `<span class="robin-summary-subtext">${escapeHTML(preview)}</span>`;

      let footer = '';
      if (!artifact.isComplete) {
        if (this.summary.generating || this.summary.streaming) {
          footer = `<div class="robin-summary-status"><span class="robin-spinner"></span><span>${escapeHTML(t('AI 正在生成摘要…'))}</span></div>`;
        } else {
          footer = `<div class="robin-summary-status"><span>${escapeHTML(t('上次生成未完成'))}</span><button class="robin-summary-action-btn" data-action="regenerate">${escapeHTML(t('重新生成'))}</button></div>`;
        }
      } else {
        footer = `<div class="robin-summary-feedback">
          <span class="robin-summary-feedback-label">${escapeHTML(t('这条摘要怎么样？'))}</span>
          <button class="robin-summary-feedback-btn" data-action="feedback" data-rating="1" title="${attr(t('有帮助'))}">👍</button>
          <button class="robin-summary-feedback-btn" data-action="feedback" data-rating="-1" title="${attr(t('没帮助'))}">👎</button>
        </div>`;
      }

      card.innerHTML = `
        <div class="robin-summary-header">
          <div class="robin-summary-header-left">
            <span class="robin-summary-title">${escapeHTML(t('Ai摘要'))}</span>
            ${subtext}
          </div>
          <button class="robin-summary-ai-btn" data-action="toggle">${expanded ? icon('chevronDown') : icon('chevronRight')}</button>
        </div>
        <div class="robin-summary-body ${expanded ? 'expanded' : 'collapsed'}">
          <div class="robin-summary-text">${renderMarkdown(artifact.content)}</div>
          ${footer}
        </div>`;
    } else if (this.summary.generating) {
      card.classList.add('generating');
      card.innerHTML = `
        <div class="robin-summary-header">
          <div class="robin-summary-header-left">
            <span class="robin-summary-title">${escapeHTML(t('Ai摘要'))}</span>
            <span class="robin-summary-subtext"><span class="robin-spinner"></span> ${escapeHTML(t('正在生成，完成后会自动显示。'))}</span>
          </div>
          <button class="robin-summary-ai-btn">${icon('chevronRight')}</button>
        </div>`;
    } else {
      card.classList.add('ungenerated');
      const errLine = this.summary.error
        ? `<span class="robin-summary-subtext" style="color:#c93b3b">${escapeHTML(this.summary.error)}</span>`
        : `<span class="robin-summary-subtext">${escapeHTML(t('尚未生成，点击后发送正文生成摘要'))}</span>`;
      card.innerHTML = `
        <div class="robin-summary-header">
          <div class="robin-summary-header-left">
            <span class="robin-summary-title">${escapeHTML(t('Ai摘要'))}</span>
            ${errLine}
          </div>
          <button class="robin-summary-ai-btn">${icon('chevronRight')}</button>
        </div>`;
    }
  }

  toggleSummary() {
    if (!this.summary.artifact && !this.summary.streaming) {
      this.generateSummary(false);
      return;
    }
    this.summary.expanded = !this.summary.expanded;
    this._renderSummaryCard();
  }

  /** 提交 AI 回答反馈（点赞/点踩），闭环到自进化引擎。 */
  async _submitFeedback(kind, rating, buttonEl = null) {
    if (!this.entryID) return;
    await window.robin.evoFeedback({ itemID: this.entryID, kind, rating });
    if (buttonEl) {
      const host = buttonEl.parentElement;
      host.querySelectorAll('.robin-summary-feedback-btn').forEach((b) => b.classList.remove('active'));
      buttonEl.classList.add('active');
      const label = host.querySelector('.robin-summary-feedback-label');
      if (label) label.textContent = rating > 0 ? t('已记录：有帮助') : t('已记录：没帮助');
    }
  }

  async generateSummary(force) {
    if (!this.entryID) return;
    if (this.summary.generating) {
      this.handlers.onFeedback?.(t('已有 AI 摘要任务正在进行，请稍后再试。'));
      return;
    }
    const text = this._articleText();
    if (!text) {
      this.handlers.onFeedback?.(t('文章暂无正文内容，无法生成摘要。'));
      return;
    }
    this.summary.generating = true;
    this.summary.expanded = true;
    this.summary.error = null;
    this._renderSummaryCard();

    const result = await window.robin.generateSummary(this.entryID);
    this.summary.generating = false;
    this.summary.streaming = '';
    if (result.ok && result.data) {
      this.summary.artifact = result.data;
    } else {
      // 失败可见化：显示错误而非静默回到「尚未生成」
      this.summary.error = result.error || t('生成失败');
      this.handlers.onFeedback?.(`${t('AI 摘要生成失败')}：${this.summary.error}`);
    }
    this._renderSummaryCard();
  }

  onSummaryDelta(payload) {
    if (payload.entryID !== this.entryID) return;
    if (payload.content !== undefined) this.summary.streaming = payload.content;
    if (this.summaryCard && !this.summary.artifact) {
      this.summary.generating = true;
      this._renderSummaryCard();
    }
  }

  onAIStatus(payload) {
    if (!payload?.key?.startsWith('summary:')) return;
    if (payload.key.slice('summary:'.length) !== this.entryID) return;
    if (payload.state === 'failed') {
      this.summary.generating = false;
      this.summary.streaming = '';
      this._renderSummaryCard();
      const body = this.summaryCard?.querySelector('.robin-summary-text');
      if (body && payload.message) {
        const status = document.createElement('div');
        status.className = 'robin-summary-status';
        // 走 data-action 交给摘要卡的委托监听分发；按钮自带监听会与委托叠加
        status.innerHTML = `<span class="robin-summary-error">${escapeHTML(payload.message)}</span>
          <button class="robin-summary-action-btn" data-action="regenerate">${escapeHTML(t('重新生成'))}</button>`;
        this.summaryCard.querySelector('.robin-summary-body')?.appendChild(status);
      }
    }
  }

  // MARK: - 双语翻译（视口驱动）

  /** 当前翻译模式：off / bilingual（双语）/ zh（仅中文）。 */
  get translateMode() {
    return this._translateMode || 'off';
  }

  /** 公开：设置翻译模式（菜单入口），带反馈并刷新按钮状态由调用方负责。 */
  setTranslateMode(mode) {
    if (!this.html) {
      this.handlers.onFeedback?.(t('文章暂无正文内容，无法翻译。'));
      return;
    }
    if (mode !== 'off' && window.__robinLLM?.__hasKey === false) {
      this.handlers.onFeedback?.(t('AI 尚未配置 API Key：请到 设置 → AI 服务商与连接 填写并保存后重试。'));
      return;
    }
    if (mode !== 'off') this._translateAll = true; // 手动触发 = 翻译全文（按序连续补齐，不只追视口）
    this._setTranslateMode(mode === 'zh' ? 'zh' : mode === 'bilingual' ? 'bilingual' : 'off');
  }

  /** 公开：当前文章是否为中文（供菜单提示「无需翻译」）。 */
  isChineseArticle() {
    if (!this.body) return false;
    const text = this.body.textContent || '';
    if (text.replace(/\s+/g, '').length < 100) return false;
    const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const letters = (text.match(/[A-Za-z]/g) || []).length;
    return cjk > letters * 2;
  }

  /** 外部（设置变化）应用翻译模式。 */
  applyTranslateMode(mode) {
    if (mode === this.translateMode) return;
    this._setTranslateMode(mode === 'zh' ? 'zh' : mode === 'bilingual' ? 'bilingual' : 'off', { silent: true });
  }

  _setTranslateMode(mode, { silent = false } = {}) {
    this._translateMode = mode;
    this.bilingualActive = mode !== 'off';
    const labels = { off: t('翻译：关闭'), bilingual: t('翻译：双语对照'), zh: t('翻译：仅中文') };
    this.handlers.onFeedback?.(labels[mode]);
    if (mode === 'off') {
      this._translateAll = false;
      this.body?.querySelectorAll('.nj-translation, .nj-t').forEach((el) => el.remove());
      this.body?.classList.remove('translate-zh', 'translate-active');
      document.getElementById('nj-translate-progress')?.remove();
      document.getElementById('nj-translation-title')?.remove();
      return;
    }
    // translate-active：句子单元成行（原文一句一行 + 译文紧随），
    // 避免行内句子被块级译文拦腰截断导致正文碎片堆叠
    this.body?.classList.add('translate-active');
    this.body?.classList.toggle('translate-zh', mode === 'zh');
    // 先刷新可见段落，避免打开时立即点翻译导致 visibleIDs 为空
    this._publishVisible();
    this._requestVisibleTranslations();
    // 已翻译段落立即应用显示模式
    this._applyTranslateVisibility();
  }

  /** 翻译按钮：循环切换 关闭 → 双语 → 仅中文 → 关闭。 */
  toggleBilingual() {
    if (!this.html) {
      this.handlers.onFeedback?.(t('文章暂无正文内容，无法翻译。'));
      return;
    }
    const order = ['off', 'bilingual', 'zh'];
    const next = order[(order.indexOf(this.translateMode) + 1) % order.length];
    if (next !== 'off') this._translateAll = true; // 手动触发 = 翻译全文
    this._setTranslateMode(next);
  }

  /** 仅中文模式：整段单元隐藏原文（句子单元由 CSS 控制：.translate-zh .nj-s 隐藏）。 */
  _applyTranslateVisibility() {
    if (!this.body) return;
    const zhOnly = this.translateMode === 'zh';
    for (const segment of this.segments) {
      if (segment.parentId) continue; // 句子单元：显示切换交给 CSS
      const block = this.body.querySelector(`[data-nj-id="${cssEscape(segment.id)}"]`);
      if (block) block.classList.toggle('origin-hidden', zhOnly);
      const aside = document.getElementById(`nj-translation-${segment.id}`);
      if (aside) aside.classList.toggle('in-zh-mode', zhOnly);
    }
  }

  /** 传给主进程的正文快照：带段落/句子 ID 的当前 DOM（两端单元口径完全一致）。
   *  必须剥离已注入的译文元素与显示类，否则注入前后哈希不一致 → 缓存失效、重复请求模型。 */
  _annotatedHTML() {
    if (!this.body) return this.html;
    const snapshot = this.body.cloneNode(true);
    snapshot.querySelectorAll('.nj-t, .nj-translation').forEach((el) => el.remove());
    // 高亮标记也须剥离（保留子文本）：否则加/删高亮会改变哈希 → 翻译缓存失效
    snapshot.querySelectorAll('mark.nj-hl').forEach((el) => el.replaceWith(...el.childNodes));
    snapshot.querySelectorAll('.origin-hidden').forEach((el) => el.classList.remove('origin-hidden'));
    return snapshot.innerHTML;
  }

  /** 正文是否为英文（ASCII 字母占比 + 长度阈值）。用 textContent：不依赖布局，隐藏窗口也可判定。 */
  _isEnglishArticle() {
    if (!this.body) return false;
    const text = this.body.textContent || '';
    if (text.replace(/\s+/g, '').length < 200) return false;
    const letters = (text.match(/[A-Za-z]/g) || []).length;
    const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    return letters > cjk * 3 && letters / text.length > 0.5;
  }

  _publishVisible() {
    if (!this.body) return;
    const viewport = this.scrollEl.clientHeight || 1;
    const topBound = -viewport * 0.30;
    const bottomBound = viewport * 1.30;
    const visible = [];
    for (const block of this.body.querySelectorAll('[data-nj-id]')) {
      const rect = block.getBoundingClientRect();
      if (rect.bottom > topBound && rect.top < bottomBound) {
        visible.push(block.dataset.njId);
      }
    }
    const normalized = visible.slice(0, 10);
    if (JSON.stringify(normalized) !== JSON.stringify(this.visibleIDs)) {
      this.visibleIDs = normalized;
      if (this.bilingualActive) this._requestVisibleTranslations();
    }
  }

  async _requestVisibleTranslations() {
    if (!this.bilingualActive || !this.html || !this.entryID) return;
    // 串行化：主进程同一文章的翻译有互斥（requestInProgress），并发请求会被当作失败。
    // 忙时只标记排队，完成后再跑一轮补齐剩余句子。
    if (this._translationBusy) { this._translationQueued = true; return; }
    this._translationBusy = true;
    try {
      await this._translateBatch();
    } finally {
      this._translationBusy = false;
      this._refreshTranslateProgress();
      if (this._translationQueued && this.bilingualActive) {
        this._translationQueued = false;
        this._requestVisibleTranslations();
      } else {
        this._translationQueued = false;
      }
    }
  }

  /**
   * 翻译进度浮标（阅读区右下角）：慢 API 时给出「X/Y 句」推进反馈；
   * 全部完成时短暂显示「翻译完成」后自动消失。
   */
  _refreshTranslateProgress() {
    const host = this.scrollEl?.parentElement;
    if (!host) return;
    const pill = document.getElementById('nj-translate-progress');
    const totalUnits = (this.paragraphs || []).length;
    const doneUnits = (this.segments || []).filter((s) => s.translation).length;
    const active = this.bilingualActive && (this._translationBusy || this.pendingIDs.size > 0);
    if (!active) {
      if (pill && doneUnits > 0 && doneUnits >= totalUnits && totalUnits > 0) {
        pill.textContent = `${t('翻译完成')} · ${doneUnits}`;
        pill.classList.add('is-done');
        setTimeout(() => document.getElementById('nj-translate-progress')?.remove(), 1800);
      } else {
        pill?.remove();
      }
      return;
    }
    let el = pill;
    if (!el) {
      el = document.createElement('div');
      el.id = 'nj-translate-progress';
      el.className = 'translate-progress';
      host.appendChild(el);
    }
    el.classList.remove('is-done');
    el.textContent = `${t('翻译中')} ${doneUnits}/${totalUnits}`;
  }

  async _translateBatch() {
    const translatedIDs = new Set(this.segments.map((s) => s.id));
    // 翻译单元 = 句子；手动触发后全文连续翻译（_translateAll），否则只翻视口
    const batch = this.paragraphs
      .filter((unit) =>
        !translatedIDs.has(unit.id)
          && !this.pendingIDs.has(unit.id)
          && (this.failedIDs.get(unit.id) ?? 0) < MAX_TRANSLATION_FAILURES
          && (unit.id === 'title' || this._translateAll || this.visibleIDs.includes(unit.parentId || unit.id)))
      .slice(0, VISIBLE_BATCH)
      .map((unit) => unit.id);
    if (batch.length === 0) return;

    for (const id of batch) {
      this.pendingIDs.add(id);
      this._injectPending(id);
    }
    this._refreshTranslateProgress();

    const result = await window.robin.translateParagraphs(this.entryID, this._annotatedHTML(), batch);
    for (const id of batch) this.pendingIDs.delete(id);

    if (!result.ok) {
      // 并发互斥：不算失败、不杀模式，排队重试即可
      if (result.error === 'requestInProgress' || /requestInProgress|进行中/.test(result.error || '')) {
        this._translationQueued = true;
        return;
      }
      for (const id of batch) {
        this.failedIDs.set(id, (this.failedIDs.get(id) ?? 0) + 1);
        this._removePending(id);
      }
      // 失败可见化（节流：同一会话同类错误只提示一次）。
      // 关键：必须走 _setTranslateMode('off') 完整恢复原文显示——
      // 否则 translate-zh 类残留会让「仅中文」模式下的正文永久消失。
      if (!this._translationErrorShown) {
        this._translationErrorShown = true;
        this.handlers.onFeedback?.(`${t('翻译失败')}：${result.error || t('请检查 AI 设置')}`);
        if (this.translateMode !== 'off') this._setTranslateMode('off', { silent: true });
      }
      return;
    }
    const newSegments = result.data || [];
    this.segments.push(...newSegments);
    for (const segment of newSegments) {
      this.failedIDs.delete(segment.id);
      this._injectTranslations([segment.id]);
    }
    // 失败计数（远端未返回的段落）
    const returnedIDs = new Set(newSegments.map((s) => s.id));
    for (const id of batch) {
      if (!returnedIDs.has(id) && !this.segments.some((s) => s.id === id)) {
        this.failedIDs.set(id, (this.failedIDs.get(id) ?? 0) + 1);
        this._removePending(id);
      }
    }
    this._requestVisibleTranslations();
  }

  _injectTranslations(ids) {
    if (!this.body || !this.bilingualActive) return;
    for (const id of ids) {
      const segment = this.segments.find((s) => s.id === id);
      if (!segment) continue;
      // 标题译文：渲染到标题下方的副标题行（h1 在 header 内，不在 body 里）
      if (id === 'title') {
        this._removePending(id);
        document.getElementById('nj-translation-title')?.remove();
        if (!segment.translation?.trim()) continue;
        const h1 = this.scrollEl.querySelector('.robin-header-title');
        if (!h1) continue;
        const line = document.createElement('p');
        line.id = 'nj-translation-title';
        line.className = 'robin-title-translation';
        line.textContent = segment.translation.trim();
        h1.insertAdjacentElement('afterend', line);
        continue;
      }
      // 句子单元：译文行插入到对应句子的紧后方（逐句双语）
      const sentSpan = this.body.querySelector(`[data-sent="${cssEscape(id)}"]`);
      if (sentSpan) {
        this._removePending(id);
        document.getElementById(`nj-translation-${cssEscape(id)}`)?.remove();
        if (!segment.translation?.trim()) continue;
        const line = document.createElement('span');
        line.id = `nj-translation-${id}`;
        line.className = 'nj-t';
        line.textContent = segment.translation.trim();
        sentSpan.insertAdjacentElement('afterend', line);
        continue;
      }
      // 整段单元（未包裹句子的块 / 旧缓存）：沿用段后纸片
      const block = this.scrollEl.querySelector(`[data-nj-id="${cssEscape(id)}"]`);
      if (!block) continue;
      this._removePending(id);
      document.getElementById(`nj-translation-${cssEscape(id)}`)?.remove();
      block.insertAdjacentHTML('afterend', translationMarkup(segment.translation, id));
    }
    this._applyTranslateVisibility();
  }

  _injectPending(id) {
    if (id === 'title') {
      if (document.getElementById('nj-translation-title')) return;
      const h1 = this.scrollEl.querySelector('.robin-header-title');
      if (!h1) return;
      const line = document.createElement('p');
      line.id = 'nj-translation-title';
      line.className = 'robin-title-translation is-loading';
      line.textContent = t('正在翻译标题…');
      h1.insertAdjacentElement('afterend', line);
      return;
    }
    const sentSpan = this.body?.querySelector(`[data-sent="${cssEscape(id)}"]`);
    if (sentSpan) {
      if (document.getElementById(`nj-translation-${cssEscape(id)}`)) return;
      const line = document.createElement('span');
      line.id = `nj-translation-${id}`;
      line.className = 'nj-t is-loading';
      line.textContent = t('正在翻译…');
      sentSpan.insertAdjacentElement('afterend', line);
      return;
    }
    const block = this.body?.querySelector(`[data-nj-id="${cssEscape(id)}"]`);
    if (!block || document.getElementById(`nj-translation-${cssEscape(id)}`)) return;
    block.insertAdjacentHTML('afterend', pendingMarkup(id));
  }

  _removePending(id) {
    const el = document.getElementById(`nj-translation-${id}`);
    if (el?.classList.contains('is-loading')) el.remove();
  }

  // MARK: - 划词（胶囊 + 弹层 + 注释锚点）

  get selectionPopoverOpen() {
    return this.popover != null || this.selectionEl != null;
  }

  _onSelectionChange() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !this.body) return;
    // 弹窗打开期间不重弹胶囊：点击胶囊按钮后的 mouseup 兜底会再次触发本函数，
    // 而 _presentSelectionPill 会先 _dismissPopover() 把刚打开的弹窗杀掉（表现为「闪一下就没反应」）
    if (this.popover && Date.now() - (this._popoverOpenedAt || 0) < 600) return;
    if (this.popover) return;
    const text = String(selection);
    if (!text || text.length < 2 || text.length > 4000) return;
    const node = selection.anchorNode;
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (!element || !this.body.contains(element)) return;
    if (element.closest('.nj-translation, .nj-t, .robin-summary-card, .nj-selection-popover, .nj-selection-actions')) return;

    clearTimeout(this._selectionTimer);
    this._selectionTimer = setTimeout(() => {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      this._presentSelectionPill({
        selection: text,
        paragraphID: closestBlockID(element),
        anchor: rangeAnchor(element, selection, range),
        localContext: paragraphContext(element),
        rect,
        range: range.cloneRange(),
      });
    }, 260);
  }

  _presentSelectionPill(payload) {
    this._dismissPopover();
    this._dismissSelection();
    const llm = window.__robinLLM || {};
    const aiActions = [];
    if (llm.showsSelectionExplanation !== false) aiActions.push({ kind: 'explanation', svg: icon('spark'), title: t('解释所选文字') });
    if (llm.showsSelectionAsk !== false) aiActions.push({ kind: 'ask', svg: icon('question'), title: t('问 AI 所选文字') });
    if (llm.showsSelectionTranslation !== false) aiActions.push({ kind: 'translation', svg: icon('translate'), title: t('翻译所选文字') });
    // 批注组（本地能力，不依赖 AI 配置）：高亮（选色）+ 锚定笔记
    const annotActions = [
      { kind: 'highlight', svg: icon('marker'), title: t('高亮选中文字') },
      { kind: 'note', svg: icon('noteSticky'), title: t('对选中文字写笔记') },
    ];
    const actions = aiActions.length ? [...aiActions, { divider: true }, ...annotActions] : annotActions;
    if (actions.length === 0) return;

    const pill = document.createElement('div');
    pill.className = 'nj-selection-actions';
    for (const action of actions) {
      if (action.divider) {
        const divider = document.createElement('span');
        divider.className = 'nj-selection-divider';
        pill.appendChild(divider);
        continue;
      }
      const button = document.createElement('button');
      button.className = 'nj-selection-action';
      button.title = action.title;
      button.innerHTML = action.svg;
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => {
        if (action.kind === 'highlight') this._showHighlightColorPicker(payload);
        else if (action.kind === 'note') this._showSelectionNoteEditor(payload);
        else this._openPopover(action.kind, payload);
      });
      pill.appendChild(button);
    }
    document.body.appendChild(pill);
    this.selectionEl = pill;
    this.selectionPayload = payload;

    const pw = pill.getBoundingClientRect().width;
    let x = payload.rect.x + payload.rect.width / 2 - pw / 2;
    x = Math.max(10, Math.min(window.innerWidth - pw - 10, x));
    let y = payload.rect.y - 40;
    if (y < 60) y = payload.rect.y + payload.rect.height + 8;
    pill.style.left = `${x}px`;
    pill.style.top = `${y}px`;

    setTimeout(() => {
      this._selectionDismissHandler = (event) => {
        if (!pill.contains(event.target) && !this.popover?.contains(event.target)) this._dismissSelection();
      };
      document.addEventListener('mousedown', this._selectionDismissHandler);
    }, 0);
  }

  _dismissSelection() {
    if (this._selectionDismissHandler) {
      document.removeEventListener('mousedown', this._selectionDismissHandler);
      this._selectionDismissHandler = null;
    }
    this.selectionEl?.remove();
    this.selectionEl = null;
  }

  _openPopover(kind, payload) {
    this._dismissSelection();
    // AI 未就绪：不发起注定失败的请求，直接给出指引
    if (window.__robinLLM?.__hasKey === false) {
      this.handlers.onFeedback?.(t('AI 尚未配置 API Key：请到 设置 → AI 服务商与连接 填写并保存后重试。'));
      return;
    }
    const titles = {
      explanation: t('AI 解释'),
      ask: t('问 AI 答疑'),
      translation: t('翻译'),
    };
    const loading = {
      explanation: t('正在结合全文理解这段文字…（首次解释需先通读全文建立上下文，约半分钟，之后会秒出）'),
      ask: t('正在生成…'),
      translation: t('正在翻译…'),
    };

    const popover = document.createElement('div');
    popover.className = 'nj-selection-popover';
    popover.innerHTML = `
      <div class="nj-explanation-header">
        <span class="nj-icon">${kind === 'translation' ? icon('translate') : icon('spark')}</span>
        <span></span>
        <button class="close-btn">${icon('close')}</button>
      </div>
      ${kind === 'ask' ? `<div class="nj-question-row">
        <input class="nj-question-input" placeholder="${attr(t('针对划选文字提问...'))}"/>
        <button class="btn-text primary ask-send">${escapeHTML(t('发送提问'))}</button>
      </div>` : ''}
      <div class="nj-explanation-body loading"></div>
    `;
    popover.querySelector('.nj-explanation-header span').textContent = titles[kind];
    this._popoverOpenedAt = Date.now();
    // 标题栏拖动：弹窗可自由移动（问 AI 多轮对话时尤其重要）
    {
      const header = popover.querySelector('.nj-explanation-header');
      header.style.cursor = 'move';
      header.style.userSelect = 'none';
      header.addEventListener('pointerdown', (down) => {
        if (down.target.closest('.close-btn')) return;
        const startX = down.clientX;
        const startY = down.clientY;
        const baseLeft = parseFloat(popover.style.left || '0');
        const baseTop = parseFloat(popover.style.top || '0');
        // 指针捕获失败（合成事件/特殊设备）时退化为 document 级监听，拖动始终可用
        try { header.setPointerCapture(down.pointerId); } catch (_) { /* 双挂载兜底 */ }
        // 双挂载（header + document）：指针捕获失败或合成事件时拖动仍然可用；样式幂等可重复应用
        const onMoveAttached = (move) => {
          popover.dataset.dragged = '1';
          popover.style.left = `${baseLeft + (move.clientX - startX)}px`;
          popover.style.top = `${baseTop + (move.clientY - startY)}px`;
        };
        const onUpAttached = () => {
          header.removeEventListener('pointermove', onMoveAttached);
          document.removeEventListener('pointermove', onMoveAttached);
          header.removeEventListener('pointerup', onUpAttached);
          document.removeEventListener('pointerup', onUpAttached);
        };
        header.addEventListener('pointermove', onMoveAttached);
        document.addEventListener('pointermove', onMoveAttached);
        header.addEventListener('pointerup', onUpAttached);
        document.addEventListener('pointerup', onUpAttached);
      });
    }
    popover.querySelector('.close-btn').addEventListener('click', () => this._dismissPopover());
    document.body.appendChild(popover);
    this.popover = popover;

    const body = popover.querySelector('.nj-explanation-body');
    const position = () => {
      if (popover.dataset.dragged) return; // 用户已拖动：不再自动复位
      const rect = popover.getBoundingClientRect();
      let x = this.selectionPayload.rect.x + this.selectionPayload.rect.width / 2 - rect.width / 2;
      x = Math.max(12, Math.min(window.innerWidth - rect.width - 12, x));
      let y = this.selectionPayload.rect.y - rect.height - 12;
      if (y < 56) y = Math.min(window.innerHeight - rect.height - 12, this.selectionPayload.rect.y + this.selectionPayload.rect.height + 12);
      popover.style.left = `${x}px`;
      popover.style.top = `${y}px`;
    };
    position();

    const requestID = `sel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._activeRequestID = requestID;
    this._askHistory = this._askHistory || [];

    const run = (question = null) => {
      popover.querySelector('.nj-followup-row')?.remove();
      body.className = 'nj-explanation-body loading';
      body.textContent = loading[kind];
      const invoke = kind === 'explanation'
        ? (question ? window.robin.askSelection : window.robin.explainSelection)
        : kind === 'ask' ? window.robin.askSelection : window.robin.translateSelection;
      const call = kind === 'translation'
        ? invoke({ requestID, entryID: this.entryID, selection: payload.selection })
        : question
          ? window.robin.askSelection({ requestID, entryID: this.entryID, selection: payload.selection, question, localContext: payload.localContext, anchor: payload.anchor, history: this._askHistory })
          : window.robin.explainSelection({ requestID, entryID: this.entryID, selection: payload.selection, localContext: payload.localContext, anchor: payload.anchor });
      call.then((result) => {
        if (this.popover !== popover) return;
        body.className = `nj-explanation-body ${result.ok ? 'rendered' : 'error'}`;
        if (result.ok) {
          if (kind === 'explanation') this._lastExplanationText = result.data;
          body.innerHTML = renderMarkdown(result.data);
          if (question) {
            // 追问历史：供下一轮使用
            this._askHistory.push({ question, answer: result.data });
            if (this._askHistory.length > 6) this._askHistory.shift();
          }
          // 解释/提问类回答后展示追问输入框（多轮问答）
          if (kind !== 'translation') this._renderFollowup(payload);
        } else {
          body.textContent = result.error;
        }
        position();
      });
    };

    if (kind === 'ask') {
      const input = popover.querySelector('.nj-question-input');
      const send = popover.querySelector('.ask-send');
      send.addEventListener('click', () => {
        const question = input.value.trim();
        if (question) run(question);
      });
      input.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          const question = input.value.trim();
          if (question) run(question);
        }
      });
      setTimeout(() => input.focus(), 40);
    } else {
      run();
    }

    // 保存本轮 run 与 payload，供追问栏复用（多轮问答）
    this._popoverRun = run;
    this._popoverPayload = payload;
    this._popoverKind = kind;

    // 解释完成后插入锚点注释图标（对应 nj-annotation-icon）
    if (kind === 'explanation') {
      const observer = new MutationObserver(() => {
        if (!body.classList.contains('loading') && body.textContent) {
          observer.disconnect();
          this._insertAnnotationIcon(payload, this._lastExplanationText || body.textContent);
        }
      });
      observer.observe(body, { attributes: true, attributeFilter: ['class'] });
    }

    setTimeout(() => {
      this._popoverDismissHandler = (event) => {
        if (!popover.contains(event.target)) this._dismissPopover();
      };
      document.addEventListener('mousedown', this._popoverDismissHandler);
    }, 0);
  }

  /** 回答完成后在弹窗底部插入反馈 + 追问输入栏（多轮问答）。 */
  _renderFollowup(payload) {
    const popover = this.popover;
    if (!popover || popover.querySelector('.nj-followup-row')) return;
    // 反馈按钮行
    const fb = document.createElement('div');
    fb.className = 'nj-followup-row nj-feedback-row';
    fb.innerHTML = `
      <span class="robin-summary-feedback-label">${escapeHTML(t('有帮助吗？'))}</span>
      <button class="robin-summary-feedback-btn" data-rating="1" title="${attr(t('有帮助'))}">👍</button>
      <button class="robin-summary-feedback-btn" data-rating="-1" title="${attr(t('没帮助'))}">👎</button>`;
    fb.querySelectorAll('.robin-summary-feedback-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const rating = Number(btn.dataset.rating);
        await this._submitFeedback(this._popoverKind || 'selection', rating, btn);
      });
    });
    popover.appendChild(fb);

    const row = document.createElement('div');
    row.className = 'nj-followup-row';
    row.innerHTML = `
      <input class="nj-question-input" placeholder="${attr(t('继续追问…（Enter 发送）'))}"/>
      <button class="btn-text primary followup-send">${escapeHTML(t('追问'))}</button>`;
    const input = row.querySelector('input');
    const send = row.querySelector('.followup-send');
    const submit = () => {
      const question = input.value.trim();
      if (!question) return;
      input.value = '';
      this._popoverRun?.(question);
    };
    send.addEventListener('click', submit);
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') submit();
    });
    popover.appendChild(row);
    setTimeout(() => input.focus(), 40);
  }

  onSelectionDelta(payload) {
    if (payload.requestID !== this._activeRequestID) return;
    const body = this.popover?.querySelector('.nj-explanation-body');
    if (body && body.classList.contains('loading')) {
      body.className = 'nj-explanation-body';
      body.textContent = '';
    }
    if (body) {
      body.textContent += payload.delta;
      body.scrollTop = body.scrollHeight;
    }
  }

  _dismissPopover() {
    if (this._popoverDismissHandler) {
      document.removeEventListener('mousedown', this._popoverDismissHandler);
      this._popoverDismissHandler = null;
    }
    this._popoverRun = null;
    this._popoverPayload = null;
    this.popover?.remove();
    this.popover = null;
  }

  _insertAnnotationIcon(payload, content) {
    if (!payload.anchor || !this.body) return;
    const block = this.body.querySelector(`[data-nj-id="${cssEscape(payload.anchor.paragraphID)}"]`);
    if (!block) return;
    const iconEl = document.createElement('span');
    iconEl.className = 'nj-annotation-icon';
    iconEl.title = t('点击重新查看 AI 解释');
    iconEl.innerHTML = icon('spark');
    iconEl.addEventListener('click', () => {
      this.selectionPayload = { ...payload, rect: iconEl.getBoundingClientRect() };
      this._openPopover('explanation', { ...payload, selection: payload.selection });
      const body = this.popover?.querySelector('.nj-explanation-body');
      if (body) {
        body.className = 'nj-explanation-body rendered';
        body.innerHTML = renderMarkdown(content);
      }
    });
    block.appendChild(iconEl);
  }

  _restoreAnnotations() {
    if (!this.annotations?.length || !this.body) return;
    for (const annotation of this.annotations) {
      if (!annotation.anchor?.paragraphID) continue;
      this._insertAnnotationIcon({
        selection: annotation.selection,
        anchor: annotation.anchor,
        paragraphID: annotation.anchor.paragraphID,
        localContext: '',
      }, annotation.content);
    }
  }

  // MARK: - 批注系统（高亮 / 段落笔记 / 批注面板）

  /** 顶部胶囊「高亮」：有选区 → 快速黄色高亮；无选区 → 打开批注面板。 */
  capsuleHighlight(selectionText = '') {
    const selection = (selectionText || window.getSelection()?.toString() || '').trim();
    if (selection.length > 2) {
      const payload = this._selectionPayloadFor(selection);
      if (payload) {
        this._doHighlight(payload, 'yellow');
        return;
      }
    }
    this.toggleAnnotationsPanel();
  }

  /** 顶部胶囊「笔记」：打开批注面板。 */
  capsuleNote() {
    this.toggleAnnotationsPanel();
  }

  /** H 快捷键：对当前选区快速高亮（黄色）。 */
  quickHighlightSelection() {
    const selection = window.getSelection()?.toString()?.trim() || '';
    if (selection.length <= 2) return false;
    const payload = this._selectionPayloadFor(selection);
    if (!payload) return false;
    this._doHighlight(payload, 'yellow');
    return true;
  }

  /** 由当前活跃选区构造划词 payload（供快捷键 / 顶部胶囊路径）。 */
  _selectionPayloadFor(selectionText) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !this.body) return null;
    const text = String(selection);
    const node = selection.anchorNode;
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (!element || !this.body.contains(element)) return null;
    if (element.closest('.nj-translation, .nj-t, .paper-summary-card, .nj-selection-popover, .nj-selection-actions')) return null;
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    return {
      selection: text,
      paragraphID: closestBlockID(element),
      anchor: rangeAnchor(element, selection, range),
      localContext: paragraphContext(element),
      rect,
      range: range.cloneRange(),
    };
  }

  /** 划词「高亮」：展开 5 色选择条（替换原胶囊）。 */
  _showHighlightColorPicker(payload) {
    this._dismissSelection();
    const pill = document.createElement('div');
    pill.className = 'nj-selection-actions nj-hl-picker';
    const label = document.createElement('span');
    label.className = 'nj-hl-picker-label';
    label.textContent = t('高亮');
    pill.appendChild(label);
    for (const color of HIGHLIGHT_COLORS) {
      const dot = document.createElement('button');
      dot.className = 'nj-hl-dot';
      dot.title = color.label;
      dot.innerHTML = `<span class="nj-hl-dot-core" style="background:${color.swatch}"></span>`;
      dot.addEventListener('mousedown', (event) => event.preventDefault());
      dot.addEventListener('click', () => {
        pill.remove();
        this._doHighlight(payload, color.key);
      });
      pill.appendChild(dot);
    }
    document.body.appendChild(pill);
    const pw = pill.getBoundingClientRect().width;
    let x = payload.rect.x + payload.rect.width / 2 - pw / 2;
    x = Math.max(10, Math.min(window.innerWidth - pw - 10, x));
    let y = payload.rect.y - 40;
    if (y < 60) y = payload.rect.y + payload.rect.height + 8;
    pill.style.left = `${x}px`;
    pill.style.top = `${y}px`;
    setTimeout(() => {
      const handler = (event) => { if (!pill.contains(event.target)) pill.remove(); };
      document.addEventListener('mousedown', handler, { once: true });
    }, 0);
    window.getSelection?.()?.removeAllRanges?.();
  }

  /** 创建高亮：包裹当前选区 + 落库 + 挂点击菜单。 */
  async _doHighlight(payload, color) {
    if (!this.entryID || !payload?.selection) return;
    const text = payload.selection.slice(0, 2000);
    // 锚点上下文：段落 ID + 前/后缀片段（重渲染后重定位用）
    let anchor = null;
    try {
      const block = payload.paragraphID
        ? this.body?.querySelector(`[data-nj-id="${cssEscape(payload.paragraphID)}"]`) : null;
      if (block) {
        const blockText = block.textContent || '';
        const at = blockText.indexOf(text.slice(0, 80));
        if (at >= 0) {
          anchor = {
            paragraphID: payload.paragraphID,
            prefix: blockText.slice(Math.max(0, at - 48), at),
            suffix: blockText.slice(at + text.length, at + text.length + 48),
          };
        }
      }
    } catch (_) { /* 锚点可选 */ }
    if (!anchor && payload.paragraphID) anchor = { paragraphID: payload.paragraphID };

    const result = await window.robin.kbAddHighlight({
      itemID: this.entryID, text, color, paragraphID: payload.paragraphID, anchor,
    });
    const hl = result?.ok ? result.data : null;
    if (!hl) {
      this.handlers.onFeedback?.(t('高亮保存失败'));
      return;
    }
    this.highlights.push(hl);
    // 就地包裹（优先 live range；失败退回文本匹配）
    let marks = [];
    try { marks = this._wrapRange(payload.range, (mark) => this._decorateMark(mark, hl)); } catch (_) { marks = []; }
    if (!marks.length) marks = this._applyHighlight(hl);
    this._bindMarkClicks(hl);
    this._refreshAnnotationsPanel();
    this.handlers.onFeedback?.(t('已高亮'));
  }

  _decorateMark(mark, hl) {
    mark.className = 'nj-hl';
    mark.dataset.hlId = hl.id;
    mark.dataset.color = hl.color || 'yellow';
    if (hl.note) mark.classList.add('has-note');
  }

  _bindMarkClicks(hl) {
    for (const el of this.body.querySelectorAll(`mark.nj-hl[data-hl-id="${cssEscape(hl.id)}"]`)) {
      el.addEventListener('click', (event) => {
        event.stopPropagation();
        event.preventDefault();
        this._openHighlightMenu(hl, el);
      });
    }
  }

  /** 直接包裹 Range 内的文本节点（创建路径，最准确）。 */
  _wrapRange(range, decorate) {
    const marks = [];
    if (!range || !this.body?.contains(range.startContainer) || !this.body.contains(range.endContainer)) return marks;
    const walker = document.createTreeWalker(this.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest('.nj-translation, .nj-t, mark.nj-hl') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!range.intersectsNode(node)) continue;
      const startWithin = node === range.startContainer ? range.startOffset : 0;
      const endWithin = node === range.endContainer ? range.endOffset : node.textContent.length;
      if (endWithin <= startWithin) continue;
      // gotcha：splitText 会改写 node.textContent.length，终点守卫必须用分裂前的原始长度，
      // 否则同节点内选区（startWithin>0）的溢出判断恒假，高亮会一直包到节点末尾。
      const originalLength = node.textContent.length;
      let target = node;
      if (startWithin > 0) target = target.splitText(startWithin);
      if (endWithin < originalLength) target.splitText(endWithin - startWithin);
      const mark = document.createElement('mark');
      decorate(mark);
      target.parentNode.insertBefore(mark, target);
      mark.appendChild(target);
      marks.push(mark);
    }
    return marks;
  }

  /** 恢复路径：按 文本 + 段落锚点 重定位并包裹。返回包裹到的 mark 列表。 */
  _applyHighlight(hl) {
    if (!this.body || !hl?.text) return [];
    if (this.body.querySelector(`mark.nj-hl[data-hl-id="${cssEscape(hl.id)}"]`)) return [];
    const text = hl.text;
    // 1) 首选：锚定段落内匹配
    if (hl.paragraphID) {
      const block = this.body.querySelector(`[data-nj-id="${cssEscape(hl.paragraphID)}"]`);
      if (block) {
        const marks = this._wrapTextInRoot(block, text, (mark) => this._decorateMark(mark, hl));
        if (marks.length) return marks;
      }
    }
    // 2) 段落失效（换 contentHash / 重排）：全正文匹配，prefix 消歧
    return this._wrapTextInRoot(this.body, text, (mark) => this._decorateMark(mark, hl), hl.anchor);
  }

  _applyHighlights() {
    if (!this.body || !this.highlights?.length) return;
    for (const hl of this.highlights) {
      try {
        const marks = this._applyHighlight(hl);
        if (marks.length) this._bindMarkClicks(hl);
      } catch (_) { /* 单条失败不影响其余 */ }
    }
  }

  /**
   * 在 root 内定位 text 并跨节点包裹。
   * @param anchor 可选 {prefix} —— 多处匹配时用「前缀+文本」消歧。
   */
  _wrapTextInRoot(root, text, decorate, anchor = null) {
    const { entries, full } = collectTextEntries(root);
    if (!entries.length) return [];
    // 精确匹配（或带前缀消歧）；entries 已排除现有高亮文本 → 天然防重复包裹
    if (anchor?.prefix) {
      const joined = `${anchor.prefix}${text}`;
      const jIdx = full.indexOf(joined);
      if (jIdx >= 0) {
        const marks = this._wrapGlobal(entries, full, jIdx + anchor.prefix.length, jIdx + joined.length, decorate);
        if (marks.length) return marks;
      }
    }
    let idx = full.indexOf(text);
    while (idx >= 0) {
      const marks = this._wrapGlobal(entries, full, idx, idx + text.length, decorate);
      if (marks.length) return marks;
      idx = full.indexOf(text, idx + 1);
    }
    return [];
  }

  /** 按全局字符区间跨节点包裹文本节点。 */
  _wrapGlobal(entries, full, from, to, decorate) {
    const marks = [];
    for (const entry of entries) {
      const start = entry.start;
      const end = start + entry.node.textContent.length;
      if (end <= from || start >= to) continue;
      const s = Math.max(from, start);
      const e = Math.min(to, end);
      let target = entry.node;
      if (s > start) target = target.splitText(s - start);
      const targetLen = e - s;
      if (targetLen < target.textContent.length) target.splitText(targetLen);
      const mark = document.createElement('mark');
      decorate(mark);
      target.parentNode.insertBefore(mark, target);
      mark.appendChild(target);
      marks.push(mark);
    }
    return marks;
  }

  /** 高亮点击菜单：换色 / 附注 / 复制 / 删除。 */
  _openHighlightMenu(hl, markEl) {
    this._dismissHighlightMenu();
    const menu = document.createElement('div');
    menu.className = 'nj-hl-menu';
    menu.innerHTML = `
      <div class="nj-hl-menu-colors"></div>
      <div class="nj-hl-menu-actions">
        <button data-act="note" title="${attr(hl.note ? t('查看/编辑笔记') : t('添加笔记'))}">${icon('noteSticky')}</button>
        <button data-act="copy" title="${attr(t('复制文字'))}">${icon('copy')}</button>
        <button data-act="delete" title="${attr(t('取消高亮'))}">${icon('trash')}</button>
      </div>`;
    const colors = menu.querySelector('.nj-hl-menu-colors');
    for (const color of HIGHLIGHT_COLORS) {
      const dot = document.createElement('button');
      dot.className = 'nj-hl-dot' + (color.key === (hl.color || 'yellow') ? ' current' : '');
      dot.title = color.label;
      dot.innerHTML = `<span class="nj-hl-dot-core" style="background:${color.swatch}"></span>`;
      dot.addEventListener('click', () => this._setHighlightColor(hl, color.key));
      colors.appendChild(dot);
    }
    menu.querySelector('[data-act="note"]').addEventListener('click', () => {
      this._dismissHighlightMenu();
      this._showHighlightNoteEditor(hl);
    });
    menu.querySelector('[data-act="copy"]').addEventListener('click', async () => {
      await window.robin.copyText(hl.text);
      this.handlers.onFeedback?.(t('已复制'));
      this._dismissHighlightMenu();
    });
    menu.querySelector('[data-act="delete"]').addEventListener('click', () => {
      this._dismissHighlightMenu();
      this._removeHighlight(hl);
    });
    document.body.appendChild(menu);
    this._hlMenu = menu;

    const rect = markEl.getBoundingClientRect();
    const mw = 190;
    let x = rect.x + rect.width / 2 - mw / 2;
    x = Math.max(10, Math.min(window.innerWidth - mw - 10, x));
    let y = rect.y - 46;
    if (y < 60) y = rect.y + rect.height + 8;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    setTimeout(() => {
      this._hlMenuDismiss = (event) => { if (!menu.contains(event.target)) this._dismissHighlightMenu(); };
      document.addEventListener('mousedown', this._hlMenuDismiss);
    }, 0);
  }

  _dismissHighlightMenu() {
    if (this._hlMenuDismiss) {
      document.removeEventListener('mousedown', this._hlMenuDismiss);
      this._hlMenuDismiss = null;
    }
    this._hlMenu?.remove();
    this._hlMenu = null;
  }

  async _setHighlightColor(hl, color) {
    hl.color = color;
    await window.robin.kbUpdateHighlight(hl.id, { color });
    for (const el of this.body.querySelectorAll(`mark.nj-hl[data-hl-id="${cssEscape(hl.id)}"]`)) {
      el.dataset.color = color;
    }
    this._dismissHighlightMenu();
    this._refreshAnnotationsPanel();
  }

  async _removeHighlight(hl) {
    await window.robin.kbRemoveHighlight(hl.id);
    this.highlights = this.highlights.filter((h) => h.id !== hl.id);
    for (const el of this.body.querySelectorAll(`mark.nj-hl[data-hl-id="${cssEscape(hl.id)}"]`)) {
      el.replaceWith(...el.childNodes);
    }
    this._refreshAnnotationsPanel();
    this.handlers.onFeedback?.(t('已取消高亮'));
  }

  /** 高亮附注编辑（浮层）。 */
  _showHighlightNoteEditor(hl) {
    const existing = hl.note || '';
    const layer = document.createElement('div');
    layer.className = 'nj-note-editor';
    layer.innerHTML = `
      <div class="nj-note-editor-head">
        <span class="nj-note-editor-quote"></span>
        <button class="nj-note-editor-close">${icon('close')}</button>
      </div>
      <textarea class="nj-note-editor-input" placeholder="${attr(t('写下你的想法…'))}"></textarea>
      <div class="nj-note-editor-foot">
        <button class="btn-text danger nj-note-editor-del" style="display:${existing ? '' : 'none'}">${escapeHTML(t('删除笔记'))}</button>
        <span class="tb-spring"></span>
        <button class="btn-text nj-note-editor-cancel">${escapeHTML(t('取消'))}</button>
        <button class="btn-text primary nj-note-editor-save">${escapeHTML(t('保存'))}</button>
      </div>`;
    layer.querySelector('.nj-note-editor-quote').textContent = hl.text.slice(0, 90) + (hl.text.length > 90 ? '…' : '');
    const input = layer.querySelector('.nj-note-editor-input');
    input.value = existing;
    document.body.appendChild(layer);
    const close = () => layer.remove();
    layer.querySelector('.nj-note-editor-close').addEventListener('click', close);
    layer.querySelector('.nj-note-editor-cancel').addEventListener('click', close);
    layer.querySelector('.nj-note-editor-save').addEventListener('click', async () => {
      const content = input.value.trim();
      hl.note = content || null;
      await window.robin.kbUpdateHighlight(hl.id, { note: content || null });
      for (const el of this.body.querySelectorAll(`mark.nj-hl[data-hl-id="${cssEscape(hl.id)}"]`)) {
        el.classList.toggle('has-note', Boolean(content));
      }
      this._refreshAnnotationsPanel();
      close();
      this.handlers.onFeedback?.(content ? t('笔记已保存') : t('笔记已清空'));
    });
    layer.querySelector('.nj-note-editor-del').addEventListener('click', async () => {
      hl.note = null;
      await window.robin.kbUpdateHighlight(hl.id, { note: null });
      for (const el of this.body.querySelectorAll(`mark.nj-hl[data-hl-id="${cssEscape(hl.id)}"]`)) el.classList.remove('has-note');
      this._refreshAnnotationsPanel();
      close();
    });
    setTimeout(() => input.focus(), 40);
  }

  /** 划词「笔记」：选区旁输入框，保存锚定笔记。 */
  _showSelectionNoteEditor(payload) {
    this._dismissSelection();
    const layer = document.createElement('div');
    layer.className = 'nj-note-editor';
    layer.innerHTML = `
      <div class="nj-note-editor-head">
        <span class="nj-note-editor-quote"></span>
        <button class="nj-note-editor-close">${icon('close')}</button>
      </div>
      <textarea class="nj-note-editor-input" placeholder="${attr(t('写下你的想法…'))}"></textarea>
      <div class="nj-note-editor-foot">
        <span class="tb-spring"></span>
        <button class="btn-text nj-note-editor-cancel">${escapeHTML(t('取消'))}</button>
        <button class="btn-text primary nj-note-editor-save">${escapeHTML(t('保存笔记'))}</button>
      </div>`;
    const quote = payload.selection.slice(0, 90) + (payload.selection.length > 90 ? '…' : '');
    layer.querySelector('.nj-note-editor-quote').textContent = quote;
    const input = layer.querySelector('.nj-note-editor-input');
    document.body.appendChild(layer);
    const close = () => layer.remove();
    layer.querySelector('.nj-note-editor-close').addEventListener('click', close);
    layer.querySelector('.nj-note-editor-cancel').addEventListener('click', close);
    layer.querySelector('.nj-note-editor-save').addEventListener('click', async () => {
      const content = input.value.trim();
      if (!content) return;
      const anchor = payload.paragraphID
        ? { paragraphID: payload.paragraphID, quote: payload.selection.slice(0, 200) } : null;
      const result = await window.robin.kbAddNote({ itemID: this.entryID, content, anchor });
      const note = result?.ok ? result.data : null;
      if (note) {
        this.notes.unshift(note);
        this._renderNoteMarkers();
        this._refreshAnnotationsPanel();
      }
      close();
      this.handlers.onFeedback?.(t('笔记已保存'));
    });
    setTimeout(() => input.focus(), 40);
  }

  /** 段落笔记插桩：锚定段末尾挂便签图标，点击展开编辑卡。 */
  _renderNoteMarkers() {
    if (!this.body) return;
    this.body.querySelectorAll('.nj-note-marker').forEach((el) => el.remove());
    for (const note of this.notes) {
      const pid = note.anchor?.paragraphID;
      let block = pid ? this.body.querySelector(`[data-nj-id="${cssEscape(pid)}"]`) : null;
      // paragraphID 失效（正文清洗/重排改变段落结构）时，用 quote 文本匹配 fallback
      if (!block && note.anchor?.quote) {
        const quote = String(note.anchor.quote).slice(0, 40);
        if (quote) {
          block = [...this.body.querySelectorAll('[data-nj-id]')].find((b) => (b.textContent || '').includes(quote));
        }
      }
      if (!block) continue;
      const marker = document.createElement('span');
      marker.className = 'nj-note-marker';
      marker.title = t('查看笔记');
      marker.innerHTML = icon('noteSticky');
      marker.addEventListener('click', (event) => {
        event.stopPropagation();
        this._openNoteCard(note, marker);
      });
      block.appendChild(marker);
    }
  }

  /** 便签卡（查看/编辑/删除）。 */
  _openNoteCard(note, marker) {
    this._dismissNoteCard();
    const card = document.createElement('div');
    card.className = 'nj-note-card';
    card.innerHTML = `
      <div class="nj-note-card-head">
        <span class="nj-note-card-icon">${icon('noteSticky')}</span>
        <span class="nj-note-card-quote"></span>
        <button class="nj-note-card-close">${icon('close')}</button>
      </div>
      <div class="nj-note-card-content"></div>
      <div class="nj-note-card-foot">
        <button class="btn-text danger nj-note-card-del">${escapeHTML(t('删除'))}</button>
        <span class="tb-spring"></span>
        <button class="btn-text nj-note-card-edit">${escapeHTML(t('编辑'))}</button>
      </div>`;
    card.querySelector('.nj-note-card-quote').textContent = note.anchor?.quote || '';
    card.querySelector('.nj-note-card-content').textContent = note.content;
    document.body.appendChild(card);
    this._noteCard = card;

    const rect = marker.getBoundingClientRect();
    let x = rect.right + 10;
    if (x + 300 > window.innerWidth) x = Math.max(10, rect.left - 310);
    let y = Math.min(rect.top, window.innerHeight - 220);
    card.style.left = `${x}px`;
    card.style.top = `${Math.max(60, y)}px`;

    card.querySelector('.nj-note-card-close').addEventListener('click', () => this._dismissNoteCard());
    card.querySelector('.nj-note-card-del').addEventListener('click', async () => {
      await window.robin.kbDeleteNote(note.id);
      this.notes = this.notes.filter((n) => n.id !== note.id);
      this._renderNoteMarkers();
      this._refreshAnnotationsPanel();
      this._dismissNoteCard();
    });
    card.querySelector('.nj-note-card-edit').addEventListener('click', () => {
      this._dismissNoteCard();
      this._editNote(note);
    });
    setTimeout(() => {
      this._noteCardDismiss = (event) => { if (!card.contains(event.target) && event.target !== marker) this._dismissNoteCard(); };
      document.addEventListener('mousedown', this._noteCardDismiss);
    }, 0);
  }

  _dismissNoteCard() {
    if (this._noteCardDismiss) {
      document.removeEventListener('mousedown', this._noteCardDismiss);
      this._noteCardDismiss = null;
    }
    this._noteCard?.remove();
    this._noteCard = null;
  }

  /** 笔记编辑浮层（段落笔记 / 文章笔记 / 面板新建共用）。note.id 为空 = 新建。 */
  _editNote(note) {
    const isNew = !note.id;
    const layer = document.createElement('div');
    layer.className = 'nj-note-editor';
    layer.innerHTML = `
      <div class="nj-note-editor-head">
        <span class="nj-note-editor-quote"></span>
        <button class="nj-note-editor-close">${icon('close')}</button>
      </div>
      <textarea class="nj-note-editor-input" placeholder="${attr(t('写下你的想法…'))}"></textarea>
      <div class="nj-note-editor-foot">
        <span class="tb-spring"></span>
        <button class="btn-text nj-note-editor-cancel">${escapeHTML(t('取消'))}</button>
        <button class="btn-text primary nj-note-editor-save">${escapeHTML(isNew ? t('保存笔记') : t('保存'))}</button>
      </div>`;
    layer.querySelector('.nj-note-editor-quote').textContent = note.anchor?.quote || t('文章笔记');
    const input = layer.querySelector('.nj-note-editor-input');
    input.value = note.content || '';
    document.body.appendChild(layer);
    const close = () => layer.remove();
    layer.querySelector('.nj-note-editor-close').addEventListener('click', close);
    layer.querySelector('.nj-note-editor-cancel').addEventListener('click', close);
    layer.querySelector('.nj-note-editor-save').addEventListener('click', async () => {
      const content = input.value.trim();
      if (!content) return;
      if (isNew) {
        const result = await window.robin.kbAddNote({ itemID: this.entryID, content, anchor: note.anchor || null });
        const created = result?.ok ? result.data : null;
        if (created) {
          this.notes.unshift(created);
          this._renderNoteMarkers();
        }
      } else {
        note.content = content;
        await window.robin.kbUpdateNote(note.id, { content });
        this._renderNoteMarkers();
      }
      this._refreshAnnotationsPanel();
      close();
      this.handlers.onFeedback?.(t('笔记已保存'));
    });
    setTimeout(() => { input.focus(); if (!isNew) input.select(); }, 40);
  }

  // MARK: - 批注面板（本篇高亮 + 笔记总览）

  toggleAnnotationsPanel() {
    const existing = document.getElementById('nj-annot-panel');
    if (existing) {
      existing.remove();
      return;
    }
    this._annotCollapsed = localStorage.getItem('robinread.panelCollapsed.annot') === '1';
    this._renderAnnotationsPanel();
  }

  _refreshAnnotationsPanel() {
    if (document.getElementById('nj-annot-panel')) this._renderAnnotationsPanel();
  }

  /** 批注面板折叠切换：记住用户偏好（之后打开默认保持该形态）。 */
  _toggleAnnotCollapsed() {
    this._annotCollapsed = !this._annotCollapsed;
    localStorage.setItem('robinread.panelCollapsed.annot', this._annotCollapsed ? '1' : '');
    this._renderAnnotationsPanel();
  }

  _renderAnnotationsPanel() {
    let panel = document.getElementById('nj-annot-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'nj-annot-panel';
      panel.className = 'annot-panel';
      this.body?.parentElement?.insertBefore(panel, this.body);
    }
    const hls = this.highlights || [];
    const notes = this.notes || [];
    const total = hls.length + notes.length;
    const collapsed = Boolean(this._annotCollapsed);
    panel.classList.toggle('collapsed', collapsed);
    panel.innerHTML = `
      <div class="annot-panel-head" title="${escapeHTML(t('点击折叠/展开'))}">
        <span class="panel-chev">${icon('chevronDown')}</span>
        <span class="annot-panel-icon">${icon('marker')}</span>
        <span class="annot-panel-title">${escapeHTML(t('我的批注'))}</span>
        <span class="annot-panel-count">${hls.length} ${escapeHTML(t('高亮'))} · ${notes.length} ${escapeHTML(t('笔记'))}</span>
        <button class="study-panel-btn annot-add-note" title="${attr(t('写文章笔记'))}">${icon('noteSticky')}</button>
        <button class="study-panel-btn" data-act="close" title="${attr(t('关闭'))}">${icon('close')}</button>
      </div>
      <div class="annot-panel-body"></div>`;
    const bodyEl = panel.querySelector('.annot-panel-body');
    if (total === 0) {
      const empty = document.createElement('div');
      empty.className = 'annot-panel-empty';
      empty.innerHTML = `
        <div class="annot-panel-empty-icon">${icon('marker')}</div>
        <p></p>
        <p class="hint"></p>`;
      const [line1, line2] = empty.querySelectorAll('p');
      line1.textContent = t('还没有批注');
      line2.textContent = t('选中正文文字后点击「高亮」或「笔记」；按 H 可快速高亮选中内容。');
      bodyEl.appendChild(empty);
    } else {
      if (hls.length) {
        const section = document.createElement('div');
        section.className = 'annot-section';
        section.innerHTML = `<div class="annot-section-title">${escapeHTML(t('高亮'))}</div>`;
        for (const hl of hls) section.appendChild(this._annotHlRow(hl));
        bodyEl.appendChild(section);
      }
      if (notes.length) {
        const section = document.createElement('div');
        section.className = 'annot-section';
        section.innerHTML = `<div class="annot-section-title">${escapeHTML(t('笔记'))}</div>`;
        for (const note of notes) section.appendChild(this._annotNoteRow(note));
        bodyEl.appendChild(section);
      }
    }
    panel.querySelector('[data-act="close"]').addEventListener('click', (event) => {
      event.stopPropagation();
      panel.remove();
    });
    panel.querySelector('.annot-add-note').addEventListener('click', (event) => {
      event.stopPropagation();
      this._editNote({ id: null, content: '', anchor: null });
    });
    panel.querySelector('.annot-panel-head').addEventListener('click', (event) => {
      if (event.target.closest('.study-panel-btn')) return;
      this._toggleAnnotCollapsed();
    });
    if (!collapsed) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  _annotHlRow(hl) {
    const row = document.createElement('div');
    row.className = 'annot-row annot-hl-row';
    row.innerHTML = `
      <span class="annot-color-bar" data-color="${attr(hl.color || 'yellow')}"></span>
      <div class="annot-row-main">
        <div class="annot-row-text"></div>
        ${hl.note ? '<div class="annot-row-note"></div>' : ''}
      </div>
      <button class="annot-row-del" title="${attr(t('删除'))}">${icon('trash')}</button>`;
    row.querySelector('.annot-row-text').textContent = hl.text;
    if (hl.note) row.querySelector('.annot-row-note').textContent = hl.note;
    row.addEventListener('click', (event) => {
      if (event.target.closest('.annot-row-del')) return;
      const mark = this.body?.querySelector(`mark.nj-hl[data-hl-id="${cssEscape(hl.id)}"]`);
      if (mark) {
        mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
        this._flashElement(mark);
      }
    });
    row.querySelector('.annot-row-del').addEventListener('click', () => this._removeHighlight(hl));
    return row;
  }

  _annotNoteRow(note) {
    const row = document.createElement('div');
    row.className = 'annot-row annot-note-row';
    row.innerHTML = `
      <span class="annot-color-bar note"></span>
      <div class="annot-row-main">
        <div class="annot-row-text"></div>
        ${note.anchor?.quote ? '<div class="annot-row-note quote"></div>' : ''}
      </div>
      <button class="annot-row-del" title="${attr(t('删除'))}">${icon('trash')}</button>`;
    row.querySelector('.annot-row-text').textContent = note.content;
    if (note.anchor?.quote) row.querySelector('.annot-row-note').textContent = note.anchor.quote;
    row.addEventListener('click', (event) => {
      if (event.target.closest('.annot-row-del')) return;
      if (note.anchor?.paragraphID) {
        const block = this.body?.querySelector(`[data-nj-id="${cssEscape(note.anchor.paragraphID)}"]`);
        if (block) {
          block.scrollIntoView({ behavior: 'smooth', block: 'center' });
          this._flashElement(block);
          return;
        }
      }
      this._editNote(note);
    });
    row.querySelector('.annot-row-del').addEventListener('click', async () => {
      await window.robin.kbDeleteNote(note.id);
      this.notes = this.notes.filter((n) => n.id !== note.id);
      this._renderNoteMarkers();
      this._refreshAnnotationsPanel();
    });
    return row;
  }

  _flashElement(el) {
    el.classList.remove('nj-flash');
    void el.offsetWidth; // 重启动画
    el.classList.add('nj-flash');
    setTimeout(() => el.classList.remove('nj-flash'), 1100);
  }

  // MARK: - 灯箱

  _showLightbox(src, alt) {
    const lightbox = document.createElement('div');
    lightbox.className = 'nj-lightbox is-active';
    lightbox.innerHTML = `
      <div class="nj-lightbox-backdrop"></div>
      <img class="nj-lightbox-img" src="${attr(src)}" alt="${attr(alt)}"/>
      <button class="nj-lightbox-close" title="${attr(t('关闭（Esc）'))}">${icon('close')}</button>
    `;
    // gotcha：esc 挂在 document 上，任何关闭路径（点击/Esc）都必须移除它，否则长会话每开一张图泄漏一个监听
    const esc = (event) => { if (event.key === 'Escape') dismiss(); };
    const dismiss = () => {
      document.removeEventListener('keydown', esc);
      lightbox.remove();
    };
    lightbox.addEventListener('click', dismiss);
    document.addEventListener('keydown', esc);
    document.body.appendChild(lightbox);
  }

  // MARK: - TOC 轨道

  _buildTOC() {
    this.tocEntries = [];
    if (!this.body) return;
    const headings = [...this.body.querySelectorAll('h1,h2,h3,h4')];
    if (headings.length < 2) {
      this.tocRail.classList.add('hidden-rail');
      return;
    }
    this.tocTrack.innerHTML = '';
    const thumb = document.createElement('div');
    thumb.className = 'toc-thumb';
    this.tocTrack.appendChild(thumb);
    this.tocThumb = thumb;

    headings.forEach((heading, index) => {
      const anchorID = `toc-${index}`;
      heading.id = anchorID;
      const position = (index + 0.5) / headings.length;
      const tick = document.createElement('div');
      tick.className = 'toc-tick';
      tick.dataset.level = heading.tagName.toLowerCase();
      tick.style.top = `${position * 100}%`;
      tick.title = heading.textContent?.slice(0, 60) || '';
      tick.addEventListener('click', () => heading.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      tick.addEventListener('mouseenter', () => {
        this.tocPeak.textContent = heading.textContent || ' ';
        this.tocPeak.style.top = tick.style.top;
        this.tocPeak.classList.add('visible');
      });
      tick.addEventListener('mouseleave', () => this.tocPeak.classList.remove('visible'));
      this.tocTrack.appendChild(tick);
      this.tocEntries.push({ element: heading, position, tick });
    });
    this.tocRail.classList.remove('hidden-rail');
    this.tocRail.classList.add('visible');
  }

  _buildTOCGestures() {
    let dragging = false;
    this.tocTrack.addEventListener('mousedown', (event) => {
      dragging = true;
      this._scrollToRailRatio(event);
    });
    window.addEventListener('mousemove', (event) => {
      if (dragging) this._scrollToRailRatio(event);
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }

  _scrollToRailRatio(event) {
    const rect = this.tocTrack.getBoundingClientRect();
    const ratio = clamp01((event.clientY - rect.top) / rect.height);
    const max = this.scrollEl.scrollHeight - this.scrollEl.clientHeight;
    this.scrollEl.scrollTop = ratio * max;
  }

  // MARK: - 浮动滚动条（透明度状态机）

  _buildScrollbarGestures() {
    this.scrollbar.style.display = 'none';
    this.thumb.addEventListener('mouseenter', () => this._setThumbState('hover'));
    this.thumb.addEventListener('mouseleave', () => this._setThumbState('scrolling'));
    this.thumb.addEventListener('mousedown', (event) => {
      event.preventDefault();
      this._setThumbState('dragging');
      const railHeight = this.scrollEl.clientHeight;
      const startY = event.clientY;
      const startTop = this.scrollEl.scrollTop;
      const onMove = (moveEvent) => {
        const delta = moveEvent.clientY - startY;
        const ratio = delta / Math.max(1, railHeight - this._thumbHeight * railHeight / this.scrollEl.scrollHeight);
        this.scrollEl.scrollTop = startTop + delta * (this.scrollEl.scrollHeight / railHeight);
      };
      const onUp = () => {
        this._setThumbState('scrolling');
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  _setThumbState(next) {
    this._thumbState = next;
    this.thumb.classList.toggle('scrolling', next === 'scrolling');
    this.thumb.classList.toggle('hover', next === 'hover');
    this.thumb.classList.toggle('dragging', next === 'dragging');
  }

  refreshScrollMetrics() {
    requestAnimationFrame(() => this._onScroll());
  }

  _onScroll() {
    // 阅读进度线：同步更新（单次 style 写入；不依赖 rAF 以免隐藏窗口节流）
    {
      const max0 = this.scrollEl.scrollHeight - this.scrollEl.clientHeight;
      const ratio0 = max0 > 0 ? this.scrollEl.scrollTop / max0 : 0;
      if (this.progressEl) this.progressEl.style.width = `${ratio0 * 100}%`;
    }
    if (this._scrollTick) return;
    this._scrollTick = true;
    requestAnimationFrame(() => {
      this._scrollTick = false;
      const el = this.scrollEl;
      const max = el.scrollHeight - el.clientHeight;
      const ratio = max > 0 ? el.scrollTop / max : 0;

      // 浮动滚动条
      if (max > 40 && this.entryID) {
        this.scrollbar.style.display = '';
        const trackHeight = el.clientHeight;
        const viewportRatio = el.scrollHeight > 0 ? el.clientHeight / el.scrollHeight : 1;
        const thumbHeight = Math.max(36, viewportRatio * trackHeight);
        this._thumbHeight = thumbHeight;
        this.thumb.style.height = `${thumbHeight}px`;
        this.thumb.style.top = `${ratio * (trackHeight - thumbHeight)}px`;
        if (this._thumbState === 'idle') this._setThumbState('scrolling');
        clearTimeout(this._hideTimer);
        this._hideTimer = setTimeout(() => {
          if (this._thumbState !== 'hover' && this._thumbState !== 'dragging') {
            this._setThumbState('idle');
          }
        }, 900);
      } else {
        this.scrollbar.style.display = 'none';
      }

      // TOC 视线重心（最近可见标题）+ 活跃刻度
      if (this.tocEntries?.length && this.tocThumb) {
        let active = 0;
        const containerTop = el.getBoundingClientRect().top;
        this.tocEntries.forEach((entry, index) => {
          const rect = entry.element.getBoundingClientRect();
          if (rect.top - containerTop < el.clientHeight * 0.4) active = index;
        });
        this.tocThumb.style.top = `${((active + 0.5) / this.tocEntries.length) * 100}%`;
        this.tocEntries.forEach((entry, index) => entry.tick.classList.toggle('active', index === active));
      }

      this._publishVisible();
    });
  }

  // MARK: - 空格推进

  spaceAdvance() {
    const el = this.scrollEl;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 6;
    if (!atBottom) {
      const pageDistance = Math.max(120, el.clientHeight * 0.382);
      el.scrollBy({ top: pageDistance, behavior: 'smooth' });
      return;
    }
    this.handlers.onSelectNext?.();
  }

  // MARK: - 快捷动作 / 状态

  handleShortcut(action) {
    switch (action) {
      case 'toggleBilingual': this.toggleBilingual(); break;
      case 'showSummary': this.toggleSummary(); break;
      case 'deepRead': this.openStudy('deepRead'); break;
      case 'richSummary': this.openStudy('richSummary'); break;
      default: break;
    }
  }

  // MARK: - 研读面板（一键精读 / 高质量摘要）

  /** 打开研读面板：缓存秒开，否则流式生成。初始折叠态跟随用户偏好。 */
  async openStudy(kind) {
    if (!this.entryID) return;
    const isDeep = kind === 'deepRead';
    const preferCollapsed = localStorage.getItem('robinread.panelCollapsed.study') === '1';
    this._study = { kind, generating: false, streaming: '', artifact: null, error: null, collapsed: preferCollapsed };
    this._renderStudyPanel();

    const workResult = await window.robin.existingWork(this.entryID, kind);
    const cached = workResult?.ok ? workResult.data : null;
    if (cached && cached.content && this._study?.kind === kind) {
      this._study.artifact = cached;
      this._renderStudyPanel();
      return;
    }
    if (!window.__robinLLM?.apiKeyConfigured && !window.__robinLLM) { /* 由主进程报错 */ }

    this._study.generating = true;
    this._renderStudyPanel();
    const fn = isDeep ? window.robin.deepRead : window.robin.richSummary;
    const result = await fn(this.entryID);
    if (this._study?.kind !== kind) return;
    this._study.generating = false;
    this._study.streaming = '';
    if (result.ok && result.data) {
      this._study.artifact = result.data;
    } else {
      this._study.error = result.error || t('生成失败');
      this.handlers.onFeedback?.(`${t(isDeep ? '精读失败' : '摘要生成失败')}：${this._study.error}`);
    }
    this._renderStudyPanel();
  }

  /** 流式增量（来自 ai:delta，kind 匹配当前面板）。 */
  onWorkDelta(payload) {
    if (!this._study || this._study.kind !== payload.kind || payload.entryID !== this.entryID) return;
    if (payload.content !== undefined) this._study.streaming = payload.content;
    if (this._study.generating !== true) {
      this._study.generating = true;
    }
    this._renderStudyPanel(true);
  }

  onWorkStatus(payload) {
    if (!this._study || payload.key !== `${this._study.kind}:${this.entryID}`) return;
    if (payload.state === 'failed') {
      this._study.generating = false;
      this._study.error = payload.message || t('生成失败');
      this._renderStudyPanel();
    }
  }

  _renderStudyPanel(streamTick = false) {
    const s = this._study;
    if (!s) return;
    let panel = document.getElementById('nj-study-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'nj-study-panel';
      panel.className = 'study-panel';
      this.body?.parentElement?.insertBefore(panel, this.body);
    }
    const isDeep = s.kind === 'deepRead';
    const title = isDeep ? t('精读笔记') : t('高质量摘要');
    const bodyText = s.error ? '' : (s.artifact?.content ?? s.streaming ?? '');
    panel.classList.toggle('collapsed', Boolean(s.collapsed));
    panel.innerHTML = `
      <div class="study-panel-head" title="${escapeHTML(t('点击折叠/展开'))}">
        <span class="panel-chev">${icon('chevronDown')}</span>
        <span class="study-panel-icon">${icon(isDeep ? 'bookOpen' : 'docText')}</span>
        <span class="study-panel-title"></span>
        <span class="study-panel-state${s.generating ? ' is-busy' : ''}">${s.generating ? t('生成中…') : (s.error ? t('生成失败') : t('已完成'))}</span>
        <button class="study-panel-btn" data-act="regen" title="${escapeHTML(t('重新生成'))}">${icon('refresh')}</button>
        <button class="study-panel-btn" data-act="close" title="${escapeHTML(t('关闭'))}">${icon('close')}</button>
      </div>
      <div class="study-panel-body${s.generating ? ' streaming' : ''}"></div>`;
    panel.querySelector('.study-panel-title').textContent = title;
    const bodyEl = panel.querySelector('.study-panel-body');
    if (s.error) {
      bodyEl.innerHTML = `<div class="study-panel-error">${escapeHTML(s.error)}</div>`;
    } else if (bodyText) {
      bodyEl.innerHTML = renderMarkdown(bodyText);
    } else if (s.generating) {
      bodyEl.innerHTML = `<div class="study-panel-loading">${escapeHTML(t('正在通读全文…'))}</div>`;
    } else {
      bodyEl.innerHTML = `<div class="study-panel-loading">${escapeHTML(t('准备生成…'))}</div>`;
    }
    // innerHTML 重绘会清监听：每次渲染后重新绑定
    panel.querySelector('[data-act="close"]').addEventListener('click', () => {
      panel.remove();
      this._study = null;
    });
    panel.querySelector('[data-act="regen"]').addEventListener('click', (event) => {
      event.stopPropagation();
      this.openStudy(s.kind);
    });
    panel.querySelector('.study-panel-head').addEventListener('click', (event) => {
      if (event.target.closest('.study-panel-btn')) return;
      this._toggleStudyCollapsed();
    });
    if (!streamTick && !s.collapsed) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /** 研读面板折叠切换：记住用户偏好（之后新面板默认保持该形态）。 */
  _toggleStudyCollapsed(force = null) {
    const s = this._study;
    if (!s) return;
    s.collapsed = force !== null ? force : !s.collapsed;
    localStorage.setItem('robinread.panelCollapsed.study', s.collapsed ? '1' : '');
    this._renderStudyPanel(true);
  }

  updateEntryState({ isRead, isStarred }) {
    if (!this.entry) return;
    this.entry.isRead = isRead;
    this.entry.isStarred = isStarred;
  }

  focus() {
    this.scrollEl.focus?.({ preventScroll: true });
  }

  _articleText() {
    if (!this.body) return '';
    // textContent：不依赖布局（隐藏窗口 innerText 为空）
    return (this.body.textContent || '').trim();
  }

  // MARK: - TTS 朗读（听文章）

  /** 对外状态：idle / playing / paused（E2E 探测与调试用）。 */
  get ttsState() {
    return this._tts ? this._tts.state : 'idle';
  }

  _ttsSynth() {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    return synth && typeof synth.speak === 'function' ? synth : null;
  }

  /**
   * 键盘：R = 读/停切换；Esc = 停止朗读。
   * 协调原则（app.js 全局键位禁改）：
   * - R 全局未占用（全局仅 Ctrl+Shift+R 刷新，带修饰键，此处直接忽略一切修饰键）；
   *   仅在阅读器栏聚焦（column-focused / 焦点在正文内）时消费，输入控件中绝不拦截。
   * - Esc 优先级让位：禅模式（app 层消费）、图片灯箱 / 模态弹层（各自监听）、
   *   以及任何已 preventDefault 的按键，本层一律不动手。
   */
  _onTTSKeyDown(event) {
    if (!event || event.defaultPrevented) return;
    const target = event.target;
    if (target instanceof HTMLElement
      && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;

    if (event.key === 'Escape') {
      if (this.ttsState === 'idle') return;
      if (document.body.classList.contains('zen')) return; // 禅模式：Esc 归 app 层退出禅模式
      if (document.querySelector('.nj-lightbox, .modal-overlay')) return; // 灯箱/模态优先
      event.preventDefault();
      event.stopPropagation();
      this._ttsStop();
      this.handlers.onFeedback?.(t('已停止朗读'));
      return;
    }

    if (event.key !== 'r' && event.key !== 'R') return;
    if (event.ctrlKey || event.metaKey || event.altKey) return; // Ctrl+Shift+R 刷新等全局组合不碰
    if (!this.entryID || !this._readerFocused()) return;
    event.preventDefault();
    this.toggleTTS();
  }

  /** 阅读器栏是否持有焦点（焦点在正文内，或 #reader 列处于 column-focused）。 */
  _readerFocused() {
    const active = document.activeElement;
    if (active && (active === this.scrollEl || this.scrollEl.contains(active))) return true;
    const column = this.scrollEl?.parentElement;
    return !!(column && column.classList.contains('column-focused'));
  }

  /** 头部「听」按钮：无语音引擎 / 已确认无语音 / 无正文时置灰并给出 title 说明。 */
  _ttsAppendHeaderButton(actions) {
    const btn = document.createElement('button');
    btn.className = 'btn-text bordered nj-tts-header-btn';
    btn.dataset.role = 'tts';
    btn.innerHTML = `${TTS_SPEAKER_SVG}<span style="margin-left:4px">${escapeHTML(t('听'))}</span>`;
    btn.addEventListener('click', () => this.toggleTTS());
    this._ttsHeaderBtn = btn;
    this._ttsRefreshButtonAvailability();
    actions.appendChild(btn);
  }

  /** 头部按钮可用态（getVoices 异步：voiceschanged 后会再次刷新）。 */
  _ttsRefreshButtonAvailability() {
    const btn = this._ttsHeaderBtn;
    if (!btn || !btn.isConnected) return;
    const synth = this._ttsSynth();
    const hasBody = plainLen(this.html || '') > 0;
    if (!synth) {
      btn.disabled = true;
      btn.title = t('当前环境不支持语音朗读（speechSynthesis 不可用）');
    } else if (!hasBody) {
      btn.disabled = true;
      btn.title = t('这篇文章没有可朗读的正文');
    } else if (this._ttsVoicesConfirmedEmpty) {
      btn.disabled = true;
      btn.title = t('未检测到可用语音：请在系统设置中安装语音（如中文 Microsoft 语音）后重试。');
    } else {
      btn.disabled = false;
      btn.title = t('听文章：本地语音朗读全文（快捷键 R 读/停，Esc 停止）');
    }
  }

  /** 同步头部按钮文案（听 ↔ 停）。头部随正文重建，引用失效时静默跳过。 */
  _ttsSyncHeaderButton() {
    const btn = this._ttsHeaderBtn;
    if (!btn || !btn.isConnected) return;
    const label = btn.querySelector('span');
    if (label) label.textContent = this.ttsState === 'idle' ? t('听') : t('停');
    btn.classList.toggle('is-playing', this.ttsState !== 'idle');
    if (this.ttsState === 'idle') {
      this._ttsRefreshButtonAvailability();
    } else {
      btn.disabled = false; // 朗读中按钮 = 「停」，始终可点
      btn.title = t('停止朗读（快捷键 R / Esc）');
    }
  }

  toggleTTS() {
    if (this.ttsState !== 'idle') {
      this._ttsStop();
      return;
    }
    this._ttsStart();
  }

  _ttsStart() {
    const synth = this._ttsSynth();
    if (!synth) {
      this.handlers.onFeedback?.(t('当前环境不支持语音朗读（speechSynthesis 不可用）'));
      return;
    }
    if (!this.entryID || !this.body) return;
    const chunks = this._ttsCollectChunks();
    if (chunks.length === 0) {
      this.handlers.onFeedback?.(t('这篇文章没有可朗读的正文。'));
      return;
    }
    const voices = this._ttsSortedVoices();
    if (voices.length === 0) {
      this.handlers.onFeedback?.(t('未检测到可用语音：请在系统设置中安装语音（如中文 Microsoft 语音）后重试。'));
      return;
    }
    this._ttsStop(); // 幂等兜底：清掉可能残留的上一轮状态
    this._ttsGen += 1;
    this._tts = {
      state: 'playing',
      chunks,
      index: 0,
      gen: this._ttsGen,
      utterances: [], // 保留 utterance 引用：Chromium 已知 GC 会吞掉在途 utterance 的回调
      rate: this._ttsReadRate(),
      player: null,
    };
    this._ttsBuildPlayer();
    this.scrollEl.classList.add('nj-tts-open'); // 播放器悬浮正文底部：预留 padding 防遮最后一行
    this._ttsEnqueueFrom(0);
    this._ttsSyncHeaderButton();
  }

  /** 收集朗读块：标题 + 正文叶子段落（[data-nj-id]），每块切成 ≤120 字的句块。 */
  _ttsCollectChunks() {
    const chunks = [];
    const title = String(this.entry?.title || '').trim();
    for (const piece of ttsSplitChunks(title, TTS_CHUNK_MAX)) chunks.push({ text: piece, paraID: 'title' });
    if (!this.body) return chunks;
    for (const block of this.body.querySelectorAll('[data-nj-id]')) {
      if (block.querySelector('[data-nj-id]')) continue; // 容器块：只读叶子
      if (block.matches('pre')) continue; // 代码块不读
      if (block.querySelector('pre, table, video, iframe')) continue;
      const text = (block.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      for (const piece of ttsSplitChunks(text, TTS_CHUNK_MAX)) {
        chunks.push({ text: piece, paraID: block.dataset.njId });
      }
    }
    return chunks;
  }

  /** 读取语速偏好（0.75/1/1.25/1.5，非法值回退 1）。 */
  _ttsReadRate() {
    try {
      const raw = Number(localStorage.getItem(TTS_RATE_KEY));
      return TTS_RATES.includes(raw) ? raw : 1;
    } catch (_) {
      return 1;
    }
  }

  /**
   * 语音列表：getVoices 异步（voiceschanged 后才非空），每次现取并缓存；
   * 排序：中文语音优先（zh*），Microsoft 开头的高质量声音再优先。
   */
  _ttsSortedVoices() {
    const synth = this._ttsSynth();
    if (!synth || typeof synth.getVoices !== 'function') return [];
    let voices = [];
    try { voices = synth.getVoices() || []; } catch (_) { voices = []; }
    return voices.slice().sort((a, b) => ttsVoiceScore(b) - ttsVoiceScore(a));
  }

  /** 按持久化偏好挑声音（存 name），无偏好/失效时取排序首位（中文优先）。 */
  _ttsPickVoice(voices) {
    if (!voices.length) return null;
    let saved = null;
    try { saved = localStorage.getItem(TTS_VOICE_KEY); } catch (_) { /* 忽略 */ }
    if (saved) {
      const hit = voices.find((v) => v.name === saved || v.voiceURI === saved);
      if (hit) return hit;
    }
    return voices[0];
  }

  /** 从第 index 块起构建 utterance 入队（browser 内部按入队序连续播报）。 */
  _ttsEnqueueFrom(startIndex) {
    const tts = this._tts;
    const synth = this._ttsSynth();
    if (!tts || !synth) return;
    const voices = this._ttsSortedVoices();
    const voice = this._ttsPickVoice(voices);
    if (!voice) {
      this._ttsStop();
      this.handlers.onFeedback?.(t('未检测到可用语音：请在系统设置中安装语音（如中文 Microsoft 语音）后重试。'));
      return;
    }
    for (let i = startIndex; i < tts.chunks.length; i += 1) {
      const chunk = tts.chunks[i];
      let utterance;
      try {
        utterance = new SpeechSynthesisUtterance(chunk.text);
      } catch (_) {
        break;
      }
      try { utterance.voice = voice; } catch (_) { /* mock/plain object 赋值失败：lang 兜底 */ }
      utterance.lang = voice.lang || 'zh-CN';
      utterance.rate = tts.rate;
      utterance.onend = () => this._ttsOnChunkEnd(i, tts.gen);
      utterance.onerror = (event) => this._ttsOnChunkError(i, tts.gen, event);
      tts.utterances.push(utterance);
      synth.speak(utterance);
    }
    this._ttsHighlight(tts.chunks[startIndex]?.paraID);
    this._ttsSyncPlayer();
  }

  /** 句块播完：推进高亮到下一块；最后一块播完则自然收尾。 */
  _ttsOnChunkEnd(index, gen) {
    const tts = this._tts;
    if (!tts || tts.gen !== gen) return; // 过期回调（已停止 / 切文 / 换速重建）
    if (index + 1 < tts.chunks.length) {
      tts.index = index + 1;
      this._ttsHighlight(tts.chunks[index + 1].paraID);
    } else {
      this._ttsStop();
      this.handlers.onFeedback?.(t('朗读结束'));
    }
  }

  _ttsOnChunkError(index, gen, event) {
    const tts = this._tts;
    if (!tts || tts.gen !== gen) return;
    const reason = event?.error || '';
    if (reason === 'interrupted' || reason === 'canceled' || reason === '') return; // 主动停止引起
    this._ttsStop();
    this.handlers.onFeedback?.(`${t('朗读遇到错误，已停止')}：${reason}`);
  }

  /** 段落跟随高亮：唯一 .nj-tts-active + 平滑居中滚动。 */
  _ttsHighlight(paraID) {
    this._ttsClearActive();
    if (!paraID || !this.scrollEl) return;
    const block = this.scrollEl.querySelector(`[data-nj-id="${cssEscape(paraID)}"]`);
    if (!block) return;
    block.classList.add('nj-tts-active');
    if (this._tts) this._tts.activeEl = block;
    block.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  _ttsClearActive() {
    this.scrollEl?.querySelectorAll('.nj-tts-active').forEach((el) => el.classList.remove('nj-tts-active'));
  }

  /** 播放/暂停切换（迷你播放器主按钮）。 */
  _ttsTogglePause() {
    const tts = this._tts;
    const synth = this._ttsSynth();
    if (!tts || !synth) return;
    if (tts.state === 'playing') {
      try { synth.pause(); } catch (_) { /* 引擎不支持暂停：忽略 */ }
      tts.state = 'paused';
    } else if (tts.state === 'paused') {
      try { synth.resume(); } catch (_) { /* 同上 */ }
      tts.state = 'playing';
    } else {
      return;
    }
    this._ttsSyncPlayer();
  }

  /** 语速循环切换：写 localStorage；播放中则从当前句块重建队列（新语速即刻生效）。 */
  _ttsCycleRate() {
    const tts = this._tts;
    const current = tts ? tts.rate : this._ttsReadRate();
    const next = TTS_RATES[(TTS_RATES.indexOf(current) + 1) % TTS_RATES.length];
    try { localStorage.setItem(TTS_RATE_KEY, String(next)); } catch (_) { /* 隐私模式：内存内仍生效 */ }
    if (tts) {
      tts.rate = next;
      this._ttsRestartFrom(tts.index);
    }
    this.handlers.onFeedback?.(`${t('语速')} ${next}×`);
    return next;
  }

  /** 声音切换：写 localStorage；播放中从当前句块重建队列。 */
  _ttsSelectVoice(name) {
    try { localStorage.setItem(TTS_VOICE_KEY, String(name || '')); } catch (_) { /* 忽略 */ }
    const tts = this._tts;
    if (tts) this._ttsRestartFrom(tts.index);
  }

  /** cancel + 丢弃旧 utterance + gen++（旧 onend 全部作废），再从 index 重灌队列。 */
  _ttsRestartFrom(index) {
    const tts = this._tts;
    if (!tts) return;
    const synth = this._ttsSynth();
    if (synth?.cancel) {
      try { synth.cancel(); } catch (_) { /* 忽略 */ }
    }
    tts.utterances = [];
    tts.gen += 1;
    tts.state = 'playing'; // 暂停中调语速/声音 → 直接以新参数继续播
    this._ttsEnqueueFrom(index);
    this._ttsSyncHeaderButton();
  }

  /** 停止：清队（cancel）+ 清高亮 + 撤播放器 + gen++ 使全部在途回调失效。幂等。 */
  _ttsStop() {
    const tts = this._tts;
    this._ttsGen += 1;
    this._tts = null;
    const synth = this._ttsSynth();
    if (synth?.cancel) {
      try { synth.cancel(); } catch (_) { /* 忽略 */ }
    }
    if (tts) {
      tts.utterances = [];
      tts.player?.remove();
    }
    this._ttsClearActive();
    this.scrollEl?.classList.remove('nj-tts-open');
    this._ttsSyncHeaderButton();
  }

  // MARK: - TTS 迷你播放器（正文底部居中悬浮胶囊）

  _ttsBuildPlayer() {
    const tts = this._tts;
    if (!tts) return;
    const host = this.scrollEl?.parentElement || document.body;
    const player = document.createElement('div');
    player.className = 'nj-tts-player';
    player.dataset.role = 'tts-player';
    player.innerHTML = `
      <button type="button" class="nj-tts-pbtn nj-tts-toggle" title="${attr(t('暂停 / 继续朗读'))}">${TTS_PAUSE_SVG}</button>
      <button type="button" class="nj-tts-pbtn nj-tts-stop" title="${attr(t('停止朗读（Esc）'))}">${TTS_STOP_SVG}</button>
      <button type="button" class="nj-tts-pbtn nj-tts-rate" title="${attr(t('点击切换语速（0.75 / 1 / 1.25 / 1.5）'))}"></button>
      <select class="nj-tts-voice" title="${attr(t('朗读声音'))}"></select>`;
    tts.player = player;
    player.querySelector('.nj-tts-toggle').addEventListener('click', () => this._ttsTogglePause());
    player.querySelector('.nj-tts-stop').addEventListener('click', () => this._ttsStop());
    player.querySelector('.nj-tts-rate').addEventListener('click', () => this._ttsCycleRate());
    const select = player.querySelector('.nj-tts-voice');
    select.addEventListener('change', () => this._ttsSelectVoice(select.value));
    host.appendChild(player);
    this._ttsSyncPlayer();
  }

  /** 同步播放器 UI：播放/暂停图标、语速文案、声音下拉（每次现取 voices，兼容异步加载）。 */
  _ttsSyncPlayer() {
    const tts = this._tts;
    const player = tts?.player;
    if (!player || !player.isConnected) return;
    const toggle = player.querySelector('.nj-tts-toggle');
    if (toggle) {
      toggle.innerHTML = tts.state === 'paused' ? TTS_PLAY_SVG : TTS_PAUSE_SVG;
      toggle.title = tts.state === 'paused' ? t('继续朗读') : t('暂停朗读');
    }
    const rateBtn = player.querySelector('.nj-tts-rate');
    if (rateBtn) rateBtn.textContent = `${tts.rate}×`;
    const select = player.querySelector('.nj-tts-voice');
    if (select) {
      const voices = this._ttsSortedVoices();
      const previous = select.value;
      select.innerHTML = '';
      if (voices.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = t('无可用语音');
        select.appendChild(opt);
      } else {
        voices.forEach((voice) => {
          const opt = document.createElement('option');
          opt.value = voice.name || voice.voiceURI || '';
          opt.textContent = `${voice.name || 'voice'}（${String(voice.lang || '').toUpperCase()}）`;
          select.appendChild(opt);
        });
      }
      const current = this._ttsPickVoice(voices);
      select.value = current ? (current.name || current.voiceURI || '') : previous;
      if (!select.value && previous) select.value = previous; // voices 未就绪时保留旧选中项
    }
  }
}

// MARK: - 工具函数（1:1 对应 ArticleExtractor / HeaderBuilder 语义）

function translationMarkup(translation, id) {
  return `<aside id="nj-translation-${id}" class="nj-translation" data-nj-translation-for="${id}">
  <p><span class="nj-translation-label">
    <span class="nj-language-chip">A</span>
    <span class="nj-language-chip">文</span>
  </span><span class="nj-translation-text">${escapeHTML(translation || '')}</span></p>
</aside>`;
}

function pendingMarkup(id) {
  return `<aside id="nj-translation-${id}" class="nj-translation is-loading" data-nj-translation-for="${id}">
  <p><span class="nj-translation-label">
    <span class="nj-language-chip">A</span>
    <span class="nj-language-chip">文</span>
  </span><span class="nj-translation-text">${escapeHTML(t('正在翻译…'))}</span></p>
</aside>`;
}

function collectParagraphs(body, title) {
  const paragraphs = [];
  if (title?.trim()) paragraphs.push({ id: 'title', original: title.trim() });
  for (const block of body.querySelectorAll('[data-nj-id]')) {
    if (block.querySelector('[data-nj-id]')) continue; // 容器块不作为翻译单元
    const sentences = block.querySelectorAll('[data-sent]');
    if (sentences.length > 0) {
      for (const span of sentences) {
        const original = span.textContent.trim();
        if (original) paragraphs.push({ id: span.dataset.sent, parentId: block.dataset.njId, original });
      }
      continue;
    }
    const original = plainText(block.innerHTML);
    if (original) paragraphs.push({ id: block.dataset.njId, original });
  }
  return paragraphs;
}

/**
 * 英文分句：返回升序「句尾偏移」数组（相对整段文本，含结尾空白）。
 * - 句界 = 句末标点(+引号/括号) + 空白 + 大写/数字/引号开头
 * - 缩写守卫（e.g. / i.e. / U.S. / Fig. 等）不切分
 * - 过短的碎片（<12 字符）并入前句
 */
function sentenceBoundaries(text) {
  const value = String(text ?? '');
  // 缩写守卫：词表缩写（e.g. / Fig. / Dr. …）或首字母缩点（U.S. / J.）不作为句界
  const guard = /(?:\b(?:e\.g|i\.e|etc|vs|cf|al|approx|Fig|No|Mr|Mrs|Ms|Dr|Prof|Inc|Ltd|Jr|Sr|St|dept|est|min|max|resp|ref|vol|pp|ed|eds|ca|sec|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.|\b(?:[A-Za-z]\.)+)$/;
  const boundary = /[.!?…]+["')\]]?(?:\s+|$)(?=[A-Z0-9"'“‘(\[])/g;
  const ends = [];
  let match;
  while ((match = boundary.exec(value)) !== null) {
    const end = match.index + match[0].length;
    const head = value.slice(0, match.index + match[0].length).trimEnd();
    if (guard.test(head)) continue;
    ends.push(end);
  }
  // 过短碎片并入前句
  const merged = [];
  let start = 0;
  for (const end of ends) {
    const piece = value.slice(start, end).trim();
    if (piece.length < 12 && merged.length === 0) { start = end; continue; }
    if (piece.length < 12) { merged[merged.length - 1] = end; start = end; continue; }
    merged.push(end);
    start = end;
  }
  // 尾部残余（无标点收尾的最后一句）不需要边界
  return merged.filter((end) => end < value.length);
}

/**
 * TTS 切句：把任意文本切成 ≤max 字的朗读块。
 * - 先按句末标点（。！？；.!?) 切句（标点保留在句尾，TTS 停顿更自然）
 * - 短句并入相邻句，减少入队碎片
 * - 超长句在次级标点（，,、：: 空格）处硬切，绝不产生超限块
 * Chromium 对超长 utterance 会截断/吞字，逐句入队是可靠性前提。
 */
function ttsSplitChunks(text, max = TTS_CHUNK_MAX) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.split(/(?<=[。！？；!?;])/).map((s) => s.trim()).filter(Boolean);
  /** 在 ≤max 内找最后的次级断点；找不到就硬切。返回切点（其后内容归下一块）。 */
  const softCut = (piece) => {
    const window = piece.slice(0, max);
    let cut = -1;
    for (const ch of ['，', ',', '、', '：', ':', ' ']) cut = Math.max(cut, window.lastIndexOf(ch));
    return cut > Math.floor(max * 0.4) ? cut + 1 : max;
  };
  const chunks = [];
  const pushMerged = (piece) => {
    const last = chunks[chunks.length - 1];
    if (last && last.length + piece.length + 1 <= max) chunks[chunks.length - 1] = `${last} ${piece}`;
    else chunks.push(piece);
  };
  for (const sentence of sentences) {
    if (sentence.length <= max) {
      pushMerged(sentence);
      continue;
    }
    let rest = sentence;
    while (rest.length > max) {
      const cut = softCut(rest);
      chunks.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) pushMerged(rest);
  }
  return chunks.filter(Boolean);
}

/** 语音质量评分：中文（zh*）优先 +2；Microsoft 开头（Windows 高质量声音）+1。 */
function ttsVoiceScore(voice) {
  const lang = String(voice?.lang || '').toLowerCase();
  const microsoft = /^microsoft/i.test(String(voice?.name || ''));
  return (lang.startsWith('zh') ? 2 : 0) + (microsoft ? 1 : 0);
}

function plainText(html) {
  let value = String(html ?? '');
  value = value.replace(/<(script|style|iframe|form|object|embed)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  value = value.replace(/<br\s*\/?>/gi, '\n');
  value = value.replace(/<\/(p|div|h[1-6]|li|blockquote|pre|figcaption|dt|dd)>/gi, '\n\n');
  value = value.replace(/<[^>]+>/g, ' ');
  value = value.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  value = value.replace(/[ \t]+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{3,}/g, '\n\n');
  return value.trim();
}

/** HTML 去标签后的纯文本长度（用于「正文过短」判定）。 */
function plainLen(html) {
  return String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
}

function removingDuplicateLeadingHeading(html, title) {
  if (!html || !title) return html;
  const cleanTitle = normalizeHeading(title);
  if (!cleanTitle) return html;
  const match = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
  if (!match) return html;
  const prefix = html.slice(0, match.index);
  if (/<p[^>]*>/i.test(prefix)) return html;
  const headingText = normalizeHeading(match[1].replace(/<[^>]+>/g, ' '));
  if (headingText === cleanTitle && normalizeHeading(prefix.replace(/<[^>]+>/g, ' ')).length <= 120) {
    return html.slice(0, match.index) + html.slice(match.index + match[0].length);
  }
  return html;
}

function normalizeHeading(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 摘要第一句预览（对应 collapse 预览逻辑）。 */
function firstSentence(content) {
  const raw = String(content || '').trim();
  if (!raw) return '';
  const firstLine = raw.split(/[\n。]/).find((part) => part.trim().length > 0) ?? raw;
  const clean = firstLine.replace(/#/g, '').replace(/\*\*/g, '').trim();
  if (!clean) return '';
  return clean + (clean.length < raw.length ? '...' : '');
}

function closestBlockID(element) {
  let node = element;
  while (node && node !== document.body) {
    if (node.dataset?.njId) return node.dataset.njId;
    node = node.parentElement;
  }
  return null;
}

function rangeAnchor(element, selection, range) {
  const block = (function findBlock(node) {
    let current = node;
    while (current && current !== document.body) {
      if (current.dataset?.njId) return current;
      current = current.parentElement;
    }
    return null;
  })(element);
  if (!block) return null;
  try {
    const blockRange = document.createRange();
    blockRange.selectNodeContents(block);
    return {
      paragraphID: block.dataset.njId,
      startOffset: range.compareBoundaryPoints(Range.START_TO_START, blockRange),
      endOffset: range.compareBoundaryPoints(Range.END_TO_START, blockRange),
    };
  } catch (_) {
    return null;
  }
}

function paragraphContext(element) {
  let node = element;
  while (node && node !== document.body && !node.dataset?.njId) {
    node = node.parentElement;
  }
  if (!node?.dataset?.njId) return element.textContent?.slice(0, 800) || '';
  const siblings = [...(node.parentElement?.querySelectorAll('[data-nj-id]') || [])];
  const index = siblings.indexOf(node);
  const parts = [];
  if (index > 0) parts.push(siblings[index - 1].textContent);
  parts.push(node.textContent);
  if (index >= 0 && index < siblings.length - 1) parts.push(siblings[index + 1].textContent);
  return parts.join('\n\n').slice(0, 5000);
}

function cssEscape(value) {
  return (window.CSS && CSS.escape) ? CSS.escape(value) : String(value).replace(/"/g, '\\"');
}

// MARK: - 数学公式（KaTeX 动态 vendor 注入）

/**
 * 无标注代码块的保守 auto 高亮门槛。实测（hljs 11.11.1 common 构建）：
 * 真实短代码 relevance 普遍只有 3~8（sql 3 / json 4 / js·python 5 / c 8），
 * 而自然语言由 looksLikeCode（行数 + 关键字特征 + 结构密度）先行拦截、根本到不了本检查，
 * 因此本值只需滤掉 gate 下的极端边缘样本——设 3 即可，更高只会误杀短代码。
 */
const CODE_AUTO_MIN_RELEVANCE = 3;

/** auto 检测排除的「噪声语言」：对任意自然语言文本也能给出非零 relevance，必须排除。 */
const CODE_AUTO_NOISE_LANGS = new Set(['markdown', 'plaintext', 'plain text']);

/** 「像代码」启发式：常见语言关键字 / 运算符 / 标签特征（只用于决定是否尝试 auto-detect）。 */
const CODE_HINT_RE = /(?:\bfunction\b|=>|\bconst\b|\blet\b|\bvar\b|\bdef\s|\bclass\s|\bimport\b|\bexport\b|#include|\bSELECT\b|\bFROM\b|\bpublic\b|\bvoid\b|<\/?[a-z]+>|\}\s*;?\s*$|^\s*\{)/im;

/** 结构字符（代码骨架：花括号/分号/括号/赋值/尖括号）密度下限——英文散文即使混入 function/class 等词，结构计数也几乎为 0。 */
const CODE_STRUCT_RE = /[{};=()[\]<>/]|=>/g;

/** 无标注 pre>code 是否值得尝试 auto 高亮：≥2 行非空行 + 命中代码特征 + ≥3 个结构字符（单行短块不碰）。 */
function looksLikeCode(text) {
  const value = String(text || '');
  if (value.length < 24 || value.length > 20000) return false;
  const lines = value.split('\n').filter((line) => line.trim()).length;
  if (lines < 2) return false;
  if (!CODE_HINT_RE.test(value)) return false;
  const structural = (value.match(CODE_STRUCT_RE) || []).length;
  return structural >= 3;
}

/** TeX 分隔符检测：$$...$$（display）/ \[...\]（display）/ \(...\)（inline）。 */
const KATEX_DETECT_RE = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)/;
const KATEX_SPAN_RE = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)/g;

/** katex 资源只注入一次（普通文章连 link/script 都不产生）；失败允许下次重试。 */
let katexReadyPromise = null;

function ensureKatexReady() {
  if (window.katex?.render) return Promise.resolve(window.katex);
  if (katexReadyPromise) return katexReadyPromise;
  katexReadyPromise = new Promise((resolve, reject) => {
    try {
      // 字体走 katex.min.css 相对路径（vendor/katex/fonts/），font-src 回落 default-src 'self' 合法
      if (!document.querySelector('link[data-nj-katex-css]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'vendor/katex/katex.min.css';
        link.dataset.njKatexCss = '1';
        document.head.appendChild(link);
      }
      const script = document.createElement('script');
      script.src = 'vendor/katex/katex.min.js'; // script-src 'self' 允许本地 vendor
      script.onload = () => {
        if (window.katex?.render) resolve(window.katex);
        else { katexReadyPromise = null; reject(new Error('katex loaded but window.katex missing')); }
      };
      script.onerror = () => { katexReadyPromise = null; reject(new Error('vendor/katex/katex.min.js 加载失败')); };
      document.head.appendChild(script);
    } catch (err) {
      katexReadyPromise = null;
      reject(err);
    }
  });
  return katexReadyPromise;
}

/**
 * 把文本节点内容拆为 [普通文本 | .nj-katex 公式] 片段。
 * display：$$...$$ 与 \[...\]；inline：\(...\)。任一公式渲染抛错 → 整体抛错（调用方回退原文本）。
 */
function katexReplacementFragments(katex, text) {
  const frag = document.createDocumentFragment();
  const re = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g;
  let last = 0;
  let made = false;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) frag.appendChild(document.createTextNode(text.slice(last, match.index)));
    const tex = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    const display = match[1] !== undefined || match[2] !== undefined;
    if (!tex) throw new Error('empty tex');
    const holder = document.createElement('span');
    holder.className = display ? 'nj-katex nj-katex-display' : 'nj-katex';
    katex.render(tex, holder, { displayMode: display, throwOnError: true, strict: false });
    frag.appendChild(holder);
    made = true;
    last = match.index + match[0].length;
  }
  if (!made) return null;
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
}

// MARK: - 批注常量与工具

/** 五色纸感荧光笔（swatch 为亮色模式色点，正文用色由 CSS 变量按明暗模式给出）。 */
const HIGHLIGHT_COLORS = [
  { key: 'yellow', label: '琥珀', swatch: '#e9c46a' },
  { key: 'green', label: '苔绿', swatch: '#a3b18a' },
  { key: 'blue', label: '黛蓝', swatch: '#8da9c4' },
  { key: 'pink', label: '胭脂', swatch: '#d8a7b1' },
  { key: 'purple', label: '青莲', swatch: '#b8a9c9' },
];

/** 收集 root 内文本节点与全局字符偏移（跳过译文/已有高亮/注释图标 → 自然防重复包裹）。 */
function collectTextEntries(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('.nj-translation, .nj-t, mark.nj-hl, .nj-annotation-icon, .nj-note-marker')
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const entries = [];
  let full = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    entries.push({ node, start: full.length });
    full += node.textContent;
  }
  return { entries, full };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function escapeHTML(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function attr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
