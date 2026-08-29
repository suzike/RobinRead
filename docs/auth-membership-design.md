# NanJuPaper 账号登录 + 会员订阅 设计方案

> 状态：**Phase 1–4 已实现并通过端到端验证（2026-08-19，mock 模式 21/21 断言）**。
> 实现差异：后端为单云函数 `cloudfunctions/njpaper-api`（文档数据库三集合替代 SQL 表）；本地联调服务器 `server/mock-server.js`；探针 `scripts/probe-account.js`。部署步骤见 `docs/deploy-backend.md`。
> 待办：微信凭据配置（Phase 0 资质）、CloudBase 部署、客户端 API 地址切换。
> 范围：微信扫码登录 → 微信支付（Native 扫码）→ 会员权益门控
> 定价：月卡 10 元 / 30 天（叠加制，手动续费），终身会员 88 元

---

## 0. 一句话架构

**Electron 客户端 ←(自家 JWT)→ 自建后端（CloudBase 云函数）←(官方 API)→ 微信开放平台 + 微信支付**

三条铁律：

1. `appsecret`、商户号私钥、APIv3 密钥**只存在后端**，客户端一个密钥都不碰（Electron 包可被解包，放客户端等于公开）。
2. **金额由服务端定价表决定**，客户端下单只传 `plan`，不传价格。
3. 权益（会员到期时间）**以服务端为准**，客户端缓存 + 过期回源刷新。

---

## 1. 资质前提（关键路径，最先启动）

| 事项 | 要求 | 周期 | 费用 |
|------|------|------|------|
| 微信开放平台「网站应用」 | 企业或个体工商户主体 + 认证 | 审核约 7 个工作日 | 认证 300 元/年 |
| 微信支付商户号 | 营业执照（企业/个体户均可），开通「Native 支付」 | 约 1–5 个工作日 | 无开通费，费率约 0.6% |
| 支付回调地址 | 公网 HTTPS | — | CloudBase 默认域名即可满足 |

