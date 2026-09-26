'use strict';
/**
 * diag-phase9-font-smoke.js — 排版引擎 v2 + 每日刊头 真实渲染烟雾（electron 隐藏窗口，离线）
 *
 * 覆盖调研报告方向 2/6 的真实风险点：
 *  1. @font-face 相对路径（../fonts/）在渲染进程 file:// 下能否解析并成功加载（霞鹜文楷 + 得意黑）
 *  2. 设置链路：fontFamily=wenkai / titleFont=smiley → CSS 变量接线 → 计算样式生效
 *  3. 每日刊头（封面故事 + 本期目录）在杂志视图真实渲染出 DOM
 * 离线：订阅由内置 RSS 字符串种子注入，不走网络。退出码 0=PASS。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const T0 = Date.now();
const log = (m) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-font-smoke-'));
app.setPath('userData', userData);

setTimeout(() => { log('WATCHDOG 退出'); app.exit(3); }, 5 * 60 * 1000).unref();

const NOW = new Date().toUTCString();
const item = (i, cover) => `<item><title>字体与刊头烟雾测试 ${i}</title><link>https://example.com/p/${i}</link><pubDate>${new Date(Date.now() - i * 3600e3).toUTCString()}</pubDate>
<content:encoded><![CDATA[${cover ? `<p><img src="https://example.com/cover${i}.jpg" alt=""></p>` : ''}<p>霞鹜文楷屏读版用于正文的中文排印烟雾验证：交笔楷意，纸感长文。</p>]]></content:encoded></item>`;
const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>字体烟雾测试</title><link>https://example.com/</link>
${item(1, true)}${item(2, true)}${item(3, false)}${item(4, false)}
</channel></rss>`;

app.whenReady().then(async () => {
  try {
    const { AppStore } = require('../src/main/AppStore');
    const { parse: parseFeed } = require('../src/main/FeedParser');
    const { LOCAL_ACCOUNT_ID } = require('../src/main/Models');
    const store = new AppStore(userData);
    const feed = store.feedsRepo.insertFeed({
      accountID: LOCAL_ACCOUNT_ID, title: '字体烟雾测试', siteURL: 'https://example.com/',
      feedURL: 'https://example.com/feed.xml',
    });
    store._applyParsedEntries(feed, parseFeed(SAMPLE, 'https://example.com/feed.xml').entries);

    const win = new BrowserWindow({
      show: false, width: 1280, height: 800,
      webPreferences: { preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'), contextIsolation: true, backgroundThrottling: false },
    });
    const { registerIPCHandlers } = require('../src/main/ipc');
    registerIPCHandlers(store, win);
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    const run = (js) => win.webContents.executeJavaScript(`(async () => { try { ${js} } catch (e) { return { error: String(e.message || e) }; } })()`);
    // 轮询等待应用桥就绪：隐藏窗口冷启动时机不定（run-all 连续 electron 启动时明显变慢），
    // 固定 sleep 会把 IPC 调用打在未初始化的 window.robin 上
    let bridgeReady = false;
    for (let i = 0; i < 60 && !bridgeReady; i += 1) {
      const probe = await run("return typeof window.robin === 'object' && typeof window.robin.setReaderLayout === 'function'");
      bridgeReady = probe === true;
      if (!bridgeReady) await sleep(500);
    }
    if (!bridgeReady) throw new Error('应用桥 30s 未就绪');
    await sleep(400);

    // 1. 霞鹜文楷：真实加载 + 正文变量接线 + 持久化
    const wenkai = await run(`
      await document.fonts.load("16px 'LXGW WenKai Screen'", '霞鹜文楷测试ABC123');
      return document.fonts.check("16px 'LXGW WenKai Screen'");
    `);
    if (wenkai !== true) throw new Error(`霞鹜文楷加载失败: ${JSON.stringify(wenkai)}`);
    log('PASS 霞鹜文楷经 @font-face 相对路径真实加载');
    await run(`await window.robin.setReaderLayout({ fontFamily: 'wenkai' }); return true;`);
    await sleep(800);
    const bodyVar = await run(`return getComputedStyle(document.documentElement).getPropertyValue('--reader-font');`);
    if (typeof bodyVar !== 'string' || !bodyVar.includes('LXGW WenKai Screen')) throw new Error(`--reader-font 未接线: ${JSON.stringify(bodyVar)}`);
    if (store.readerLayout().fontFamily !== 'wenkai') throw new Error('fontFamily 未持久化');
    log('PASS 正文字体变量接线与持久化');

    // 2. 得意黑：真实加载 + 标题变量接线 + 刊头计算样式生效
    const smiley = await run(`
      await document.fonts.load("16px 'Smiley Sans'", '得意黑测试ABC123');
      return document.fonts.check("16px 'Smiley Sans'");
    `);
    if (smiley !== true) throw new Error(`得意黑加载失败: ${JSON.stringify(smiley)}`);
    await run(`await window.robin.setReaderLayout({ titleFont: 'smiley' }); return true;`);
    await sleep(800);
    const titleVar = await run(`return getComputedStyle(document.documentElement).getPropertyValue('--reader-title-font');`);
    if (typeof titleVar !== 'string' || !titleVar.includes('Smiley Sans')) throw new Error(`--reader-title-font 未接线: ${JSON.stringify(titleVar)}`);
    log('PASS 得意黑加载与标题字体变量接线');

    // 3. 每日刊头：切杂志视图，轮询等待渲染（隐藏窗口 rAF 时机不定，固定 sleep 不可靠）
    await run(`await window.robin.setReaderLayout({ listViewMode: 'magazine' }); return true;`);
    let mast = null;
    for (let i = 0; i < 24 && !(mast && mast.cover); i += 1) {
      await sleep(500);
      mast = await run(`return {
        edition: !!document.querySelector('.nj-edition'),
        coverID: document.querySelector('.nj-edition-cover')?.dataset?.entryId || '',
        coverTitle: document.querySelector('.nj-edition-cover h2')?.textContent || '',
        tocRows: document.querySelectorAll('.nj-edition-toc-row').length,
        sections: document.querySelectorAll('.nj-edition-section').length,
        brandFont: document.querySelector('.nj-edition-brand') ? getComputedStyle(document.querySelector('.nj-edition-brand')).fontFamily : '',
      };`);
    }
    if (!mast || !mast.edition || !mast.coverID) throw new Error(`每日刊头未渲染: ${JSON.stringify(mast)}`);
    if (mast.tocRows !== 3) throw new Error(`目录行数应为 3（4 篇减封面故事 1），实际 ${JSON.stringify(mast)}`);
    if (!mast.brandFont.includes('Smiley Sans')) throw new Error(`刊头报头未吃到标题字体: ${mast.brandFont}`);
    log(`PASS 每日刊头渲染：封面「${mast.coverTitle}」+ 目录 ${mast.tocRows} 行 / ${mast.sections} 栏目`);

    // 4. 同题对比速读：无 API Key 的受控失败路径（不崩溃、错误信息可读）
    const single = await run(`return await window.robin.clusterBrief([{ id: 'a', title: '只有一篇' }]);`);
    if (!single || single.ok !== false) throw new Error(`单篇入参应受控拒绝: ${JSON.stringify(single)}`);
    const pair = await run(`return await window.robin.clusterBrief([
      { id: 'a', title: '同题报道甲', sourceTitle: '源A', summaryPreview: '甲摘要' },
      { id: 'b', title: '同题报道乙', sourceTitle: '源B', summaryPreview: '乙摘要' },
    ]);`);
    if (!pair || pair.ok !== false || typeof pair.error !== 'string' || !pair.error.length) {
      throw new Error(`无 Key 生成应受控失败并给出可读错误: ${JSON.stringify(pair)}`);
    }
    log(`PASS 对比速读受控路径：单篇拒绝 / 无 Key 报错「${pair.error.slice(0, 24)}…」`);

    // 5. 命令面板（方向 22）：真实键事件唤起/关闭
    const opened = await run(`
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'P', ctrlKey: true, shiftKey: true, bubbles: true }));
      return !!document.querySelector('.cmd-palette');
    `);
    if (opened !== true) throw new Error(`Ctrl+Shift+P 未唤起命令面板: ${JSON.stringify(opened)}`);
    const inputCount = await run(`return document.querySelectorAll('.cmd-item').length;`);
    if (!(inputCount >= 10)) throw new Error(`命令注册表数量异常: ${JSON.stringify(inputCount)}`);
    const closed = await run(`
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return !document.querySelector('.cmd-palette');
    `);
    if (closed !== true) throw new Error('Esc 未关闭命令面板');
    log(`PASS 命令面板：唤起 ${inputCount} 条命令，Esc 正常关闭`);

    // 6. 聚焦模式（方向 11）：F 键切换
    const focusOn = await run(`
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f', bubbles: true }));
      return document.body.classList.contains('rp-focus');
    `);
    if (focusOn !== true) throw new Error('F 键未进入聚焦模式');
    const focusOff = await run(`
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f', bubbles: true }));
      return document.body.classList.contains('rp-focus');
    `);
    if (focusOff !== false) throw new Error('再按 F 未退出聚焦模式');
    log('PASS 聚焦模式：F 键两态切换正常');

    app.exit(0);
  } catch (error) {
    console.error('FAIL', error && error.message ? error.message : error);
    app.exit(1);
  }
});
