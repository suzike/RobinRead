'use strict';
/** shot-cardx-variant.js — 配色变体/封面滤镜实效实机截图（挑剔官验收用） */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-cxshot-')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CARD_DATA = {
  kind: 'deepRead', title: '失败清单是最被低估的资产', feedTitle: 'DEV Community', date: '2026-09-30',
  lead: '失败具有可复现、可证伪、可复利的特性，公开发布失败清单本身就是建立信任的商业策略，而非单纯的行业卫生习惯。',
  steps: [{ t: '现象：失败清单的价值', d: '作者用三周时间收集失败清单，共归纳十余个死因。' }, { t: '机制：可验证性', d: '公开失败样本本身就是建立信任的商业策略。' }],
  concepts: ['自主智能体', '失败清单', '401', '数据中台'],
  stats: [{ v: '17', l: '死掉项目' }, { v: '10+', l: '死因归纳' }, { v: '3', l: '共性模式' }],
  meta: { words: 1959, minutes: 5 },
};

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, width: 1280, height: 880, webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') } });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await sleep(900);
  await win.webContents.executeJavaScript(`(async () => {
    const data = ${JSON.stringify(CARD_DATA)};
    const cv = document.createElement('canvas'); cv.width = 600; cv.height = 300;
    const g = cv.getContext('2d'); const grad = g.createLinearGradient(0, 0, 600, 300);
    grad.addColorStop(0, '#c8332a'); grad.addColorStop(0.55, '#8c2f1b'); grad.addColorStop(1, '#232838');
    g.fillStyle = grad; g.fillRect(0, 0, 600, 300);
    g.fillStyle = '#f6f1e4'; g.font = '700 64px Georgia'; g.fillText('Ike', 42, 210);
    data.cover = cv.toDataURL('image/png');
    const { openCardExportModal } = await import('./card-export/preview.js');
    await openCardExportModal({ data, link: 'https://example.com/post/1' });
    const modal = document.querySelector('.modal-overlay .cardx-modal');
    const clickSeg = (boxSel, label) => {
      const b = [...modal.querySelectorAll(boxSel + ' button')].find(x => x.textContent.trim() === label);
      if (b) b.click();
    };
    clickSeg('.cardx-variant', '原色');
    await new Promise(r => setTimeout(r, 200));
    // R49: 不上滤镜，拍侧栏细节
    await new Promise(r => setTimeout(r, 400));
  })()`);
  await sleep(400);
  fs.mkdirSync(path.join(__dirname, '..', '.tmp-shots'), { recursive: true });
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, '..', '.tmp-shots', 'r49-1-modal.png'), img.toPNG());
  console.log('shot r49-1-modal.png');
  app.exit(0);
});
