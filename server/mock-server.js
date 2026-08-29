'use strict';
/**
 * RobinRead 本地联调服务器（零依赖，node server/mock-server.js）
 *
 * 与 cloudfunctions/njpaper-api 完全相同的 API 契约，内存存储：
 *   - 微信登录未配置 → /api/config 返回 wx_login_enabled:false，/api/auth/dev-login 可用
 *   - 支付走 mock 渠道：code_url = "mock:NP…"，下单 4 秒后轮询自动「支付成功」并开通会员
 *
 * 供 Electron 客户端开发/回归使用；Ctrl+C 退出即数据清空。
 */
const http = require('node:http');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3777);

const PLANS = {
  monthly: { id: 'monthly', title: '月卡会员', price_fen: 1000, days: 30 },
  lifetime: { id: 'lifetime', title: '终身会员', price_fen: 8800, days: null },
};

// ---- 内存存储（结构与云函数文档数据库一致）----
const users = new Map();     // uid -> user
const orders = new Map();    // out_trade_no -> order
const redeemCodes = new Map(); // code -> { code, plan, status, redeemed_by, redeemed_at, created_at }
const events = [];           // membership_events

const MEMBER_LIFETIME = 'lifetime';
const nowISO = () => new Date().toISOString();
const isMember = (mu) => mu === MEMBER_LIFETIME || (!!mu && new Date(mu).getTime() > Date.now());

