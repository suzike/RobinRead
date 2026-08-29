'use strict';
/**
 * NanJuPaper — 账号与会员中心（渲染层）
 *
 * - AccountController：账号状态生命周期（初始化/登录推送/门控判断/会员中心入口）
 * - 会员中心：登录引导 / 会员状态 / 套餐购买 / 额度展示
 * - 支付弹窗：微信 Native 二维码（mock 订单渲染占位码）+ 2s 轮询 + 倒计时
 * - 升级引导：触发免费限制时弹出（对应 entitlement 门控的 UI 侧）
 */
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { alertBox, promptBox } from '../ui-prompt.js';
import qrcode from '../vendor/qrcode.js';

/** 会员中心打开函数（升级引导弹窗回跳用），由 AccountController 注册。 */
let _openCenter = null;
/** 默认控制器（设置面板等外部入口打开会员中心用）。 */
let _defaultController = null;

/** 外部入口（如设置 → 账号分区）打开会员中心。 */
export function openAccountCenter() {
  _defaultController?.openCenter();
}

// MARK: - 控制器

export class AccountController {
  /** @param {{ onUserChanged?: (user: object|null) => void, feedCount?: () => number }} opts */
  constructor(opts = {}) {
    this.user = null;
    this.onUserChanged = opts.onUserChanged || (() => {});
    this._feedCount = opts.feedCount || (() => 0);
    _defaultController = this;
  }

  async init() {
    window.robin.onAccountChanged(({ user }) => this._apply(user));
    try {
      const r = await window.robin.accountMe(false);
      if (r.ok) this._apply(r.data.user);
    } catch (_) { /* 离线按游客处理 */ }
  }

  _apply(user) {
    this.user = user || null;
    try { this.onUserChanged(this.user); } catch (_) { /* UI 回调异常不阻塞 */ }
  }

  isMember() { return !!(this.user && this.user.is_member); }

  /**
   * AI 功能门控：会员直接放行；免费（含游客）扣每日额度，用尽弹升级引导。
   * @returns {Promise<boolean>} 是否放行
   */
  async gateAI() {
    try {
      const me = await window.robin.accountMe(false);
      const user = me.ok ? me.data.user : null;
      if (user && user.is_member) return true;
      const r = await window.robin.accountConsumeAIQuota();
      if (r.ok && r.data && r.data.allowed) return true;
      const info = (r.ok && r.data) || {};
      showUpgradeGate({
        message: info.message || info.error || t('免费版每日可使用 3 次 AI 功能，今日额度已用完。'),
        used: info.used, limit: info.limit,
      });
      return false;
    } catch (_) {
      return true; // 判定服务不可用时不拦截（离线优先保证可用）
    }
  }

  /** 打开会员中心。feedCount: () => number 当前订阅源总数（缺省用构造时注入的提供者）。 */
  async openCenter({ feedCount } = {}) {
    const feedCountFn = feedCount || this._feedCount;
    _openCenter = () => this.openCenter({ feedCount: feedCountFn });
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'modal small acct-modal';
    overlay.appendChild(modal);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    const esc = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); } };
    document.addEventListener('keydown', esc);

    const render = async (force = false) => {
      modal.innerHTML = '';
      const [meR, cfgRaw] = await Promise.all([
        window.robin.accountMe(force).catch(() => null),
        // accountConfig 走 data() 解包：成功时直接就是配置对象，失败/离线为 undefined
        window.robin.accountConfig().catch(() => undefined),
      ]);
      const me = (meR && meR.ok) ? meR.data : { user: null, limits: { feeds: 30, aiPerDay: 3 }, quota: { unlimited: false, used: 0, limit: 3 } };
      const cfg = cfgRaw || { offline: true, wx_login_enabled: false, pay_mock: true, plans: [] };
      if (me.user) this._apply(me.user);
      renderCenterInto(modal, {
        me, cfg,
        feedCount: typeof feedCountFn === 'function' ? (feedCountFn() || 0) : (feedCountFn || 0),
        onClose: () => { overlay.remove(); document.removeEventListener('keydown', esc); },
        onRefresh: () => render(true),
        onLogged: () => render(true),
        controller: this,
      });
    };
    await render(false);
  }
}

// MARK: - 会员中心

