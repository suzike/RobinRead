'use strict';
/**
 * diag-card-export.js — 精读/摘要卡片导出链路探针（离线）
 * 覆盖：parse.js 解析器（三套 prompt 结构 + 非标准降级 + 数字提取）、
 *       templates.js 渲染断言、隐藏窗口离屏截图 PNG 产物。
 * 运行：npx electron scripts/diag-card-export.js   （退出码 0 = PASS）
 */
const { app, BrowserWindow } = require('electron');
const { pathToFileURL } = require('url');
const path = require('node:path');
const fs = require('node:fs');

app.commandLine.appendSwitch('force-device-scale-factor', '1');
const ROOT = path.join(__dirname, '..');
let failed = 0;
const ok = (cond, name) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failed += 1;
};

const DEEPREAD_MD = `**主旨**：大模型推理成本的下降不是单点突破，而是系统性优化的结果。

**论证脉络**：
- **现象：成本陡降**：18 个月内主流 API 千 token 价格下降约 90%，降幅远超硬件迭代。
- **机制：三条主线**：KV Cache 压缩、投机解码与算子融合叠加，吞吐提升 3.2 倍。
- **推论：应用受益**：Agent 任务单位成本降至 ¥0.008 以下。

**关键概念**：
- KV Cache：键值缓存
- 投机解码：草稿验证式解码
- MoE：混合专家模型

**证据与数据**：
- 主流 API 千 token 价格下降 90%
- 长文本吞吐提升 3.2 倍
- 边际成本 ¥0.008

**局限与另一面**：未讨论量化精度损失在超长上下文下的累积效应。

**金句摘录**：
> 推理成本的下降速度，第一次超过了模型能力的增长速度。
> 当算力不再是瓶颈，瓶颈就变成了想象力。

**读后行动**：
- 用开源量化模型复测自家业务成本基线
- 关注 vLLM 月度更新

**结论与启示**：把长上下文从可选实验变为默认架构。`;

const RICH_MD = `**一句话总览**：推理成本暴跌是三条软件优化主线叠加的系统性结果。

**核心要点**：
- **成本降幅达一个数量级**：18 个月下降约 90%。
- **长文本受益最大**：吞吐提升 3.2 倍。

**关键数据与事实**：API 成本下降 90%；吞吐提升 3.2 倍。

**结论与启示**：先完成架构切换的团队吃掉红利。`;

const PLAIN_MD = `这篇文章讲了大模型推理成本下降的三大原因，值得所有 AI 应用团队一读。

- KV Cache 压缩显著降低长上下文成本
- 投机解码带来 2-3 倍时延改善
- 算子融合减少内存搬运`;

