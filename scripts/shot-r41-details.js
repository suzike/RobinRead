'use strict';
/** R41 验收截图：空态「立即刷新」+ 失败图点击重试态 → .tmp-shots/r41-1-details.png */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r41-'));
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
      const { ReaderView } = await import('./views/reader.js');
      document.getElementById('app') && (document.getElementById('app').style.display = 'none');
      // 左：空态刷新按钮
      const lhost = document.createElement('div');
      lhost.className = 'list-scroll';
      lhost.style.cssText = 'position:fixed;top:0;left:0;bottom:0;width:50%;z-index:400;background:var(--page-background,#faf8f2);overflow:auto;';
      document.body.appendChild(lhost);
      const lv = new ListView(lhost, { onSelect: () => {}, onContext: () => {}, onLoadMore: () => {}, onSearch: () => {} });
      window.__robinSidebar = [{ allFeeds: [{ id: 'f1' }] }];
      lv.setViewMode('list');
      lv.render([], { kind: 'all' }, null, true);
      lv.topInset.querySelector('.list-top-title').textContent = '今天';
      // 右：失败图（自动重试链已走完）+ 提示点击重试
      const rhost = document.createElement('div');
      rhost.className = 'reader-article';
      rhost.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:50%;z-index:400;background:#fff;padding:24px;box-sizing:border-box;overflow:auto;';
      document.body.appendChild(rhost);
      rhost.innerHTML = '<h3 style="font-size:14px;color:#a3573d;margin:0 0 8px">源站防盗链失败 · 点击图片可手动重试</h3>';
      const rproto = Object.create(ReaderView.prototype);
      rproto.body = rhost;
      rproto.feed = {}; rproto.entry = {};
      const p = document.createElement('p');
      p.innerHTML = '<img src="https://127.0.0.1:1/broken.jpg" width="800" height="450" alt="源站图片加载失败（可能是源站防盗链或代理失效）">';
      rhost.appendChild(p);
      rhost.querySelectorAll('img').forEach((im) => rproto._decorateImage(im));
      await new Promise(r => setTimeout(r, 1900)); // 自动重试链走完
      const btn = lhost.querySelector('.list-empty-refresh');
      const btnRect = btn ? { w: Math.round(btn.getBoundingClientRect().width), h: Math.round(btn.getBoundingClientRect().height) } : null;
      return { btnRect, failed: rhost.querySelector('img').classList.contains('nj-img-failed') };
    })()`);
    console.log('evidence:', JSON.stringify(info));
    await sleep(250);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, 'r41-1-details.png'), img.toPNG());
    console.log('shot r41-1-details.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 700));
    app.exit(1);
  }
});
