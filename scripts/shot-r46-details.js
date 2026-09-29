'use strict';
/** R46 验收截图：触底呼吸点 + splitter hover 高亮 → .tmp-shots/r46-1-bottom.png */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r46-'));
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
      const topics = ['端侧大模型', '车规芯片', '存储介质', '商业价值'];
      const mk = (i) => ({ id: 'r46-' + i, title: '文' + String.fromCharCode(65 + (i % 26)) + (i * 43 % 601) + ' ' + topics[i % 4] + '观察', summaryPreview: '这篇的摘要用于展示触底呼吸点的验收。', sourceTitle: 'InfoQ', publishedAt: 1758902400 - i * 600, isRead: i % 4 === 0, contentHead: '' });
      const lv = new ListView(host, { onSelect: () => {}, onContext: () => {}, onLoadMore: () => {}, onSearch: () => {} });
      window.__lv = lv;
      lv.setViewMode('list');
      lv.render(Array.from({ length: 20 }, (_, i) => mk(i)), { kind: 'all' }, null, true);
      lv.topInset.querySelector('.list-top-title').textContent = '今天';
      lv.setSortButton('unreadFirst');
      host.scrollTop = host.scrollHeight; // 触底 → 呼吸点
      await new Promise(r => setTimeout(r, 250));
      const dotEl = host.querySelector('.list-loading-more');
      const dot = !!dotEl;
      const dr = dotEl ? dotEl.getBoundingClientRect() : null;
      const cs = dotEl ? getComputedStyle(dotEl) : null;
      return { dot: !!dot, rect: dr ? { top: Math.round(dr.top), h: Math.round(dr.height) } : null, opacity: cs ? cs.opacity : null, color: cs ? cs.color : null, anim: cs ? cs.animationName : null, hostScroll: host.scrollTop, hostSH: host.scrollHeight, hostCH: host.clientHeight };
    })()`);
    console.log('diag:', JSON.stringify(info));
    await sleep(200);
    await shot_or_die();
    async function shot_or_die() {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(OUT, 'r46-1-bottom.png'), img.toPNG());
      console.log('shot r46-1-bottom.png');
    }
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 700));
    app.exit(1);
  }
});
