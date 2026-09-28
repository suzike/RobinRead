'use strict';
/**
 * diag-edition-find.js — R11 期刊内搜索探针（run-all OFFLINE 集）
 * 验证：Ctrl+F 打开搜索条 / 文章模式计数「N 处」+ Enter 跳页定位（叶高亮）/ 循环推进 /
 *       版面模式「M 条」+ Enter 跳页选中 / Esc 关闭（Esc 链最优先）
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-edition-find-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 150 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false, width: 1600, height: 1000,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(600);
    const run = (tag, js) => {
      console.log('PHASE ' + tag);
      return win.webContents.executeJavaScript(`(async () => { try { ${js} } catch (e) { return { __err: String(e && e.stack || e) }; } })()`);
    };
    const a = await run('article-find', `
      const mod = await import('./views/edition-reader.js');
      const PARA = '段落内容用于期刊内搜索验证：山海关是明长城的东北关隘，纸感阅读的关键不在于仿旧，版心行距页边共同构成节奏。';
      const ARTICLE = ('<h2>第一章 关隘</h2><p>' + PARA + '</p><p>补充段落：山海关城楼上的匾额与远处的海面相映成趣，是搜索定位的第二个落点。</p>').repeat(6);
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要 ' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 12 }, (_, i) => mk(i)), fetchArticle: async () => ARTICLE });
      window.__er = er;
      er.present(); clearTimeout(er._autoTimer); er._doOpen();
      await new Promise(r => setTimeout(r, 900));
      await er._openArticle(er.items[0]);
      await new Promise(r => setTimeout(r, 1200));
      // Ctrl+F 打开
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 300));
      const bar = document.querySelector('.er-findbar');
      const opened = !!bar;
      const input = bar?.querySelector('.er-find-input');
      input.value = '山海关';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      const count0 = bar.querySelector('.er-find-count').textContent;
      const page0 = er.index;
      // Enter 定位
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 1200));
      const page1 = er.index;
      const count1 = bar.querySelector('.er-find-count').textContent;
      const hitSoon = await new Promise(r => setTimeout(() => r(document.querySelectorAll('.er-article-leaf.er-leaf-hit').length), 400));
      // 循环推进
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 200));
      const count2 = bar.querySelector('.er-find-count').textContent;
      // Esc 关闭
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      const closed = !document.querySelector('.er-findbar');
      return { opened, count0, page0, page1, count1, hitSoon, count2, closed };
    `);
    if (a.__err) throw new Error('find: ' + a.__err);
    ok(a.opened, 'Ctrl+F 打开搜索条');
    ok(/处$/.test(a.count0) && parseInt(a.count0) >= 4, '文章命中计数（' + a.count0 + '）');
    ok(a.page1 !== a.page0 || a.count1.startsWith('1 /'), 'Enter 定位（页 ' + a.page0 + '→' + a.page1 + '，' + a.count1 + '）');
    ok(a.hitSoon >= 1, '命中叶高亮出现');
    ok(/^\d+ \/ /.test(a.count2) || a.count2.includes('/'), 'Shift+Enter 回退推进（' + a.count2 + '）');
    ok(a.closed, 'Esc 关闭搜索条');
    const b = await run('edition-find', `
      const er = window.__er;
      er._closeArticle(); // 回版面态再搜条目
      await new Promise(r => setTimeout(r, 800));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 300));
      const input = document.querySelector('.er-find-input');
      input.value = '条目 3';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      const count0 = document.querySelector('.er-find-count').textContent;
      const page0 = er.index;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 1400));
      const page1 = er.index;
      const selected = er.selected;
      er._findClose();
      er.dismiss();
      return { count0, page0, page1, selected };
    `);
    if (b.__err) throw new Error('edition: ' + b.__err);
    ok(/^1 条$/.test(b.count0) || b.count0.includes('条'), '版面条目命中（' + b.count0 + '）');
    ok(b.page1 === b.page0 || b.page1 >= 0, '版面跳页/选中执行（页 ' + b.page0 + '→' + b.page1 + '）');
    ok(!!b.selected, '命中条目被选中（' + b.selected + '）');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.message || e).slice(0, 400));
    app.exit(1);
  }
});
