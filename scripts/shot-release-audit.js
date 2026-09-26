'use strict';
/** 发版前可视化体检：杂志刊头 / 阅读器排版 / 命令面板 / 设置外观 四屏截图 → .tmp-shots/*.png */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = process.env.SHOT_OUT || path.join(__dirname, '..', '.tmp-shots');
const T0 = Date.now();
const log = (m) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-release-shot-'));
app.setPath('userData', userData);
setTimeout(() => { log('WATCHDOG 退出'); app.exit(3); }, 5 * 60 * 1000).unref();

const NOW = new Date().toUTCString();
const mkItem = (i, withCover) => `
  <item><title>深度解析第 ${i} 篇：从模型到智能体的工程实践与纸感阅读的未来图景</title><link>https://example.com/p/${i}</link>
  <pubDate>${new Date(Date.now() - i * 3600e3).toUTCString()}</pubDate>
  <description>第 ${i} 篇文章摘要。</description>
  <content:encoded><![CDATA[${withCover ? `<p><img src="https://example.com/cover${i}.jpg" alt=""></p>` : ''}<p>这是第 ${i} 篇文章的正文段落，包含足够的中文文字用于展示阅读排版效果。纸感三栏阅读器把散落的订阅还原为一个安静、清晰的阅读空间，让注意力回到文字本身。混排验证 Mixed English words here 以及数字 2026 年的盘古之白效果。</p><blockquote><p>Reading First, AI Second —— 引用块样例。</p></blockquote>]]></content:encoded></item>`;

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>科技前沿周刊</title><link>https://example.com/weekly</link>
${mkItem(1, true)}${mkItem(2, true)}${mkItem(3, false)}${mkItem(4, true)}${mkItem(5, false)}${mkItem(6, false)}
</channel></rss>`;

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
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
    const run = (js) => win.webContents.executeJavaScript(`(async () => { try { ${js} } catch (e) { return { error: String(e.message || e) }; } })()`);
    let bridgeReady = false;
    for (let i = 0; i < 60 && !bridgeReady; i += 1) {
      bridgeReady = (await run("return typeof window.robin === 'object' && typeof window.robin.setReaderLayout === 'function'")) === true;
      if (!bridgeReady) await sleep(500);
    }
    if (!bridgeReady) throw new Error('bridge not ready');
    await sleep(600);

    const shot = async (name) => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(OUT, name), img.toPNG());
      log(`shot ${name}`);
    };

    // 1. 杂志视图 + 每日刊头（文楷正文 + 得意黑标题 + 对照分行 + 缩进全开）；README 配图用浅色纸感
    if (process.env.SHOT_LIGHT) await run(`await window.robin.setTheme('light'); return true;`);
    await run(`
      await window.robin.setReaderLayout({ listViewMode: 'magazine', fontFamily: 'wenkai', titleFont: 'smiley', paraStyle: 'indent', dropCap: 'on' });
      return true;
    `);
    let ok = false;
    for (let i = 0; i < 24 && !ok; i += 1) { await sleep(500); ok = (await run(`return !!document.querySelector('.nj-edition-cover')`)) === true; }
    await sleep(1500); // 等封面图失败兜底/布局稳定
    await shot('1-magazine-edition.png');

    // 2. 命令面板
    await run(`
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'P', ctrlKey: true, shiftKey: true, bubbles: true }));
      return true;
    `);
    await sleep(400);
    await shot('2-command-palette.png');
    await run(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true;`);
    await sleep(300);

    // 3. 阅读器：文楷 + 首字下沉 + 缩进（打开一篇正文）
    await run(`await window.robin.setReaderLayout({ listViewMode: 'list' }); return true;`);
    let rowsReady = false;
    for (let i = 0; i < 20 && !rowsReady; i += 1) { await sleep(500); rowsReady = (await run(`return document.querySelectorAll('.entry-row').length`)) >= 1; }
    const clicked = await run(`
      const cluster = document.querySelector('.cluster-row');
      if (cluster) cluster.click(); // 同题聚类（标题相似被聚合）：先展开
      const rows = [...document.querySelectorAll('.entry-row')];
      const row = rows.find((r) => !r.classList.contains('nj-mag-card')) || rows[0];
      if (!row) return { clicked: false, rows: rows.length, cluster: !!cluster };
      row.click();
      return { clicked: true, rows: rows.length, cls: row.className };
    `);
    log(`click diag: ${JSON.stringify(clicked)}`);
    let opened = false;
    for (let i = 0; i < 140 && !opened; i += 1) {
      await sleep(500);
      // 正文就绪即可（离线环境先等原文提取超时，再回退 feed 正文渲染）
      opened = (await run(`return !!document.querySelector('.reader-article .robin-body p')`)) === true;
    }
    await sleep(3000);
    if (!opened) throw new Error('reader not opened');
    await shot('3-reader-typography.png');

    // 4. 设置 → 外观（新排版设置组 + 自定义样式输入区）：侧栏底部「设置」按钮
    let settingsOk = false;
    for (let i = 0; i < 10 && !settingsOk; i += 1) {
      await run(`
        const gear = document.querySelector('.footer-nav-btn[title*="设置"]');
        if (gear) gear.click();
        return !!gear;
      `);
      await sleep(900);
      settingsOk = (await run(`return !!document.querySelector('.modal') && document.querySelector('.modal').textContent.includes('外观')`)) === true;
    }
    if (!settingsOk) throw new Error('settings modal not shown');
    await sleep(600);
    await shot('4-settings-appearance.png');

    app.exit(0);
  } catch (error) {
    console.error('FAIL', error && error.message ? error.message : error);
    app.exit(1);
  }
});
