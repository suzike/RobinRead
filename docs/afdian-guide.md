# 爱发电「卡密自动发货」接入指引

> 目标：让用户在 RobinRead 里点「开通会员」→ 跳到你的爱发电商品页 → 付款后爱发电**自动发激活码** → 用户回客户端输入兑换。
> 全程零资质、零人工发码，爱发电抽成约 6%。

## 一、你只需本人做的一步：注册爱发电

其余（生成激活码、配跳转链接）都由我这边完成。

1. 打开 https://afdian.com ，用**手机号**注册（或微信扫码登录）。
2. 进入「创作者中心」→ 完成**实名认证**（个人：身份证 + 人脸识别，需本人操作）。
3. 绑定**提现方式**（支付宝 / 微信，这是你收钱的地方）。

> ⚠️ 这一步必须你本人（身份证 + 手机验证码 + 人脸），我代替不了。

## 二、创建两个虚拟商品（卡密自动发货）

在创作者中心找「**发电方案** / **商品**」或「**商店**」入口，新建**虚拟商品**（有的版本叫「自动发货商品」）：

**商品 1：月卡会员**
- 名称：`RobinRead 月卡会员`
- 价格：**10 元**
- 发货方式：**卡密 / 自动发货**
- 卡密库存：把 `redeem-codes-monthly.txt` 的内容整批粘贴进去（每行一个码）

**商品 2：终身会员**
- 名称：`RobinRead 终身会员`
- 价格：**88 元**
- 发货方式：**卡密 / 自动发货**
- 卡密库存：把 `redeem-codes-lifetime.txt` 的内容整批粘贴进去

> 卡密库存卖一张少一张，卖完了用下面命令补：
> ```bash
> ADMIN_SECRET=P26AQmTGs91k-eGeXyeydoelRAvSb-6- node scripts/admin-redeem-codes.js gen monthly 50 > redeem-codes-monthly.txt
> ADMIN_SECRET=P26AQmTGs91k-eGeXyeydoelRAvSb-6- node scripts/admin-redeem-codes.js gen lifetime 20 > redeem-codes-lifetime.txt
> ```

## 三、把商品链接发我

建好两个商品后，把**月卡商品页链接**和**终身商品页链接**发给我（爱发电商品页通常形如 `https://afdian.com/item/xxxx`）。

我会把它们配到云函数（`AFDIAN_MONTHLY_URL` / `AFDIAN_LIFETIME_URL`），客户端「立即开通」按钮就会自动跳转到对应商品页——**不需要重新打包客户端**。

## 四、效果

- 用户在 RobinRead 登录 → 会员中心点「立即开通」→ 外部浏览器打开爱发电商品页 → 付款 → 爱发电自动发一个激活码。
- 用户回 RobinRead → 「使用激活码」输入 → 立即开通会员（月卡可叠加、终身永久）。

## 当前已就绪的资产

- 激活码文件：`redeem-codes-monthly.txt`（50 张月卡）、`redeem-codes-lifetime.txt`（20 张终身），已同步到云端 `redeem_codes` 表。
- 客户端「开通会员」跳转逻辑已打包进 2.1.0，等你链接一配即生效。
