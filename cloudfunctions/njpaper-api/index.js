'use strict';
/**
 * RobinRead 账号与会员服务（CloudBase 云函数，单函数全路由，PostgreSQL 版）
 *
 * 数据层：环境为 PG 模式（无文档数据库），通过 CloudBase PG HTTP API 访问：
 *   https://{envId}.api.tcloudbasegateway.com/v1/rdb/rest/{table}
 *   鉴权 Bearer API Key（service_role，绕过 RLS）；表结构见 migrations/（RLS 开启+零策略，
 *   仅服务端可访问，浏览器 anon/authenticated 一律拒绝）。
 *
 * 路由（经云接入暴露，/api 前缀可选，函数内部已归一化）：
 *   GET  /api/config            公共配置（微信登录可用性 / 套餐）
 *   POST /api/auth/wechat       微信扫码登录：code → JWT
 *   POST /api/auth/dev-login    开发模式登录（仅当微信未配置时可用）
 *   GET  /api/me                当前用户 + 会员状态（Bearer JWT）
 *   POST /api/pay/orders        创建订单（微信 Native 下单 → code_url；未配置走 mock）
 *   GET  /api/pay/orders/:no    查询自己的订单（客户端轮询；mock 4 秒后自动支付）
 *   POST /api/pay/notify        微信支付回调（验签 + AES-GCM 解密 + 幂等开通）
 *   [定时触发]                   掉单补偿：查单 / 关单（每 5 分钟）
 *
 * 环境变量：JWT_SECRET / PUBLIC_BASE / TCB_ENV_ID / TCB_API_KEY（必备）；
 *   WX_APPID + WX_SECRET（启用微信登录）；WXPAY_MCHID/WXPAY_SERIAL_NO/WXPAY_APIV3_KEY/
 *   WXPAY_PRIVATE_KEY/WXPAY_PUBLIC_KEY（启用真实 Native 支付，缺一则 mock 渠道）。
 *   启用真实支付前需在 package.json 加回 wechatpay-node-v3 依赖并重新部署。
 */

const crypto = require('node:crypto');

// MARK: - 常量与配置

const PLANS = {
  monthly: { id: 'monthly', title: '月卡会员', price_fen: 1000, days: 30 },
  lifetime: { id: 'lifetime', title: '终身会员', price_fen: 8800, days: null },
};

const env = process.env;
const CONFIG = {
  envId: env.TCB_ENV_ID || '',
  apiKey: env.TCB_API_KEY || '',
  wxLogin: !!(env.WX_APPID && env.WX_SECRET),
  wxAppid: env.WX_APPID || '',
  publicBase: (env.PUBLIC_BASE || '').replace(/\/+$/, ''),
  jwtSecret: env.JWT_SECRET || '',
  jwtTTLSeconds: 30 * 24 * 3600,
  adminSecret: env.ADMIN_SECRET || '',
  afdianMonthlyUrl: env.AFDIAN_MONTHLY_URL || '',
  afdianLifetimeUrl: env.AFDIAN_LIFETIME_URL || '',
  wxPay: !!(env.WXPAY_MCHID && env.WXPAY_SERIAL_NO && env.WXPAY_APIV3_KEY && env.WXPAY_PRIVATE_KEY && env.WXPAY_PUBLIC_KEY),
};
if (!CONFIG.jwtSecret) {
  CONFIG.jwtSecret = 'dev-' + crypto.randomUUID();
  console.warn('[njpaper-api] JWT_SECRET 未配置，使用临时密钥（重启即失效，正式部署必须配置）');
}

const MEMBER_LIFETIME = 'lifetime'; // member_until 哨兵：终身；普通值为 ISO 字符串；空=未购买

// MARK: - PG HTTP API（PostgREST 风格）

const RDB_BASE = () => `https://${CONFIG.envId}.api.tcloudbasegateway.com/v1/rdb/rest`;

