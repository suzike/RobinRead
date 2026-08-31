'use strict';
/** v2.4.3 README 配图：AI 探索卡片流 / TTS 播放器（mock 语音）。输出 docs/images/{explore,tts}.jpg */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, ipcMain } = require('electron');
fs.appendFileSync(path.join(__dirname, 'shot-init.log'), 'module top\n');

const OUT = path.join(__dirname, '..', 'docs', 'images');
const LOG = path.join(__dirname, 'shot-v24.log');
const T0 = Date.now();
const log = (m) => { const line = `[${Math.round((Date.now() - T0) / 1000)}s] ${m}`; console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-shot-'));
app.setPath('userData', userData);

const NOW = new Date().toUTCString();
const mkItem = (i) => `
  <item><title>文章标题 ${i}：从模型到智能体的工程实践</title><link>https://example.com/p/${i}</link>
  <pubDate>${new Date(Date.now() - i * 3600e3).toUTCString()}</pubDate>
  <description>第 ${i} 篇文章摘要。</description>
  <content:encoded><![CDATA[<p>这是第 ${i} 篇文章的正文，包含足够的文字用于展示阅读排版、TTS 朗读高亮与翻译对照。纸感三栏阅读器把散落的订阅还原为一个安静、清晰的阅读空间，让注意力回到文字本身。</p>]]></content:encoded></item>`;

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>科技前沿周刊</title><link>https://example.com/weekly</link>
${[1, 2, 3, 4, 5, 6].map(mkItem).join('\n')}
</channel></rss>`;

// 8 分钟看门狗
setTimeout(() => { log('WATCHDOG 退出'); app.exit(3); }, 8 * 60 * 1000).unref();

app.whenReady().then(async () => {
  let failures = 0;
  const ok = (name) => { failures += 0; console.log(`PASS ${name}`); };
  const fail = (name, detail) => { failures += 1; console.log(`FAIL ${name} — ${detail}`); };

  const { AppStore } = require('../src/main/AppStore');
  const { parse: parseFeed } = require('../src/main/FeedParser');
  const { LOCAL_ACCOUNT_ID } = require('../src/main/Models');
  const store = new AppStore(userData);

  const feed = store.feedsRepo.insertFeed({
    accountID: LOCAL_ACCOUNT_ID, title: '科技前沿周刊', siteURL: 'https://example.com/weekly',
    feedURL: 'https://example.com/weekly/feed.xml',
  });
  store._applyParsedEntries(feed, parseFeed(SAMPLE, 'https://example.com/weekly/feed.xml').entries);

  const win = new BrowserWindow({
    show: false, width: 1440, height: 900,
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'), contextIsolation: true, backgroundThrottling: false },
  });
  const { registerIPCHandlers } = require('../src/main/ipc');
  registerIPCHandlers(store, win);
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await sleep(2500);
  const run = (js) => win.webContents.executeJavaScript(`(async () => { try { ${js} } catch (e) { return { error: String(e.message || e) }; } })()`);
  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, name), img.toJPEG(88));
    log(`${name} 截图完成`);
  };

  // ── 图 1：AI 探索卡片流 ──
  win.webContents.send('menu:openStore');
  await sleep(1200);
  const inStore = await run(`(() => { return { header: (document.querySelector('.fs-brand h2') || {}).textContent || '', entry: Boolean(document.querySelector('.fs-explore-entry')) }; })()`);
  if (inStore.header.includes('商店')) ok('商店已打开');
  else fail('商店未打开', JSON.stringify(inStore));
  await run(`document.querySelector('.fs-explore-entry').click()`);
  await sleep(600);
  await run(`(async () => {
    const input = document.querySelector('.fs-explore-domain');
    if (input) { input.value = '人工智能'; input.dispatchEvent(new Event('input', { bubbles: true })); }
    const start = document.querySelector('.fs-explore-start');
    if (start) start.click();
    return true;
  })()`);
  log('AI 探索运行中（真实网络验证）…');
  let cards = 0;
  for (let i = 0; i < 24; i += 1) {
    await sleep(5000);
    const st = await run(`(() => { const g = document.querySelectorAll('.fs-explore-grid > *'); return { n: g.length, first: g[0] ? (g[0].textContent || '').slice(0, 40) : '' }; })()`);
    log(`  轮询 ${i}: n=${st.n} ${st.first}`);
    if (st.n >= 3) { cards = st.n; break; }
  }
  if (cards >= 3) ok(`AI 探索卡片流 ${cards} 张`);
  else fail(`AI 探索卡片流仅 ${cards} 张`);
  await sleep(800);
  await shot('explore.jpg');

  // ── 图 2：TTS 播放器（mock 语音）──
  await run(`(async () => {
    let q = [];
    Object.defineProperty(window, 'speechSynthesis', {
      value: { speak(u) { q.push(u); setTimeout(() => u.onend && u.onend(), 100); }, cancel() { q.length = 0; }, pause() {}, resume() {}, getVoices() { return [{ name: 'Microsoft Huihui', lang: 'zh-CN' }]; }, speaking: false, pending: false },
      configurable: true,
    });
    window.__ttsq = q;
    const rows = [...document.querySelectorAll('.entry-row')];
    if (rows[0]) rows[0].click();
    await new Promise((r) => setTimeout(r, 3000));
    const ttsBtn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '听' || (b.title || '').includes('朗读'));
    if (ttsBtn) { ttsBtn.click(); return 'clicked'; }
    return 'no-btn: ' + [...document.querySelectorAll('.robin-header-actions button, button')].map((b) => (b.textContent || '').trim()).join('/');
  })()`);
  await sleep(3000);
  const ttsState = await run(`(() => {
    const player = document.querySelector('.nj-tts-player, [class*=tts]');
    const active = document.querySelector('.nj-tts-active');
    return { player: Boolean(player), active: Boolean(active) };
  })()`);
  if (ttsState.player || ttsState.active) ok('TTS 播放器与高亮');
  else fail('TTS 未出现', JSON.stringify(ttsState));
  await sleep(500);
  await shot('tts.jpg');

  win.destroy();
  console.log(failures === 0 ? 'SHOT: ALL PASSED' : `SHOT: ${failures} FAILED`);
  app.exit(failures === 0 ? 0 : 1);
});
