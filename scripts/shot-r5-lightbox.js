'use strict';
/** R5 灯箱增强验收截图：画廊态（计数+关闭钮）/ 200% 缩放态 → .tmp-shots/r5-*.png（真窗口） */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r5-shot-'));
app.setPath('userData', userData);
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 180 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const win = new BrowserWindow({
      show: true, width: 1600, height: 1000,
      webPreferences: {
        contextIsolation: true, backgroundThrottling: false,
        preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(800);
    const shot = async (name) => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(OUT, name), img.toPNG());
      console.log(`shot ${name}`);
    };
    await win.webContents.executeJavaScript(`(async () => {
      const mod = await import('./views/edition-reader.js');
      const SVG = (a, b, kind) => {
        const base = "<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='800'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='" + a + "'/><stop offset='1' stop-color='" + b + "'/></linearGradient></defs><rect width='1200' height='800' fill='url(#g)'/>" + (kind === 0
          ? "<circle cx='900' cy='210' r='130' fill='rgba(255,253,246,0.34)'/><path d='M0 640 L320 430 L560 640 L840 380 L1200 700 L1200 800 L0 800 Z' fill='rgba(32,28,22,0.32)'/><path d='M0 720 L420 560 L780 740 L1200 580 L1200 800 L0 800 Z' fill='rgba(32,28,22,0.46)'/>"
          : kind === 1
            ? "<rect x='120' y='120' width='380' height='380' fill='rgba(255,253,246,0.30)'/><rect x='220' y='220' width='380' height='380' fill='rgba(32,28,22,0.18)'/><circle cx='880' cy='600' r='160' fill='rgba(255,253,246,0.26)'/>"
            : "<rect x='100' y='110' width='1000' height='22' fill='rgba(255,253,246,0.55)'/><rect x='100' y='160' width='760' height='16' fill='rgba(255,253,246,0.4)'/><circle cx='880' cy='520' r='180' fill='rgba(255,253,246,0.3)'/><rect x='100' y='470' width='520' height='14' fill='rgba(32,28,22,0.26)'/>") + '</svg>';
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(base).replace(/'/g, '%27');
      };
      const ARTICLE = '<p>纸感阅读的关键不在于仿旧，而在于把注意力还给文字本身：版心、行距、页边与留白共同构成节奏。</p>'
        + '<p><img src="' + SVG('#A8B2B9', '#5F6B73', 0) + '"></p>'
        + '<p>第二段：安静是最重要的排版变量，长文在屏幕上也应保有翻阅的呼吸感，中英混排 Mixed English 与数字 2026 亦不例外。</p>'
        + '<p><img src="' + SVG('#C4A98E', '#7D6650', 1) + '"></p>'
        + '<p>第三段：我们把每一次翻页都当作一次纸面的触碰来对待。</p>'
        + '<p><img src="' + SVG('#9FAF9A', '#5F6F58', 2) + '"></p>';
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要文本用于灯箱验证。' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 12 }, (_, i) => mk(i)), startIndex: 0, reduceMotion: false, onOpen: () => {}, fetchArticle: async () => ARTICLE });
      window.__er = er;
      er.present();
      await new Promise(r => setTimeout(r, 1500));
      er._go(1);
      await new Promise(r => setTimeout(r, 1500));
      const card = document.querySelector('.er-sheet[data-role="a"] .er-place') || document.querySelector('.er-place');
      card.click();
      await new Promise(r => setTimeout(r, 1600));
      const img = document.querySelector('.er-article img');
      img.click();
      await new Promise(r => setTimeout(r, 600));
      const lb = document.querySelector('.er-lightbox');
      return { on: lb.classList.contains('on'), count: lb.querySelector('.er-lb-count').textContent };
    })()`);
    await sleep(400);
    await shot('r5-1-lightbox.png');
    // 双击 2× + 拖拽平移
    await win.webContents.executeJavaScript(`(async () => {
      const lb = document.querySelector('.er-lightbox');
      lb.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      lb.dispatchEvent(new PointerEvent('pointerdown', { clientX: 800, clientY: 500, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 560, clientY: 380, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: 560, clientY: 380, bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      return { count: lb.querySelector('.er-lb-count').textContent };
    })()`);
    await sleep(300);
    await shot('r5-2-zoom-pan.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('SHOT-FAIL', e && e.stack || e);
    app.exit(1);
  }
});
