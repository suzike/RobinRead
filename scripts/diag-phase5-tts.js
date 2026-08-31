'use strict';
/**
 * diag-phase5-tts.js — 阶段五「听文章」TTS 状态机端到端探测
 *
 * speechSynthesis 在无头/CI 环境可能不可用或无中文语音，因此全部断言走注入的
 * mock 状态机（页面加载前 executeJavaScript 注入 stub），不依赖真实语音：
 *   speak(u) → 入队 + 同步 onstart；cancel() → 清队；onend 由本测试手动触发驱动状态机。
 *
 * 与生产一致的 boot：独立临时 userData（os.tmpdir 隔离）+ 真实 registerIPCHandlers
 * + show:false + backgroundThrottling:false + 加载 src/renderer/index.html。
 * 样本数据：本地注入 RSS（pubDate 一律取当前时间），不联网。
 *
 * 覆盖：
 *   a. 点「听」→ 队列收到按句切分的多个 utterance（≤120 字/句），第一段获得 nj-tts-active，
 *      播放器出现、声音下拉包含 mock 中文语音、状态为 playing
 *   b. 手动触发第一句 onend → active 移到下一块
 *   c. 暂停/继续/停止状态正确（stop 后队列清空、active 全移除、播放器移除）
 *   d. 切换文章 → 自动停止（队列清空）
 *   e. Esc 停止；灯箱打开时 Esc 让位；语速切换写入 localStorage 且新 utterance 生效；
 *      R 键读/停切换（阅读器栏聚焦时）
 *
 * 幂等：全部数据落在一次性临时目录；退出码 0=全 PASS，1=有 FAIL。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

// 必须在 app ready 前 require：ipc.js 顶层注册 robin-icon 特权 scheme（与生产相同路径）
require('../src/main/ipc');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-phase5-tts-'));
app.setPath('userData', userData);

// 页面加载前注入的 speechSynthesis stub（onend 由测试手动触发驱动状态机）。
// gotcha：window.speechSynthesis 是只读 WebIDL 访问器属性，直接赋值会被静默忽略
// （window 上仍是真的 speechSynthesis）——必须用 Object.defineProperty 整体替换。
const MOCK_JS = `(() => {
  try {
    const queue = [];
    const synth = {
      speak(u) { queue.push(u); if (typeof u.onstart === 'function') { try { u.onstart(); } catch (_) {} } },
      cancel() { queue.length = 0; },
      pause() { window.__ttsPauseCalls += 1; },
      resume() { window.__ttsResumeCalls += 1; },
      getVoices() { return [{ name: 'Microsoft Huihui', lang: 'zh-CN' }]; },
      speaking: false,
      pending: false,
    };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, writable: true, configurable: true });
    window.__ttsQueue = queue;
    window.__ttsPauseCalls = 0;
    window.__ttsResumeCalls = 0;
    window.__ttsMockInstalled = window.speechSynthesis === synth;
    return window.__ttsMockInstalled;
  } catch (e) { window.__ttsMockInstalled = 'err:' + (e && e.message); return false; }
})()`;

// >500 plainLen：needsExtraction=false 且不走「正文过短补全抓取」，保证确定性
const LONG = '朗读状态机探测用正文段落，包含多个句子。语音引擎会把这段文字按句切块逐句入队。块长不得超过一百二十字，超出部分在次级标点处硬切！这一句以问号收尾可以验证句界切分；分号也是句界。'.repeat(10);
const BODY1 = `<h2>朗读状态机</h2><p>${LONG}</p>`;
const BODY2 = `<h2>第二篇文章</h2><p>${'切换文章时朗读必须自动停止并清空队列。'.repeat(30)}</p>`;

function sampleRSS() {
  const iso = (ms) => new Date(ms).toUTCString();
  const now = Date.now();
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>阶段五TTS周刊</title>
    <link>https://example.com/tts-weekly</link>
    <item>
      <title>样本文章一：TTS 朗读状态机验证</title>
      <link>https://example.com/tts-weekly/1</link>
      <pubDate>${iso(now)}</pubDate>
      <description>听文章状态机样本。</description>
      <content:encoded><![CDATA[${BODY1}]]></content:encoded>
    </item>
    <item>
      <title>样本文章二：切文自动停止</title>
      <link>https://example.com/tts-weekly/2</link>
      <pubDate>${iso(now)}</pubDate>
      <description>生命周期样本。</description>
      <content:encoded><![CDATA[${BODY2}]]></content:encoded>
    </item>
  </channel>
</rss>`;
}

app.whenReady().then(async () => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(Boolean(ok));
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let code = 1;
  const watchdog = setTimeout(() => {
    console.log('FAIL watchdog — 探测总时长超 120s，强制退出');
    app.exit(1);
  }, 120000);

  try {
    const FeedParser = require('../src/main/FeedParser');
    const { AppStore } = require('../src/main/AppStore');
    const { registerIPCHandlers } = require('../src/main/ipc');

    const parsed = FeedParser.parse(Buffer.from(sampleRSS(), 'utf8'), 'https://example.com/tts-weekly/feed.xml');
    const store = new AppStore(userData);
    const feed = store.feedsRepo.insertFeed({
      accountID: 'local-default',
      title: parsed.title,
      siteURL: parsed.siteURL,
      feedURL: 'https://example.com/tts-weekly/feed.xml',
    });
    store._applyParsedEntries(feed, parsed.entries);
    const items = store.listItems({ kind: 'feed', feedID: feed.id });
    const id1 = (items.find((i) => i.title.includes('样本文章一')) || {}).id || '';
    const id2 = (items.find((i) => i.title.includes('样本文章二')) || {}).id || '';
    if (!id1 || !id2) throw new Error(`样本条目缺失 id1=${id1} id2=${id2}`);

    const win = new BrowserWindow({
      show: false, width: 1500, height: 940,
      webPreferences: {
        preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    registerIPCHandlers(store, win);
    // 页面加载前注入 mock：不 await loadFile，先发起注入（赶在页面脚本消费之前）
    const loadPromise = win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    win.webContents.executeJavaScript(MOCK_JS, true).catch(() => {});
    await loadPromise;
    // gotcha：executeJavaScript 的 rejection 会变成空 {}，注入 IIFE 内一律自行 try/catch
    const run = async (js) => {
      try { return await win.webContents.executeJavaScript(js, true); }
      catch (e) { return { ok: false, error: 'executeJavaScript-rejected: ' + String((e && e.message) || e) }; }
    };
    await sleep(4500); // boot：reloadAll + 首屏渲染（show:false 下 rAF 可能不跑，一律 setTimeout 等待）

    // ── 0. mock 注入断言 ──
    const mockState = await run(`({ installed: window.__ttsMockInstalled === true, voice: (window.speechSynthesis && window.speechSynthesis.getVoices()[0] || {}).name })`);
    check('mock speechSynthesis 已在页面内就位', mockState.installed === true && mockState.voice === 'Microsoft Huihui', JSON.stringify(mockState));

    // ── a. 打开文章一，点「听」→ 按句切块入队 + 首段高亮 ──
    await run(`(async () => { try { await window.__robinReader.open(${JSON.stringify(id1)}); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } })()`);
    await sleep(1200);
    const a = await run(`(() => {
      try {
        const btn = document.querySelector('[data-role="tts"]');
        if (!btn) return { ok: false, why: 'no-tts-button' };
        if (btn.disabled) return { ok: false, why: 'tts-button-disabled', title: btn.title };
        btn.click();
        const queue = window.__ttsQueue || [];
        const active = document.querySelector('.nj-tts-active');
        const reader = window.__robinReader;
        const select = document.querySelector('.nj-tts-voice');
        return {
          ok: queue.length >= 2
            && queue.every((u) => u.text.length <= 120)
            && !!active && active.dataset.njId === 'title'
            && reader.ttsState === 'playing'
            && !!document.querySelector('.nj-tts-player')
            && !!select && [...select.options].some((o) => o.value === 'Microsoft Huihui')
            && queue[0].lang === 'zh-CN',
          queueLen: queue.length,
          maxChunk: Math.max(...queue.map((u) => u.text.length)),
          firstActive: active ? active.dataset.njId : null,
          state: reader.ttsState,
          player: !!document.querySelector('.nj-tts-player'),
          voiceSelected: select ? select.value : null,
          firstLang: queue[0] ? queue[0].lang : null,
          btnLabel: (btn.querySelector('span') || {}).textContent,
        };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    })()`);
    check('a 点「听」→ 多 utterance 入队（≤120字/句）+ 首段(title) nj-tts-active + playing + 播放器/声音就绪',
      a.ok === true, JSON.stringify(a));

    // ── b. 手动触发第一句 onend → active 移到下一块 ──
    const b = await run(`(() => {
      try {
        const queue = window.__ttsQueue;
        const reader = window.__robinReader;
        const before = (document.querySelector('.nj-tts-active') || {}).dataset?.njId || null;
        const expectNext = reader._tts.chunks[1].paraID;
        if (typeof queue[0].onend !== 'function') return { ok: false, why: 'onend-missing' };
        queue[0].onend();
        const after = (document.querySelector('.nj-tts-active') || {}).dataset?.njId || null;
        return {
          ok: after === expectNext && after !== before && reader.ttsState === 'playing' && reader._tts.index === 1,
          before, after, expectNext, state: reader.ttsState, index: reader._tts.index,
        };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    })()`);
    check('b 第一句 onend → active 移到下一块且仍为 playing', b.ok === true, JSON.stringify(b));

    // ── c. 暂停 / 继续 / 停止 ──
    const cPause = await run(`(() => {
      try {
        document.querySelector('.nj-tts-toggle').click();
        const reader = window.__robinReader;
        return { ok: reader.ttsState === 'paused' && window.__ttsPauseCalls === 1, state: reader.ttsState, pauseCalls: window.__ttsPauseCalls,
                 toggleIsPlay: document.querySelector('.nj-tts-toggle').innerHTML.includes('M5 3.2') };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    })()`);
    check('c1 暂停：state=paused 且 synth.pause 被调用、按钮切为播放图标', cPause.ok === true, JSON.stringify(cPause));

    const cResume = await run(`(() => {
      try {
        document.querySelector('.nj-tts-toggle').click();
        const reader = window.__robinReader;
        return { ok: reader.ttsState === 'playing' && window.__ttsResumeCalls === 1, state: reader.ttsState, resumeCalls: window.__ttsResumeCalls };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    })()`);
    check('c2 继续：state=playing 且 synth.resume 被调用', cResume.ok === true, JSON.stringify(cResume));

    const cStop = await run(`(() => {
      try {
        document.querySelector('.nj-tts-stop').click();
        const queue = window.__ttsQueue;
        return {
          ok: window.__robinReader.ttsState === 'idle'
            && queue.length === 0
            && document.querySelectorAll('.nj-tts-active').length === 0
            && !document.querySelector('.nj-tts-player'),
          state: window.__robinReader.ttsState, queueLen: queue.length,
          activeCount: document.querySelectorAll('.nj-tts-active').length,
          playerGone: !document.querySelector('.nj-tts-player'),
        };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    })()`);
    check('c3 停止：state=idle、队列清空、active 全移除、播放器移除', cStop.ok === true, JSON.stringify(cStop));

    // ── d. 切换文章 → 自动停止 ──
    const dStart = await run(`(() => { try { document.querySelector('[data-role="tts"]').click(); return { ok: (window.__ttsQueue || []).length > 0, queueLen: (window.__ttsQueue || []).length }; } catch (e) { return { ok: false, error: e.message }; } })()`);
    const dSwitch = await run(`(async () => {
      try {
        await window.__robinReader.open(${JSON.stringify(id2)});
        await new Promise((r) => setTimeout(r, 600));
        const reader = window.__robinReader;
        return {
          ok: reader.ttsState === 'idle' && window.__ttsQueue.length === 0
            && document.querySelectorAll('.nj-tts-active').length === 0
            && !document.querySelector('.nj-tts-player'),
          state: reader.ttsState, queueLen: window.__ttsQueue.length,
        };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    })()`);
    check('d 前置：再次点「听」恢复朗读', dStart.ok === true && dStart.queueLen > 0, JSON.stringify(dStart));
    check('d 切换文章 → 自动停止（队列清空、active 清除、播放器移除）', dSwitch.ok === true, JSON.stringify(dSwitch));

    // ── e. 语速切换写 localStorage + Esc 停止 + 灯箱 Esc 让位 + R 键切换 ──
    await run(`(() => { try { localStorage.removeItem('robinread.tts.rate'); localStorage.removeItem('robinread.tts.voice'); document.querySelector('[data-role="tts"]').click(); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } })()`);
    await sleep(120);
    const eRate = await run(`(() => {
      try {
        const before = window.__ttsQueue.length;
        document.querySelector('.nj-tts-rate').click();
        const queue = window.__ttsQueue;
        return {
          ok: localStorage.getItem('robinread.tts.rate') === '1.25'
            && window.__robinReader.ttsState === 'playing'
            && queue.length > 0 && queue[0].rate === 1.25,
          savedRate: localStorage.getItem('robinread.tts.rate'),
          state: window.__robinReader.ttsState, queueLen: queue.length,
          utteranceRate: queue[0] ? queue[0].rate : null,
          before,
        };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    })()`);
    check('e1 语速切换写入 localStorage（1 → 1.25）且新 utterance rate 生效', eRate.ok === true, JSON.stringify(eRate));

    const eLightbox = await run(`(() => {
      try {
        const lb = document.createElement('div');
        lb.className = 'nj-lightbox is-active';
        lb.id = 'phase5-lightbox';
        document.body.appendChild(lb);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        const stillPlaying = window.__robinReader.ttsState === 'playing' && window.__ttsQueue.length > 0;
        lb.remove();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        return {
          ok: stillPlaying && window.__robinReader.ttsState === 'idle' && window.__ttsQueue.length === 0,
          stillPlayingWithLightbox: stillPlaying,
          stateAfterLightboxClosed: window.__robinReader.ttsState,
        };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    })()`);
    check('e2 灯箱打开时 Esc 让位（朗读不停）；灯箱关闭后 Esc 停止朗读', eLightbox.ok === true, JSON.stringify(eLightbox));

    // R 键：阅读器栏聚焦时 读 ↔ 停 切换
    const eKey = await run(`(() => {
      try {
        const readerCol = document.getElementById('reader');
        readerCol.classList.add('column-focused'); // 模拟 app 层 setActiveColumn(2) 的聚焦标记
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
        const started = window.__robinReader.ttsState === 'playing' && window.__ttsQueue.length > 0;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
        const stopped = window.__robinReader.ttsState === 'idle' && window.__ttsQueue.length === 0;
        readerCol.classList.remove('column-focused');
        return { ok: started && stopped, started, stopped };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    })()`);
    check('e3 R 键（阅读器聚焦时）：读 ↔ 停 切换', eKey.ok === true, JSON.stringify(eKey));

    // 声音选择持久化：切换下拉 → 写 robinread.tts.voice
    const eVoice = await run(`(() => {
      try {
        document.querySelector('[data-role="tts"]').click();
        const select = document.querySelector('.nj-tts-voice');
        select.value = 'Microsoft Huihui';
        select.dispatchEvent(new Event('change'));
        const saved = localStorage.getItem('robinread.tts.voice');
        const ok = saved === 'Microsoft Huihui' && window.__robinReader.ttsState === 'playing';
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        return { ok, saved };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    })()`);
    check('e4 声音选择写入 localStorage（robinread.tts.voice）', eVoice.ok === true, JSON.stringify(eVoice));

    // 禁用场景：无正文 / 已确认无语音 → 按钮置灰 + title 说明
    const eDisabled = await run(`(() => {
      try {
        const reader = window.__robinReader;
        const btn = document.querySelector('[data-role="tts"]');
        const savedHTML = reader.html;
        reader.html = '';
        reader._ttsRefreshButtonAvailability();
        const noBodyDisabled = btn.disabled === true && btn.title.length > 0;
        reader.html = savedHTML;
        reader._ttsVoicesConfirmedEmpty = true;
        reader._ttsRefreshButtonAvailability();
        const noVoiceDisabled = btn.disabled === true;
        reader._ttsVoicesConfirmedEmpty = false;
        reader._ttsRefreshButtonAvailability();
        const reEnabled = btn.disabled === false;
        return { ok: noBodyDisabled && noVoiceDisabled && reEnabled, noBodyDisabled, noVoiceDisabled, reEnabled, title: btn.title };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    })()`);
    check('e5 禁用场景：无正文/无语音 → 「听」按钮置灰 + title，恢复后可用', eDisabled.ok === true, JSON.stringify(eDisabled));

    code = results.every(Boolean) ? 0 : 1;
    console.log(code === 0 ? 'PHASE5 TTS PROBE: ALL PASSED' : 'PHASE5 TTS PROBE: FAILED');
  } catch (err) {
    console.error('HARNESS ERROR:', err && (err.stack || err.message || err));
    code = 1;
  }
  clearTimeout(watchdog);
  app.exit(code);
}).catch((err) => { console.error(err); app.exit(1); });