function fmtDate(iso) {
  try {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  } catch (_) { return ''; }
}

export function memberStatusLabel(user) {
  if (!user) return t('未登录');
  if (user.member_until === 'lifetime') return t('终身会员');
  if (user.is_member) return `${t('会员')} · ${fmtDate(user.member_until)} ${t('到期')}`;
  return t('免费版');
}

/**
 * 账号密码登录/注册表单（会员中心未登录态与 设置→账号 共用）。
 * @param {HTMLElement} container 挂载容器
 * @param {{ onLogged: () => void }} ctx
 */
export function renderAuthForm(container, { onLogged }) {
  const wrap = document.createElement('div');
  wrap.className = 'acct-auth';
  let mode = 'login';

  const tabs = document.createElement('div');
  tabs.className = 'acct-auth-tabs';
  const loginTab = document.createElement('button');
  loginTab.className = 'acct-auth-tab active';
  loginTab.textContent = t('登录');
  const regTab = document.createElement('button');
  regTab.className = 'acct-auth-tab';
  regTab.textContent = t('注册');
  tabs.append(loginTab, regTab);

  const fields = document.createElement('div');
  fields.className = 'acct-auth-fields';
  const username = document.createElement('input');
  username.className = 'control';
  username.placeholder = t('用户名（3-20 位字母/数字/下划线）');
  const password = document.createElement('input');
  password.className = 'control';
  password.type = 'password';
  password.placeholder = t('密码（6-64 位）');
  const nickname = document.createElement('input');
  nickname.className = 'control';
  nickname.placeholder = t('昵称（可选）');
  nickname.style.display = 'none';
  fields.append(username, password, nickname);

  const error = document.createElement('div');
  error.className = 'acct-auth-error';

  const submit = document.createElement('button');
  submit.className = 'btn accent';
  submit.style.width = '100%';

  const setMode = (m) => {
    mode = m;
    loginTab.classList.toggle('active', m === 'login');
    regTab.classList.toggle('active', m === 'register');
    nickname.style.display = m === 'register' ? '' : 'none';
    submit.textContent = m === 'register' ? t('注册并登录') : t('登录');
    error.textContent = '';
  };
  loginTab.addEventListener('click', () => setMode('login'));
  regTab.addEventListener('click', () => setMode('register'));
  setMode('login');

  const doSubmit = async () => {
    const u = username.value.trim();
    const p = password.value;
    if (!u || !p) { error.textContent = t('请填写用户名和密码'); return; }
    submit.disabled = true;
    error.textContent = '';
    try {
      const r = mode === 'register'
        ? await window.robin.accountRegister(u, p, nickname.value.trim())
        : await window.robin.accountLoginPassword(u, p);
      if (!r.ok) throw new Error(String(r.error || '登录失败'));
      onLogged();
    } catch (err) {
      error.textContent = String(err.error || err.message || err);
      submit.disabled = false;
    }
  };
  submit.addEventListener('click', doSubmit);
  password.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSubmit(); });

  wrap.append(tabs, fields, error, submit);
  container.appendChild(wrap);
}

