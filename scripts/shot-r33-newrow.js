'use strict';
/** R33 验收截图：新文章到达行高亮（到达后 ~0.5s 拍中间帧）→ .tmp-shots/r33-1-row-new.png */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r33-'));
app.setPath('userData', userData);
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 180 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const win = new BrowserWindow({
      show: true, width: 1440, height: 900,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(800);
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
      host.style.cssText = 'position:fixed;inset:0;z-index:400;background:var(--page-background,#faf8f2);overflow:auto;';
      document.body.appendChild(host);
      const topics = ['端侧大模型', '车规芯片', '存储介质', '商业价值', 'Agent 沙箱'];
      const mk = (i) => ({ id: 'r33-' + i, title: '文' + String.fromCharCode(65 + (i % 26)) + (i * 43 % 601) + ' ' + topics[i % 5] + '观察', summaryPreview: '这篇摘要用于展示新到文章的一次性高亮动效：橄榄绿底色 1.7 秒淡出，之后与普通行无异。', sourceTitle: 'InfoQ', publishedAt: 1758902400 - i * 600, isRead: i % 4 === 0, contentHead: '' });
      const lv = new ListView(host, { onSelect: () => {}, onContext: () => {}, onLoadMore: () => {}, onSearch: () => {} });
      window.__lv = lv;
      lv.setViewMode('list');
      lv.render(Array.from({ length: 4 }, (_, i) => mk(i)), { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 350));
      // 新文章到达：插到最前
      const fresh = { id: 'r33-fresh', title: '文NEW 突发：期刊阅读器又发新版了', summaryPreview: '这一行是刚到达的新文章：它带着一次性高亮底色出现，1.7 秒后淡出归位。', sourceTitle: 'InfoQ', publishedAt: 1758902500, isRead: false, contentHead: '' };
      lv.render([fresh, ...Array.from({ length: 4 }, (_, i) => mk(i))], { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 450));
      return { marked: !!document.querySelector('.entry-row.row-new') };
    })()`);
    await sleep(120);
    await shot('r33-1-row-new.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('SHOT-FAIL', e && e.stack || e);
    app.exit(1);
  }
});
