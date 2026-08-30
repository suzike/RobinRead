# 后端部署手册（CloudBase · njpaper-api）— 已部署版

> **当前线上状态（2026-08-19）**：已部署并通过 25 项端到端断言。
> - 环境：`ronbinread-d9gmsqi2vc0a18f04`（上海 · 个人版 baas_personal · PostgreSQL 模式）
> - 线上地址：`https://ronbinread-d9gmsqi2vc0a18f04.service.tcloudbase.com/api`（客户端 `AuthService.DEFAULT_API_BASE` 已指向此处）
> - 数据层：**CloudBase PG**（本环境无文档数据库），四张表 `users` / `orders` / `membership_events` / `redeem_codes`，
>   通过 PG HTTP API（PostgREST 风格，Bearer API Key=service_role）访问；RLS 开启+零策略+REVOKE，
>   仅服务端可读写
> - 云函数：`njpaper-api`（零 npm 依赖；60s 超时）；定时器 `reconcile-timer` 每 5 分钟掉单补偿
> - 服务端凭据：API Key `njpaper-api-server`（keyId `Q_zABdqWTZGVQjONI_xRog`，service_role，永久）已注入函数环境变量
> - 表结构迁移：`cloudfunctions/njpaper-api/migrations/20260819093000_init_account_tables.sql`（已应用，版本 20260819093000）

## API 一览

```
GET  /api/config             公共配置（套餐/回调地址）
POST /api/auth/register      账号密码注册 {username, password, nickname?}（用户名 3-20 字母数字下划线；密码 6-64）
POST /api/auth/login         账号密码登录 {username, password}
POST /api/auth/wechat        微信扫码登录（可选；需 WX_APPID/WX_SECRET）
POST /api/auth/dev-login     开发登录（联调兜底，无 UI 入口；需环境变量 DEV_LOGIN_ENABLED=1，默认 404 关闭）
GET  /api/me                 用户+会员状态（Bearer JWT）
POST /api/profile            资料自定义 {nickname, avatar_url}（昵称≤24字；头像 http(s) 链接或 data:image base64 ≤180KB）
POST /api/pay/orders         下单（真实 Native 下单需 WXPAY_* 5 项；无 WXPAY 且 PAY_MOCK_ENABLED=1 时才走 mock 渠道，
                             否则 503「支付渠道暂未开通，请使用激活码兑换会员」）
GET  /api/pay/orders/:no     查询订单（轮询；mock 下单 4 秒后自动支付成功）
POST /api/pay/notify         微信支付回调（验签+解密+幂等开通）
POST /api/redeem            兑换激活码 {code}（Bearer JWT；幂等 unused→redeemed，开通会员；uid 5 次/分钟 + IP 10 次/分钟限流）
POST /api/admin/generate-codes  批量生成激活码（`x-admin-secret` 头 = ADMIN_SECRET；{plan, count≤200}；10 次/分钟限流）
```

## 安全开关与环境变量（2026-08-30 加固）

| 变量 | 默认 | 说明 |
|------|------|------|
| `DEV_LOGIN_ENABLED` | 未设置（关闭） | dev-login 双门禁之一（另一门禁：微信未配置）。**生产环境严禁设置**，否则任何人可登入共享 dev 账号 |
| `PAY_MOCK_ENABLED` | 未设置（关闭） | mock 支付通道开关。mock 模式下单 4 秒即自动「支付成功」=免费开会员，**线上保持关闭**；本地联调走 `server/mock-server.js`（它自己实现了 mock，与云函数无关） |
| `JWT_SECRET` / `TCB_ENV_ID` / `TCB_API_KEY` / `ADMIN_SECRET` | 必备 | 见上 |

限流（实例内存级滑动窗口）：`/auth/login` IP 10/min + 用户名 20/min；`/auth/register` IP 5/min；`/auth/wechat`、`/auth/dev-login` IP 10/min；`/redeem` uid 5/min + IP 10/min；admin IP 10/min；下单 uid 5/min。IP 取自 `X-Original-Forwarded-For`（CloudBase 网关推荐头）→ `X-Real-IP` → `X-Forwarded-For` 末段；取不到时**跳过 IP 键**（仅保留用户名/uid 键），避免所有请求挤进同一桶互相锁死。上线前建议临时记录一次 `event.headers` 实证网关 IP 头形态。

## 激活码兑换（微信支付办不下来时的收费通道）

登录从微信扫码改为**账号密码**（`/auth/register` + `/auth/login`，密码 scrypt 加盐哈希存储）；
收款走**激活码**：后台批量生成 `RR-XXXX-XXXX-XXXX` 码，用户付费后输入兑换开通会员。

