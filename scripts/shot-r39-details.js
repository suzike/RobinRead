'use strict';
/** R39 验收截图：细节三连场景（截断来源行/清除键命中区/时间行）→ .tmp-shots/r39-1-details.png */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r39-'));
app.setPath('userData', userData);
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 180 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const win = new BrowserWindow({
      show: true, width: 1360, height: 860,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(900);
    win.setBounds({ width: 400, height: 860 });
    await sleep(400);
    const info = await win.webContents.executeJavaScript(`(async () => {
      const { ListView } = await import('./views/list.js');
      document.getElementById('app') && (document.getElementById('app').style.display = 'none');
      const host = document.createElement('div');
      host.className = 'list-scroll';
      host.style.cssText = 'position:fixed;top:0;left:0;bottom:0;width:100%;z-index:400;background:var(--page-background,#faf8f2);overflow:auto;';
      document.body.appendChild(host);
      const lv = new ListView(host, { onSelect: () => {}, onContext: () => {}, onLoadMore: () => {}, onSearch: () => {} });
      window.__lv = lv;
      const topics = ['端侧大模型', '车规芯片', '存储介质', '商业价值'];
      const mk = (i) => ({ id: 'r39-' + i, title: '文' + String.fromCharCode(65 + (i % 26)) + (i * 43 % 601) + ' ' + topics[i % 4] + '观察', summaryPreview: '这篇的摘要用于展示细节优化的列表观感：长来源名已截断、悬停可看全名。', sourceTitle: 'InfoQ - 促进软件开发领域知识与创新的传播', publishedAt: 1758902400 - i * 600, isRead: i % 4 === 0, contentHead: '' });
      lv.setViewMode('list');
      lv.render(Array.from({ length: 5 }, (_, i) => mk(i)), { kind: 'all' }, null, true);
      lv.topInset.querySelector('.list-top-title').textContent = '今天';
      lv.setSortButton('unreadFirst');
      // 搜索框有值 → 清除键可见（命中区已扩至 24px）
      lv.searchInput.value = '端侧';
      lv.searchHost.classList.add('has-value');
      await new Promise(r => setTimeout(r, 300));
      const clearBox = document.querySelector('.list-search .clear').getBoundingClientRect();
      const srcTitle = document.querySelector('.entry-source')?.title || '';
      const timeTitle = document.querySelector('.entry-time')?.title || '';
      const se = document.querySelector('.entry-source');
      const rowEl = document.querySelector('.entry-row');
      const rowCS = rowEl ? { minWidth: getComputedStyle(rowEl).minWidth, disp: getComputedStyle(rowEl).display, kids: [...rowEl.children].map((k) => ({ cls: k.className, w: Math.round(k.getBoundingClientRect().width), ws: getComputedStyle(k).whiteSpace, mw: getComputedStyle(k).minWidth })) } : null;
      const srcEllipsized = !!se && se.scrollWidth > se.clientWidth + 1;
      const srcDbg = se ? { sw: se.scrollWidth, cw: se.clientWidth, ws: getComputedStyle(se).whiteSpace, to: getComputedStyle(se).textOverflow, rowW: Math.round(se.closest('.entry-row').getBoundingClientRect().width), bodyW: Math.round(se.closest('.entry-body').getBoundingClientRect().width), metaW: Math.round(se.closest('.entry-meta').getBoundingClientRect().width) } : null;
      return { clearW: Math.round(clearBox.width), srcTitleFull: srcTitle, srcEllipsized, srcDbg, rowCS, timeTitle, viewW: window.innerWidth };
    })()`);
    console.log('evidence:', JSON.stringify(info));
    await sleep(250);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, 'r39-1-details.png'), img.toPNG());
    console.log('shot r39-1-details.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 700));
    app.exit(1);
  }
});
