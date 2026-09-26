/* ==========================================================================
   样张探针：用真实结构的样例数据离屏渲染 6 款精读卡片模板 → PNG
   产物：.tmp-card-samples/*.png（2x 高清，1500px 宽）
   运行：node scripts/shot-card-templates.js   （退出码 0 = 全部成功）
   ========================================================================== */
const { app, BrowserWindow } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('force-device-scale-factor', '1');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.tmp-card-samples');
const W_LOGICAL = 750;
const ZOOM = 2;

/* ---------------------------------------------------- 样例封面（程序化 SVG） */
function makeCover() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="640" viewBox="0 0 1400 640">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#1f2b33"/><stop offset=".62" stop-color="#3d5a66"/><stop offset="1" stop-color="#c9a86a"/>
      </linearGradient>
      <linearGradient id="m3" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2c3a40"/><stop offset="1" stop-color="#1d282e"/>
      </linearGradient>
    </defs>
    <rect width="1400" height="640" fill="url(#sky)"/>
    <circle cx="980" cy="392" r="118" fill="#e8c98a" opacity=".92"/>
    <circle cx="980" cy="392" r="170" fill="#e8c98a" opacity=".18"/>
    <circle cx="980" cy="392" r="236" fill="#e8c98a" opacity=".07"/>
    <polygon points="0,640 240,398 420,528 610,352 830,640" fill="url(#m3)" opacity=".95"/>
    <polygon points="560,640 810,418 1010,560 1190,430 1400,640" fill="#24303a" opacity=".96"/>
    <polygon points="0,640 190,530 400,610 620,500 860,640" fill="#1b252c"/>
    <polygon points="760,640 980,540 1180,618 1400,520 1400,640" fill="#171f26"/>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/* ---------------------------------------------------------------- 样例数据 */
const DEEP_READ = {
  kind: 'deepRead',
  title: '推理成本下降90%背后：一场静悄悄的算力革命',
  feedTitle: '机器之心',
  date: '2026年9月24日',
  cover: makeCover(),
  meta: { minutes: 8, words: 2400 },
  lead: '当所有人盯着训练集群的规模竞赛时，真正决定大模型商业化的推理成本，正在被一群底层优化工程师以每年一个数量级的速度压低——这场革命没有发布会，却重塑着每一个AI应用的账本。',
  steps: [
    { t: '现象：成本曲线陡降', d: '过去18个月，主流大模型 API 的千 token 价格下降了约90%，降幅远超摩尔定律的预测节奏。' },
    { t: '机制：三条优化主线', d: 'KV Cache 压缩、投机解码与算子融合构成软件侧降本的主干，三者叠加带来乘数效应。' },
    { t: '证据：基准实测', d: '在 32K 长文本场景下，新一代推理引擎的吞吐达到上一代的 3.2 倍，延迟反而降低41%。' },
    { t: '推论：应用层受益', d: '成本下探让长上下文应用从演示走向量产，多模态与 Agent 任务的单位成本也降到了可忽略的水平。' },
  ],
  concepts: ['KV Cache', '投机解码', 'INT4 量化', '连续批处理', 'MoE', '算子融合'],
  stats: [
    { v: '-90%', l: 'API 千 token 成本' },
    { v: '3.2×', l: '长文本吞吐提升' },
    { v: '¥0.008', l: '千 token 边际成本' },
  ],
  counter: '作者未讨论量化带来的精度损失在极端长文本下的累积效应，也未对比专用推理芯片路线——「软件优化派」与「硬件定制派」的竞争可能改写结论。',
  quotes: [
    '推理成本的下降速度，第一次超过了模型能力的增长速度。',
    '当算力不再是瓶颈，瓶颈就变成了想象力。',
  ],
  actions: [
    '用开源量化模型复测自家业务的推理成本基线',
    '关注 vLLM 与 SGLang 两大推理框架的月度更新',
  ],
  conclusion: '对应用方而言，2026 年的正确姿势是把「长上下文 + 多模态」从可选实验变为默认架构；成本红利的窗口期，属于先动手的那批团队。',
};

