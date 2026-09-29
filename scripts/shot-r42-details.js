'use strict';
/** R42 验收截图：输入即收起历史下拉（两帧对照）→ .tmp-shots/r42-1/2.png */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r42-'));
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
    const shot = async (name) => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(OUT, name), img.toPNG());
      console.log(`shot ${name}`);
    };
    await win.webContents.executeJavaScript(`(async () => {
      const { ListView } = await import('./views/list.js');
      document.getElementById('app') && (document.getElementById('app').style.display = 'none');
      const host = document.createElement('div');
      host.className = 'list-scroll';
      host.style.cssText = 'position:fixed;top:0;left:0;bottom:0;width:520px;z-index:400;background:var(--page-background,#faf8f2);overflow:auto;';
      document.body.appendChild(host);
      const topics = ['端侧大模型', '车规芯片', '存储介质', '商业价值'];
      const mk = (i) => ({ id: 'r42-' + i, title: '文' + String.fromCharCode(65 + (i % 26)) + (i * 43 % 601) + ' ' + topics[i % 4] + '观察', summaryPreview: '这篇的摘要用于展示输入收起历史下拉的对照。', sourceTitle: 'InfoQ', publishedAt: 1758902400 - i * 600, isRead: i % 4 === 0, contentHead: '' });
      const lv = new ListView(host, { onSelect: () => {}, onContext: () => {}, onLoadMore: () => {}, onSearch: () => {} });
      window.__lv = lv;
      localStorage.setItem('robinread.searchHistory', JSON.stringify(['端侧大模型 功耗', '车规芯片 选型', '存储介质 原理']));
      lv.setViewMode('list');
      lv.render(Array.from({ length: 5 }, (_, i) => mk(i)), { kind: 'all' }, null, true);
      lv.topInset.querySelector('.list-top-title').textContent = '今天';
      lv.setSortButton('unreadFirst');
      lv.searchInput.focus(); // 空 focus → 下拉开
      await new Promise(r => setTimeout(r, 300));
      return { open: !!document.querySelector('.search-history') };
    })()`);
    await sleep(200);
    await shot('r42-1-dropdown-open.png');
    // 输入字符 → 下拉应即收起
    await win.webContents.executeJavaScript(`(() => {
      const input = window.__lv.searchInput;
      input.value = '端侧';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(300);
    await shot('r42-2-typed-hidden.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 700));
    app.exit(1);
  }
});
