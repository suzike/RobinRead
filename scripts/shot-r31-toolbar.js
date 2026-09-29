'use strict';
/** R31 验收截图：工具栏精修四视角（宽栏/杂志纸感/窄栏折行/夜间纸感）→ .tmp-shots/r31t-*.png */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r31t-'));
app.setPath('userData', userData);
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 240 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LEAK = '<div align="right"> <a href="https://www.infoq.cn/article/xR2DgrXP6zRE">阅读全文</a></div>超六成的车企座舱，为何选中了同一个「端侧大脑」？本文深入拆解芯片选型背后的权衡。';

app.whenReady().then(async () => {
  const make = async (lv, n, leakRow) => {
    const topics = ['端侧大模型', '车规芯片', '存储介质', '商业价值', 'Agent 沙箱', 'Zig 重写'];
    const mk = (i) => ({
      id: 'r31t-' + i,
      title: i === leakRow ? '大模型下沉车规芯片：超六成的车企座舱，为何选中了同一个「端侧大脑」？' : '文' + String.fromCharCode(65 + (i % 26)) + (i * 37 % 501) + ' ' + topics[i % 6] + '观察',
      summaryPreview: i === leakRow ? LEAK : '这篇文章的摘要预览用于展示列表行的两行摘要排版效果与工具栏精修后的整体观感。',
      sourceTitle: 'InfoQ - 促进软件开发领域知识与创新的传播',
      publishedAt: 1758902400 - i * 600,
      isRead: i % 4 === 0, isStarred: i === 2, isLater: i === 3,
      contentHead: '',
    });
    lv.setViewMode('list');
    lv.render(Array.from({ length: n }, (_, i) => mk(i)), { kind: 'today' }, null, true);
    lv.topInset.querySelector('.list-top-title').textContent = '今天';
    lv.setSortButton('unreadFirst');
  };
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
    // ① 宽栏列表：净化摘要 + 统一工具栏
    await win.webContents.executeJavaScript(`(async () => {
      const { ListView } = await import('./views/list.js');
      document.getElementById('app') && (document.getElementById('app').style.display = 'none');
      const host = document.createElement('div');
      host.className = 'list-scroll';
      host.style.cssText = 'position:fixed;inset:0;z-index:400;background:var(--page-background,#faf8f2);overflow:auto;';
      document.body.appendChild(host);
      window.__mk = (w, h) => { host.style.width = w ? w + 'px' : ''; host.style.height = h ? h + 'px' : ''; };
      const lv = new ListView(host, { onSelect: () => {}, onContext: () => {}, onLoadMore: () => {}, onSearch: () => {} });
      window.__lv = lv; window.__host = host;
      await window.__make?.();
      const topics = ['端侧大模型', '车规芯片', '存储介质', '商业价值', 'Agent 沙箱', 'Zig 重写'];
      const mk = (i) => ({ id: 'r31t-' + i, title: i === 0 ? '大模型下沉车规芯片：超六成的车企座舱，为何选中了同一个「端侧大脑」？' : '文' + String.fromCharCode(65 + (i % 26)) + (i * 37 % 501) + ' ' + topics[i % 6] + '观察', summaryPreview: i === 0 ? ${JSON.stringify(LEAK)} : '这篇文章的摘要预览用于展示列表行的两行摘要排版效果与工具栏精修后的整体观感。', sourceTitle: 'InfoQ - 促进软件开发领域知识与创新的传播', publishedAt: 1758902400 - i * 600, isRead: i % 4 === 0, isStarred: i === 2, isLater: i === 3, contentHead: '' });
      lv.setViewMode('list');
      lv.render(Array.from({ length: 9 }, (_, i) => mk(i)), { kind: 'today' }, null, true);
      lv.topInset.querySelector('.list-top-title').textContent = '今天';
      lv.setSortButton('unreadFirst');
      await new Promise(r => setTimeout(r, 350));
      return { ok: 1 };
    })()`);
    await sleep(250);
    await shot('r31t-1-list-wide.png');
    // ② 杂志纸感主题
    await win.webContents.executeJavaScript(`(async () => {
      window.__host.classList.add('nj-mag-paper');
      const { paperPref } = await import('./views/paper-pref.js');
      window.__lv.setViewMode('magazine');
      const topics = ['端侧大模型', '车规芯片', '存储介质', '商业价值', 'Agent 沙箱', 'Zig 重写'];
      const mk = (i) => ({ id: 'r31t-' + i, title: '文' + String.fromCharCode(65 + (i % 26)) + (i * 37 % 501) + ' ' + topics[i % 6] + '观察', summaryPreview: '摘要预览。', sourceTitle: 'InfoQ', publishedAt: 1758902400 - i * 600, isRead: i % 4 === 0, contentHead: '' });
      window.__lv.render(Array.from({ length: 7 }, (_, i) => mk(i)), { kind: 'today' }, null, true);
      window.__lv.topInset.querySelector('.list-top-title').textContent = '今天';
      await new Promise(r => setTimeout(r, 350));
      return { ok: 1 };
    })()`);
    await sleep(250);
    await shot('r31t-2-mag-paper.png');
    // ③ 窄栏折行（复现用户 430px 场景）
    win.setBounds({ width: 560, height: 900 });
    await win.webContents.executeJavaScript(`(async () => {
      window.__host.classList.remove('nj-mag-paper');
      window.__mk(430, null);
      window.__lv.setViewMode('list');
      const topics = ['端侧大模型', '车规芯片', '存储介质', '商业价值'];
      const mk = (i) => ({ id: 'r31t-' + i, title: '文' + String.fromCharCode(65 + (i % 26)) + (i * 53 % 701) + ' ' + topics[i % 4] + '观察', summaryPreview: '摘要预览用于窄栏折行验收。', sourceTitle: 'InfoQ', publishedAt: 1758902400 - i * 600, isRead: i % 4 === 0, contentHead: '' });
      window.__lv.render(Array.from({ length: 6 }, (_, i) => mk(i)), { kind: 'today' }, null, true);
      window.__lv.topInset.querySelector('.list-top-title').textContent = '今天';
      await new Promise(r => setTimeout(r, 300));
      return { ok: 1 };
    })()`);
    await sleep(250);
    await shot('r31t-3-narrow-wrap.png');
    // ④ 夜间纸感
    await win.webContents.executeJavaScript(`(async () => {
      document.body.classList.add('dark');
      window.__host.classList.add('nj-mag-paper');
      const topics = ['端侧大模型', '车规芯片', '存储介质', '商业价值'];
      const mk = (i) => ({ id: 'r31t-' + i, title: '文' + String.fromCharCode(65 + (i % 26)) + (i * 53 % 701) + ' ' + topics[i % 4] + '观察', summaryPreview: '摘要预览。', sourceTitle: 'InfoQ', publishedAt: 1758902400 - i * 600, isRead: i % 4 === 0, contentHead: '' });
      window.__lv.setViewMode('magazine');
      window.__lv.render(Array.from({ length: 6 }, (_, i) => mk(i)), { kind: 'today' }, null, true);
      await new Promise(r => setTimeout(r, 300));
      return { ok: 1 };
    })()`);
    await sleep(250);
    await shot('r31t-4-dark-paper.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('SHOT-FAIL', e && e.stack || e);
    app.exit(1);
  }
});
