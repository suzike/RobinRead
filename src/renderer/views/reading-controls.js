'use strict';
/**
 * reading-controls.js — 阅读控制中心（R3 重量级）
 *
 * 单一 Aa 浮层整合全部阅读参数：字号 / 行距 / 页宽 / 字体 / 段落风格 /
 * 聚焦模式 / 禅模式 / 自动滚动 / 朗读（引擎+连播）。
 * 全部控件读写既有通道（setReaderLayout / setFontSize / reader 方法），
 * 聚焦与禅模式经 handlers 回调 app 层，本模块零业务逻辑。
 */
import { t } from '../i18n.js';

function seg(options, current, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'rc-seg';
  for (const [val, label] of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rc-seg-btn';
    btn.textContent = label;
    btn.dataset.val = String(val);
    if (String(val) === String(current)) btn.classList.add('active');
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('.rc-seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      onChange(val);
    });
    wrap.appendChild(btn);
  }
  return wrap;
}

export class ReadingControls {
  constructor(reader, handlers) {
    this.reader = reader;
    this.handlers = handlers || {};
    this.overlay = null;
  }

  open() {
    if (this.overlay) { this.close(); return; }
    const reader = this.reader;
    if (!reader.entryID) return;
    const layout = window.__robinReaderLayout || {};
    const overlay = document.createElement('div');
    overlay.className = 'rc-overlay';
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) this.close(); });
    const panel = document.createElement('div');
    panel.className = 'rc-panel';
    panel.innerHTML = `<div class="rc-head"><span class="rc-title"></span></div>`;
    panel.querySelector('.rc-title').textContent = t('阅读控制中心');
    this.overlay = overlay;
    overlay.appendChild(panel);

    const addSection = (label) => {
      const sec = document.createElement('div');
      sec.className = 'rc-section';
      const lbl = document.createElement('div');
      lbl.className = 'rc-section-label';
      lbl.textContent = label;
      sec.appendChild(lbl);
      panel.appendChild(sec);
      return sec;
    };
    const addSeg = (sec, options, current, onChange) => sec.appendChild(seg(options, current, onChange));

    // ── 版面 ──
    const secType = addSection(t('版面'));
    addSeg(secType, [['serif', t('衬线')], ['sans', t('无衬线')], ['wenkai', t('文楷')]], layout.fontFamily || 'serif',
      (v) => window.robin.setReaderLayout({ fontFamily: v }));
    addSeg(secType, [[15, '15'], [17, '17'], [19, '19'], [21, '21'], [24, '24']], window.__robinArticleFontSize || 17,
      (v) => window.robin.setFontSize(Number(v)));
    addSeg(secType, [['compact', t('紧凑')], ['standard', t('标准')], ['loose', t('宽松')]], layout.lineHeight || 'standard',
      (v) => window.robin.setReaderLayout({ lineHeight: v }));
    addSeg(secType, [['narrow', t('窄')], ['standard', t('标准')], ['wide', t('宽')]], layout.pageWidth || 'standard',
      (v) => window.robin.setReaderLayout({ pageWidth: v }));

    // ── 模式 ──
    const secMode = addSection(t('模式'));
    addSeg(secMode, [['spacing', t('空行式')], ['indent', t('缩进式')]], layout.paraStyle || 'spacing',
      (v) => window.robin.setReaderLayout({ paraStyle: v }));
    addSeg(secMode, [['left', t('左对齐')], ['justify', t('两端')]], layout.textAlign || 'left',
      (v) => window.robin.setReaderLayout({ textAlign: v }));

    // ── 状态（聚焦/禅/自动滚动：瞬时切换 + 反映真实态）──
    const secState = addSection(t('状态'));
    const stateRow = document.createElement('div');
    stateRow.className = 'rc-seg';
    const stateDefs = [
      ['focus', t('聚焦'), () => this.handlers.onToggleFocus?.()],
      ['zen', t('禅模式'), () => this.handlers.onToggleZen?.()],
      ['autoscroll', t('自动滚动'), () => reader.toggleAutoScroll?.()],
    ];
    const reflect = () => {
      const on = {
        focus: document.body.classList.contains('rp-focus'),
        zen: document.body.classList.contains('zen'),
        autoscroll: !!reader._autoScroll,
      };
      stateRow.querySelectorAll('.rc-seg-btn').forEach((b) => b.classList.toggle('active', !!on[b.dataset.val]));
    };
    for (const [val, label] of stateDefs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rc-seg-btn';
      btn.dataset.val = val;
      btn.textContent = label;
      btn.addEventListener('click', () => { stateDefs.find((d) => d[0] === val)[2](); reflect(); });
      stateRow.appendChild(btn);
    }
    secState.appendChild(stateRow);
    reflect();

    // ── 朗读 ──
    const secTTS = addSection(t('朗读'));
    addSeg(secTTS, [['edge', t('神经')], ['local', t('本地')]], reader._ttsCfg?.engine === 'local' ? 'local' : 'edge',
      (v) => {
        window.robin.ttsSetConfig?.({ engine: v === 'edge' ? 'edge' : 'local' });
        document.dispatchEvent(new CustomEvent('robinread:tts-config'));
      });
    const ttsRow = document.createElement('div');
    ttsRow.className = 'rc-tts-row';
    const ttsPlay = document.createElement('button');
    ttsPlay.className = 'btn-text primary';
    ttsPlay.textContent = reader.ttsState !== 'idle' ? t('停止朗读') : t('开始朗读');
    ttsPlay.addEventListener('click', () => {
      reader.toggleTTS();
      setTimeout(() => { ttsPlay.textContent = reader.ttsState !== 'idle' ? t('停止朗读') : t('开始朗读'); }, 120);
    });
    const ttsQueue = document.createElement('button');
    ttsQueue.className = 'btn-text bordered';
    ttsQueue.textContent = reader._ttsQueueOn?.() ? t('连播：开') : t('连播：关');
    ttsQueue.addEventListener('click', () => {
      reader._ttsToggleQueue?.();
      ttsQueue.textContent = reader._ttsQueueOn?.() ? t('连播：开') : t('连播：关');
    });
    ttsRow.append(ttsPlay, ttsQueue);
    secTTS.appendChild(ttsRow);

    document.body.appendChild(overlay);
  }

  close() {
    this.overlay?.remove();
    this.overlay = null;
  }
}
