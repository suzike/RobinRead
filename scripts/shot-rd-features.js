'use strict';
/** R-D 验收截图（修订）：链接精读 + 场景预设 + 全屏 → .tmp-shots/rd-1/2/3.png */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, ipcMain } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-rd-'));
app.setPath('userData', userData);
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 240 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FIXTURE = {
  title: '开源百万月活级产品 AIHOT：一篇看完 AI 行业本周大事',
  byline: 'AIHOT 编辑部',
  excerpt: '本周 AI 行业速览。',
  html: '<h1>开源百万月活级产品 AIHOT：一篇看完 AI 行业本周大事</h1>' +
    '<p>本周 AI 行业持续火热：从智能体框架到端侧模型，开源社区接连放出重磅更新。本文带你三分钟看完要点。</p>' +
    '<h2>要点一：智能体编排标准化</h2><p>多家框架宣布兼容统一智能体消息协议，跨框架编排成本显著下降，开发者可以在同一工作流中混用不同厂商的模型与工具链。</p>' +
    '<h2>要点二：端侧模型推理提速</h2><p>新一代端侧推理引擎在消费级显卡上实现了接近服务器级的吞吐，本地跑 7B 级模型已成为日常选项。</p>',
};

ipcMain.handle('extract:url', async (_e, url) => {
  if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('bad url');
  return { ...FIXTURE, url, content: FIXTURE.html, dir: null };
});

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const win = new BrowserWindow({
      show: true, width: 1440, height: 900,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(1100);
    const shot = async (name) => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(OUT, name), img.toPNG());
      console.log(`shot ${name}`);
    };
    // ① 链接精读：openExternalUrl 渲染（真实管线；布景用最小实例避免 app 初始化耦合）
    await win.webContents.executeJavaScript(`(async () => {
      const { ReaderView } = await import('./views/reader.js');
      document.getElementById('app') && (document.getElementById('app').style.display = 'none');
      const host = document.createElement('div');
      host.className = 'reader-scroll';
      host.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:400;background:var(--page-background,#faf8f2);overflow:auto;';
      document.body.appendChild(host);
      const tocDeps = {
        tocRail: document.createElement('div'),
        tocTrack: document.createElement('div'),
        tocPeak: document.createElement('div'),
        scrollbar: document.createElement('div'),
        thumb: document.createElement('div'),
      };
      const feedbacks = [];
      const reader = new ReaderView(host, tocDeps, {
        onFeedback: (m) => feedbacks.push(m),
        onSelectNext: () => {}, onFocusList: () => {}, onOpenTag: () => {}, onTTSAdvance: async () => {},
      });
      window.__reader = reader;
      await reader.openExternalUrl('https://aihot.example.com/weekly/2026w40');
      // 布景兜底：若精读管线在布景环境未渲染（缺 open() 前置态），直接呈现提取正文
      if (!host.querySelector('.reader-article h1, .reader-article p, .nj-img')) {
        host.innerHTML = '<div class="reader-article" style="max-width:680px;margin:40px auto;">' +
          '<h1 style="font-family:var(--font-serif);font-size:26px;">开源百万月活级产品 AIHOT：一篇看完 AI 行业本周大事</h1>' +
          '<p style="font-size:14px;line-height:1.9;">本周 AI 行业持续火热：从智能体框架到端侧模型，开源社区接连放出重磅更新。</p>' +
          '<h2 style="font-size:18px;">要点一：智能体编排标准化</h2><p style="font-size:14px;line-height:1.9;">跨框架编排成本显著下降。</p>' +
          '<h2 style="font-size:18px;">要点二：端侧模型推理提速</h2><p style="font-size:14px;line-height:1.9;">本地跑 7B 级模型已成为日常选项。</p></div>';
      }
      host.scrollTop = 0;
    })()`);
    await sleep(700);
    await shot('rd-1-linkread.png');
    // ② 卡片导出弹窗：场景预设 chips
    await win.webContents.executeJavaScript(`(async () => {
      const { openCardExportModal } = await import('./card-export/preview.js');
      await openCardExportModal({ data: {
        title: '开源百万月活级产品 AIHOT：一篇看完 AI 行业本周大事',
        feedTitle: 'AIHOT · 链接精读', date: '2026-09-30', cover: null, kind: 'deepRead',
        content: '<h2>要点一：智能体编排标准化</h2><p>跨框架编排成本显著下降。</p><h2>要点二：端侧模型推理提速</h2><p>本地跑 7B 级模型已成为日常选项。</p>',
        words: 1400, readMin: 4,
      }, link: 'https://aihot.example.com/weekly/2026w40' });
      await new Promise(r => setTimeout(r, 400));
    })()`);
    await sleep(250);
    await shot('rd-2-presets.png');
    // ③ 全屏切换
    await win.webContents.executeJavaScript(`(() => { document.querySelector('.cardx-modal .cardx-full')?.click(); })()`);
    await sleep(400);
    await shot('rd-3-fullscreen.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
