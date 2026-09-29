'use strict';
/** R38 验收截图：图片宽高占位三态（加载中 shimmer / 已加载 / 失败保留框）→ .tmp-shots/r38-1-ratio.png */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r38-'));
app.setPath('userData', userData);
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 180 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const win = new BrowserWindow({
      show: true, width: 1360, height: 760,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(900);
    const script = [
      "const { ReaderView } = await import('./views/reader.js');",
      "const OKIMG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"800\" height=\"450\"><rect width=\"800\" height=\"450\" fill=\"#3D4A5C\"/><text x=\"400\" y=\"240\" font-size=\"40\" fill=\"#E9E2CF\" text-anchor=\"middle\" font-family=\"sans-serif\">已加载 · 版面零跳动</text></svg>');",
      "const wrap = document.createElement('div');",
      "wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#faf8f2;display:flex;gap:20px;padding:20px;font-family:sans-serif;';",
      "const styleEl = document.createElement('style');",
      "styleEl.textContent = '.col38 img { max-width:100%; max-height:178px; display:block; margin:6px 0; } .col38 { flex:1; background:#fff; border:1px solid #e5e0d2; border-radius:10px; padding:14px; } .col38 h3 { margin:0 0 10px; font-size:13px; } .col38 p { font-size:12px; color:#555; line-height:1.6; margin:6px 0; }';",
      "wrap.appendChild(styleEl);",
      "const mk = (title, color) => {",
      "  const col = document.createElement('div');",
      "  col.className = 'col38';",
      "  const h = document.createElement('h3');",
      "  h.style.color = color;",
      "  h.textContent = title;",
      "  col.appendChild(h);",
      "  const body = document.createElement('div');",
      "  body.className = 'reader-article';",
      "  col.appendChild(body);",
      "  wrap.appendChild(col);",
      "  return body;",
      "};",
      "const bLoading = mk('加载中 · 等比 shimmer 占位（版面已预留，不再跳动）', '#a3573d');",
      "bLoading.innerHTML = '<p>上图位置已在加载前按已知比例预留等比空间：</p><img src=\"https://10.255.255.1:81/slow.jpg\" width=\"800\" height=\"450\"><p>下文不会在图片到达瞬间整体下跳。</p>';",
      "const bLoaded = mk('已加载 · 宽高比锁定渲染', '#617357');",
      "bLoaded.innerHTML = '<p>加载完成，等比呈现：</p><img src=\"' + OKIMG + '\" width=\"800\" height=\"450\"><p>正文衔接无任何位移。</p>';",
      "const bFailed = mk('加载失败 · 占位框不塌陷', '#8a6d3b');",
      "bFailed.innerHTML = '<p>源站防盗链失败时保留等比占位框：</p><img src=\"https://127.0.0.1:1/broken.jpg\" width=\"800\" height=\"450\"><p>版面结构保持，可平静重试。</p>';",
      "document.body.appendChild(wrap);",
      "const proto = Object.create(ReaderView.prototype);",
      "proto.feed = {}; proto.entry = {};",
      "for (const body of [bLoading, bLoaded, bFailed]) {",
      "  proto.body = body;",
      "  body.querySelectorAll('img').forEach((im) => proto._decorateImage(im));",
      "}",
      "await new Promise(r => setTimeout(r, 1900));",
      "const gLoading = bLoading.querySelector('img');",
      "const cap = document.createElement('div');",
      "cap.style.cssText = 'position:absolute;right:14px;bottom:6px;font-size:11px;color:#617357;background:#fff;border:1px solid #ddd;border-radius:6px;padding:2px 8px;z-index:5;';",
      "cap.textContent = '自检 wrap 零溢出 · sw=' + wrap.scrollWidth + '/cw=' + wrap.clientWidth + ' sh=' + wrap.scrollHeight + '/ch=' + wrap.clientHeight;",
      "wrap.appendChild(cap);",
      "return {",
      "  sw: wrap.scrollWidth, cw: wrap.clientWidth, sh: wrap.scrollHeight, ch: wrap.clientHeight,",
      "  loading: gLoading.classList.contains('nj-img-loading'),",
      "  ar: gLoading.style.aspectRatio,",
      "  failed: bFailed.querySelector('img').classList.contains('nj-img-failed'),",
      "  failedH: Math.round(bFailed.querySelector('img').getBoundingClientRect().height),",
      "  capW: Math.round(cap.getBoundingClientRect().width),",
      "  capH: Math.round(cap.getBoundingClientRect().height),",
      "};",
    ].join('\n');
    const info = await win.webContents.executeJavaScript('(async () => { try {\n' + script + '\n} catch (e) { return { __pageErr: String(e && e.stack || e).slice(0, 600) }; } })()');
    console.log('state:', JSON.stringify(info));
    await sleep(300);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, 'r38-1-ratio.png'), img.toPNG());
    console.log('shot r38-1-ratio.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 700));
    app.exit(1);
  }
});
