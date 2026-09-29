'use strict';
/** R45 验收截图：批量条 toolbar 语义 + 标签 chips 焦点环（可见部分）→ .tmp-shots/r45-1-details.png */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r45-'));
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
    const info = await win.webContents.executeJavaScript(`(async () => {
      const { ListView } = await import('./views/list.js');
      document.getElementById('app') && (document.getElementById('app').style.display = 'none');
      const host = document.createElement('div');
      host.className = 'list-scroll';
      host.style.cssText = 'position:fixed;inset:0;z-index:400;background:var(--page-background,#faf8f2);overflow:auto;';
      document.body.appendChild(host);
      const lv = new ListView(host, { onSelect: () => {}, onContext: () => {}, onLoadMore: () => {}, onSearch: () => {} });
      window.__lv = lv;
      const topics = ['端侧大模型', '车规芯片', '存储介质', '商业价值'];
      const mk = (i) => ({ id: 'r45-' + i, title: '文' + String.fromCharCode(65 + (i % 26)) + (i * 43 % 601) + ' ' + topics[i % 4] + '观察', summaryPreview: '这篇的摘要用于展示批量操作条与焦点环的验收。', sourceTitle: 'InfoQ', publishedAt: 1758902400 - i * 600, isRead: i % 4 === 0, contentHead: '' });
      lv.setViewMode('list');
      lv.render(Array.from({ length: 5 }, (_, i) => mk(i)), { kind: 'all' }, null, true);
      lv.topInset.querySelector('.list-top-title').textContent = '今天';
      lv.setSortButton('unreadFirst');
      // Ctrl+点击两行 → 批量条出现（含 role=toolbar）
      const rows = host.querySelectorAll('.entry-row');
      rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
      rows[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
      await new Promise(r => setTimeout(r, 250));
      const bar = document.querySelector('.list-batch-bar');
      return { barRole: bar?.getAttribute('role'), barLabel: bar?.getAttribute('aria-label'), picked: document.querySelectorAll('.entry-row.nj-picked').length };
    })()`);
    console.log('evidence:', JSON.stringify(info));
    await sleep(250);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, 'r45-1-details.png'), img.toPNG());
    console.log('shot r45-1-details.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 700));
    app.exit(1);
  }
});
