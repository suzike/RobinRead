'use strict';
/** shot-cardx-scenes2.js — 场景排版 v2（比例合同）实机截图：稀疏普通文章 + 超长文，四画幅对比 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-scn2-')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SPARSE = {
  kind: 'summary', title: '本周值得一读的三件事', feedTitle: '知更观察', date: '2026-09-30',
  lead: '没有 AI 精读结构的普通文章也能出漂亮的场景卡——排版引擎会自动用正文段落填满版面。',
  content: '第一段：这是订阅源里的一篇普通文章，只有标题、摘要和正文，没有任何结构化的精读数据。场景排版引擎检测到数据稀疏后，自动把正文段落作为主内容流放进画幅，封面图弹性放大补足视觉重量。\n\n第二段：所有内容都完整保留在卡片里，没有任何截断；画幅严格保持所选比例，内容放不下时画布等比放大。',
};
const LONG = {
  kind: 'deepRead', title: '超长文的完整呈现：比例合同下的画布放大',
  feedTitle: '知更实验室', date: '2026-09-30',
  lead: '十四段长文全部进卡，字号不变，画布放大，比例恒定。',
  steps: [
    { t: '求解器', d: '基准宽渲染测自然高，超比例即放大画布重排，三轮内收敛。' },
    { t: '零截断', d: '标题导语正文步骤标签全量渲染，绝不省略。' },
    { t: '比例恒定', d: '输出宽高比严格等于所选画幅，误差小于百分之一。' },
  ],
  content: Array.from({ length: 14 }, (_, i) => `第${i + 1}段：比例合同的排版引擎把所有内容放进约定横纵比的画幅。字号保持基准，画布等比放大，文字重新回流后行数减少，求解器在极数轮内收敛到稳定尺寸。内容多长卡就多大，比例永远不变，这是对「画幅」一词的重新定义：不是尺寸的枷锁，而是比例的承诺。`).join('\n\n'),
  concepts: ['比例合同', '画布放大', '零截断', '求解器'],
  stats: [{ v: '14', l: '段正文' }, { v: '0', l: '截断' }],
};

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, width: 1720, height: 1180, webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') } });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await sleep(900);
  await win.webContents.executeJavaScript(`(async () => {
    const SPARSE = ${JSON.stringify(SPARSE)}, LONG = ${JSON.stringify(LONG)};
    const cv = document.createElement('canvas'); cv.width = 900; cv.height = 540;
    const g = cv.getContext('2d'); const grad = g.createLinearGradient(0, 0, 900, 540);
    grad.addColorStop(0, '#a8442f'); grad.addColorStop(1, '#232833');
    g.fillStyle = grad; g.fillRect(0, 0, 900, 540);
    g.strokeStyle = 'rgba(246,241,228,.4)'; g.lineWidth = 2;
    for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(160 + i * 200, 270, 90 - i * 10, 0, Math.PI * 2); g.stroke(); }
    SPARSE.cover = cv.toDataURL('image/png'); LONG.cover = cv.toDataURL('image/png');
    const { renderSceneCard } = await import('./card-export/scenes.js');
    document.getElementById('app') && (document.getElementById('app').style.display = 'none');
    const SOLVE_LOG = [];
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:#e9e4d8;padding:22px;display:flex;flex-wrap:wrap;gap:18px;align-content:flex-start;justify-content:center;z-index:400;overflow:auto;';
    document.body.appendChild(host);
    // 卡 1-2：稀疏文章 4:3 与 9:16（旧版空白问题场景）
    // 卡 3-4：超长文 4:3 与 3:4（放大+比例恒定）
    const jobs = [
      ['4:3', SPARSE, 380], ['9:16', SPARSE, 300], ['4:3', LONG, 460], ['3:4', LONG, 330],
    ];
    for (const [id, data, w] of jobs) {
      const cell = document.createElement('div');
      cell.style.cssText = 'flex:none;'; // 禁 flex 收缩：测量宽度失真会让求解器提前锁定
      const sh = cell.attachShadow({ mode: 'open' });
      host.appendChild(cell); // 必须先挂载再测量：detached 节点 getBoundingClientRect 恒 0（上一版 bug 源）
      const R = { '4:3': 3/4, '9:16': 16/9, '3:4': 4/3 }[id];
      let W = { '4:3': 1000, '9:16': 750, '3:4': 750 }[id];
      let final = null;
      for (let round = 0; round < 4; round++) {
        const sc = renderSceneCard(data, { sceneId: id, tplId: 'paper', width: W });
        sh.innerHTML = '<style>' + sc.css + '</style><div style="position:absolute;left:0;top:0;visibility:hidden;">' + sc.html + '</div>';
        const cardEl = sh.querySelector('.sp-card');
        const Hn = Math.ceil(cardEl.getBoundingClientRect().height);
        SOLVE_LOG.push(id + " r" + round + " W=" + W + " Hn=" + Hn + " boxRH=" + Math.round(W * R));
        if (Hn > 0 && Hn <= W * R + 4) { final = renderSceneCard(data, { sceneId: id, tplId: 'paper', width: W, height: Math.round(W * R) }); break; }
        if (Hn > 0) W = Math.max(W + 60, Math.ceil((Hn + 8) / R));
      }
      if (!final) final = renderSceneCard(data, { sceneId: id, tplId: 'paper', width: W, height: Math.round(W * R) });
      const s = w / final.boxW;
      sh.innerHTML = '<style>' + final.css + '.cardx-stage{overflow:hidden;border-radius:8px;box-shadow:0 6px 24px rgba(30,26,18,.16)}</style>'
        + '<div style="zoom:' + s + ';width:' + final.boxW + 'px"><div class="cardx-stage" style="width:' + final.boxW + 'px;height:' + Math.round(W * R) + 'px">' + final.html + '</div></div>';
      cell.style.cssText = 'flex:none;height:' + Math.round(W * R * s) + 'px;';
    }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise(r => setTimeout(r, 350));
    window.__solveLog = SOLVE_LOG;
  })()`);
  await sleep(400);
  fs.mkdirSync(path.join(__dirname, '..', '.tmp-shots'), { recursive: true });
  const solveLog = await win.webContents.executeJavaScript('window.__solveLog || []');
  console.log('SOLVE', JSON.stringify(solveLog));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, '..', '.tmp-shots', 'scenes-2-v2.png'), img.toPNG());
  console.log('shot scenes-2-v2.png');
  app.exit(0);
});
