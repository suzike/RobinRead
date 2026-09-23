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
];
const ONLINE = [
  { file: 'scripts/selftest.js', runner: 'electron', desc: '核心自测套件（真实数据形状）' },
  { file: 'scripts/diag-phase6-node.js', runner: 'electron', desc: '主进程服务探针' },
  { file: 'scripts/diag-phase4-explore.js', runner: 'electron', desc: '探索后端（真实网络 20-60s）' },
  { file: 'scripts/diag-phase7-upstream.js', runner: 'electron', desc: '上游借鉴包端到端' },
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