/**
 * 底层请求。query 为扁平对象（postgREST 过滤/排序语法），prefer 控制 return/count。
 * 返回 { status, rows, range }：rows 为响应 JSON（数组或对象），range 为 Content-Range。
 */
async function rdb(method, table, { query, body, prefer } = {}) {
  const qs = query && Object.keys(query).length
    ? '?' + Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    : '';
  const res = await fetch(`${RDB_BASE()}/${table}${qs}`, {
    method,
    headers: {
      Authorization: `Bearer ${CONFIG.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12000),
  });
  let rows = null;
  try {
    const text = await res.text();
    if (text) rows = JSON.parse(text);
  } catch (_) { rows = null; }
  if (!res.ok) {
    const detail = rows && (rows.message || rows.code) ? ` ${rows.message || rows.code}` : '';
    throw new Error(`PG HTTP ${res.status}${detail}`.slice(0, 300));
  }
  return { status: res.status, rows, range: res.headers.get('content-range') || '' };
}

// MARK: - 工具

const nowISO = () => new Date().toISOString();

function isMember(memberUntil) {
  if (memberUntil === MEMBER_LIFETIME) return true;
  if (!memberUntil) return false;
  return new Date(memberUntil).getTime() > Date.now();
}

function outTradeNo() {
  const t = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}` +
    `${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}`;
  return `RR${stamp}${crypto.randomInt(100000, 999999)}`;
}

// MARK: - JWT（HS256，零依赖）

const b64u = (input) => Buffer.from(input).toString('base64url');

function signJWT(payload) {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64u(JSON.stringify({ ...payload, iat: now, exp: now + CONFIG.jwtTTLSeconds }));
  const sig = crypto.createHmac('sha256', CONFIG.jwtSecret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyJWT(token) {
  try {
    const [header, body, sig] = String(token || '').split('.');
    if (!header || !body || !sig) return null;
    const expect = crypto.createHmac('sha256', CONFIG.jwtSecret).update(`${header}.${body}`).digest('base64url');
    if (sig.length !== expect.length ||
        !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.uid || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch (_) { return null; }
}

// MARK: - 密码哈希（scrypt，零依赖；存 "salt:hash" 十六进制）

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored || '').split(':');
    if (!salt || !hash) return false;
    const expect = crypto.scryptSync(String(password), salt, 32);
    const got = Buffer.from(hash, 'hex');
    return expect.length === got.length && crypto.timingSafeEqual(expect, got);
  } catch (_) { return false; }
}

// MARK: - 数据访问（snake_case 列 ↔ camelCase 对外）

async function findUserByUnionid(unionid) {
  const { rows } = await rdb('GET', 'users', { query: { unionid: `eq.${unionid}`, limit: '1' } });
  return (rows && rows[0]) || null;
}

async function getUser(uid) {
  const { rows } = await rdb('GET', 'users', { query: { id: `eq.${uid}`, limit: '1' } });
  return (rows && rows[0]) || null;
}

async function upsertWechatUser({ unionid, openid, nickname, avatar_url }) {
  const existing = await findUserByUnionid(unionid);
  if (existing) {
    await rdb('PATCH', 'users', {
      query: { id: `eq.${existing.id}` },
      body: { openid, nickname: nickname || existing.nickname, avatar_url, updated_at: nowISO() },
    });
    return { ...existing, openid, nickname: nickname || existing.nickname, avatar_url };
  }
  const user = {
    id: crypto.randomUUID(), unionid, openid,
    nickname: nickname || '微信用户', avatar_url: avatar_url || '',
    member_until: null, created_at: nowISO(), updated_at: nowISO(),
  };
  await rdb('POST', 'users', { body: user, prefer: 'return=minimal' });
  return user;
}

function publicUser(user) {
  return {
    uid: user.id,
    nickname: user.nickname,
    avatar_url: user.avatar_url || '',
    member_until: user.member_until || null,
    is_member: isMember(user.member_until),
    plan: user.member_until === MEMBER_LIFETIME ? 'lifetime' : (isMember(user.member_until) ? 'monthly' : 'free'),
  };
}

// MARK: - 微信开放平台（snsapi_login 网站应用扫码）

async function wechatCodeToUser(code) {
  const tokenURL = 'https://api.weixin.qq.com/sns/oauth2/access_token' +
    `?appid=${encodeURIComponent(CONFIG.wxAppid)}&secret=${encodeURIComponent(process.env.WX_SECRET)}` +
    `&code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  const tokenRes = await fetch(tokenURL);
  const token = await tokenRes.json();
  if (token.errcode) throw new Error(`微信登录失败(${token.errcode}): ${token.errmsg}`);
  let nickname = '', avatar = '';
  try {
    const infoRes = await fetch(`https://api.weixin.qq.com/sns/userinfo?access_token=${encodeURIComponent(token.access_token)}&openid=${encodeURIComponent(token.openid)}`);
    const info = await infoRes.json();
    if (!info.errcode) { nickname = info.nickname || ''; avatar = info.headimgurl || ''; }
  } catch (_) { /* 资料拉取失败不阻塞登录 */ }
  return upsertWechatUser({ unionid: token.unionid || token.openid, openid: token.openid, nickname, avatar_url: avatar });
}

// MARK: - 会员开通（幂等）

/** 月卡叠加 / 终身永久。 */
function nextMemberUntil(current, plan) {
  if (plan === 'lifetime') return MEMBER_LIFETIME;
  const baseMs = current && current !== MEMBER_LIFETIME && new Date(current).getTime() > Date.now()
    ? new Date(current).getTime() : Date.now();
  return new Date(baseMs + PLANS.monthly.days * 24 * 3600 * 1000).toISOString();
}

/**
 * 订单支付成功后的开通：幂等由条件 PATCH 保证（status=created 才能翻转；
 * 微信重试回调 / 查单补偿并发时，仅一个请求能翻转状态）。
 */
async function markOrderPaid(outTradeNoStr, transactionId, paidTotalFen) {
  const { rows } = await rdb('GET', 'orders', { query: { out_trade_no: `eq.${outTradeNoStr}`, limit: '1' } });
  const order = rows && rows[0];
  if (!order) return { done: false, reason: 'missing' };
  if (order.status !== 'created') return { done: false, reason: 'already-processed' };
  if (Number(paidTotalFen) !== Number(order.amount_fen)) {
    console.error(`[njpaper-api] 金额不符拒绝开通: ${outTradeNoStr} 订单${order.amount_fen}分 实付${paidTotalFen}分`);
    return { done: false, reason: 'amount-mismatch' };
  }
  // 条件 PATCH = 原子状态机；返回空数组说明已被并发处理
  const updated = await rdb('PATCH', 'orders', {
    query: { out_trade_no: `eq.${outTradeNoStr}`, status: 'eq.created' },
    body: { status: 'paid', transaction_id: transactionId || '', paid_at: nowISO() },
    prefer: 'return=representation',
  });
  const row = Array.isArray(updated.rows) && updated.rows[0];
  if (!row) return { done: false, reason: 'already-processed' };

  const user = await getUser(order.user_id);
  let after = null;
  if (user) {
    const before = user.member_until;
    after = nextMemberUntil(before, order.plan);
    await rdb('PATCH', 'users', {
      query: { id: `eq.${user.id}` },
      body: { member_until: after, updated_at: nowISO() },
    });
    await rdb('POST', 'membership_events', {
      body: {
        id: crypto.randomUUID(), user_id: user.id, out_trade_no: order.out_trade_no,
        type: order.plan === 'lifetime' ? 'grant' : 'extend',
        member_until_before: before || null, member_until_after: after, created_at: nowISO(),
      },
      prefer: 'return=minimal',
    });
  }
  return { done: true, after };
}

// MARK: - 激活码兑换（微信支付不可用时的替代开通通道）

/** 生成激活码：RR-XXXX-XXXX-XXXX（32 字符集，去掉 0/O/1/I/L 混淆字符）。 */
function genCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = (n) => Array.from(crypto.randomBytes(n)).map((b) => alphabet[b % alphabet.length]).join('');
  return `RR-${seg(4)}-${seg(4)}-${seg(4)}`;
}

/** 兑换激活码（幂等：条件 PATCH unused→redeemed，并发仅一个成功）。 */
async function redeemCode(uid, body) {
  const code = String(body && body.code || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!code) throw httpError(400, '请输入激活码');
  const { rows } = await rdb('GET', 'redeem_codes', { query: { code: `eq.${code}`, limit: '1' } });
  const rc = rows && rows[0];
  if (!rc) throw httpError(404, '激活码不存在或已失效');
  if (rc.status !== 'unused') throw httpError(409, '激活码已被使用');
  const user = await getUser(uid);
  if (!user) throw httpError(401, '用户不存在');
  // 条件 PATCH 原子翻转；返回空数组 = 已被并发处理
  const updated = await rdb('PATCH', 'redeem_codes', {
    query: { code: `eq.${code}`, status: 'eq.unused' },
    body: { status: 'redeemed', redeemed_by: uid, redeemed_at: nowISO() },
    prefer: 'return=representation',
  });
  const row = Array.isArray(updated.rows) && updated.rows[0];
  if (!row) throw httpError(409, '激活码已被使用');
  const before = user.member_until;
  const after = nextMemberUntil(before, rc.plan);
  await rdb('PATCH', 'users', { query: { id: `eq.${uid}` }, body: { member_until: after, updated_at: nowISO() } });
  await rdb('POST', 'membership_events', {
    body: {
      id: crypto.randomUUID(), user_id: uid, out_trade_no: null,
      type: rc.plan === 'lifetime' ? 'grant' : 'extend',
      member_until_before: before || null, member_until_after: after, created_at: nowISO(),
    },
    prefer: 'return=minimal',
  });
  const fresh = await getUser(uid);
  return { ok: true, ...publicUser(fresh) };
}

/** 管理端批量生成激活码（需 X-Admin-Secret = ADMIN_SECRET）。 */
async function adminGenerateCodes(body, headers) {
  if (!CONFIG.adminSecret) throw httpError(503, '管理密钥未配置（ADMIN_SECRET）');
  if (String(headers['x-admin-secret'] || '') !== CONFIG.adminSecret) throw httpError(403, '无权限');
  const plan = String(body && body.plan || 'monthly');
  if (!PLANS[plan]) throw httpError(400, '未知套餐');
  const count = Math.min(Math.max(Number(body && body.count) || 1, 1), 200);
  const codes = [];
  for (let i = 0; i < count; i++) {
    const code = genCode();
    await rdb('POST', 'redeem_codes', { body: { code, plan, status: 'unused', created_at: nowISO() }, prefer: 'return=minimal' });
    codes.push(code);
  }
  return { ok: true, plan, codes };
}

/** 管理端列出激活码（含状态统计，用于对账）。 */
async function adminListCodes(headers) {
  if (!CONFIG.adminSecret) throw httpError(503, '管理密钥未配置（ADMIN_SECRET）');
  if (String(headers['x-admin-secret'] || '') !== CONFIG.adminSecret) throw httpError(403, '无权限');
  const { rows } = await rdb('GET', 'redeem_codes', { query: { order: 'created_at.desc', limit: '500' } });
  const list = Array.isArray(rows) ? rows : (rows ? [rows] : []);
  const stats = { total: list.length, unused: 0, redeemed: 0, disabled: 0 };
  for (const c of list) {
    if (stats[c.status] !== undefined) stats[c.status] += 1;
  }
  return { ok: true, codes: list, stats };
}

// MARK: - 微信支付 v3（Native 扫码；未配置时走 mock）

let wxpayInstance = null;
function getWxPay() {
  if (!CONFIG.wxPay) return null;
  if (wxpayInstance) return wxpayInstance;
  let WxPay;
  try {
    WxPay = require('wechatpay-node-v3');
  } catch (err) {
    throw new Error('真实支付已配置但缺少 wechatpay-node-v3 依赖：请在 package.json 加回该依赖并重新部署');
  }
  const fs = require('node:fs');
  const writePem = (name, content) => {
    const file = `/tmp/${name}.pem`;
    fs.writeFileSync(file, String(content).replace(/\\n/g, '\n'));
    return file;
  };
  wxpayInstance = new WxPay({
    appid: CONFIG.wxAppid,
    mchid: process.env.WXPAY_MCHID,
    serialNo: process.env.WXPAY_SERIAL_NO,
    key: process.env.WXPAY_APIV3_KEY,
    publicKey: writePem('wxpay-platform', process.env.WXPAY_PUBLIC_KEY),
    privateKey: writePem('wxpay-merchant', process.env.WXPAY_PRIVATE_KEY),
  });
  return wxpayInstance;
}

async function createNativeOrder(order) {
  const pay = getWxPay();
  if (!pay) return { code_url: `mock:${order.out_trade_no}`, mock: true };
  const result = await pay.transactions({
    description: `RobinRead ${PLANS[order.plan].title}`,
    out_trade_no: order.out_trade_no,
    notify_url: `${CONFIG.publicBase}/api/pay/notify`,
    amount: { total: order.amount_fen, currency: 'CNY' },
  });
  if (!result || !result.code_url) throw new Error(`微信下单失败: ${JSON.stringify(result).slice(0, 300)}`);
  return { code_url: result.code_url, mock: false };
}

// MARK: - 路由处理器

function getConfig() {
  return {
    ok: true,
    wx_login_enabled: CONFIG.wxLogin,
    pay_mock: !CONFIG.wxPay,
    appid: CONFIG.wxAppid,
    redirect_uri: CONFIG.publicBase ? `${CONFIG.publicBase}/auth/callback` : '',
    plans: Object.values(PLANS).map(({ id, title, price_fen, days }) => ({ id, title, price_fen, days })),
    afdian: { monthly: CONFIG.afdianMonthlyUrl, lifetime: CONFIG.afdianLifetimeUrl },
  };
}

async function authWechat(body) {
  const code = String(body.code || '').trim();
  if (!code) throw httpError(400, '缺少 code');
  if (!CONFIG.wxLogin) throw httpError(503, '微信登录未配置');
  const user = await wechatCodeToUser(code);
  return { ok: true, token: signJWT({ uid: user.id }), user: publicUser(user) };
}

async function authDevLogin(body) {
  if (CONFIG.wxLogin) throw httpError(404, 'dev-login 仅在微信登录未配置时可用');
  const user = await upsertWechatUser({
    unionid: 'dev-user', openid: 'dev-openid',
    nickname: (body && body.nickname ? String(body.nickname).slice(0, 30) : '') || '开发者（联调）',
    avatar_url: '',
  });
  return { ok: true, token: signJWT({ uid: user.id }), user: publicUser(user), dev: true };
}

async function authRegister(body) {
  const username = String(body && body.username || '').trim();
  const password = String(body && body.password || '');
  const nickname = String(body && body.nickname || '').trim().slice(0, 24);
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) throw httpError(400, '用户名需为 3-20 位字母、数字或下划线');
  if (password.length < 6 || password.length > 64) throw httpError(400, '密码需为 6-64 位');
  const { rows: existingRows } = await rdb('GET', 'users', { query: { username: `eq.${username}`, limit: '1' } });
  if (existingRows && existingRows[0]) throw httpError(409, '用户名已被占用');
  const user = {
    id: crypto.randomUUID(), username,
    password_hash: hashPassword(password),
    nickname: nickname || username, avatar_url: '',
    member_until: null, created_at: nowISO(), updated_at: nowISO(),
  };
  await rdb('POST', 'users', { body: user, prefer: 'return=minimal' });
  return { ok: true, token: signJWT({ uid: user.id }), user: publicUser(user) };
}

async function authLogin(body) {
  const username = String(body && body.username || '').trim();
  const password = String(body && body.password || '');
  const { rows } = await rdb('GET', 'users', { query: { username: `eq.${username}`, limit: '1' } });
  const user = rows && rows[0];
  if (!user || !verifyPassword(password, user.password_hash)) throw httpError(401, '用户名或密码错误');
  return { ok: true, token: signJWT({ uid: user.id }), user: publicUser(user) };
}

async function me(uid) {
  const user = await getUser(uid);
  if (!user) throw httpError(401, '用户不存在');
  return { ok: true, ...publicUser(user) };
}

/**
 * 资料自定义：昵称与头像。
 * 头像支持三种形态：''（清空，用首字母徽章）、http(s) 图片链接（≤500 字符）、
 * data:image/*;base64（本地图片经客户端缩放后上传，≤180KB 字符串 ≈ 130KB 图片）。
 */
async function updateProfile(uid, body) {
  const patch = {};
  if (body && body.nickname !== undefined) {
    const nickname = String(body.nickname).trim().slice(0, 24);
    if (!nickname) throw httpError(400, '昵称不能为空');
    patch.nickname = nickname;
  }
  if (body && body.avatar_url !== undefined) {
    const avatar = String(body.avatar_url || '').trim();
    if (avatar === '') patch.avatar_url = '';
    else if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(avatar) && avatar.length <= 180_000) patch.avatar_url = avatar;
    else if (/^https?:\/\/\S+$/i.test(avatar) && avatar.length <= 500) patch.avatar_url = avatar;
    else throw httpError(400, '头像格式不支持（仅支持本地图片或 http(s) 图片链接）');
  }
  if (!Object.keys(patch).length) throw httpError(400, '没有可更新的资料');
  patch.updated_at = nowISO();
  await rdb('PATCH', 'users', { query: { id: `eq.${uid}` }, body: patch });
  const user = await getUser(uid);
  if (!user) throw httpError(401, '用户不存在');
  return { ok: true, ...publicUser(user) };
}

