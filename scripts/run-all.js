'use strict';
/**
 * run-all.js — 回归探针统一入口
 *
 * 用法：
 *   node scripts/run-all.js          # 本地全量（含真实网络的探针）
 *   node scripts/run-all.js --ci     # CI 精简集（仅离线可判定的探针）
 *
 * 每个探针以退出码判定（0=PASS）；全部结束后打印汇总，任一失败则整体退出 1。
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const OFFLINE = [
  { file: 'scripts/diag-needs-extraction.js', runner: 'node', desc: 'needsExtraction 判定（离线单元）' },
  { file: 'scripts/diag-phase8-gate.js', runner: 'electron', desc: '会员全量释放 + 默认刷新间隔（离线）' },
  { file: 'scripts/diag-phase9-typography.js', runner: 'node', desc: '排版引擎 v2：盘古之白 + 设置链路（离线）' },
  { file: 'scripts/diag-phase12-knowledge.js', runner: 'electron', desc: '知识增强：图谱数据/问答受控路径（离线）' },
  { file: 'scripts/diag-phase13-backup.js', runner: 'electron', desc: '自动备份：首查快照/配置/开关（离线）' },
  { file: 'scripts/diag-phase9-font-smoke.js', runner: 'electron', desc: '排版引擎+每日刊头真实渲染烟雾（离线）' },
  { file: 'scripts/diag-edition-magazine.js', runner: 'electron', desc: '期刊翻页 2.0：对开版面/折页/封面/滑轨（离线）' },
  { file: 'scripts/diag-edition-typography.js', runner: 'electron', desc: 'R1 阅读排版：密度/页边/首字下沉面板（离线）' },
  { file: 'scripts/diag-edition-paper.js', runner: 'electron', desc: 'R2 纸张质感：四态循环/夜间独立偏好/牛皮变量（离线）' },
  { file: 'scripts/diag-edition-selection.js', runner: 'electron', desc: 'R3 划词工具条：胶囊/复制/弹层/选区守卫（离线）' },
  { file: 'scripts/diag-edition-progress.js', runner: 'electron', desc: 'R4 阅读进度：滑轨剩余时间/文章进度线预估（离线）' },
  { file: 'scripts/diag-edition-lightbox.js', runner: 'electron', desc: 'R5 灯箱增强：滚轮缩放/双击/键盘切图（离线）' },
  { file: 'scripts/diag-edition-micro.js', runner: 'electron', desc: 'R6 版面微交互：落页错落淡入/hover 精修（离线）' },
  { file: 'scripts/diag-edition-cover.js', runner: 'electron', desc: 'R7 封面升级：期号大字/头条大图/无图回退（离线）' },
  { file: 'scripts/diag-edition-toc.js', runner: 'electron', desc: 'R8 滑轨分段/目录树状（离线）' },
  { file: 'scripts/diag-edition-colwidth.js', runner: 'electron', desc: 'R9 栏宽舒适度：三档切换/分页联动/持久化（离线）' },
  { file: 'scripts/diag-edition-find.js', runner: 'electron', desc: 'R11 期刊内搜索：Ctrl+F/计数/跳页定位（离线）' },
  { file: 'scripts/diag-edition-quick.js', runner: 'electron', desc: 'R12 快捷收藏/稍后读：S/L 键/回调/重绘（离线）' },
  { file: 'scripts/diag-edition-export.js', runner: 'electron', desc: 'R13 当前页导出：captureRect/剪贴板/浮层收起（离线）' },
  { file: 'scripts/diag-edition-keys.js', runner: 'electron', desc: 'R14 快捷键速查：? 呼出/8 行/Esc 往复（离线）' },
  { file: 'scripts/diag-edition-session.js', runner: 'electron', desc: 'R15 会话统计：翻页/读文累计/退出小结（离线）' },
  { file: 'scripts/diag-edition-fx.js', runner: 'electron', desc: 'R16 动作音效：tick/done/开纸声/开关静默（离线）' },
  { file: 'scripts/diag-edition-accent.js', runner: 'electron', desc: 'R17 纸感联动强调色：四态日/夜档位（离线）' },
  { file: 'scripts/diag-edition-resume.js', runner: 'electron', desc: 'R18 续读提醒：落位+文案/无记忆静默（离线）' },
  { file: 'scripts/diag-edition-focus.js', runner: 'electron', desc: 'R19 段落聚焦：P 开关/点击/↑↓/翻页重聚焦（离线）' },
  { file: 'scripts/diag-edition-palette.js', runner: 'electron', desc: 'R20 命令面板接入：期刊命令/翻页执行/z 层级（离线）' },
  { file: 'scripts/diag-palette-groups.js', runner: 'electron', desc: 'R21 面板分组小节头：组头渲染/键盘跳过/组名可搜（离线）' },
  { file: 'scripts/diag-row-quick.js', runner: 'electron', desc: 'R22 行内快捷操作：三键挂载/隐藏浮现/IPC 参数（离线）' },
  { file: 'scripts/diag-card-export.js', runner: 'electron', desc: '精读卡片导出：解析器+模板+离屏截图（离线）' },
  { file: 'scripts/diag-phase10-export.js', runner: 'node', desc: '导出工厂：EPUB 结构 + 对照版式/自定义CSS 链路（离线）' },
  { file: 'scripts/e2e-card-export.js', runner: 'electron', desc: '精读卡片导出 E2E：真 IPC 链路+预览弹窗（离线）' },
];
const ONLINE = [
  { file: 'scripts/selftest.js', runner: 'electron', desc: '核心自测套件（真实数据形状）' },
  { file: 'scripts/diag-phase6-node.js', runner: 'electron', desc: '主进程服务探针' },
  { file: 'scripts/diag-phase4-explore.js', runner: 'electron', desc: '探索后端（真实网络 20-60s）' },
  { file: 'scripts/diag-phase7-upstream.js', runner: 'electron', desc: '上游借鉴包端到端' },
  { file: 'scripts/diag-phase11-neural-tts.js', runner: 'electron', desc: '神经语音在线合成（真实网络）' },
];

const ci = process.argv.includes('--ci');
const suite = ci ? OFFLINE : OFFLINE.concat(ONLINE);
const results = [];

for (const probe of suite) {
  const runner = probe.runner === 'node' ? 'node' : 'npx';
  const args = probe.runner === 'node'
    ? [probe.file]
    : ['electron', probe.file];
  process.stdout.write(`\n===== ${probe.desc} (${probe.file}) =====\n`);
  const result = spawnSync(runner, args, {
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'inherit', 'ignore'],
    timeout: probe.runner === 'node' ? 60000 : 300000,
    shell: process.platform === 'win32',
  });
  const ok = result.status === 0;
  results.push({ ...probe, ok, status: result.status });
  console.log(ok ? `>>> PASS ${probe.file}` : `>>> FAIL ${probe.file} (exit=${result.status})`);
}

console.log('\n===== SUMMARY =====');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.file} — ${r.desc}`);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length}/${results.length} FAILED` : `\nALL ${results.length} PASSED`);
process.exit(failed.length ? 1 : 0);