```bash
# 生成 10 张月卡码
curl -X POST "https://ronbinread-d9gmsqi2vc0a18f04.service.tcloudbase.com/api/admin/generate-codes" \
  -H "Content-Type: application/json" -H "x-admin-secret: $ADMIN_SECRET" \
  -d '{"plan":"monthly","count":10}'
# plan: monthly（+30 天，可叠加）| lifetime（终身）
```

`ADMIN_SECRET` 已注入云函数环境变量（`updateFunctionConfig` 配的，值见记忆 project-auth-membership）。
激活码在 `redeem_codes` 表，状态机 `unused → redeemed`（条件 PATCH 保证幂等，并发只一个成功）。

**管理 CLI**（生成 + 对账，封装了上面的 curl，推荐用这个）：

```bash
ADMIN_SECRET=<密钥> node scripts/admin-redeem-codes.js gen monthly 10     # 生成 10 张月卡码
ADMIN_SECRET=<密钥> node scripts/admin-redeem-codes.js gen lifetime 5     # 生成 5 张终身码
ADMIN_SECRET=<密钥> node scripts/admin-redeem-codes.js list               # 列表 + 统计（unused/redeemed/disabled）
# 本地联调加 API_BASE=http://127.0.0.1:3777/api 前缀
```

对应接口：`GET /api/admin/redeem-codes`（`x-admin-secret` 头，返回 `{codes, stats}`）。

## 切换到真实微信登录/支付（拿到资质后）

云函数环境变量补齐（管理端或 `updateFunctionConfig`）：

| 变量 | 说明 |
|------|------|
| `WX_APPID` + `WX_SECRET` | 开放平台「网站应用」凭据 → 启用扫码登录（dev-login 自动关闭） |
| `WXPAY_MCHID` / `WXPAY_SERIAL_NO` / `WXPAY_APIV3_KEY` / `WXPAY_PRIVATE_KEY` / `WXPAY_PUBLIC_KEY` | 商户号五件套（后两个为 PEM 内容，换行转 `\n`）→ 启用 Native 真实支付 |

⚠️ 启用真实支付前需在 `cloudfunctions/njpaper-api/package.json` 加回 `wechatpay-node-v3` 依赖再部署。
开放平台「授权回调域名」填 `ronbinread-d9gmsqi2vc0a18f04.service.tcloudbase.com`（如需校验文件，
用静态托管 `ronbinread-….tcloudbaseapp.com` 挂根路径即可；客户端在跳转前拦截 code，回调页仅兜底）。

## 本地联调

```bash
node server/mock-server.js                              # 本地 mock（127.0.0.1:3777）
$env:NANJU_API_BASE="http://127.0.0.1:3777"; npx electron .   # PowerShell 临时切本地
# Git Bash: NANJU_API_BASE=http://127.0.0.1:3777 npx electron .
npx electron scripts/probe-account.js                   # 25 项断言（默认连 DEFAULT_API_BASE=云端）
NANJU_API_BASE=http://127.0.0.1:3777 npx electron scripts/probe-account.js   # 跑本地 mock
```

注意：dev-login 固定使用 unionid `dev-user`，云端联调重复测试后该用户会带会员身份——
重置用 PG：`DELETE FROM membership_events/orders/users WHERE …unionid='dev-user'`（三条按外键顺序）。

## 运维

- 改价：改函数顶部 `PLANS` → `updateFunctionCode` 重新部署（客户端价格来自 /api/config 自动同步）
- 对账：`membership_events` 全量流水；`queryPgDatabase(action="sql")` 即席查询
- 退款：v1 未做接口，PG 手工置 `orders.status='refunded'` 并回退 `users.member_until`（记流水）

## CLI 重新部署（2026-08-30 实测踩通的路径）

登录凭据在 `~/.config/.cloudbase/auth.json`（CLI 登录一次即可），CLI 用 `npx -y -p @cloudbase/cli tcb`（v3.8.1）。

```bash
# 核对现状（环境变量在 detail 输出里，改动前先备份）
npx -y -p @cloudbase/cli tcb fn detail njpaper-api -e ronbinread-d9gmsqi2vc0a18f04 --json

# 代码更新：⚠️ `fn code update` 的 COS 上传在本机稳定 60s 超时（CLI bug），
# zip 模式报「不能大于 1.5MB」——都不可用。走 fn deploy + cloudbaserc.json --force：
# 仓库根建 cloudbaserc.json（functionRoot=./cloudfunctions，functions[0] 逐字复刻
# detail 里的 runtime/timeout/memorySize/handler/envVariables/triggers），然后：
npx -y -p @cloudbase/cli tcb fn deploy njpaper-api --force
# 部署完立即删除 cloudbaserc.json（含密钥，严禁提交）
```

部署后验证：`/api/config` 应返回新字段口径；`dev-login` 期望 404；登录连打 11 次期望出现 429；
突发请求下偶发 500 是 PG 冷启动超时（rdb 12s），单发即恢复，属瞬态。
