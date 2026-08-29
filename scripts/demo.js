'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

app.setPath('userData', app.getPath('userData'));

app.whenReady().then(async () => {
  const { AppStore } = require('../src/main/AppStore');
  const store = new AppStore(app.getPath('userData'));
  const { registerIPCHandlers } = require('../src/main/ipc');
  const win = new BrowserWindow({
    show: false, width: 1400, height: 880, frame: false, autoHideMenuBar: true,
    title: 'RobinRead',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'), contextIsolation: true },
  });
  registerIPCHandlers(store, win);
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 900));
  win.show();

  const run = (code) => win.webContents.executeJavaScript(code);

  // 打开 AIHOT 精选 → 打开一篇文章
  await run(`(async () => {
    await new Promise((r) => setTimeout(r, 1400));
    const aihot = [...document.querySelectorAll('.sidebar-row')].find((r) => r.textContent.includes('AIHOT'));
    aihot?.click();
    await new Promise((r) => setTimeout(r, 700));
    document.querySelector('.entry-row')?.click();
    await new Promise((r) => setTimeout(r, 1800));
  })()`).catch(() => null);
  await new Promise((r) => setTimeout(r, 600));
  const shot1 = path.join(process.env.USERPROFILE, 'Desktop', 'NanJuPaper-Windows-main.png');
  fs.writeFileSync(shot1, (await win.webContents.capturePage()).toPNG());
  console.log('saved:', shot1);

  // 商店截图
  await run(`(async () => {
    [...document.querySelectorAll('.footer-nav-btn')].find((b) => b.textContent.includes('商店'))?.click();
    await new Promise((r) => setTimeout(r, 900));
  })()`).catch(() => null);
  await new Promise((r) => setTimeout(r, 400));
  const shot3 = path.join(process.env.USERPROFILE, 'Desktop', 'NanJuPaper-Windows-store.png');
  fs.writeFileSync(shot3, (await win.webContents.capturePage()).toPNG());
  console.log('saved:', shot3);
  await run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`).catch(() => null);
  await new Promise((r) => setTimeout(r, 400));

  // 打开设置 → 外观 → 主题设计器
  await run(`(async () => {
    [...document.querySelectorAll('.footer-nav-btn')].find((b) => b.textContent.includes('设置'))?.click();
    await new Promise((r) => setTimeout(r, 900));
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('打开设计器'));
    btn?.click();
    await new Promise((r) => setTimeout(r, 900));
    return Boolean(document.querySelector('.td-modal'));
  })()`).catch(() => null);
  await new Promise((r) => setTimeout(r, 500));
  const shot2 = path.join(process.env.USERPROFILE, 'Desktop', 'NanJuPaper-Windows-theme-designer.png');
  fs.writeFileSync(shot2, (await win.webContents.capturePage()).toPNG());
  console.log('saved:', shot2);

  const summary = await run(`(() => ({
    toolbarZones: document.querySelectorAll('.tb-zone').length,
    winControls: document.querySelectorAll('.wc-btn').length,
    toolbarBg: getComputedStyle(document.querySelector('.tb-zone-sidebar')).backgroundColor,
    sidebarBg: getComputedStyle(document.getElementById('sidebar')).backgroundColor,
    readerTitle: document.querySelector('.paper-header-title')?.textContent?.slice(0, 40) || '',
    designerWheel: Boolean(document.querySelector('.td-wheel')),
    tradChips: document.querySelectorAll('.td-trad-chip').length,
    auditRows: document.querySelectorAll('.td-audit-row').length,
  }))()`).catch(() => ({}));
  console.log('DOM SUMMARY:', JSON.stringify(summary));

  win.destroy();
  app.exit(0);
}).catch((err) => { console.error('demo failed:', err.message); app.exit(1); });
