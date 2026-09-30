'use strict';
/**
 * diag-d2-urlread.js — R-D3 链接精读探针（run-all OFFLINE 集）
 * 验证：extract:url 通道 → reader.openExternalUrl 渲染合成精读。
 * 附 _render spy：若渲染抛错，栈写入 d2-rendererr.txt 供根因定位。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, ipcMain } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-d2-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 180 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };

const FIXTURE = {
  title: '任意链接的精读标题',
  byline: '作者甲',
  excerpt: '摘要文本',
  html: '<h1>任意链接的精读标题</h1><p>第一段正文，用于链接精读渲染验收，长度适中覆盖两行。</p><p>第二段正文。</p>',
};

ipcMain.handle('extract:url', async (_e, url) => {
  if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('bad url');
  return { ok: true, data: { ...FIXTURE, url, content: FIXTURE.html, dir: null } };
});

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false, width: 1200, height: 800,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') },
    });
    win.webContents.on('console-message', (e, level, message) => { if (String(message).includes('[RD3]')) console.log('RD3', message.slice(0, 120)); });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(900);
    const a = await win.webContents.executeJavaScript(`(async () => {
      const { ReaderView } = await import('./views/reader.js');
      const rbody = document.createElement('div');
      rbody.className = 'reader-scroll';
      rbody.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;overflow:auto;';
      document.body.appendChild(rbody);
      const tocDeps = {
        tocRail: document.createElement('div'),
        tocTrack: document.createElement('div'),
        tocPeak: document.createElement('div'),
        scrollbar: document.createElement('div'),
        thumb: document.createElement('div'),
      };
      const feedbacks = [];
      const reader = new ReaderView(rbody, tocDeps, {
        onFeedback: (m) => feedbacks.push(m),
        onSelectNext: () => {}, onFocusList: () => {}, onOpenTag: () => {}, onTTSAdvance: async () => {},
      });
      const origRender = ReaderView.prototype._render;
      reader._render = function () {
        try { return origRender.call(this); } catch (e) { window.__renderErr = String(e && e.stack || e).slice(0, 500); throw e; }
      };
      const bad = await reader.openExternalUrl('ftp://x');
      let okv = null;
      let okErr = null;
      try { okv = await reader.openExternalUrl('https://example.com/article/1'); } catch (e) { okErr = String(e && e.stack || e).slice(0, 500); }
      await new Promise(r => setTimeout(r, 300));
      return {
        badRejected: bad === false,
        okTrue: okv === true,
        okErr: okErr || null,
        renderErr: window.__renderErr || null,
        title: reader.entry?.title || '',
        htmlLen: (reader.html || '').length,
        bodyHasP1: (rbody.textContent || '').includes('第一段正文'),
        feedbackOk: feedbacks.some((m) => String(m).includes('链接精读完成')),
        feedbackFail: feedbacks.some((m) => String(m).includes('链接精读失败')),
        extId: String(reader.entryID || '').startsWith('ext:'),
      };
    })()`);
    fs.writeFileSync(path.join(__dirname, '..', '.tmp-shots', 'd2-state.json'), JSON.stringify(a, null, 1));
    ok(a.badRejected === true, '非 http(s) 链接被拒绝');
    ok(a.okTrue === true, 'http(s) 链接精读成功');
    ok(!a.okErr, 'openExternalUrl 无异常（' + (a.okErr || 'clean').slice(0, 120) + '）');
    ok(!a.renderErr, '_render 无异常（' + (a.renderErr || 'clean').slice(0, 120) + '）');
    ok(a.title === FIXTURE.title, '标题采用提取结果');
    ok(a.htmlLen > 40, 'reader.html 已装配（len ' + a.htmlLen + '）');
    ok(a.bodyHasP1, '正文渲染进 DOM');
    ok(a.feedbackOk && !a.feedbackFail, '完成反馈出现（无失败反馈）');
    ok(a.extId, '合成 entryID ext: 前缀');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
