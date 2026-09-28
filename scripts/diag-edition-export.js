'use strict';
/**
 * diag-edition-export.js — R13 当前页导出探针（run-all OFFLINE 集）
 * 验证：captureRect IPC 返回合法 PNG / 尺寸与书页矩形吻合 / copyImage 写入剪贴板 /
 *       notice 反馈 / 浮层收起后截图（面板不出现在导出里——由矩形即书页保证）
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, clipboard, ipcMain, nativeImage } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-edition-exp-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 150 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false, width: 1600, height: 1000,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') },
    });
    // 与主应用同语义的通道（真实 app 由 registerIPCHandlers 注册）
    ipcMain.handle('app:captureRect', async (e, rect) => {
      const w = BrowserWindow.fromWebContents(e.sender);
      const image = await w.capturePage({
        x: Math.max(0, Math.round(Number(rect?.x) || 0)),
        y: Math.max(0, Math.round(Number(rect?.y) || 0)),
        width: Math.max(1, Math.round(Number(rect?.width) || 1)),
        height: Math.max(1, Math.round(Number(rect?.height) || 1)),
      });
      return image.toPNG().toString('base64');
    });
    ipcMain.handle('app:copyImage', (_e, { base64 } = {}) => {
      clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(String(base64 ?? ''), 'base64')));
      return true;
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(600);
    const run = (tag, js) => {
      console.log('PHASE ' + tag);
      return win.webContents.executeJavaScript(`(async () => { try { ${js} } catch (e) { return { __err: String(e && e.stack || e) }; } })()`);
    };
    clipboard.writeText('sentinel');
    const a = await run('export', `
      const mod = await import('./views/edition-reader.js');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要 ' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 24 }, (_, i) => mk(i)), fetchArticle: async () => '' });
      window.__er = er;
      er.present(); clearTimeout(er._autoTimer); er._doOpen();
      await new Promise(r => setTimeout(r, 1300));
      // 先开排版面板，导出应自动收起
      document.querySelector('.er-type').click();
      await new Promise(r => setTimeout(r, 300));
      await er._exportPage();
      await new Promise(r => setTimeout(r, 300));
      const panelGone = !document.querySelector('.er-type-panel');
      const notice = document.querySelector('.er-notice').textContent;
      const book = document.querySelector('.er-book').getBoundingClientRect();
      return { panelGone, notice, book: { x: Math.round(book.x), y: Math.round(book.y), w: Math.round(book.width), h: Math.round(book.height) } };
    `);
    if (a.__err) throw new Error('export: ' + a.__err);
    const img = clipboard.readImage();
    const size = img.getSize();
    ok(a.panelGone, '导出前浮层自动收起');
    ok(a.notice.includes('剪贴板'), 'notice 反馈（' + a.notice + '）');
    ok(!img.isEmpty(), '剪贴板已有图像');
    const ratio = size.width / Math.max(1, a.book.w);
    ok(ratio > 0.99 && ratio < 2.1, `截图尺寸=书页矩形（含 dpr 高清 ${size.width}x${size.height} vs ${a.book.w}x${a.book.h}，ratio ${ratio.toFixed(2)}）`);
    ok(size.width > 400, '导出图有效宽度');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.message || e).slice(0, 400));
    app.exit(1);
  }
});