// ---- JWT（与云函数同一实现）----
const SECRET = process.env.JWT_SECRET || 'mock-secret';
const b64u = (s) => Buffer.from(s).toString('base64url');
function signJWT(payload) {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const b = b64u(JSON.stringify({ ...payload, iat: now, exp: now + 30 * 24 * 3600 }));
  const sig = crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url');
  return `${h}.${b}.${sig}`;
}
function verifyJWT(token) {
  try {
    const [h, b, sig] = String(token || '').split('.');
    if (!h || !b || !sig) return null;
    const expect = crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url');
    if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'));
    if (!payload.uid || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch (_) { return null; }
}

function publicUser(u) {
  return {
    uid: u._id, nickname: u.nickname, avatar_url: u.avatar_url,
    member_until: u.member_until || null, is_member: isMember(u.member_until),
    plan: u.member_until === MEMBER_LIFETIME ? 'lifetime' : (isMember(u.member_until) ? 'monthly' : 'free'),
  };
}

// ---- 密码哈希（scrypt，与云函数一致）----
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

function upsertUser({ unionid, openid, nickname, avatar_url }) {
  for (const u of users.values()) {
    if (u.unionid === unionid) {
      if (nickname) u.nickname = nickname; // dev-login 可更新昵称，方便联调
      return u;
    }
  }
  const u = { _id: crypto.randomUUID(), unionid, openid, nickname, avatar_url, member_until: null, created_at: nowISO() };
  users.set(u._id, u);
  return u;
}

function nextMemberUntil(current, plan) {
  if (plan === 'lifetime') return MEMBER_LIFETIME;
  const base = current && current !== MEMBER_LIFETIME && new Date(current).getTime() > Date.now() ? new Date(current).getTime() : Date.now();
  return new Date(base + PLANS.monthly.days * 24 * 3600 * 1000).toISOString();
}

function markOrderPaid(no, transactionId, paidFen) {
  const order = orders.get(no);
  if (!order || order.status !== 'created') return { done: false };
  if (Number(paidFen) !== Number(order.amount_fen)) return { done: false, reason: 'amount-mismatch' };
  order.status = 'paid';
  order.transaction_id = transactionId;
  order.paid_at = nowISO();
  const user = users.get(order.user_id);
  if (user) {
    const before = user.member_until;
    user.member_until = nextMemberUntil(before, order.plan);
    events.push({ user_id: user._id, out_trade_no: no, type: order.plan === 'lifetime' ? 'grant' : 'extend', member_until_before: before || null, member_until_after: user.member_until, created_at: nowISO() });
  }
  return { done: true };
}

function outTradeNo() {
  const t = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `NP${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}${crypto.randomInt(100000, 999999)}`;
}

function genCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = (n) => Array.from(crypto.randomBytes(n)).map((b) => alphabet[b % alphabet.length]).join('');
  return `RR-${seg(4)}-${seg(4)}-${seg(4)}`;
}

// ---- HTTP 服务 ----
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const send = (status, obj) => {
    const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': typeof obj === 'string' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(body);
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }); return res.end(); }

  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let json = {};
    try { json = body ? JSON.parse(body) : {}; } catch (_) {}

    const auth = req.headers.authorization || '';
    const session = auth.startsWith('Bearer ') ? verifyJWT(auth.slice(7)) : null;

    if (req.method === 'GET' && path === '/') return send(200, { ok: true, service: 'njpaper-mock' });
    if (req.method === 'GET' && path === '/api/config') {
      return send(200, {
        ok: true, wx_login_enabled: false, pay_mock: true, appid: '', redirect_uri: '',
        plans: Object.values(PLANS).map(({ id, title, price_fen, days }) => ({ id, title, price_fen, days })),
        afdian: { monthly: process.env.AFDIAN_MONTHLY_URL || '', lifetime: process.env.AFDIAN_LIFETIME_URL || '' },
      });
    }
    if (req.method === 'POST' && path === '/api/auth/wechat') return send(503, { ok: false, error: 'mock 服务器未配置微信登录，请使用 dev-login' });
    if (req.method === 'POST' && path === '/api/auth/dev-login') {
      const names = json.nickname ? String(json.nickname).slice(0, 30) : '开发者（本地联调）';
      const u = upsertUser({ unionid: 'dev-user', openid: 'dev-openid', nickname: names, avatar_url: '' });
      return send(200, { ok: true, token: signJWT({ uid: u._id }), user: publicUser(u), dev: true });
    }
    if (req.method === 'POST' && path === '/api/auth/register') {
      const username = String(json.username || '').trim();
      const password = String(json.password || '');
      const nickname = String(json.nickname || '').trim().slice(0, 24);
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return send(400, { ok: false, error: '用户名需为 3-20 位字母、数字或下划线' });
      if (password.length < 6 || password.length > 64) return send(400, { ok: false, error: '密码需为 6-64 位' });
      for (const u of users.values()) if (u.username === username) return send(409, { ok: false, error: '用户名已被占用' });
      const u = { _id: crypto.randomUUID(), username, password_hash: hashPassword(password), nickname: nickname || username, avatar_url: '', member_until: null, created_at: nowISO() };
      users.set(u._id, u);
      return send(200, { ok: true, token: signJWT({ uid: u._id }), user: publicUser(u) });
    }
    if (req.method === 'POST' && path === '/api/auth/login') {
      const username = String(json.username || '').trim();
      const password = String(json.password || '');
      let u = null;
      for (const x of users.values()) if (x.username === username) { u = x; break; }
      if (!u || !verifyPassword(password, u.password_hash)) return send(401, { ok: false, error: '用户名或密码错误' });
      return send(200, { ok: true, token: signJWT({ uid: u._id }), user: publicUser(u) });
    }
    if (req.method === 'GET' && path === '/api/me') {
      if (!session) return send(401, { ok: false, error: '未登录或登录已过期' });
      const u = users.get(session.uid);
      if (!u) return send(401, { ok: false, error: '用户不存在' });
      return send(200, { ok: true, ...publicUser(u) });
    }
    if (req.method === 'POST' && path === '/api/profile') {
      if (!session) return send(401, { ok: false, error: '未登录或登录已过期' });
      const u = users.get(session.uid);
      if (!u) return send(401, { ok: false, error: '用户不存在' });
      if (json.nickname !== undefined) {
        const nickname = String(json.nickname).trim().slice(0, 24);
        if (!nickname) return send(400, { ok: false, error: '昵称不能为空' });
        u.nickname = nickname;
      }
      if (json.avatar_url !== undefined) {
        const avatar = String(json.avatar_url || '').trim();
        const isData = /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(avatar) && avatar.length <= 180000;
        const isURL = /^https?:\/\/\S+$/i.test(avatar) && avatar.length <= 500;
        if (avatar !== '' && !isData && !isURL) return send(400, { ok: false, error: '头像格式不支持（仅支持本地图片或 http(s) 图片链接）' });
        u.avatar_url = avatar;
      }
      return send(200, { ok: true, ...publicUser(u) });
    }
    if (req.method === 'POST' && path === '/api/pay/orders') {
      if (!session) return send(401, { ok: false, error: '未登录或登录已过期' });
      const plan = PLANS[json.plan];
      if (!plan) return send(400, { ok: false, error: '未知套餐' });
      const u = users.get(session.uid);
      if (!u) return send(401, { ok: false, error: '用户不存在' });
      const no = outTradeNo();
      orders.set(no, { _id: no, user_id: u._id, plan: plan.id, amount_fen: plan.price_fen, status: 'created', channel: 'mock', transaction_id: '', paid_at: '', created_at: nowISO() });
      return send(200, { ok: true, out_trade_no: no, code_url: `mock:${no}`, mock: true, amount_fen: plan.price_fen, expires_at: new Date(Date.now() + 2 * 3600 * 1000).toISOString() });
    }
    const m = path.match(/^\/api\/pay\/orders\/([A-Za-z0-9_-]+)$/);
    if (req.method === 'GET' && m) {
      if (!session) return send(401, { ok: false, error: '未登录或登录已过期' });
      const o = orders.get(m[1]);
      if (!o || o.user_id !== session.uid) return send(404, { ok: false, error: '订单不存在' });
      if (o.status === 'created' && Date.now() - new Date(o.created_at).getTime() > 4000) {
        markOrderPaid(o._id, 'mock-transaction', o.amount_fen);
      }
      return send(200, { ok: true, out_trade_no: o._id, status: o.status, amount_fen: o.amount_fen, paid_at: o.paid_at || null });
    }
    if (req.method === 'POST' && path === '/api/pay/notify') return send(200, { code: 'SUCCESS' });
    if (req.method === 'POST' && path === '/api/redeem') {
      if (!session) return send(401, { ok: false, error: '未登录或登录已过期' });
      const code = String(json.code || '').trim().toUpperCase().replace(/\s+/g, '');
      if (!code) return send(400, { ok: false, error: '请输入激活码' });
      const rc = redeemCodes.get(code);
      if (!rc) return send(404, { ok: false, error: '激活码不存在或已失效' });
      if (rc.status !== 'unused') return send(409, { ok: false, error: '激活码已被使用' });
      const user = users.get(session.uid);
      if (!user) return send(401, { ok: false, error: '用户不存在' });
      rc.status = 'redeemed';
      rc.redeemed_by = session.uid;
      rc.redeemed_at = nowISO();
      const before = user.member_until;
      user.member_until = nextMemberUntil(before, rc.plan);
      events.push({ user_id: user._id, out_trade_no: null, type: rc.plan === 'lifetime' ? 'grant' : 'extend', member_until_before: before || null, member_until_after: user.member_until, created_at: nowISO() });
      return send(200, { ok: true, ...publicUser(user) });
    }
    if (req.method === 'POST' && path === '/api/admin/generate-codes') {
      const secret = process.env.ADMIN_SECRET || '';
      if (!secret) return send(503, { ok: false, error: '管理密钥未配置（ADMIN_SECRET）' });
      if (String(req.headers['x-admin-secret'] || '') !== secret) return send(403, { ok: false, error: '无权限' });
      const plan = PLANS[json.plan] ? json.plan : 'monthly';
      const count = Math.min(Math.max(Number(json.count) || 1, 1), 200);
      const codes = [];
      for (let i = 0; i < count; i++) {
        const code = genCode();
        redeemCodes.set(code, { code, plan, status: 'unused', redeemed_by: null, redeemed_at: null, created_at: nowISO() });
        codes.push(code);
      }
      return send(200, { ok: true, plan, codes });
    }
    if (req.method === 'GET' && path === '/api/admin/redeem-codes') {
      const secret = process.env.ADMIN_SECRET || '';
      if (!secret) return send(503, { ok: false, error: '管理密钥未配置（ADMIN_SECRET）' });
      if (String(req.headers['x-admin-secret'] || '') !== secret) return send(403, { ok: false, error: '无权限' });
      const list = [...redeemCodes.values()].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      const stats = { total: list.length, unused: 0, redeemed: 0, disabled: 0 };
      for (const c of list) if (stats[c.status] !== undefined) stats[c.status] += 1;
      return send(200, { ok: true, codes: list, stats });
    }
    if (req.method === 'GET' && path === '/auth/callback') {
      return send(200, '<!DOCTYPE html><html><head><meta charset="utf-8"><title>RobinRead</title></head><body style="font-family:system-ui;text-align:center;padding-top:80px;color:#333">授权成功，请回到知更 RobinRead 应用。</body></html>');
    }
    if (req.method === 'GET' && path === '/__dump') {
      // 调试：查看全部用户与订单
      return send(200, { users: [...users.values()], orders: [...orders.values()], redeemCodes: [...redeemCodes.values()], events });
    }
    return send(404, { ok: false, error: 'not found' });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[njpaper-mock] http://127.0.0.1:${PORT}  （dev-login + mock 支付：下单 4 秒后轮询自动成功）`);
  console.log('[njpaper-mock] 调试视图: http://127.0.0.1:' + PORT + '/__dump');
});