const RICH_SUMMARY = {
  kind: 'richSummary',
  title: '推理成本下降90%背后：一场静悄悄的算力革命',
  feedTitle: '机器之心',
  date: '2026年9月24日',
  cover: makeCover(),
  meta: { minutes: 5, words: 2400 },
  lead: '这篇文章讲清了一件事：大模型推理成本的暴跌不是单点突破，而是缓存、解码与内核三条优化主线叠加的系统性结果，且红利正快速传导到应用层。',
  points: [
    { t: '成本降幅达一个数量级', d: '18 个月内主流 API 千 token 价格下降约 90%，速度远超硬件迭代。' },
    { t: '三条软件优化主线叠加', d: 'KV Cache 压缩、投机解码、算子融合相互成就，构成乘数效应。' },
    { t: '长文本场景受益最大', d: '32K 上下文吞吐提升 3.2 倍，延迟降低 41%，长文档应用率先落地。' },
    { t: 'Agent 经济学成立', d: '多步推理的单位成本进入可忽略区间，智能体任务从实验走向生产。' },
    { t: '窗口期属于行动者', d: '架构决策应把长上下文与多模态设为默认，而非可选实验。' },
  ],
  stats: [
    { v: '-90%', l: 'API 成本' },
    { v: '3.2×', l: '吞吐提升' },
  ],
  conclusion: '成本曲线的陡降把「要不要上长上下文」变成了「多快上」；先完成架构切换的团队将吃掉大部分红利。',
};

const PLAIN_SUMMARY = {
  kind: 'summary',
  title: '推理成本下降90%背后：一场静悄悄的算力革命',
  feedTitle: '机器之心',
  date: '2026年9月24日',
  cover: makeCover(),
  meta: { minutes: 2, words: 2400 },
  lead: '大模型推理成本18个月内下降约90%，主因是 KV Cache 压缩、投机解码与算子融合三条软件优化主线的叠加。',
  points: [
    { t: '主流 API 千 token 价格降幅约 90%，远超硬件迭代速度' },
    { t: '新一代推理引擎在 32K 长文本场景吞吐提升 3.2 倍' },
    { t: '成本下探使 Agent 与多模态任务单位成本进入可忽略区间' },
    { t: '应用层的正确反应是把长上下文从实验转为默认架构' },
  ],
};

/* ---------------------------------------------------------------- 渲染流程 */
async function main() {
  let qrcode = null;
  try {
    ({ default: qrcode } = await import(pathToFileURL(path.join(ROOT, 'src/renderer/vendor/qrcode.js')).href));
  } catch (e) { console.warn('[samples] qrcode 加载失败，样张将不带二维码：', e.message); }
  const makeQR = (text) => {
    if (!qrcode) return null;
    const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
    return qr.createSvgTag(4, 0);
  };
  const qr = makeQR('https://example.com/post/inference-revolution');

  const samples = [
    { file: '01-paper-deepread', tpl: 'paper', data: DEEP_READ },
    { file: '02-ink-deepread', tpl: 'ink', data: DEEP_READ },
    { file: '03-mag-deepread', tpl: 'mag', data: DEEP_READ },
    { file: '04-note-deepread', tpl: 'note', data: DEEP_READ },
    { file: '05-min-deepread', tpl: 'min', data: DEEP_READ },
    { file: '06-news-deepread', tpl: 'news', data: DEEP_READ },
    { file: '07-ink-nocover', tpl: 'ink', data: { ...DEEP_READ, cover: null } },
    { file: '08-paper-richsummary', tpl: 'paper', data: RICH_SUMMARY },
    { file: '09-min-summary', tpl: 'min', data: PLAIN_SUMMARY },
  ];

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const win = new BrowserWindow({
    show: false, width: W_LOGICAL * ZOOM, height: 1000, useContentSize: true,
    webPreferences: { offscreen: true },
  });
  win.setContentSize(W_LOGICAL * ZOOM, 1000);

  let failed = 0;
  for (const s of samples) {
    try {
      const { renderFullPage } = await import(pathToFileURL(path.join(ROOT, 'src/renderer/card-export/templates.js')).href);
      const page = renderFullPage(s.data, { templateId: s.tpl, qr }, ZOOM);
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page.html));
      await win.webContents.executeJavaScript('document.fonts.ready.then(()=>1)');
      await win.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      const rect = JSON.parse(await win.webContents.executeJavaScript(
        '(()=>{const r=document.querySelector(".xc-card").getBoundingClientRect();return JSON.stringify({w:Math.ceil(r.width),h:Math.ceil(r.height)})})()'
      ));
      const h = Math.min(rect.h, 16000);
      if (rect.h > 16000) console.warn(`[samples] ${s.file} 内容过高(${rect.h}px)已截断`);
      win.setContentSize(rect.w, h);
      win.setBackgroundColor(page.bg);
      await new Promise((r) => setTimeout(r, 160));
      const img = await win.webContents.capturePage();
      const out = path.join(OUT_DIR, `${s.file}.png`);
      fs.writeFileSync(out, img.toPNG());
      console.log(`[samples] ${out}  ${rect.w}x${h}`);
    } catch (e) {
      failed += 1;
      console.error(`[samples] ${s.file} 失败:`, e);
    }
  }
  win.destroy();
  if (failed > 0) process.exitCode = 1;
}

app.whenReady().then(() => main().then(() => app.exit(process.exitCode || 0)).catch((e) => {
  console.error('ERR', e);
  app.exit(1);
}));
