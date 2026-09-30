'use strict';
// shot-r50.js — R50 阅读器细节实机截图：划词弹层 + 图片（hover 提亮为交互态，由探针验证）
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r50shot-')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, width: 1280, height: 880, webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') } });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await sleep(900);
  await win.webContents.executeJavaScript(`(async () => {
    document.getElementById('app') && (document.getElementById('app').style.display = 'none');
    const art = document.createElement('div');
    art.className = 'reader-article';
    art.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;overflow:auto;background:var(--page-background,#faf8f2);padding:40px 22%;z-index:400;';
    const svg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="420"><rect width="800" height="420" fill="#d8cbb8"/><circle cx="400" cy="210" r="120" fill="#b7402e"/></svg>');
    art.innerHTML = '<h1>听说读写之外</h1>'
      + '<p>移动光标到下方插图上：图片会轻微提亮，配合 zoom-in 光标提示可点击灯箱。</p>'
      + '<img class="nj-img" style="width:100%;border-radius:8px" src="data:image/svg+xml;utf8,' + svg + '"/>'
      + '<p>第二段文字用于撑起滚动上下文。</p>';
    document.body.appendChild(art);
    const pop = document.createElement('div');
    pop.className = 'er-sel-popover nj-explanation';
    pop.style.cssText = 'position:fixed;right:60px;top:120px;z-index:401;width:320px;background:var(--note-background,#fff);border:1px solid var(--note-border);border-radius:10px;box-shadow:0 10px 32px rgba(30,26,18,.14);';
    pop.innerHTML = '<div class="nj-explanation-header" style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;"><b>词语解释</b><button class="close-btn" type="button" style="border:none;background:transparent;cursor:pointer;width:24px;height:24px;border-radius:6px;">✕</button></div>'
      + '<div class="nj-explanation-body" style="padding:0 14px 12px;font-size:13px;line-height:1.6;">精读：逐字逐句深入阅读并理解其含义。</div>';
    document.body.appendChild(pop);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  })()`);
  await sleep(400);
  fs.mkdirSync(path.join(__dirname, '..', '.tmp-shots'), { recursive: true });
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, '..', '.tmp-shots', 'r50-1-reader.png'), img.toPNG());
  console.log('shot r50-1-reader.png');
  app.exit(0);
});