async function unitTests(parse, templates) {
  // 真实 LLM 输出变体：## 标题式 + 中文引号金句 + 千分位数字 + 段落式脉络
  const HEADING_MD = `## 主旨

边缘计算正在成为「下一代基础设施」的关键一环。

## 论证脉络

**起点**：从某厂故障案例切入，损失约 ¥1,200万。
**展开**：对比三种部署模式的时延数据，其中边缘节点快 2.4 倍。
**收束**：给出选型建议与实施路径。

## 关键概念

- 边缘节点：靠近用户侧的计算设施
- MEC：多接入边缘计算

## 证据与数据

- 边缘节点时延降低 68%
- 某厂部署后年省成本 3,500 万

## 金句摘录

> 「时延的每一毫秒，都是真金白银。」
> 把算力送到离用户最近的地方。

## 读后行动

- 盘点自身业务的时延敏感模块
- 试用一家边缘云厂商的免费额度

## 结论与启示

边缘部署从可选项变成了必选项。`;
  const h = parse.parseArtifactToCard(HEADING_MD, 'deepRead');
  ok(h.lead.includes('边缘计算'), '变体: ## 标题式主旨识别');
  ok(h.steps.length === 3 && h.steps[0].t === '起点', '变体: 段落式论证脉络（无列表标记）');
  ok(h.concepts.includes('边缘节点') && h.concepts.includes('MEC'), '变体: ## 式关键概念');
  ok(h.stats.length === 2 && h.stats.some((s) => s.v.replace(/,/g, '').includes('3500')), '变体: 千分位数字提取', JSON.stringify(h.stats));
  ok(h.quotes.length === 2 && !h.quotes[0].startsWith('「') && h.quotes[1].includes('算力'), '变体: 中文引号金句剥壳', JSON.stringify(h.quotes));
  ok(h.actions.length === 2 && h.conclusion.includes('必选项'), '变体: 行动/结论');

  const d = parse.parseArtifactToCard(DEEPREAD_MD, 'deepRead');
  ok(d.lead.includes('系统性优化'), 'deepRead: 主旨→lead');
  ok(d.steps.length === 3 && d.steps[0].t.includes('现象'), 'deepRead: 论证脉络→steps（加粗小标题）');
  ok(d.concepts.includes('KV Cache') && d.concepts.includes('投机解码'), 'deepRead: 关键概念→concepts');
  ok(d.stats.length === 3 && d.stats.some((s) => s.v.includes('90')), 'deepRead: 证据与数据→stats 数字提取');
  ok(d.quotes.length === 2 && d.quotes[0].includes('下降速度'), 'deepRead: 金句摘录→quotes（blockquote）');
  ok(d.actions.length === 2 && d.counter.includes('累积效应'), 'deepRead: 读后行动/另一面');
  ok(d.conclusion.includes('默认架构'), 'deepRead: 结论与启示');
  ok(d.meta.words > 100 && d.meta.minutes >= 1, 'deepRead: 阅读时长元信息');

  const r = parse.parseArtifactToCard(RICH_MD, 'richSummary');
  ok(r.lead.includes('叠加'), 'richSummary: 一句话总览→lead');
  ok(r.points.length === 2 && r.points[0].t.includes('数量级'), 'richSummary: 核心要点→points');
  ok(r.stats.length === 2, 'richSummary: 关键数据→stats');

  const p = parse.parseArtifactToCard(PLAIN_MD, 'summary');
  ok(p.lead.includes('推理成本') && p.points.length === 3, 'summary: 无章节结构降级（首段导语+要点）');

  const junk = parse.parseArtifactToCard('就是一段普通的话。\n\n又一段普通的话，没有列表也没有小节。'.repeat(3), 'summary');
  ok(junk.lead.length > 0 && junk.prose.length > 0, '非标准内容：段落流降级不炸');

  const st = parse.extractStats('本季增长 45%，成本降至 ¥1.2万，用户突破 3.2亿');
  ok(st.length === 3, 'extractStats: 混合数字提取 3 条');
  ok(parse.extractStats('没有任何数字').length === 0, 'extractStats: 无数字返回空');

  ok(parse.extractFirstImage('<p><img src="https://a.b/c.jpg"></p>') === 'https://a.b/c.jpg', 'extractFirstImage: 取首图');
  ok(parse.extractFirstImage('<img src="data:x">') === null, 'extractFirstImage: 非 http 忽略');
  ok(parse.base64ImageToDataURI('iVBORabc') === 'data:image/png;base64,iVBORabc', 'base64ImageToDataURI: png 嗅探');

  const card = templates.renderCard({ kind: 'deepRead', title: 'T', feedTitle: 'F', date: 'D', ...d }, { templateId: 'paper' });
  ok(card.html.includes('xc-t-paper') && card.html.includes('xc-steps') && card.html.includes('xc-quote'), 'renderCard: 书页模板结构完整');
  const inkNoCover = templates.renderCard({ kind: 'deepRead', title: '标题', ...d, cover: null }, { templateId: 'ink' });
  ok(inkNoCover.html.includes('xc-cover-gen'), 'renderCard: 无封面生成式头图');
  const stage = templates.renderStagePage({ kind: 'summary', title: 'T', lead: 'x' }, { templateId: 'min' }, { zoom: 2, ratio: 4 / 3, naturalHeight: 3000 });
  ok(stage.width === 1500 && stage.height === 2000, 'renderStagePage: 3:4 画幅数学（1500×2000 @2x）');
  const cardOptions = { templateId: 'paper', qr: null, watermark: false };
  const noMark = templates.renderCard({ kind: 'summary', title: 'T', lead: 'x' }, cardOptions);
  ok(!noMark.html.includes('xc-brand-name'), 'renderCard: 水印开关生效');
}

async function captureTest(templates) {
  const data = {
    kind: 'deepRead', title: '推理成本下降90%背后：一场静悄悄的算力革命',
    feedTitle: '机器之心', date: '2026年9月24日', cover: null,
    lead: '大模型推理成本正在被系统性压低。',
    steps: [{ t: '现象', d: 'API 价格下降 90%。' }],
    quotes: ['成本下降速度第一次超过能力增长速度。'],
    conclusion: '把长上下文变为默认架构。',
    meta: { words: 100, minutes: 1 },
  };
  const page = templates.renderFullPage(data, { templateId: 'paper', qr: null }, 2);
  const win = new BrowserWindow({ show: false, width: 1500, height: 1000, useContentSize: true, webPreferences: { offscreen: true } });
  win.setContentSize(1500, 1000);
  const tmp = path.join(app.getPath('temp'), `robin-diag-card-${Date.now()}.html`);
  fs.writeFileSync(tmp, page.html, 'utf8');
  try {
    await win.loadFile(tmp);
    await win.webContents.executeJavaScript('document.fonts.ready.then(()=>1)');
    await new Promise((r) => setTimeout(r, 120));
    const rect = JSON.parse(await win.webContents.executeJavaScript(
      '(()=>{const r=document.querySelector(".xc-card").getBoundingClientRect();return JSON.stringify({w:Math.ceil(r.width),h:Math.ceil(r.height)})})()'
    ));
    ok(rect.w === 1500 && rect.h > 300, `离屏渲染：卡片尺寸 ${rect.w}×${rect.h}`);
    win.setContentSize(rect.w, rect.h);
    win.setBackgroundColor(page.bg);
    await new Promise((r) => setTimeout(r, 140));
    const png = (await win.webContents.capturePage()).toPNG();
    ok(png.length > 20000, `capturePage→PNG 产物 ${Math.round(png.length / 1024)}KB`);
  } finally {
    win.destroy();
    try { fs.unlinkSync(tmp); } catch (_) { /* 忽略 */ }
  }
}

app.whenReady().then(async () => {
  try {
    const parseUrl = pathToFileURL(path.join(ROOT, 'src/renderer/card-export/parse.js')).href;
    const tplUrl = pathToFileURL(path.join(ROOT, 'src/renderer/card-export/templates.js')).href;
    const [parse, templates] = await Promise.all([import(parseUrl), import(tplUrl)]);
    await unitTests(parse, templates);
    await captureTest(templates);
  } catch (e) {
    console.error('FAIL  探针异常:', e);
    failed += 1;
  }
  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
  app.exit(failed === 0 ? 0 : 1);
});
