'use strict';
/**
 * NanJuPaper — 账号与会员服务（主进程）
 *
 * 职责：
 *   - 微信扫码登录：子窗口加载开放平台 qrconnect，重定向前拦截 code，换 JWT
 *   - JWT 存取（CredentialStore / DPAPI），用户与会员状态本地缓存（12h 刷新 / 72h 离线宽限）
 *   - 订单：创建（Native 扫码）+ 轮询，支付成功后强制刷新会员状态
 *   - 免费额度：订阅源上限、AI 每日次数（游客按免费版处理，额度记在本地）
 *
 * 安全：本模块只持有 JWT；appsecret / 商户密钥全部在后端（cloudfunctions/njpaper-api）。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { BrowserWindow, net, app } = require('electron');

/** 线上后端（CloudBase 云接入，2026-08-19 部署）；联调本地 mock 用环境变量 NANJU_API_BASE=http://127.0.0.1:3777 覆盖。 */
const DEFAULT_API_BASE = 'https://ronbinread-d9gmsqi2vc0a18f04.service.tcloudbase.com/api';
const PREF_KEY_API_BASE = 'NanJuPaper.apiBase';
const STATE_FILE = 'account-state.json';

const FREE_FEED_LIMIT = 30;   // 免费版订阅源上限（会员无限）
const FREE_AI_PER_DAY = 3;    // 免费版 AI 生成次数/天（会员无限）

const CACHE_TTL_MS = 12 * 3600 * 1000;   // 会员状态正常刷新间隔
const GRACE_TTL_MS = 72 * 3600 * 1000;   // 断网宽限：超过则按免费处理并提示

class AuthService {
  /**
   * @param {object} opts
   * @param {import('./CredentialStore')} opts.credentialStore
   * @param {object} opts.preferences  AppStore.preferences（PreferenceStore）
   * @param {() => import('electron').BrowserWindow|null} opts.getMainWindow
   * @param {(account: object|null) => void} opts.onChange  登录/登出/会员变化时回调（ipc 转推渲染层）
   */
  constructor({ credentialStore, preferences, getMainWindow, onChange }) {
    this.credentials = credentialStore;
    this.preferences = preferences;
    this.getMainWindow = getMainWindow || (() => null);
    this.onChange = onChange || (() => {});
    this._configCache = null;       // /api/config 内存缓存
    this._configAt = 0;
    this._state = this._readState();
  }

  // MARK: - 基础配置

  get apiBase() {
    const fromEnv = process.env.NANJU_API_BASE;
    if (fromEnv) return fromEnv.replace(/\/+$/, '');
    const fromPref = this.preferences?.get?.(PREF_KEY_API_BASE, '');
    if (fromPref) return String(fromPref).replace(/\/+$/, '');
    return DEFAULT_API_BASE;
  }

  /** 后端公共配置（微信登录可用性 / 套餐）。后端不可达时返回降级配置（offline 标记）。 */
  async config(force = false) {
    if (!force && this._configCache && Date.now() - this._configAt < 10 * 60 * 1000) {
      return this._configCache;
    }
    try {
      const cfg = await this._request('GET', '/api/config');
      this._configCache = cfg;
      this._configAt = Date.now();
      return cfg;
    } catch (_) {
      if (this._configCache) return this._configCache;
      return {
        ok: false, offline: true, wx_login_enabled: false, pay_mock: true, appid: '', redirect_uri: '',
        plans: [
          { id: 'monthly', title: '月卡会员', price_fen: 1000, days: 30 },
          { id: 'lifetime', title: '终身会员', price_fen: 8800, days: null },
        ],
      };
    }
  }

  // MARK: - 登录

  token() { return this.credentials.authToken(); }