// 下单限频：同 uid 每分钟最多 5 单（实例内存级，够用的第一道闸）
const orderRate = new Map();
function allowOrder(uid) {
  const now = Date.now();
  const list = (orderRate.get(uid) || []).filter((t) => now - t < 60_000);
  if (list.length >= 5) return false;
  list.push(now);
  orderRate.set(uid, list);
  return true;
}

async function createOrder(uid, body) {
  const plan = String((body && body.plan) || '');
  if (!PLANS[plan]) throw httpError(400, '未知套餐');
  if (!allowOrder(uid)) throw httpError(429, '下单太频繁，请稍后再试');
  const user = await getUser(uid);
  if (!user) throw httpError(401, '用户不存在');
  const no = outTradeNo();
  const order = {
    out_trade_no: no, user_id: uid, plan, amount_fen: PLANS[plan].price_fen,
    status: 'created', channel: CONFIG.wxPay ? 'wxpay_native' : 'mock',
    transaction_id: '', created_at: nowISO(),
  };
  await rdb('POST', 'orders', { body: order, prefer: 'return=minimal' });
  const placed = await createNativeOrder({ ...order, out_trade_no: no });
  return {
    ok: true, out_trade_no: no, code_url: placed.code_url, mock: placed.mock,
    amount_fen: order.amount_fen,
    expires_at: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
  };
}

