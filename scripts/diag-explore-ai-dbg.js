'use strict';
/** 调试：AI 模式 + 领域词外扩（真实凭据）。全新临时目录 + 启动前拷全凭据三件套。 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app } = require('electron');

const LOG = path.join(__dirname, 'explore-ai-dbg.log');
const T0 = Date.now();
const log = (m) => { const line = `[${Math.round((Date.now() - T0) / 1000)}s] ${m}`; console.log(line); fs.appendFileSync(LOG, line + '\n'); };

// 凭据三件套必须在 Chromium 初始化前就位（DPAPI 解密依赖 Local State 中的 os_crypt 密钥）
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-explore-ai-'));
const PROD = path.join(process.env.APPDATA, 'RobinRead');
fs.mkdirSync(path.join(userData, 'credentials'), { recursive: true });
fs.copyFileSync(path.join(PROD, 'preferences.json'), path.join(userData, 'preferences.json'));
fs.copyFileSync(path.join(PROD, 'credentials', 'ai-api-key.bin'), path.join(userData, 'credentials', 'ai-api-key.bin'));
fs.copyFileSync(path.join(PROD, 'Local State'), path.join(userData, 'Local State'));
app.setPath('userData', userData);

// 8 分钟看门狗：探针绝不无限挂起
setTimeout(() => { log('WATCHDOG: 8 分钟超时强制退出'); app.exit(3); }, 8 * 60 * 1000).unref();

app.whenReady().then(async () => {
  log('electron ready');
  const { AppStore } = require('../src/main/AppStore');
  const store = new AppStore(userData);
  log('AppStore 就绪, hasAIKey=' + store.hasAIAPIKey());

  // 分步 2：LLM 域名外扩
  try {
    const expanded = await store.explore._llmExpandDomain('agent', new Set());
    log('expand → ' + expanded.map((s) => s.name + '|' + s.siteURL).join(' ; '));
  } catch (e) { log('expand ERROR → ' + e.message); }

  // 分步 3：完整 run（含 40s 单候选预算与进度回调）
  try {
    const run = await store.explore.run({
      mode: 'ai', domain: 'agent', limit: 10,
      onProgress: (p) => log('  验证 ' + (p.ok ? '✓' : '✗') + ' ' + p.name),
    });
    log(`run → cards=${(run.cards || []).length} mode=${run.mode} note=${run.note || '-'}`);
    for (const c of run.cards || []) log(`  ✓ ${c.name} | ${c.domain} | score=${c.score} | 最近${c.freshnessDays}天 | ${c.fullText ? '全文' : '摘要'}`);
  } catch (e) { log('run ERROR → ' + e.message); }

  log('DONE');
  app.exit(0);
});