  /** 微信扫码登录。用户关闭子窗口 → 抛 cancelled。 */
  async loginWithWechat() {
    const cfg = await this.config();
    if (!cfg.wx_login_enabled) throw new Error('微信登录尚未配置（后端缺少 WX_APPID/WX_SECRET）');
    const state = crypto.randomBytes(8).toString('hex');
    const redirectURI = cfg.redirect_uri;
    const qrURL = 'https://open.weixin.qq.com/connect/qrconnect' +
      `?appid=${encodeURIComponent(cfg.appid)}` +
      `&redirect_uri=${encodeURIComponent(redirectURI)}` +
      `&response_type=code&scope=snsapi_login&state=${state}#wechat_redirect`;
    const code = await this._openLoginWindow(qrURL, redirectURI);
    if (!code) { const e = new Error('cancelled'); e.cancelled = true; throw e; }
    const result = await this._request('POST', '/api/auth/wechat', { body: { code, state } });
    return this._acceptLogin(result);
  }

  /** 开发模式登录（仅后端未配置微信时可用），nickname 仅用于本地展示。 */
  async loginDev(nickname) {
    const result = await this._request('POST', '/api/auth/dev-login', { body: { nickname: nickname || '' } });
    return this._acceptLogin(result);
  }

  /** 账号密码注册（用户名 3-20 位字母/数字/下划线，密码 6-64 位）。 */
  async register(username, password, nickname) {
    const result = await this._request('POST', '/api/auth/register', { body: { username, password, nickname: nickname || '' } });
    return this._acceptLogin(result);
  }

  /** 账号密码登录。 */
  async loginWithPassword(username, password) {
    const result = await this._request('POST', '/api/auth/login', { body: { username, password } });
    return this._acceptLogin(result);
  }

  /** 兑换激活码（开通会员）。成功后更新缓存并推送渲染层。 */
  async redeem(code) {
    const token = this.token();
    if (!token) { const e = new Error('请先登录'); e.gate = 'login'; throw e; }
    const result = await this._request('POST', '/api/redeem', { token, body: { code } });
    this._state.user = {
      uid: result.uid, nickname: result.nickname, avatar_url: result.avatar_url,
      member_until: result.member_until, is_member: result.is_member, plan: result.plan,
    };
    this._state.fetchedAt = Date.now();
    this._writeState();
    this.onChange(this._state.user);
    return this._state.user;
  }

  _acceptLogin(result) {
    if (!result || !result.token) throw new Error('登录失败：后端未返回 token');
    this.credentials.setAuthToken(result.token);
    this._state.user = result.user || null;
    this._state.fetchedAt = Date.now();
    this._writeState();
    this.onChange(this._state.user);
    return result.user;
  }

  async logout() {
    this.credentials.setAuthToken('');
    this._state.user = null;
    this._state.fetchedAt = 0;
    this._state.aiQuota = { date: localDateKey(), used: 0 };
    this._writeState();
    this.onChange(null);
    return true;
  }

  /**
   * 资料自定义（昵称/头像）。成功后更新缓存并推送渲染层。
   * 头像格式由后端校验；本地文件路径的裁剪缩放在 ipc 层完成（account:pickAvatar）。
   */
  async updateProfile(patch = {}) {
    const token = this.token();
    if (!token) { const e = new Error('请先登录'); e.gate = 'login'; throw e; }
    const result = await this._request('POST', '/api/profile', { token, body: patch });
    this._state.user = {
      uid: result.uid, nickname: result.nickname, avatar_url: result.avatar_url,
      member_until: result.member_until, is_member: result.is_member, plan: result.plan,
    };
    this._state.fetchedAt = Date.now();
    this._writeState();
    this.onChange(this._state.user);
    return this._state.user;
  }