**⚠️ 若当前是个人主体、无法办资质**：微信登录和微信支付均走不了官方通道。替代路线见[附录 A](#附录-a个人主体替代路线)，且本设计的「订单/权益层」与支付渠道解耦，未来拿到资质可无缝切回微信通道。

**月卡没有自动续费**：微信周期代扣（委托代扣）不对小商户开放，所以月卡 = 每次付款延长 30 天，可叠加。UI 上要写清楚「到期时间」，到期前 3 天在应用内提醒。

---

## 2. 总体架构

```
┌─────────────────────┐        ┌──────────────────────┐       ┌─────────────────┐
│ NanJuPaper (Electron)│  HTTPS │ 后端（CloudBase）      │ HTTPS │ 微信开放平台      │
│                     │ ──────►│ ├ auth 云函数          │ ────► │ (snsapi_login)  │
│ · 登录子窗口(扫码)    │  JWT   │ ├ pay 云函数           │       ├ 微信支付 v3      │
│ · 支付弹窗(二维码)    │        │ │  (Native下单/回调)    │ ◄───► │  Native/回调/查单 │
│ · entitlement 门控   │        │ ├ notify 云函数(回调)   │       └─────────────────┘
│ · token: safeStorage │        │ └ 数据库(users/orders) │
└─────────────────────┘        └──────────────────────┘
```

后端选 **CloudBase** 的理由：

- 云函数默认域名自带 HTTPS，**支付回调可直接用，不需要备案域名**（自建 VPS 在国内必须备案 + 证书，这是最大的运维负担）。
- 云函数 + 云数据库免运维，量级（万级用户）绰绰有余。
- 本开发环境已接入 CloudBase 工具链（MCP + skills），创建/部署零阻力。

API 层做成渠道无关的纯 HTTP 契约（见 §5），将来迁移到自建 Node 服务只需换部署，客户端零改动。

---

## 3. 数据模型（3 张表 + 1 张定价表）

```sql
-- 用户（微信身份 + 会员状态）
CREATE TABLE users (
  id           TEXT PRIMARY KEY,            -- 后端生成的 uid（uuid）
  unionid      TEXT UNIQUE NOT NULL,        -- 微信 unionid（跨应用唯一身份）
  openid       TEXT NOT NULL,
  nickname     TEXT,
  avatar_url   TEXT,
  member_until TIMESTAMPTZ,                 -- NULL = 终身会员；> now = 有效
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);
-- is_member 的判定：member_until IS NULL（终身）OR member_until > now()

-- 订单（渠道无关：现在记微信支付，将来可记兑换码/其他渠道）
CREATE TABLE orders (
  out_trade_no  TEXT PRIMARY KEY,           -- 商户订单号 NP+时间戳+随机
  user_id       TEXT NOT NULL,
  plan          TEXT NOT NULL,              -- 'monthly' | 'lifetime'
  amount_fen    INTEGER NOT NULL,           -- 服务端定价写入，分
  status        TEXT NOT NULL DEFAULT 'created',  -- created|paid|closed|refunded
  channel       TEXT NOT NULL DEFAULT 'wxpay_native',
  transaction_id TEXT,                      -- 微信支付订单号（回调后回填）
  paid_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 权益变更流水（审计 + 对账，出纠纷时能还原全过程）
CREATE TABLE membership_events (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  out_trade_no        TEXT,                 -- 关联订单（退款也记这里）
  type                TEXT NOT NULL,        -- grant|extend|revoke
  member_until_before TIMESTAMPTZ,
  member_until_after  TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now()
);
```

定价表（服务端硬编码在 pay 云函数里，改价 = 改代码重新部署，不进数据库）：

```js
const PLANS = {
  monthly:  { title: '月卡会员',  price_fen: 1000, days: 30 },
  lifetime: { title: '终身会员',  price_fen: 8800, days: null },  // null = 永久
};
```

**会员叠加规则**（支付成功回调里执行，务必幂等）：

```
monthly:  member_until = greatest(now(), 当前的 member_until) + 30 天
lifetime: member_until = NULL（永久）
```

---

## 4. 微信扫码登录流程

桌面端用开放平台「网站应用」的 `snsapi_login` 扫码授权。**不用 iframe**（微信页面有 X-Frame-Options，会被挡），用独立子 `BrowserWindow`：

```
客户端                                后端                          微信
  │  1. 生成 state(随机数) 暂存          │                             │
  │  2. 打开登录子窗口，加载 qrconnect    │                             │
  │     https://open.weixin.qq.com/connect/qrconnect                 │
  │       ?appid=…&redirect_uri=<后端域名>/auth/callback              │
  │       &response_type=code&scope=snsapi_login&state=…             │
  │  3. 用户微信扫码确认 ─────────────────────────────────────────►  │
  │  4. 微信 302 跳转 redirect_uri?code=…&state=…                    │
  │  5. 子窗口 will-redirect 拦截：域名匹配即取 code，关闭子窗口        │
  │     （后端页面实际不会被加载，只需域名配置进「授权回调域名」）        │
  │  6. POST /api/auth/wechat {code, state} ──►                      │
  │                                       │ 7. sns/oauth2/access_token
  │                                       │    换 openid/unionid ───►│
  │                                       │ 8. upsert users，签发 JWT │
  │  9. 存 token: CredentialStore（DPAPI）│                             │
  │ 10. 刷新 UI（头像/昵称/会员状态）      │                             │
```

要点：

- **state** 每次登录随机生成并暂存内存，回调比对，防 CSRF。
- **unionid** 做用户唯一键（将来若加小程序/App 端，身份能打通）。
- JWT 有效期 30 天，HS256，secret 放云函数环境变量。过期 → 客户端检测 401 → 静默弹出扫码窗重新登录（扫码 2 秒的事，不做 refresh token，少一半复杂度）。
- 回调域名配置技巧：开放平台要求「授权回调域名」根目录放校验文件。用 CloudBase **静态托管**默认域名挂一个 `WxOpenVerify.txt` 即可通过校验；redirect_uri 填该域名下任意路径（反正 Electron 会拦截，页面无需真实存在）。
- 「不登录也能用」：登录是可选的，未登录按免费版处理（本地游客态），保证现有用户体验不倒退。

---

## 5. 后端 API 契约（全部 6 个）

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | `/api/auth/wechat` | 无 | `{code, state}` → `{token, user}` |
| GET  | `/api/me` | Bearer JWT | → `{uid, nickname, avatar, is_member, plan, member_until}` |
| GET  | `/api/plans` | 无 | → 定价表（客户端展示用，真实价格仍以服务端为准） |
| POST | `/api/pay/orders` | Bearer JWT | `{plan}` → `{out_trade_no, code_url, amount_fen, expires_at}` |
| GET  | `/api/pay/orders/:out_trade_no` | Bearer JWT | → `{status, paid_at}`（客户端轮询用，校验订单属于本人） |
| POST | `/api/pay/notify` | 微信验签 | 微信支付回调（见 §6） |

---

## 6. 微信支付 Native（扫码）流程

桌面端唯一合适的支付方式是 **Native 扫码**（微信返回 `code_url`，客户端渲染成二维码，用户手机扫）：

```
客户端                          后端                              微信支付v3
  │ 1. POST /api/pay/orders      │                                  │
  │    {plan:'lifetime'} ───────►│ 2. 查 PLANS 定价(8800分)           │
  │                              │ 3. POST /v3/pay/transactions/native│
  │                              │    (amount 由服务端算) ──────────►│
  │ 4. 返回 code_url ────────────│ ◄── code_url ────────────────────│
  │ 5. 渲染二维码（本地生成，qrcode 库）                                │
  │ 6. 每 2s 轮询订单状态 ───────►│                                  │
  │                              │   【异步】支付成功，微信回调：        │
  │                              │ ◄─ POST /api/pay/notify ─────────│
  │                              │ 7. 验签(平台证书) → AES-GCM 解密    │
  │                              │ 8. 幂等检查(status=created才处理)   │
  │                              │ 9. 查单核对金额 → 订单置 paid       │
  │                              │ 10. 更新 member_until + 记流水     │
  │                              │ 11. 应答 200（失败微信会重试）       │
  │ 12. 轮询到 paid → 刷新会员状态 │                                  │
```

必须处理的边界：

- **验签 + 解密**：用微信支付平台证书验 Wechatpay-Signature，再用 APIv3 密钥 AES-256-GCM 解密 `resource`。用官方 `wechatpay-node-v3` 库，不要手写。
- **幂等**：微信会重试回调。以 `out_trade_no` 为主键 + 状态机（`created → paid` 单向），重复回调直接应答 200。
- **金额核对**：回调解密出的 `amount.total` 必须等于订单的 `amount_fen`，不符则告警不发货。
- **掉单兜底**：定时触发器每 5 分钟扫 `created` 超 10 分钟的订单，调 `GET /v3/pay/transactions/out-trade-no/{no}` 主动查单，paid 则走同一套开通逻辑（用户扫码了但回调丢失的场景）。
- **过期关单**：二维码 2 小时有效；超时订单调关单接口置 `closed`，客户端倒计时结束提示重新生成。
- **退款**（可后置到 Phase 5）：`POST /v3/refund/domestic/refunds` + 回调 → 订单置 `refunded` + 月卡回退时长/终身份回收 + 记 `membership_events(type=revoke)`。

---

## 7. 客户端设计（映射到现有代码）

### 7.1 主进程

| 文件 | 改动 |
|------|------|
| `src/main/Account/CredentialStore.js` | 加 `authToken()` / `setAuthToken()` 两个方法（复用现有 DPAPI 落盘，约 10 行） |
| `src/main/Account/AuthService.js` **(新)** | ① `login()`：创建 480×560 子窗口加载 qrconnect，`will-redirect` 拦截取 code，调后端换 JWT；② `me()`：带 token 请求 `/api/me`，结果缓存到 userData JSON（含拉取时间）；③ `logout()`；④ HTTP 用 Electron `net` 模块（走系统代理） |
| `src/main/ipc.js` | 注册通道：`auth:login` / `auth:logout` / `auth:me`、`pay:createOrder` / `pay:queryOrder`，遵循现有 invoke 风格 |
| `src/main/preload.js` | 暴露 `window.nanju.auth.*`、`window.nanju.pay.*` |

### 7.2 渲染进程

| 组件 | 说明 |
|------|------|
| 侧栏底部 **账号按钮** | 未登录：微信图标 +「微信登录」；已登录：头像 + 昵称，会员加金边/皇冠 |
| **会员中心弹窗** | 当前状态（免费/月卡至 x 月 x 日/终身）、两张套餐卡片、会员权益对比表 |
| **支付弹窗** | 二维码（本地渲染）+ 金额 + 2h 倒计时 + 2s 轮询；成功 → 打勾动画 → 刷新状态 |
| **升级提示（Gate 弹窗）** | 触发免费限制时弹出，列出权益，一键去会员中心 |

⚠️ 两个项目已知坑（来自过往经验）：

- frameless 窗口下原生 `alert/confirm` 静默失败，弹窗全部走现有 `ui-prompt.js` / `dialogs.js` 体系。
- 项目目前**零 npm 运行时依赖**（package.json 无 dependencies），二维码生成建议 vendor 一个单文件库（如 `qrcode-generator`，~10KB）进 `src/shared/`，保持打包方式不变。

### 7.3 门控层 `entitlement.js`

单点判断，所有受限入口都问它，不许散落 if：

```js
// src/renderer/entitlement.js（示意）
const FREE_LIMITS = { feeds: 30, aiPerDay: 3 };
isMember()            // 来自缓存的 /api/me
canAddFeed(current)   // isMember || current < 30
canUseAI(usedToday)   // isMember || usedToday < 3
```

**门控点**（对应现有代码）：

| 功能 | 位置 | 免费版 | 会员 |
|------|------|--------|------|
| 订阅/阅读 | FeedService / 三栏 UI | ≤30 个源，无限阅读 | 无限 |
| AI 精读 | LLMService 调用前 | 3 次/天 | 无限 |
| 全文抓取 | ArticleExtractor | ✕ | ✓ |
| 智能过滤/演化/知识库 | EvolutionEngine 等 | ✕ | ✓ |
| OPML 导入导出 | OPMLService | ✓（用户数据不绑架，口碑底线） | ✓ |

> 边界默认按「温和方案」，具体数值上线前可再调，只改 `FREE_LIMITS` 一处。

### 7.4 诚实的门控强度说明

当前 AI 精读在**客户端直连用户自己的 API Key**，本地门控理论上可被破解（改本地文件）。对策分两步：

1. **v1（本方案）**：本地门控 + 服务端只管身份和会员状态。对绝大多数用户足够，RSS 阅读器不是破解重灾区。
2. **v2（可选）**：AI 请求走后端代理（会员每日配额制），后端真正扣配额，这才是硬门控。架构已预留：`/api/me` 返回配额字段即可平滑升级。

### 7.5 会员状态刷新策略

- 启动时、支付成功后、每天首次启动：拉 `/api/me` 刷缓存。
- 断网：用 72h 内的缓存（宽限期），超 72h 仍连不上服务端 → 降回免费并提示。

---

## 8. 安全清单

- [ ] appsecret / 商户私钥 / APIv3 key / JWT secret 只在云函数环境变量，日志脱敏（openid 只记哈希）
- [ ] 金额一律服务端计算；回调金额与订单金额核对
- [ ] 回调验签 + 解密 + 幂等状态机 + 微信重试应答 200
- [ ] 登录 state 防 CSRF；JWT 30 天过期
- [ ] 客户端 token 走 safeStorage（DPAPI），绝不 localStorage
- [ ] 轮询接口校验订单归属（防越权查别人订单）
- [ ] 下单接口限频（同用户 5 次/分钟，防刷单）

---

## 9. 实施里程碑

| 阶段 | 内容 | 预估 |
|------|------|------|
| **Phase 0** | 资质申请（开放平台认证 + 商户号），与开发并行 | 日历 1–2 周（审核） |
| **Phase 1** | CloudBase 环境 + 3 张表 + auth 云函数骨架 + JWT 签发（先用假 code 联调） | 1 天 |
| **Phase 2** | 微信登录端到端：qrconnect 子窗口 + code 换 JWT + 客户端账号 UI | 1–2 天 |
| **Phase 3** | pay 云函数：Native 下单 + 回调验签/幂等/开通 + 掉单查单定时器；客户端支付弹窗 + 轮询 | 2–3 天 |
| **Phase 4** | entitlement 门控全部落点 + 会员中心 + 升级弹窗 + i18n 文案 | 2 天 |
| **Phase 5** | 退款流程、订单后台查询小工具、数据统计（日活/转化） | 1 天（可后置） |

**联调技巧**：Phase 3 之前微信商户号若还在审核，pay 云函数加一个 `MOCK_PAY=1` 环境变量开关，跳过微信直接置 paid，先把客户端全流程跑通；商户号下来后关掉开关接真单。

---

## 10. 现实提醒

- 微信支付费率约 0.6%（10 元实收约 9.94）。
- 终身 88 元 ≈ 8.8 个月卡，定价合理，但要在购买页标明「一次买断」。
- 开放平台审核会看应用截图/官网，桌面应用准备下载页 + 截图即可。
- 建议保留「未登录游客模式」，登录只在使用会员功能/支付时强引导，降低使用门槛。

---

## 附录 A：个人主体替代路线

无资质时，整体架构不变，只换「登录渠道」和「支付渠道」两层：

- **登录**：邮箱验证码（CloudBase 自带 auth，零资质零成本）或 GitHub OAuth。
- **收款**（三选一）：
  1. **兑换码模式（推荐）**：爱发电/面包多上架月卡、终身卡（它们支持虚拟商品+自动发货），付款后发兑换码；客户端「兑换会员」输码 → 后端核销并走**同一套**开通逻辑。用户也可以人工卖码。
  2. 爱发电 webhook 直连：付款事件直接回调后端开通（体验最顺，但依赖第三方稳定性）。
  3. 纯人工（起步最简）：收款后手动在后端给用户开会员。
- 数据模型里 `orders.channel` 已预留，微信 Native 将来只是多一个 channel，订单/权益层零改动。

---

## 待确认事项

1. **主体资质**：有/无企业或个体工商户？决定走主方案还是附录 A。
2. **免费版限额**：30 源 + AI 3 次/天是否合适？
3. 后端区域选择：CloudBase 上海/广州均可，无差异。
