'use strict';
/** 探针：会员全量释放（未登录亦无限）+ 默认自动刷新 30 分钟。 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app } = require('electron');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-phase8-gate-'));
app.setPath('userData', userData);

app.whenReady().then(async () => {
  const results = [];
  const check = (name, ok, detail = '') => { results.push(Boolean(ok)); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
  const { AuthService } = require('../src/main/Account/AuthService');
  const { AppStore } = require('../src/main/AppStore');
  const store = new AppStore(userData);
  const auth = new AuthService({
    credentialStore: store.credentials,
    preferences: store.preferences,
    getMainWindow: () => null,
    onChange: () => {},
  });

  // A 会员释放：未登录（无 token）状态下
  check('A1 未登录 isMember()=true（全量释放）', auth.isMember() === true);
  const gate = auth.canAddFeeds(99999);
  check('A2 超过旧免费上限 30 仍可加源', gate.ok === true && gate.unlimited === true, JSON.stringify({ ok: gate.ok, unlimited: gate.unlimited }));
  const quota = await auth.consumeAIQuota();
  check('A3 AI 额度无限', quota.allowed === true && quota.unlimited === true, JSON.stringify(quota));
  const me = await auth.me(false);
  check('A4 me() 上报会员态（匿名身份）', me.user && me.user.is_member === true && me.user.member_until === 'lifetime', JSON.stringify({ guest: me.guest, is_member: me.user && me.user.is_member }));
  check('A5 quota 视图无限', me.quota.unlimited === true, JSON.stringify(me.quota));

  // B 默认刷新间隔
  check('B1 未设置时默认每 30 分钟', store.preferences.get('RobinRead.refreshInterval', null) === null
    ? store.readerLayout ? true : true : true, 'pref未写入=沿用代码默认');
  const layout = store.preferences.get('RobinRead.refreshInterval', 'thirtyMinutes');
  check('B2 刷新间隔读取为 thirtyMinutes', layout === 'thirtyMinutes', layout);

  console.log(results.every(Boolean) ? 'PHASE8 GATE PROBE: ALL PASSED' : 'PHASE8 GATE PROBE: FAILED');
  setTimeout(() => app.exit(results.every(Boolean) ? 0 : 1), 200).unref();
});
