'use strict';
/* 开发工具：把 RobinRead 的品牌视觉渲染成「极简高设计感」产品视频分镜卡（1920×1080 PNG）。
 * 用法：npx electron scripts/shot-video-cards.js
 * 输出：shots/video/cards/card-01.png … card-09.png
 * 设计语言与 src/renderer/styles/robin.css 同源：米白纸底 / 松绿 / 暖橘 / 衬线标题。 */
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

// 强制 1x 缩放，避免 Windows DPI 把 capturePage 放大、破坏 1920×1080 精确尺寸
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const ROOT = path.join(__dirname, '..');
const SHOTS_DIR = path.join(ROOT, 'website', 'shots');
const OUT_DIR = path.join(ROOT, 'shots', 'video', 'cards');
const W = 1920, H = 1080;

/* —— 品牌令牌（与 robin.css :root 一致）—— */
const INK = '#292622';
const INK2 = 'rgba(41,38,32,0.58)';
const INK3 = 'rgba(41,38,32,0.38)';
const PINE = '#617357';
const PINE_DEEP = '#4e5c47';
const WARM = '#a3573d';
const CREAM = '#f6f2e7';
const CREAM_EDGE = '#efe9da';
const SEAL = '#b13b2a';

/* —— 纸感纹理：柔和的高光 + 极细纤维（避免引号地狱，用内联 data URI 做噪点）—— */
/* —— 纸感纹理：柔和高光 + 暖调暗角（极简，无颗粒噪声）—— */
const PAPER_GRAD = `
  radial-gradient(1200px 800px at 12% -6%, rgba(255,255,255,0.6), rgba(255,255,255,0) 62%),
  radial-gradient(1100px 780px at 106% 108%, rgba(150,132,96,0.09), rgba(150,132,96,0) 62%)`;

const SERIF = `"Noto Serif SC", "Source Han Serif SC Heavy", "STZhongsong", "STSong", "SimSun", "Microsoft YaHei", serif`;
const SANS = `"Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif`;

/* —— 折纸知更鸟 logo（brand-proposal/robinread/logo.svg 内联为 data URI）—— */
const LOGO_SVG = fs.readFileSync(path.join(ROOT, 'brand-proposal', 'robinread', 'logo.svg'), 'utf8');
const LOGO_URI = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(LOGO_SVG);

function readShotB64(name) {
  return 'data:image/jpeg;base64,' + fs.readFileSync(path.join(SHOTS_DIR, name)).toString('base64');
}

/* —— 分镜定义 —— */
const SCENES = [
  { type: 'title' },
  { type: 'feature', img: 'home.jpg',           no: '壹', zh: '纸感三栏',   en: 'PAPERLIKE THREE COLUMNS' },
  { type: 'feature', img: 'deepread.jpg',       no: '贰', zh: 'AI 精读',    en: 'AI DEEP READING' },
  { type: 'feature', img: 'bilingual.jpg',      no: '叁', zh: '双语流转',   en: 'BILINGUAL FLOW' },
  { type: 'feature', img: 'annotation.jpg',     no: '肆', zh: '批注系统',   en: 'HIGHLIGHTS & NOTES' },
  { type: 'feature', img: 'knowledge.jpg',      no: '伍', zh: '知识库',     en: 'KNOWLEDGE BASE' },
  { type: 'feature', img: 'aihot-board.jpg',    no: '陆', zh: '热点榜单',   en: 'TRENDING BOARD' },
  { type: 'feature', img: 'theme-designer.jpg', no: '柒', zh: '主题设计',   en: 'THEME DESIGNER' },
  { type: 'end' },
];
const TOTAL = SCENES.length;

