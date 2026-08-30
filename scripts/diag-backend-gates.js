'use strict';
/* 后端加固探测（临时脚本）：不连真实 PG，直接调用 exports.main 断言 dev-login 门禁与登录限流。 */
process.env.TCB_ENV_ID = '';
process.env.TCB_API_KEY = '';
delete process.env.DEV_LOGIN_ENABLED; // 默认关闭

const fn = require('../cloudfunctions/njpaper-api/index.js');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(ok ? 'PASS' : 'FAIL', name, detail);
  if (!ok) failures += 1;
};
const call = (method, path, body = {}) => fn.main({
  method, path, headers: { 'x-forwarded-for': '1.2.3.4' }, body,
});

(async () => {
  // 1) dev-login：默认（未设 DEV_LOGIN_ENABLED）必须 404，与微信是否配置无关
  const r1 = await call('POST', '/api/auth/dev-login', { nickname: 'x' });
  check('dev-login 默认 404（显式开关生效）', r1.statusCode === 404, `status=${r1.statusCode} body=${r1.body}`);

  // 2) 打开开关后：应越过门禁（往下走到 PG 层报错，而非门禁 404）
  process.env.DEV_LOGIN_ENABLED = '1';
  // 注意：CONFIG 在模块加载时定格，这里重新 require 才会生效
  delete require.cache[require.resolve('../cloudfunctions/njpaper-api/index.js')];
  const fn2 = require('../cloudfunctions/njpaper-api/index.js');
  const r2 = await fn2.main({ method: 'POST', path: '/api/auth/dev-login', headers: { 'x-forwarded-for': '1.2.3.4' }, body: {} });
  const parsed2 = JSON.parse(r2.body || '{}');
  check('dev-login 开关打开后越过门禁（失败于 PG 配置而非 404）',
    r2.statusCode !== 404, `status=${r2.statusCode} err=${parsed2.error || ''}`);

  // 3) 登录限流：同 IP 第 11 次必须 429（在触达 PG/scrypt 之前拦截）
  let saw429 = false;
  for (let i = 0; i < 12; i += 1) {
    const r = await call('POST', '/api/auth/login', { username: 'u', password: 'p' });
    if (r.statusCode === 429) { saw429 = true; break; }
  }
  check('login 第 11 次起 429（IP 滑动窗口）', saw429);

  // 4) 注册限流：同 IP 第 6 次 429
  let sawReg429 = false;
  for (let i = 0; i < 7; i += 1) {
    const r = await call('POST', '/api/auth/register', { username: `u${i}`, password: '123456' });
    if (r.statusCode === 429) { sawReg429 = true; break; }
  }
  check('register 第 6 次起 429', sawReg429);

  // 5) 换 IP 不受前面窗口影响
  const r5 = await fn.main({ method: 'POST', path: '/api/auth/login', headers: { 'x-forwarded-for': '5.6.7.8' }, body: { username: 'u', password: 'p' } });
  check('不同 IP 各自独立限流', r5.statusCode !== 429, `status=${r5.statusCode}`);

  console.log(failures === 0 ? 'BACKEND PROBE: ALL PASSED' : `BACKEND PROBE: ${failures} FAILED`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('PROBE ERROR', e); process.exit(1); });
