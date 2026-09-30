'use strict';
/** shot-cardx-scenes.js — 场景排版系统实机截图：六画幅同数据并排网格（挑剔官验收用） */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-scnshot-')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DATA = {
  kind: 'deepRead',
  title: '场景排版系统上线：每个尺寸都有专属版式',
  feedTitle: '知更实验室', date: '2026-09-30',
  lead: '选定画幅即切换该画幅的专属排版脚本——构图、模块取舍、字号节奏全部随场景重新设计，不再是一张卡缩放塞进画幅。',
  steps: [
    { t: '一画幅一脚本', d: '1:1 对称 / 3:4 信息流 / 16:9 分区 / 9:16 海报 / 2.35:1 影院 / 4:3 双栏。' },
    { t: '画幅即合同', d: '输出尺寸严格等于所选画幅，超长文按 line-clamp 精选，永不回落长图。' },
    { t: '皮肤沿用模板', d: '十个样式模板的主色底色继续生效，变体与封面滤镜照常可用。' },
  ],
  concepts: ['场景版式', '画幅硬合同', 'line-clamp', '精选海报'],
  stats: [{ v: '6', l: '场景版式' }, { v: '0', l: '回落长图' }],
  quotes: ['版式跟着画幅走，而不是画幅迁就版式。'],
};

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, width: 1680, height: 1150, webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') } });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await sleep(900);
  await win.webContents.executeJavaScript(`(async () => {
    const data = ${JSON.stringify(DATA)};
    const cv = document.createElement('canvas'); cv.width = 900; cv.height = 520;
    const g = cv.getContext('2d'); const grad = g.createLinearGradient(0, 0, 900, 520);
    grad.addColorStop(0, '#b7402e'); grad.addColorStop(0.6, '#7c2d1c'); grad.addColorStop(1, '#20242e');
    g.fillStyle = grad; g.fillRect(0, 0, 900, 520);
    g.strokeStyle = 'rgba(246,241,228,.5)'; g.lineWidth = 2;
    for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(140 + i * 155, 300, 60 - i * 6, 0, Math.PI * 2); g.stroke(); }
    data.cover = cv.toDataURL('image/png');
    const { renderSceneCard } = await import('./card-export/scenes.js');
    document.getElementById('app') && (document.getElementById('app').style.display = 'none');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:#e9e4d8;padding:26px;display:flex;flex-wrap:wrap;gap:22px;align-content:flex-start;justify-content:center;z-index:400;overflow:auto;';
    document.body.appendChild(host);
    const grid = [
      ['1:1', 300], ['3:4', 260], ['9:16', 235], ['4:3', 400], ['16:9', 520], ['2.35:1', 620],
    ];
    for (const [id, w] of grid) {
      const cell = document.createElement('div');
      const sc = renderSceneCard(data, { sceneId: id, tplId: 'paper' });
      const s = w / sc.boxW;
      const sh = cell.attachShadow({ mode: 'open' });
      sh.innerHTML = '<style>' + sc.css + '.cardx-stage{overflow:hidden;border-radius:8px;box-shadow:0 6px 24px rgba(30,26,18,.18)}</style>'
        + '<div style="zoom:' + s + ';width:' + sc.boxW + 'px"><div class="cardx-stage" style="width:' + sc.boxW + 'px;height:' + sc.boxH + 'px">' + sc.html + '</div></div>';
      cell.style.cssText = 'flex:none;height:' + Math.round(sc.boxH * s) + 'px;';
      host.appendChild(cell);
    }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise(r => setTimeout(r, 350));
  })()`);
  await sleep(400);
  fs.mkdirSync(path.join(__dirname, '..', '.tmp-shots'), { recursive: true });
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, '..', '.tmp-shots', 'scenes-1-grid.png'), img.toPNG());
  console.log('shot scenes-1-grid.png');
  app.exit(0);
});
