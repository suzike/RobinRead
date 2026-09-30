'use strict';
/** shot-kb-trendfit.js — 知识中心看板趋势图适配实机截图（挑剔官验收用） */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, ipcMain } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-kbshot-')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ipcMain.handle('kb:statsExtras', () => ({
  topFeeds: [
    { name: '少数派', n: 96 }, { name: '阮一峰周刊', n: 74 }, { name: 'InfoQ', n: 61 },
    { name: 'Hacker News', n: 55 }, { name: '量子位', n: 43 }, { name: '机器之心', n: 37 },
    { name: '爱范儿', n: 29 }, { name: '月光博客', n: 18 },
  ],
  hours: Array.from({ length: 24 }, (_, h) => Math.max(0, Math.round(12 * Math.exp(-Math.pow(h - 21, 2) / 18) + 5 * Math.exp(-Math.pow(h - 9, 2) / 8)))),
}));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, width: 1180, height: 860, webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') } });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await sleep(900);
  await win.webContents.executeJavaScript(`(async () => {
    const { KnowledgeCenter } = await import('./views/knowledge.js');
    document.getElementById('app') && (document.getElementById('app').style.display = 'none');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;overflow:auto;padding:28px 40px;background:var(--page-background,#faf8f2);z-index:400;';
    document.body.appendChild(host);
    const kc = Object.create(KnowledgeCenter.prototype);
    kc.contentHost = host;
    kc.tab = 'dashboard';
    const heat = {};
    const base = new Date();
    for (let i = 0; i < 30; i++) {
      const dt = new Date(base.getTime() - (29 - i) * 86400000);
      const key = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      heat[key] = { read: [1, 0, 0, 0, 0, 0, 2, 6, 3, 0, 4, 9, 5, 2][i % 14], highlights: i % 3, notes: i % 5 === 0 ? 1 : 0 };
    }
    kc._renderDashboard({
      highlights: 28, notes: 6, review: 9, due: 2, collections: 0,
      tags: [{ tag: 'TypeScript', count: 4204 }, { tag: 'Agent', count: 2357 }, { tag: 'LLM', count: 1618 }, { tag: 'RAG', count: 1300 }, { tag: '工具', count: 1214 }],
      streak: 15, heat,
    });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise(r => setTimeout(r, 300));
    host.scrollTop = 0;
  })()`);
  await sleep(400);
  fs.mkdirSync(path.join(__dirname, '..', '.tmp-shots'), { recursive: true });
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, '..', '.tmp-shots', 'kbfit-1-dashboard.png'), img.toPNG());
  console.log('shot kbfit-1-dashboard.png');
  app.exit(0);
});