async function queryOrder(uid, no) {
  const { rows } = await rdb('GET', 'orders', {
    query: { out_trade_no: `eq.${no}`, user_id: `eq.${uid}`, limit: '1' },
  });
  const order = rows && rows[0];
  if (!order) throw httpError(404, '订单不存在');
  // Mock 渠道：创建 4 秒后查询即模拟支付成功（走同一套开通逻辑，联调真实链路）
  if (order.status === 'created' && order.channel === 'mock' &&
      Date.now() - new Date(order.created_at).getTime() > 4000) {
    await markOrderPaid(order.out_trade_no, 'mock-transaction', order.amount_fen);
    order.status = 'paid';
    order.paid_at = order.paid_at || nowISO();
  }
  return { ok: true, out_trade_no: order.out_trade_no, status: order.status, amount_fen: order.amount_fen, paid_at: order.paid_at || null };
}

async function payNotify(event) {
  const pay = getWxPay();
  if (!pay) return jsonResponse(200, { code: 'SUCCESS' }); // mock 模式不会有真实回调
  const headers = lowerKeys(event.headers || {});
  const rawBody = typeof event.body === 'string' ? event.body : JSON.stringify(event.body || {});
  const verified = await pay.verifySign({
    timestamp: headers['wechatpay-timestamp'],
    nonce: headers['wechatpay-nonce'],
    body: rawBody,
    signature: headers['wechatpay-signature'],
    serial: headers['wechatpay-serial'],
  }).catch(() => false);
  if (!verified) return jsonResponse(401, { code: 'FAIL', message: '验签失败' });
  let event2 = {};
  try { event2 = JSON.parse(rawBody); } catch (_) { return jsonResponse(400, { code: 'FAIL', message: '非法 JSON' }); }
  if (event2.event_type !== 'TRANSACTION.SUCCESS') {
    return jsonResponse(200, { code: 'SUCCESS' }); // 非支付成功通知应答成功，避免微信无限重试
  }
  const resource = event2.resource || {};
  let plain;
  try {
    plain = JSON.parse(pay.decipheriv(resource.ciphertext, resource.associated_data, resource.nonce));
  } catch (err) {
    console.error('[njpaper-api] 回调解密失败:', err.message);
    return jsonResponse(500, { code: 'FAIL', message: '解密失败' });
  }
  if (plain.trade_state === 'SUCCESS') {
    await markOrderPaid(plain.out_trade_no, plain.transaction_id, plain.amount && plain.amount.total);
  }
  return jsonResponse(200, { code: 'SUCCESS' });
}