function renderCenterInto(modal, ctx) {
  const { me, cfg, feedCount } = ctx;
  const user = me.user;

  const main = document.createElement('div');
  main.className = 'modal-main';

  const header = document.createElement('div');
  header.className = 'modal-header';
  header.innerHTML = `<h3>${escapeHTML(t('账号与会员'))}</h3>`;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn icon-only';
  closeBtn.innerHTML = icon('close');
  closeBtn.addEventListener('click', ctx.onClose);
  header.appendChild(closeBtn);
  main.appendChild(header);

  const body = document.createElement('div');
  body.className = 'acct-body';

  // -- 身份区（基础账号信息：头像/昵称只读 + 登录/退出；账号自定义在 设置→账号）--
  if (user) {
    const identity = document.createElement('div');
    identity.className = 'acct-identity';
    const letter = (String(user.nickname || '?').trim()[0] || '?').toUpperCase();
    const avatarHTML = user.avatar_url
      ? `<img class="acct-identity-avatar" src="${attr(user.avatar_url)}" referrerpolicy="no-referrer"/>`
      : `<span class="acct-identity-avatar acct-identity-ph">${escapeHTML(letter)}</span>`;
    identity.innerHTML = `
      ${avatarHTML}
      <div class="acct-identity-info">
        <div class="acct-identity-name"></div>
        <div class="acct-identity-status"></div>
      </div>`;
    identity.querySelector('.acct-identity-name').textContent = user.nickname || t('微信用户');
    identity.querySelector('.acct-identity-status').textContent = memberStatusLabel(user);
    if (user.grace) {
      const grace = document.createElement('div');
      grace.className = 'acct-grace';
      grace.textContent = t('离线状态：会员信息为本地缓存（72 小时内有效）');
      identity.querySelector('.acct-identity-info').appendChild(grace);
    }
    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'btn-text danger';
    logoutBtn.textContent = t('退出登录');
    logoutBtn.addEventListener('click', async () => {
      await window.robin.accountLogout();
      ctx.onLogged();
    });
    identity.appendChild(logoutBtn);
    body.appendChild(identity);
  } else {
    renderAuthForm(body, { onLogged: ctx.onLogged });
  }

  // -- 使用情况 --
  const usage = document.createElement('div');
  usage.className = 'acct-usage';
  const feedLimit = me.limits?.feeds ?? 30;
  const feedsLabel = user?.is_member ? `${feedCount} · ${escapeHTML(t('不限量'))}` : `${feedCount} / ${feedLimit}`;
  const aiLabel = me.quota?.unlimited ? escapeHTML(t('不限量')) : `${me.quota?.used ?? 0} / ${me.quota?.limit ?? 3}`;
  usage.innerHTML = `
    <div class="acct-usage-row"><span>${escapeHTML(t('订阅源'))}</span><b></b></div>
    <div class="acct-usage-row"><span>${escapeHTML(t('AI 功能（今日）'))}</span><b></b></div>`;
  usage.querySelectorAll('.acct-usage-row b')[0].textContent = feedsLabel;
  usage.querySelectorAll('.acct-usage-row b')[1].innerHTML = aiLabel;
  body.appendChild(usage);

  // -- 套餐 --
  const plansTitle = document.createElement('div');
  plansTitle.className = 'acct-section-title';
  plansTitle.textContent = t('升级会员');
  body.appendChild(plansTitle);

  const grid = document.createElement('div');
  grid.className = 'acct-plans';
  const plans = (cfg.plans && cfg.plans.length) ? cfg.plans : [
    { id: 'monthly', title: '月卡会员', price_fen: 1000, days: 30 },
    { id: 'lifetime', title: '终身会员', price_fen: 8800, days: null },
  ];
  for (const plan of plans) {
    const card = document.createElement('div');
    card.className = `acct-plan ${plan.id === 'lifetime' ? 'is-lifetime' : ''}`;
    card.innerHTML = `
      <div class="acct-plan-name"></div>
      <div class="acct-plan-price"><span class="yen">¥</span><span class="num"></span><span class="per"></span></div>
      <div class="acct-plan-desc"></div>
      <button class="btn accent"></button>`;
    card.querySelector('.acct-plan-name').textContent = t(plan.title);
    card.querySelector('.num').textContent = (plan.price_fen / 100).toFixed(plan.price_fen % 100 === 0 ? 0 : 2);
    card.querySelector('.per').textContent = plan.days ? t('/ 30 天') : t('一次买断');
    card.querySelector('.acct-plan-desc').textContent = plan.days
      ? t('全部高级功能，时长可叠加')
      : t('永久解锁全部高级功能');
    const buy = card.querySelector('button');
    buy.textContent = t('立即开通');
    buy.addEventListener('click', async () => {
      if (!user) {
        await uiAlert(t('请先登录'), t('开通会员需要先登录账号。'));
        return;
      }
      // 配置了爱发电商品页 → 跳转购买（付款后爱发电自动发激活码，回客户端兑换）
      const afdianUrl = cfg.afdian && cfg.afdian[plan.id];
      if (afdianUrl) {
        window.robin.openLink(afdianUrl);
        return;
      }
      // 未配置爱发电 → 走 mock 支付（联调）
      buy.disabled = true;
      try {
        const r = await window.robin.payCreateOrder(plan.id);
        if (!r.ok) throw new Error(String(r.error));
        showPayDialog({ plan, order: r.data, onPaid: ctx.onRefresh, onClose: ctx.onRefresh });
      } catch (err) {
        await uiAlert(t('下单失败'), String(err.message || err.error || err));
      } finally {
        buy.disabled = false;
      }
    });
    grid.appendChild(card);
  }
  body.appendChild(grid);

  // -- 激活码兑换（微信支付不可用时的替代开通通道；需登录）--
  if (user) {
    const redeem = document.createElement('div');
    redeem.className = 'acct-redeem';
    redeem.innerHTML = `
      <div class="acct-section-title">${escapeHTML(t('使用激活码'))}</div>
      <div class="acct-redeem-row">
        <input class="control" placeholder="RR-XXXX-XXXX-XXXX"/>
        <button class="btn-text primary"></button>
      </div>`;
    const input = redeem.querySelector('input');
    const redeemBtn = redeem.querySelector('button');
    redeemBtn.textContent = t('兑换');
    const doRedeem = async () => {
      const code = input.value.trim();
      if (!code) { input.focus(); return; }
      redeemBtn.disabled = true;
      try {
        await window.robin.accountRedeem(code);
        ctx.onRefresh();
      } catch (err) {
        await uiAlert(t('兑换失败'), String(err.error || err.message || err));
        redeemBtn.disabled = false;
      }
    };
    redeemBtn.addEventListener('click', doRedeem);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doRedeem(); });
    body.appendChild(redeem);
  }

  // -- 权益对照 --
  const rights = document.createElement('div');
  rights.className = 'acct-rights';
  rights.innerHTML = `<div class="acct-section-title">${escapeHTML(t('会员权益'))}</div>
    <div class="acct-rights-list">
      <div>✓ ${escapeHTML(t('无限订阅源（免费版 30 个）'))}</div>
      <div>✓ ${escapeHTML(t('AI 精读 / 摘要 / 翻译 / 今日简报不限量（免费版每日 3 次）'))}</div>
      <div>✓ ${escapeHTML(t('全文抓取 · 智能过滤 · 进化引擎 · 知识库全部能力'))}</div>
      <div>✓ ${escapeHTML(t('后续新增会员功能自动解锁'))}</div>
    </div>`;
  body.appendChild(rights);

  main.appendChild(body);
  modal.appendChild(main);
}