  /** 打开微信扫码子窗口，返回授权 code（用户关闭窗口返回 null）。 */
  _openLoginWindow(qrURL, redirectURI) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (code) => {
        if (settled) return;
        settled = true;
        try { if (!win.isDestroyed()) win.close(); } catch (_) { /* 已关闭 */ }
        resolve(code);
      };
      const parent = this.getMainWindow();
      const win = new BrowserWindow({
        width: 470, height: 560,
        parent: parent || undefined, modal: !!parent,
        show: false, title: '微信登录', autoHideMenuBar: true,
        backgroundColor: '#ffffff',
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
      });
      win.once('ready-to-show', () => win.show());
      win.on('closed', () => finish(null));
      // 微信 302 跳转回调地址 → 拦截取 code，不真正加载后端页面
      const intercept = (event, url) => {
        if (!redirectURI || !url.startsWith(redirectURI)) return;
        event.preventDefault();
        try {
          const parsed = new URL(url);
          finish(parsed.searchParams.get('code') || null);
        } catch (_) { finish(null); }
      };
      win.webContents.on('will-redirect', intercept);
      win.webContents.on('will-navigate', intercept);
      // 兜底：did-navigate 说明 will-redirect 未拦截成功（如 meta 跳转）
      win.webContents.on('did-navigate', (_e, url) => {
        if (!settled && redirectURI && url.startsWith(redirectURI)) {
          try { finish(new URL(url).searchParams.get('code') || null); } catch (_) { finish(null); }
        }
      });
      win.loadURL(qrURL).catch(() => finish(null));
    });
  }

  // MARK: - 会员状态

  /**
   * 当前账号快照（渲染层视角）。
   * force=true 强制回源；离线时 72h 内用缓存（宽限期），超期降级为免费。
   */
  async me(force = false) {
    const token = this.token();
    const base = {
      user: null,
      apiBase: this.apiBase,
      limits: { feeds: FREE_FEED_LIMIT, aiPerDay: FREE_AI_PER_DAY },
      quota: this._quotaView(),
    };
    if (!token) return { ...base, guest: true };

    const cached = this._state.user;
    const age = Date.now() - (this._state.fetchedAt || 0);
    if (!force && cached && age < CACHE_TTL_MS) {
      return { ...base, user: cached, quota: this._quotaView() };
    }
    try {
      const result = await this._request('GET', '/api/me', { token });
      this._state.user = { uid: result.uid, nickname: result.nickname, avatar_url: result.avatar_url, member_until: result.member_until, is_member: result.is_member, plan: result.plan };
      this._state.fetchedAt = Date.now();
      this._writeState();
      return { ...base, user: this._state.user, quota: this._quotaView() };
    } catch (err) {
      if (err.status === 401) {
        // token 过期：静默转为未登录（下次使用会员功能时引导重新扫码）
        await this.logout();
        return { ...base, guest: true };
      }
      // 网络问题：宽限期内沿用缓存
      if (cached && age < GRACE_TTL_MS) {
        return { ...base, user: { ...cached, grace: true }, quota: this._quotaView() };
      }
      return { ...base, guest: true, offline: true };
    }
  }

  /** 同步视图（不发请求）：给订阅源门控等同步路径用。 */
  userNow() {
    const cached = this._state.user;
    if (!cached) return null;
    const age = Date.now() - (this._state.fetchedAt || 0);
    if (age >= GRACE_TTL_MS) return null;   // 缓存超宽限期按未登录处理
    return cached;
  }

  isMember() {
    const user = this.userNow();
    return !!(user && user.is_member);
  }

  /** 订阅源上限门控（AppStore.addFeed / importOPML 调用）。 */
  canAddFeeds(currentCount) {
    if (this.isMember()) return { ok: true, unlimited: true };
    const limit = FREE_FEED_LIMIT;
    if (Number(currentCount) >= limit) {
      const e = new Error(`免费版最多订阅 ${limit} 个源。升级会员后可无限订阅。`);
      e.gate = 'feeds';
      e.limit = limit;
      return { ok: false, error: e, limit };
    }
    return { ok: true, limit };
  }

  /** AI 每日额度：会员无限；免费（含游客）每日 FREE_AI_PER_DAY 次，用完弹升级引导。 */
  consumeAIQuota() {
    if (this.isMember()) return { allowed: true, unlimited: true };
    const quota = this._quotaToday();
    if (quota.used >= FREE_AI_PER_DAY) {
      // 注意：Error 对象过 IPC 会丢内容，消息用 message 字段返回
      return { allowed: false, message: `免费版每日可用 ${FREE_AI_PER_DAY} 次 AI 功能，今日已用完。升级会员解锁不限量。`, used: quota.used, limit: FREE_AI_PER_DAY };
    }
    quota.used += 1;
    this._state.aiQuota = quota;
    this._writeState();
    return { allowed: true, used: quota.used, limit: FREE_AI_PER_DAY };
  }

  _quotaToday() {
    const today = localDateKey();
    if (this._state.aiQuota && this._state.aiQuota.date === today) return { ...this._state.aiQuota };
    return { date: today, used: 0 };
  }

  _quotaView() {
    if (this.isMember()) return { unlimited: true, used: 0, limit: FREE_AI_PER_DAY };
    const q = this._quotaToday();
    return { unlimited: false, used: q.used, limit: FREE_AI_PER_DAY };
  }

  // MARK: - 订单

  async createOrder(plan) {
    const token = this.token();
    if (!token) { const e = new Error('请先登录再购买会员'); e.gate = 'login'; throw e; }
    const order = await this._request('POST', '/api/pay/orders', { token, body: { plan } });
    return { outTradeNo: order.out_trade_no, codeURL: order.code_url, amountFen: order.amount_fen, mock: !!order.mock, expiresAt: order.expires_at };
  }

  async queryOrder(outTradeNo) {
    const token = this.token();
    const r = await this._request('GET', `/api/pay/orders/${encodeURIComponent(outTradeNo)}`, { token });
    if (r.status === 'paid' && !this._paymentConsumed?.has?.(outTradeNo)) {
      // 支付成功：强制刷新会员状态并通知渲染层
      (this._paymentConsumed = this._paymentConsumed || new Set()).add(outTradeNo);
      await this.me(true);
      this.onChange(this._state.user);
    }
    return { status: r.status, paidAt: r.paid_at };
  }

  // MARK: - 本地状态文件

  _statePath() { return path.join(app.getPath('userData'), STATE_FILE); }

  _readState() {
    try {
      const raw = fs.readFileSync(this._statePath(), 'utf8');
      const parsed = JSON.parse(raw);
      return {
        user: parsed.user || null,
        fetchedAt: Number(parsed.fetchedAt) || 0,
        aiQuota: parsed.aiQuota && parsed.aiQuota.date ? parsed.aiQuota : { date: localDateKey(), used: 0 },
      };
    } catch (_) {
      return { user: null, fetchedAt: 0, aiQuota: { date: localDateKey(), used: 0 } };
    }
  }

  _writeState() {
    try {
      // 原子写：先写临时文件再改名，崩溃瞬间不会留下截断的 JSON
      const target = this._statePath();
      const tmp = `${target}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this._state), 'utf8');
      fs.renameSync(tmp, target);
    } catch (_) { /* 写失败不阻塞主流程 */ }
  }

  // MARK: - HTTP（net.fetch 走系统代理）

  async _request(method, apiPath, { token, body } = {}) {
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body != null) headers['Content-Type'] = 'application/json';
    // 归一化：apiBase 以 /api 结尾而路径又以 /api/ 开头时去掉重复前缀，
    // 兼容 apiBase 带或不带 /api 两种写法（云端网关与本地 mock 均为 …/api）
    const base = this.apiBase;
    const path = base.endsWith('/api') && apiPath.startsWith('/api/')
      ? apiPath.slice(4)
      : apiPath;
    let res;
    try {
      res = await net.fetch(base + path, {
        method, headers,
        body: body != null ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      const e = new Error(`无法连接会员服务（${this.apiBase}）`);
      e.status = 0;
      throw e;
    }
    let json = null;
    try { json = await res.json(); } catch (_) { json = null; }
    if (!res.ok || (json && json.ok === false)) {
      const e = new Error((json && json.error) || `请求失败(${res.status})`);
      e.status = res.status;
      throw e;
    }
    return json;
  }
}

function localDateKey() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

module.exports = { AuthService, FREE_FEED_LIMIT, FREE_AI_PER_DAY };
