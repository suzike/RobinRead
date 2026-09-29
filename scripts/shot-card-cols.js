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
      const data = {
        kind: 'summary', title: '超载长文的 16:9 回落长图：内容完整可读，而不是缩小内容',
        lead: '当一篇长文遇上 16:9 横幅画幅而装不下时，正确的做法是回落为自然高度长图：宽度保持、高度随内容、字号正常、一段不少。',
        feedTitle: '潮流周刊', date: '2026 年 9 月 29 日',
        prose: Array.from({ length: 14 }, (_, i) => '第' + (i + 1) + '段：纸感阅读的关键不在于仿旧，而在于把注意力还给文字本身。版心、行距、页边与留白共同构成节奏，让长文在屏幕上也保有翻阅的呼吸感，安静是最重要的排版变量，中英混排 Mixed English 与数字 2026 亦不例外。本段为第 ' + (i + 1) + ' 段的补充正文，用于验证超载回落长图的完整呈现。'),
        points: [
          { t: '画幅装不下时回落长图', d: '内容完整优先：宽度保持、高度随内容，绝不整卡缩小到字迹难辨。' },
          { t: '字号正常', d: '回落长图保住可读性，正文一段不少。' },
          { t: '头图通栏', d: '题图保持全宽，正文按自然流排布。' },
          { t: '极限回退', d: '四栏仍装不下的超长文才走回落长图通道。' },
        ],
      };
      const mod = await import('./card-export/preview.js');
      await mod.openCardExportModal({ data, link: 'https://example.com/post/1' });
      await new Promise(r => setTimeout(r, 700));
      const btns = [...document.querySelectorAll('.cardx-ratio button, .cardx-ratio .chip, [class*=ratio] button')];
      const b169 = btns.find((b) => b.textContent.trim() === '16:9');
      if (b169) b169.click();
      await new Promise(r => setTimeout(r, 400));
      // 统一切 3x 清晰度（与导出证据图同档）
      const zBtns = [...document.querySelectorAll('button')].filter((b) => /^2x$|^3x$/.test(b.textContent.trim()));
      const z3 = zBtns.find((b) => b.textContent.trim() === '3x');
      if (z3) z3.click();
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