// MARK: - 支付弹窗

export function showPayDialog({ plan, order, onPaid, onClose }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal small acct-pay';
  overlay.appendChild(modal);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) finish('closed'); });
  document.body.appendChild(overlay);
  const esc = (e) => { if (e.key === 'Escape') finish('closed'); };
  document.addEventListener('keydown', esc);

  let timer = null;
  let done = false;
  const finish = (result) => {
    if (done) return;
    done = true;
    clearInterval(timer);
    document.removeEventListener('keydown', esc);
    overlay.remove();
    if (result === 'paid') onPaid?.();
    else onClose?.();
  };

  modal.innerHTML = `
    <div class="modal-main">
      <div class="modal-header"><h3></h3></div>
      <div class="acct-body acct-pay-body">
        <div class="acct-pay-amount"><span class="yen">¥</span><span class="num"></span></div>
        <div class="acct-pay-qrbox"><canvas></canvas><div class="acct-pay-mocktag" hidden>模拟支付<br/>下单 4 秒后自动成功</div></div>
        <div class="acct-pay-status"></div>
        <div class="acct-pay-countdown"></div>
        <div class="acct-pay-actions"><button class="btn-text"></button></div>
      </div>
    </div>`;
  modal.querySelector('h3').textContent = `${t(plan.title)} · ${t('微信支付')}`;
  modal.querySelector('.acct-pay-amount .num').textContent = (order.amountFen / 100).toFixed(order.amountFen % 100 === 0 ? 0 : 2);
  const statusEl = modal.querySelector('.acct-pay-status');
  const countdownEl = modal.querySelector('.acct-pay-countdown');
  const cancelBtn = modal.querySelector('.acct-pay-actions button');
  cancelBtn.textContent = t('取消支付');
  cancelBtn.addEventListener('click', () => finish('closed'));

  const canvas = modal.querySelector('canvas');
  if (order.mock) {
    // mock 渠道：渲染「模拟支付」占位二维码（内容为订单号，可真实扫描但不会支付）
    modal.querySelector('.acct-pay-mocktag').hidden = false;
    renderQR(canvas, `nanjupaper-mock://${order.outTradeNo}`, 190);
  } else {
    renderQR(canvas, order.codeURL, 190);
  }

  const expiresAt = order.expiresAt ? new Date(order.expiresAt).getTime() : Date.now() + 2 * 3600 * 1000;
  statusEl.textContent = t('请使用微信扫码支付…');
  const tickCountdown = () => {
    const left = Math.max(0, expiresAt - Date.now());
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    countdownEl.textContent = `${t('二维码有效时间')} ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    if (left <= 0) { statusEl.textContent = t('二维码已过期，请重新下单'); finish('closed'); }
  };
  tickCountdown();

  let pollCount = 0;
  timer = setInterval(async () => {
    tickCountdown();
    if (done) return;
    pollCount += 1;
    try {
      const r = await window.robin.payQueryOrder(order.outTradeNo);
      if (r.ok && r.data && r.data.status === 'paid') {
        modal.querySelector('.acct-pay-qrbox').classList.add('is-paid');
        statusEl.textContent = t('支付成功，会员已开通 ✓');
        setTimeout(() => finish('paid'), 900);
      } else if (r.ok && r.data && r.data.status === 'closed') {
        statusEl.textContent = t('订单已关闭，请重新下单');
        setTimeout(() => finish('closed'), 1200);
      }
    } catch (_) { /* 轮询失败继续 */ }
    if (pollCount > 120) finish('closed');
  }, 2000);
}

// MARK: - 升级引导弹窗

export function showUpgradeGate({ title, message, used, limit } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal small acct-gate';
  overlay.appendChild(modal);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  const esc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', esc); };

  modal.innerHTML = `
    <div class="modal-main">
      <div class="modal-header"><h3>${escapeHTML(title || t('升级会员'))}</h3></div>
      <div class="acct-body">
        <div class="acct-gate-msg"></div>
        <div class="acct-rights-list">
          <div>✓ ${escapeHTML(t('无限订阅源（免费版 30 个）'))}</div>
          <div>✓ ${escapeHTML(t('AI 精读 / 摘要 / 翻译 / 今日简报不限量'))}</div>
          <div>✓ ${escapeHTML(t('全文抓取 · 智能过滤 · 知识库全部能力'))}</div>
        </div>
        <div class="acct-gate-price">¥10 <span>/ 30 天</span>　·　¥88 <span>${escapeHTML(t('终身'))}</span></div>
        <div class="acct-gate-actions">
          <button class="btn-text"></button>
          <button class="btn accent"></button>
        </div>
      </div>
    </div>`;
  const msg = modal.querySelector('.acct-gate-msg');
  msg.textContent = message || t('当前功能需要会员。');
  if (used != null && limit != null) {
    const extra = document.createElement('div');
    extra.className = 'acct-gate-quota';
    extra.textContent = `${t('今日已用')} ${used}/${limit} ${t('次')}`;
    msg.appendChild(extra);
  }
  const later = modal.querySelectorAll('.acct-gate-actions button')[0];
  later.textContent = t('以后再说');
  later.addEventListener('click', close);
  const upgrade = modal.querySelectorAll('.acct-gate-actions button')[1];
  upgrade.textContent = t('查看会员方案');
  upgrade.addEventListener('click', () => { close(); _openCenter?.(); });
}

// MARK: - 工具

/** 把文本渲染成二维码 canvas（vendor 库：单文件 qrcode-generator，MIT）。 */
export function renderQR(canvas, text, size) {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(String(text));
    qr.make();
    const count = qr.getModuleCount();
    const quiet = 2;
    const scale = Math.max(2, Math.floor(size / (count + quiet * 2)));
    const dim = (count + quiet * 2) * scale;
    canvas.width = dim;
    canvas.height = dim;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = '#141414';
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
      }
    }
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
  } catch (err) {
    canvas.replaceWith(Object.assign(document.createElement('div'), { textContent: t('二维码渲染失败') }));
  }
}

/** frameless 窗口禁用原生 alert：统一走 ui-prompt。 */
function uiAlert(title, message) {
  return alertBox(title, String(message));
}

function escapeHTML(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function attr(s) { return escapeHTML(s); }
