'use strict';
/** shot-cardx-scenes2.js — 场景排版 v2（比例合同）实机截图：稀疏普通文章 + 超长文，四画幅对比 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-scn2-')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SPARSE = {
 "kind": "deepRead",
 "title": "推理成本下降 90% 背后的三场战役",
 "feedTitle": "机器之心",
 "date": "2026-09-30",
 "lead": "当所有人盯着训练集群的规模竞赛时，真正决定大模型商业化的推理成本正在被系统性压低。",
 "steps": [
  {
   "t": "KV Cache 压缩",
   "d": "把注意力缓存压掉一个量级，长文本首 token 延迟随之骤降。"
  },
  {
   "t": "投机解码",
   "d": "小模型起草、大模型校验，一次前向出多 token。"
  },
  {
   "t": "算子融合",
   "d": "把碎片 kernel 拼成大块，显存带宽不再空转。"
  }
 ],
 "prose": [
  "第一段：十八个月内主流 API 千 token 价格下降约九成，这不是补贴，而是单位成本的真实坍缩。",
  "第二段：成本曲线的每一次下移，都对应一类此前不可行的应用忽然成立：实时语音、长文档审阅、Agent 循环。",
  "第三段：训练竞赛决定谁有入场券，推理竞赛决定谁能活到终局。"
 ],
 "concepts": [
  "KV Cache",
  "投机解码",
  "算子融合",
  "单位经济"
 ],
 "stats": [
  {
   "v": "-90%",
   "l": "千token成本"
  },
  {
   "v": "3.2×",
   "l": "长文本吞吐"
  },
  {
   "v": "18月",
   "l": "时间窗"
  }
 ],
 "quotes": [
  "推理成本的下降速度，第一次超过了模型能力的增长速度。"
 ],
 "counter": "未讨论量化精度损失的累积效应，长上下文场景可能放大该风险。",
 "actions": [
  "用开源量化模型复测成本基线",
  "把长上下文从可选实验改为默认架构"
 ],
 "conclusion": "把长上下文从可选实验变为默认架构，是这轮成本红利最直接的兑现方式。"
};
const LONG = {
 "kind": "deepRead",
 "title": "失败清单是最被低估的资产",
 "feedTitle": "DEV Community",
 "date": "2026-09-30",
 "lead": "失败具有可复现、可证伪、可复利的特性，公开发布失败清单本身就是建立信任的商业策略。",
 "steps": [
  {
   "t": "收集",
   "d": "三周时间收集十七个死掉项目的完整死因。"
  },
  {
   "t": "归类",
   "d": "归纳出十余个可复用的死因模式。"
  },
  {
   "t": "反用",
   "d": "把死因清单变成新项目的立项检查表。"
  }
 ],
 "prose": [
  "第1段：失败不是噪音而是信号。每一个死掉的项目都精确标注了一类边界条件：需求不存在、渠道不通、单位经济不成立、时机过早。把这些边界条件汇总成清单，等于拿到了一张反向地图——上面画着所有不能走的路。公开这份地图，反而是最快建立专业信任的方式，因为成功可以靠运气，失败只能靠真相。",
  "第2段：失败不是噪音而是信号。每一个死掉的项目都精确标注了一类边界条件：需求不存在、渠道不通、单位经济不成立、时机过早。把这些边界条件汇总成清单，等于拿到了一张反向地图——上面画着所有不能走的路。公开这份地图，反而是最快建立专业信任的方式，因为成功可以靠运气，失败只能靠真相。",
  "第3段：失败不是噪音而是信号。每一个死掉的项目都精确标注了一类边界条件：需求不存在、渠道不通、单位经济不成立、时机过早。把这些边界条件汇总成清单，等于拿到了一张反向地图——上面画着所有不能走的路。公开这份地图，反而是最快建立专业信任的方式，因为成功可以靠运气，失败只能靠真相。",
  "第4段：失败不是噪音而是信号。每一个死掉的项目都精确标注了一类边界条件：需求不存在、渠道不通、单位经济不成立、时机过早。把这些边界条件汇总成清单，等于拿到了一张反向地图——上面画着所有不能走的路。公开这份地图，反而是最快建立专业信任的方式，因为成功可以靠运气，失败只能靠真相。",
  "第5段：失败不是噪音而是信号。每一个死掉的项目都精确标注了一类边界条件：需求不存在、渠道不通、单位经济不成立、时机过早。把这些边界条件汇总成清单，等于拿到了一张反向地图——上面画着所有不能走的路。公开这份地图，反而是最快建立专业信任的方式，因为成功可以靠运气，失败只能靠真相。",
  "第6段：失败不是噪音而是信号。每一个死掉的项目都精确标注了一类边界条件：需求不存在、渠道不通、单位经济不成立、时机过早。把这些边界条件汇总成清单，等于拿到了一张反向地图——上面画着所有不能走的路。公开这份地图，反而是最快建立专业信任的方式，因为成功可以靠运气，失败只能靠真相。",
  "第7段：失败不是噪音而是信号。每一个死掉的项目都精确标注了一类边界条件：需求不存在、渠道不通、单位经济不成立、时机过早。把这些边界条件汇总成清单，等于拿到了一张反向地图——上面画着所有不能走的路。公开这份地图，反而是最快建立专业信任的方式，因为成功可以靠运气，失败只能靠真相。",
  "第8段：失败不是噪音而是信号。每一个死掉的项目都精确标注了一类边界条件：需求不存在、渠道不通、单位经济不成立、时机过早。把这些边界条件汇总成清单，等于拿到了一张反向地图——上面画着所有不能走的路。公开这份地图，反而是最快建立专业信任的方式，因为成功可以靠运气，失败只能靠真相。",
  "第9段：失败不是噪音而是信号。每一个死掉的项目都精确标注了一类边界条件：需求不存在、渠道不通、单位经济不成立、时机过早。把这些边界条件汇总成清单，等于拿到了一张反向地图——上面画着所有不能走的路。公开这份地图，反而是最快建立专业信任的方式，因为成功可以靠运气，失败只能靠真相。",
  "第10段：失败不是噪音而是信号。每一个死掉的项目都精确标注了一类边界条件：需求不存在、渠道不通、单位经济不成立、时机过早。把这些边界条件汇总成清单，等于拿到了一张反向地图——上面画着所有不能走的路。公开这份地图，反而是最快建立专业信任的方式，因为成功可以靠运气，失败只能靠真相。"
 ],
 "concepts": [
  "失败清单",
  "反向地图",
  "单位经济",
  "可证伪性",
  "401"
 ],
 "stats": [
  {
   "v": "17",
   "l": "死掉项目"
  },
  {
   "v": "10+",
   "l": "死因归纳"
  },
  {
   "v": "3",
   "l": "共性模式"
  }
 ],
 "quotes": [
  "成功可以靠运气，失败只能靠真相。",
  "公开失败是最快的信任建设。"
 ],
 "counter": "幸存者偏差：能被写成清单的失败，都是作者已经走出来的失败。",
 "actions": [
  "为自己的项目维护一份死因台账",
  "每次立项先过一遍反向地图"
 ],
 "conclusion": "把失败当作可检索的资产来经营，而不是当作需要掩埋的耻辱。"
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
      ['1:1', SPARSE, 330], ['4:3', SPARSE, 420], ['16:9', LONG, 560], ['3:4', LONG, 340],
    ];
    for (const [id, data, w] of jobs) {
      const cell = document.createElement('div');
      cell.style.cssText = 'flex:none;'; // 禁 flex 收缩：测量宽度失真会让求解器提前锁定
      const sh = cell.attachShadow({ mode: 'open' });
      host.appendChild(cell); // 必须先挂载再测量：detached 节点 getBoundingClientRect 恒 0（上一版 bug 源）
      const R = { '4:3': 3/4, '9:16': 16/9, '3:4': 4/3, '1:1': 1, '16:9': 9/16 }[id];
      let W = { '4:3': 1000, '9:16': 750, '3:4': 750, '1:1': 750, '16:9': 1333 }[id];
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
      SOLVE_LOG.push('RECT ' + id + ' cell=' + Math.round(cell.getBoundingClientRect().width) + 'x' + Math.round(cell.getBoundingClientRect().height) + ' card=' + sh.querySelector('.sp-card').className.split(' ').slice(0,2).join('.') + ' stageInline=' + sh.querySelector('.cardx-stage').getAttribute('style').replace(/;/g,'|'));
      SOLVE_LOG.push(id + ' LOCKED ' + final.boxW + 'x' + Math.round(W * R) + ' blocks: steps=' + sh.querySelectorAll('.sp-step').length + ' prose=' + sh.querySelectorAll('.sp-prose p').length + ' counter=' + sh.querySelectorAll('.sp-counter').length + ' quotes=' + sh.querySelectorAll('.sp-quotes blockquote').length + ' actions=' + sh.querySelectorAll('.sp-action').length + ' conclusion=' + sh.querySelectorAll('.sp-conclusion').length + ' chips=' + sh.querySelectorAll('.sp-chips span').length + ' stats=' + sh.querySelectorAll('.sp-stats b').length + ' foot=' + sh.querySelectorAll('.sp-foot .sp-wm').length);
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
  fs.writeFileSync(path.join(__dirname, '..', '.tmp-shots', 'scenes-3-v21.png'), img.toPNG());
  console.log('shot scenes-2-v2.png');
  app.exit(0);
});
