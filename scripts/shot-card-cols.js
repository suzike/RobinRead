'use strict';
/** 卡片超载回落长图验收截图：16:9 超载长文预览（自然长图）→ .tmp-shots/cardcols-1-preview.png（真窗口） */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-cardcols-shot-'));
app.setPath('userData', userData);
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 180 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const win = new BrowserWindow({
      show: true, width: 1280, height: 860,
      webPreferences: {
        contextIsolation: true, backgroundThrottling: false,
        preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      },
    });
    const shot = async (name) => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(OUT, name), img.toPNG());
      console.log(`shot ${name}`);
    };
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(800);
    const info = await win.webContents.executeJavaScript(`(async () => {
      const mod = await import('./card-export/preview.js');
      const PARA = '段落内容用于超载多栏铺满验证：纸感阅读的关键不在于仿旧，而在于把注意力还给文字本身。版心、行距、页边与留白共同构成节奏，让长文在屏幕上也保有翻阅的呼吸感，安静是最重要的排版变量，中英混排 Mixed English 与数字 2026 亦不例外。';
      const data = {
        kind: 'summary', title: '超载长文的 16:9 多栏铺满：让内容匹配画幅，而不是缩小内容',
        lead: '当一篇长文遇上 16:9 横幅画幅，正确的做法不是把整张卡片缩小到字迹难辨，而是像杂志那样把内容切分为多栏铺满版面。',
        feedTitle: '潮流周刊', date: '2026 年 9 月 29 日',
        prose: Array.from({ length: 14 }, (_, i) => '第' + (i + 1) + '段：' + PARA + '本段为第 ' + (i + 1) + ' 段的补充正文，用于把内容总量推到单栏容量之上，验证超载回落长图的真实效果。'),
        points: ['画幅是硬约束：输出宽度精确等于所选比例', '字号优先：回落长图保住可读性，而不是整卡缩小', '头图通栏：题图保持全宽', '内容完整：十四段正文一段不少'],
      };
      await mod.openCardExportModal({ data, link: 'https://example.com/post/1' });
      await new Promise(r => setTimeout(r, 700));
      const btns = [...document.querySelectorAll('.cardx-ratio button, .cardx-ratio .chip, [class*=ratio] button')];
      const b169 = btns.find((b) => b.textContent.trim() === '16:9');
      if (b169) b169.click();
      await new Promise(r => setTimeout(r, 2600));
      const host = document.querySelector('.cardx-host');
      const cap = document.querySelector('.cardx-cap, [class*=cap]');
      const card = host && host.shadowRoot ? host.shadowRoot.querySelector('.xc-card') : null;
      const cs = card ? getComputedStyle(card) : null;
      return { has169: !!b169, cap: cap ? cap.textContent : '',
        card: cs ? { display: cs.display, colCount: cs.columnCount, transform: cs.transform, zoom: cs.zoom, inline: card.getAttribute('style') } : null };
    })()`);
    console.log('CARD ' + JSON.stringify(info));
    await sleep(400);
    await shot('cardcols-1-preview.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('SHOT-FAIL', e && e.stack || e);
    app.exit(1);
  }
});