function css() {
  return `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${W}px; height: ${H}px; }
  body {
    font-family: ${SANS};
    color: ${INK};
    background-color: ${CREAM};
    background-image: ${PAPER_GRAD};
    background-repeat: no-repeat;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    overflow: hidden;
  }
  .card { position: relative; width: ${W}px; height: ${H}px; display: flex; flex-direction: column; }

  /* 顶部品牌细线 */
  .brandline { position: absolute; top: 0; left: 0; right: 0; height: 5px;
    background: linear-gradient(90deg, ${PINE} 0%, ${PINE} 12%, ${WARM} 12%, ${WARM} 14%, transparent 14%); }

  /* 通用页头（功能卡） */
  .head { display: flex; align-items: baseline; justify-content: space-between;
    padding: 74px 120px 26px; }
  .head .kicker { font-family: ${SERIF}; font-weight: 700; font-size: 40px; letter-spacing: 2px; color: ${INK}; }
  .head .kicker .no { color: ${PINE}; font-size: 30px; vertical-align: 8px; margin-right: 16px; }
  .head .kicker .sep { color: ${WARM}; margin: 0 14px; font-weight: 400; }
  .head .en { font-family: ${SANS}; font-size: 12px; letter-spacing: 5px; color: ${INK3}; font-weight: 500; }
  .head .rule { position: absolute; left: 120px; right: 120px; top: 148px; height: 1px; background: ${INK3}; opacity: 0.35; }

  /* 截图主体 */
  .stage { flex: 1; display: flex; align-items: center; justify-content: center; padding: 44px 140px 30px; }
  .stage .frame { position: relative; max-width: 100%; max-height: 100%; display: flex;
    border: 1px solid rgba(41,38,32,0.16); border-radius: 12px; overflow: hidden;
    box-shadow: 0 1px 2px rgba(41,38,32,0.06), 0 24px 60px -24px rgba(41,38,32,0.28); background: #fff; }
  .stage img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }

  /* 页脚 */
  .foot { display: flex; align-items: center; justify-content: space-between;
    padding: 22px 120px 54px; }
  .foot .brand { font-family: ${SERIF}; font-size: 15px; letter-spacing: 3px; color: ${INK2}; }
  .foot .brand b { color: ${PINE}; font-weight: 700; }
  .foot .page { font-family: ${SANS}; font-size: 12px; letter-spacing: 4px; color: ${INK3}; }

  /* —— 标题卡 / 结尾卡 —— */
  .center { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  .mark { width: 148px; height: 148px; border-radius: 34px; overflow: hidden;
    box-shadow: 0 18px 44px -18px rgba(41,38,32,0.4); margin-bottom: 46px; }
  .mark img { width: 100%; height: 100%; display: block; }
  .title-zh { font-family: ${SERIF}; font-weight: 700; font-size: 176px; line-height: 1; letter-spacing: 18px; color: ${INK}; }
  .title-en { font-family: ${SANS}; font-weight: 600; font-size: 34px; letter-spacing: 22px; color: ${PINE}; margin-top: 26px; padding-left: 22px; }
  .divider { width: 56px; height: 3px; background: ${WARM}; margin: 42px 0 34px; border-radius: 2px; }
  .tagline { font-family: ${SERIF}; font-weight: 500; font-size: 34px; letter-spacing: 4px; color: ${INK2}; }
  .tagline b { color: ${WARM}; font-weight: 700; }
  .subnote { font-family: ${SANS}; font-size: 15px; letter-spacing: 8px; color: ${INK3}; margin-top: 22px; }

  .end-zh { font-family: ${SERIF}; font-weight: 700; font-size: 120px; letter-spacing: 14px; color: ${INK}; }
  .end-en { font-family: ${SANS}; font-weight: 600; font-size: 26px; letter-spacing: 16px; color: ${PINE}; margin-top: 20px; padding-left: 16px; }
  .end-url { font-family: ${SANS}; font-size: 18px; letter-spacing: 5px; color: ${INK2}; margin-top: 40px; }
  .seal { margin-top: 44px; width: 76px; height: 76px; border-radius: 12px; background: ${SEAL};
    color: ${CREAM}; display: flex; align-items: center; justify-content: center; transform: rotate(-6deg);
    font-family: ${SERIF}; font-weight: 700; font-size: 26px; writing-mode: vertical-rl; letter-spacing: 4px;
    box-shadow: inset 0 0 0 2px rgba(255,255,255,0.35), inset 0 0 0 5px ${SEAL}, 0 8px 20px -8px rgba(177,59,42,0.6); }
  .corner { position: absolute; font-family: ${SERIF}; font-size: 13px; letter-spacing: 6px; color: ${INK3};
    writing-mode: vertical-rl; }
  .corner.l { left: 66px; top: 50%; transform: translateY(-50%); }
  .corner.r { right: 66px; top: 50%; transform: translateY(-50%); }
  `;
}

function titleCard() {
  return `
  <div class="card">
    <div class="brandline"></div>
    <div class="center">
      <div class="mark"><img src="${LOGO_URI}" alt=""></div>
      <div class="title-zh">知更</div>
      <div class="title-en">ROBINREAD</div>
      <div class="divider"></div>
      <div class="tagline"><b>Reading First</b>，AI Second</div>
      <div class="subnote">双语流转 · 克制智能化</div>
    </div>
    <div class="corner l">双语流转</div>
    <div class="corner r">克制智能化</div>
  </div>`;
}

function endCard() {
  return `
  <div class="card">
    <div class="brandline"></div>
    <div class="center">
      <div class="mark" style="width:112px;height:112px;border-radius:26px;margin-bottom:38px;"><img src="${LOGO_URI}" alt=""></div>
      <div class="end-zh">知更</div>
      <div class="end-en">ROBINREAD</div>
      <div class="divider" style="margin:34px 0 0;"></div>
      <div class="end-url">Reading First, AI Second</div>
      <div class="seal">知更</div>
    </div>
    <div class="corner l">现代纸感</div>
    <div class="corner r">RSS 阅读器</div>
  </div>`;
}

function featureCard(s, i) {
  const img = readShotB64(s.img);
  return `
  <div class="card">
    <div class="brandline"></div>
    <div class="head">
      <div class="kicker"><span class="no">${s.no}</span><span class="sep">·</span>${s.zh}</div>
      <div class="en">${s.en}</div>
    </div>
    <div class="head rule"></div>
    <div class="stage"><div class="frame"><img src="${img}" alt="${s.zh}"></div></div>
    <div class="foot">
      <div class="brand"><b>RobinRead</b> · 知更</div>
      <div class="page">${String(i + 1).padStart(2, '0')} — ${String(TOTAL).padStart(2, '0')}</div>
    </div>
  </div>`;
}

function buildHtml(i) {
  const s = SCENES[i];
  let body = '';
  if (s.type === 'title') body = titleCard();
  else if (s.type === 'end') body = endCard();
  else body = featureCard(s, i);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css()}</style></head><body>${body}</body></html>`;
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const win = new BrowserWindow({
    show: false, width: W, height: H, useContentSize: true,
    webPreferences: { offscreen: true },
  });
  win.setContentSize(W, H);
  win.setBackgroundColor(CREAM);
  try {
    for (let i = 0; i < SCENES.length; i++) {
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildHtml(i)));
      await win.webContents.executeJavaScript('document.fonts.ready.then(()=>1)');
      await new Promise((r) => setTimeout(r, 120));
      const img = await win.webContents.capturePage();
      const out = path.join(OUT_DIR, `card-${String(i + 1).padStart(2, '0')}.png`);
      fs.writeFileSync(out, img.toPNG());
      console.log('[video-card]', out);
    }
  } catch (e) {
    console.error('ERR', e);
    process.exitCode = 1;
  }
  app.exit(0);
});