// MARK: - 掉单补偿（定时触发）

async function reconcile() {
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { rows } = await rdb('GET', 'orders', {
    query: { status: 'eq.created', created_at: `lt.${tenMinAgo}`, limit: '100', order: 'created_at.asc' },
  });
  let paid = 0, closed = 0;
  for (const order of rows || []) {
    if (order.channel === 'mock') {
      await rdb('PATCH', 'orders', { query: { out_trade_no: `eq.${order.out_trade_no}` }, body: { status: 'closed' } });
      closed += 1;
      continue;
    }
    try {
      const q = await getWxPay().query({ out_trade_no: order.out_trade_no });
      const state = q && (q.trade_state || (q.transaction && q.transaction.trade_state));
      if (state === 'SUCCESS') {
        const total = (q.amount && q.amount.total) || (q.transaction && q.transaction.amount && q.transaction.amount.total);
        const r = await markOrderPaid(order.out_trade_no,
          (q.transaction_id || (q.transaction && q.transaction.transaction_id) || ''), total);
        if (r.done) paid += 1; else closed += 1;
      } else if (state && state !== 'NOTPAY' && state !== 'USERPAYING') {
        await rdb('PATCH', 'orders', { query: { out_trade_no: `eq.${order.out_trade_no}` }, body: { status: 'closed' } });
        closed += 1;
      } else if (Date.now() - new Date(order.created_at).getTime() > 2 * 3600 * 1000) {
        try { await getWxPay().close(order.out_trade_no); } catch (_) { /* 已关或从未下单 */ }
        await rdb('PATCH', 'orders', { query: { out_trade_no: `eq.${order.out_trade_no}` }, body: { status: 'closed' } });
        closed += 1;
      }
    } catch (err) {
      console.warn(`[njpaper-api] 查单失败 ${order.out_trade_no}: ${err.message}`);
    }
  }
  console.log(`[njpaper-api] reconcile: paid=${paid} closed=${closed}`);
  return { paid, closed };
}

