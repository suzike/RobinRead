'use strict';
/**
 * diag-r42-details.js — R42 细节三连探针（run-all OFFLINE 集）
 * 验证：搜索输入即收起历史下拉（不遮输入与结果）/ 正文外链悬停「在浏览器打开」提示 /
 *       正文 iframe 注入 loading=lazy
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r42-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 150 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false, width: 1440, height: 900,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(900);
    const run = (tag, js) => {
      console.log('PHASE ' + tag);
      return win.webContents.executeJavaScript(`(async () => { try { ${js} } catch (e) { return { __err: String(e && e.stack || e) }; } })()`);
    };
    const a = await run('details', `
      // ① 输入即收起历史下拉
      const { ListView } = await import('./views/list.js');
      const host = document.createElement('div');
      host.className = 'list-scroll';
      document.body.appendChild(host);
      const searches = [];
      const lv = new ListView(host, { onSelect: () => {}, onContext: () => {}, onLoadMore: () => {}, onSearch: (q) => searches.push(q) });
      window.__lv = lv;
      const titles = ['量子计算商用化进展观察', '深海火山口的生态系统', '城市地铁新线通车运营'];
      const mk = (i) => ({ id: 'r42-' + i, title: titles[i], summaryPreview: '摘要用于细节探针', sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 60, contentHead: '' });
      lv.setViewMode('list');
      lv.render([mk(0), mk(1), mk(2)], { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 200));
      const input = lv.searchInput;
      for (const term of ['量子', '火山']) {
        input.value = term;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 330));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 40));
      }
      lv._showSearchHistory(); // 下拉开
      await new Promise(r => setTimeout(r, 60));
      const openBefore = !!document.querySelector('.search-history');
      input.value = '量';
      input.dispatchEvent(new Event('input', { bubbles: true })); // 输入字符
      await new Promise(r => setTimeout(r, 60));
      const goneAfterType = !document.querySelector('.search-history');
      // ②③ 外链 title + iframe 懒加载（正文归一化）
      const { ReaderView } = await import('./views/reader.js');
      const rhost = document.createElement('div');
      rhost.className = 'reader-article';
      document.body.appendChild(rhost);
      const rproto = Object.create(ReaderView.prototype);
      rproto.body = rhost;
      rproto.feed = { siteURL: 'https://example.com/' };
      rproto.entry = { url: 'https://example.com/a' };
      rhost.innerHTML = '<p><a href="https://example.com/out">外部链接</a> <a href="/relative">相对链接</a></p>' +
        '<iframe src="https://www.youtube.com/embed/x"></iframe>';
      rproto._normalizeArticle();
      rproto._interceptLinks();
      await new Promise(r => setTimeout(r, 60));
      const extLink = rhost.querySelector('a[href="https://example.com/out"]');
      const extTitle = extLink?.title || '';
      const iframeLazy = rhost.querySelector('iframe')?.getAttribute('loading');
      return { openBefore, goneAfterType, extTitle, iframeLazy };
    `);
    if (a.__err) throw new Error('details: ' + a.__err);
    ok(a.openBefore, '下拉开启态成立');
    ok(a.goneAfterType, '输入字符即收起历史下拉（不遮输入与结果）');
    ok(a.extTitle.includes('在浏览器打开'), '外链悬停「在浏览器打开」提示（' + a.extTitle + '）');
    ok(a.iframeLazy === 'lazy', '正文 iframe 注入 loading=lazy');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
