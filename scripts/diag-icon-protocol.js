'use strict';
/**
 * robin-icon:// 图标协议端到端探测（临时脚本）：
 * 生产同序在 ready 前注册特权 scheme，真实窗口 + 真实 CSP 下验证
 * <img> 经协议从 FeedIconStore 加载成功 / 404 失败回落两条路径。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, protocol } = require('electron');

// 与 main.js → ipc.js 生产顺序一致：ready 前注册
protocol.registerSchemesAsPrivileged([
  { scheme: 'robin-icon', privileges: { standard: false, secure: true, supportFetchAPI: true, stream: true } },
]);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-iconprobe-'));
app.setPath('userData', userData);

app.whenReady().then(async () => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(ok ? 'PASS' : 'FAIL', name, detail);
  };

  const { FeedIconStore } = require('../src/main/FeedIconStore');
  const icons = new FeedIconStore(path.join(userData, 'favicons'));

  // 与 ipc.js registerIconProtocol 相同的 handler 逻辑（探测不加载整个 IPC 层）
  protocol.handle('robin-icon', async (request) => {
    try {
      const url = new URL(request.url);
      const dataURL = await icons.load({
        storedIconURL: url.searchParams.get('stored') || '',
        siteURL: url.searchParams.get('site') || '',
        feedURL: url.searchParams.get('feed') || '',
        host: url.searchParams.get('host') || '',
      });
      if (!dataURL) return new Response('', { status: 404 });
      const comma = dataURL.indexOf(',');
      const mime = dataURL.slice(5, comma).split(';')[0] || 'image/png';
      const body = Buffer.from(dataURL.slice(comma + 1), 'base64');
      return new Response(body, { headers: { 'Content-Type': mime, 'Cache-Control': 'max-age=86400' } });
    } catch (_) {
      return new Response('', { status: 404 });
    }
  });

  // 1) 命中路径：预置内存缓存（不打网络），1x1 红点 PNG
  const hitURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const hitParams = { host: 'probe-hit.example.com', siteURL: 'https://probe-hit.example.com', feedURL: '', storedIconURL: '' };
  icons.memory.set(icons._key(hitParams), hitURL);

  // 2) 失败路径：冷却期内 → 协议返回 404 → img error（渲染层回落字母徽章的前提）
  const coldParams = { host: 'probe-cold.example.com', siteURL: 'https://probe-cold.example.com', feedURL: '', storedIconURL: '' };
  icons.failures.set(icons._key(coldParams), Date.now() + 60_000);

  const CSP = `default-src 'self'; img-src * data: robin-icon:; media-src *; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src *`;
  const page = path.join(userData, 'probe.html');
  fs.writeFileSync(page, `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"></head><body>
<img id="hit" src="robin-icon://icon/?host=probe-hit.example.com&amp;site=https%3A%2F%2Fprobe-hit.example.com">
<img id="cold" src="robin-icon://icon/?host=probe-cold.example.com&amp;site=https%3A%2F%2Fprobe-cold.example.com">
</body></html>`, 'utf8');

  const win = new BrowserWindow({ show: false });
  await win.loadFile(page);
  await new Promise((r) => setTimeout(r, 1500));
  const state = await win.webContents.executeJavaScript(`(() => {
    const hit = document.getElementById('hit');
    const cold = document.getElementById('cold');
    return {
      hitDone: hit.complete, hitW: hit.naturalWidth,
      coldDone: cold.complete, coldFailed: cold.complete && cold.naturalWidth === 0,
    };
  })()`);
  check('icon-protocol-hit', state.hitDone && state.hitW === 1, JSON.stringify(state));
  check('icon-protocol-404-fallback', state.coldDone && state.coldFailed, JSON.stringify(state));

  win.destroy();
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length === 0 ? 'ICON PROBE: ALL PASSED' : `ICON PROBE: ${failed.length} FAILED`);
  app.exit(failed.length === 0 ? 0 : 1);
});
