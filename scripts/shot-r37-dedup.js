'use strict';
/** R37 验收截图：同址重复图折叠 前后对比 → .tmp-shots/r37-1-dedup.png */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r37-'));
app.setPath('userData', userData);
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 180 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const win = new BrowserWindow({
      show: true, width: 1440, height: 1000,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(900);
    const info = await win.webContents.executeJavaScript(`(async () => {
      const IMG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="880" height="300"><rect width="880" height="300" fill="#2B3444"/><text x="440" y="165" font-size="42" fill="#E9E2CF" text-anchor="middle" font-family="sans-serif">AI Has Taste · 封面图</text></svg>');
      const IMG2 = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="880" height="260"><rect width="880" height="260" fill="#3D4A5C"/><text x="440" y="145" font-size="36" fill="#CFE0D8" text-anchor="middle" font-family="sans-serif">数据图表 · 正文图</text></svg>');
      const raw = \`
        <figure><img src="\${IMG}"></figure>
        <p>公众号文章常见形态：封面图与正文头图同址重复。</p>
        <p><img src="\${IMG}"></p>
        <p><img src="\${IMG2}"></p>
        <p><img src="\${IMG2}"></p>
        <p>结尾段落保持完整。</p>\`;
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#faf8f2;display:flex;gap:24px;padding:24px;font-family:sans-serif;box-sizing:border-box;';
      wrap.innerHTML = '<style>.col img { max-width: 100%; max-height: 170px; object-fit: contain; object-position: left top; display: block; border-radius: 6px; margin: 8px 0; }</style>';
      const mk = (cls, title, color) => {
        const col = document.createElement('div');
        col.className = 'col ' + cls;
        col.style.cssText = 'flex:1;background:#fff;border:1px solid #e5e0d2;border-radius:10px;padding:16px;';
        col.innerHTML = '<h3 style="margin:0 0 10px;font-size:14px;color:' + color + '">' + title + '</h3>';
        return col;
      };
      const before = mk('b', '修复前 · 源 HTML 原样（4 图 2 组重复）', '#a3573d');
      const after = mk('a', '修复后 · 同址重复折叠（2 图）', '#617357');
      wrap.append(before, after);
      document.body.appendChild(wrap);
      before.innerHTML += raw + '<div style="font-size:11px;color:#999;margin-top:8px">第 1、2 张与第 3、4 张各为同址重复</div>';
      const host = document.createElement('div');
      host.innerHTML = raw;
      after.appendChild(host);
      const { ReaderView } = await import('./views/reader.js');
      const proto = Object.create(ReaderView.prototype);
      proto.body = host;
      proto.feed = {}; // 无 siteURL：跳过 src 修复通路（data-URI 占位图得以保留，专验去重逻辑）
      proto.entry = {};
      proto._normalizeArticle();
      const cap = document.createElement('div');
      cap.style.cssText = 'font-size:11px;color:#999;margin-top:8px';
      cap.textContent = '重复已折叠 · 正文文本完整';
      after.appendChild(cap);
      await new Promise(r => setTimeout(r, 400));
      const cap2 = document.createElement('div');
      cap2.style.cssText = 'position:absolute;right:16px;bottom:6px;font-size:11px;color:#b06;background:#fff;border:1px solid #ddd;border-radius:6px;padding:2px 8px;z-index:5;';
      cap2.textContent = '自检 wrap 溢出 sw=' + wrap.scrollWidth + '/cw=' + wrap.clientWidth + ' sh=' + wrap.scrollHeight + '/ch=' + wrap.clientHeight + ' · 首图高=' + Math.round((wrap.querySelector('.col img') || {}).getBoundingClientRect ? wrap.querySelector('.col img').getBoundingClientRect().height : -1);
      wrap.appendChild(cap2);
      return { imgs: host.querySelectorAll('img').length, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, iw: window.innerWidth, ih: window.innerHeight };
    })()`);
    console.log('after imgs:', JSON.stringify(info));
    await sleep(300);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, 'r37-1-dedup.png'), img.toPNG());
    console.log('shot r37-1-dedup.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 700));
    app.exit(1);
  }
});