// MARK: - 云接入协议适配

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

function jsonResponse(status, obj) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(obj) };
}

function lowerKeys(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k.toLowerCase()] = v;
  return out;
}

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try { return JSON.parse(raw); } catch (_) { return {}; }
}

exports.main = async (event) => {
  try {
    // 定时触发（掉单补偿）
    if (event && (event.Type === 'Timer' || event.TriggerName)) {
      return reconcile();
    }
    const method = String(event.method || event.httpMethod || 'GET').toUpperCase();
    const rawPath = String(event.path || '').replace(/\?.*$/, '').replace(/\/+$/, '') || '/';
    // 网关挂载路径可能带 /api 前缀也可能不带：统一剥掉前缀后匹配
    const route = (rawPath.startsWith('/api/') || rawPath === '/api') ? (rawPath.slice(4) || '/') : rawPath;
    const headers = lowerKeys(event.headers || {});
    const body = parseBody(event);

    const auth = String(headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const session = token ? verifyJWT(token) : null;

    if (method === 'GET' && route === '/config') return jsonResponse(200, getConfig());
    if (method === 'POST' && route === '/auth/wechat') return jsonResponse(200, await authWechat(body));
    if (method === 'POST' && route === '/auth/register') return jsonResponse(200, await authRegister(body));
    if (method === 'POST' && route === '/auth/login') return jsonResponse(200, await authLogin(body));
    if (method === 'POST' && route === '/auth/dev-login') return jsonResponse(200, await authDevLogin(body));
    if (method === 'GET' && route === '/me') {
      if (!session) return jsonResponse(401, { ok: false, error: '未登录或登录已过期' });
      return jsonResponse(200, await me(session.uid));
    }
    if (method === 'POST' && route === '/profile') {
      if (!session) return jsonResponse(401, { ok: false, error: '未登录或登录已过期' });
      return jsonResponse(200, await updateProfile(session.uid, body));
    }
    if (method === 'POST' && route === '/pay/orders') {
      if (!session) return jsonResponse(401, { ok: false, error: '未登录或登录已过期' });
      return jsonResponse(200, await createOrder(session.uid, body));
    }
    const orderMatch = route.match(/^\/pay\/orders\/([A-Za-z0-9_-]+)$/);
    if (method === 'GET' && orderMatch) {
      if (!session) return jsonResponse(401, { ok: false, error: '未登录或登录已过期' });
      return jsonResponse(200, await queryOrder(session.uid, orderMatch[1]));
    }
    if (method === 'POST' && route === '/redeem') {
      if (!session) return jsonResponse(401, { ok: false, error: '未登录或登录已过期' });
      return jsonResponse(200, await redeemCode(session.uid, body));
    }
    if (method === 'POST' && route === '/admin/generate-codes') return jsonResponse(200, await adminGenerateCodes(body, headers));
    if (method === 'GET' && route === '/admin/redeem-codes') return jsonResponse(200, await adminListCodes(headers));
    if (method === 'POST' && route === '/pay/notify') return payNotify(event);
    if (method === 'GET' && route === '/auth/callback') {
      // 开放平台授权回调页：Electron 客户端在跳转前就拦截了 code，此页仅兜底展示
      return {
        statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: '<!DOCTYPE html><html><head><meta charset="utf-8"><title>RobinRead</title></head><body style="font-family:system-ui;text-align:center;padding-top:80px;color:#333">授权成功，请回到 RobinRead 应用。</body></html>',
      };
    }
    if (method === 'GET' && route === '/') return jsonResponse(200, { ok: true, service: 'njpaper-api', time: nowISO() });
    return jsonResponse(404, { ok: false, error: 'not found' });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[njpaper-api]', err);
    return jsonResponse(status, { ok: false, error: err.message || '服务错误' });
  }
};
