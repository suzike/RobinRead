# 更新日志 Changelog

版本以 GitHub Release 标签管理，**与应用（客户端）版本号保持一致**。格式参考 [Keep a Changelog](https://keepachangelog.com/)。

---

## v2.2.0 — 开源基线（2026-08-29）

仓库首个 Release，作为后续版本管理的基线；与客户端构建 v2.2.0 同版本号。发布页附 `RobinRead-2.2.0-setup.exe` / `RobinRead-2.2.0-portable.exe` 及 SHA-256 校验值。

相对 v2.1.0 的增量：官网 `update.json` 更新源接入（应用内检查更新）、会员 / 激活码体系上线（免费 30 源 · 每日 3 次 AI；月卡 / 终身）。

### 阅读
- 纸感三栏布局（订阅 / 列表 / 阅读），衬线排版、纸纹噪点，明暗双套主题
- 章节导航轨道（TOC Rail）、浮动滚动条、空格翻篇、禅模式
- 阅读位置记忆（切换文章后回到原位置）
- Mozilla Readability 通用正文提取 + HTML 白名单消毒，烂排版一键重排
- 图片加载占位与失败兜底；微信文章图片直连源站（绕过代理，注入 Referer 防盗链）
- 聚合器页面内容治理：剥离导航残留与元信息尾巴，Hacker News 源转为友好卡片

### AI
- 流式全文摘要（折叠卡片）
- 逐句对照翻译（原文/译文并排）
- 划词解释、翻译、多轮追问
- 今日 AI 简报（按主题分组 + 值得深读推荐）
- AIHOT 热点榜 / AI 日报 / 精选 / 大模型综合榜；刷新时后台预抓取，打开秒开
- 模型接入：DeepSeek / OpenAI 兼容 API / 可信局域网 HTTP 服务

### 批注与知识
- 五色高亮（黄/绿/蓝/粉/紫）、段落便签、批注总览面板（可折叠、可回锚）
- `H` 键快速高亮
- 知识中心：标签云、看板、复习、收藏集、热力图、导出
- 阅读进化统计

### 订阅
- 本地账户 + FreshRSS（Google Reader API）多账户，未读/星标双向同步、离线变更队列
- 订阅商店：190+ 人工核验精选源、12 分类、编辑精选一键订阅
- OPML 导入导出、ETag 条件刷新
- 订阅去重与数据自修复（链接实体解码规范化、缓存自愈）

### 账号与会员
- 用户名密码登录（JWT，30 天），激活码兑换会员（月卡 / 终身，后端验证）
- 凭据 DPAPI 加密存储；AI API Key 仅存本机

### 工程
- Electron 37 + `node:sqlite` 本地优先存储，三级遗留数据迁移（目录 / 偏好 / LocalStorage）
- 中英双语界面；OKLCH 主题引擎 + 主题设计器（传统色、色觉模拟、WCAG 对比度、令牌导入导出）
- 应用内更新检查（官网 `update.json` 更新源）
- 测试脚本：`scripts/selftest.js`、`scripts/uitest.js`、`scripts/verify-realrun.js` 及各专项验证脚本

---

## v2.1.0（2026-08-19）

- 引入 Mozilla Readability 通用正文提取（替代逐源特判），可绕过反爬壳页
- 修复微信文章链接实体解码导致的跳转失败、AIHOT 聚合页内容缺失、中文订阅重复入库
- 微信图片绕过 img-proxy 直连源站，加载速度大幅提升
- 阅读体验优化：图片加载占位 / 失败兜底、阅读位置记忆、字体栈调整

## v2.0.0（2026-08-19）

- 全面品牌重塑：PaperRss → NanJuPaper（南橘）→ **RobinRead（知更）**
- 三级数据迁移：数据目录 / 偏好键 / LocalStorage 自动升级，不覆盖新数据
- 批注系统（五色高亮 / 段落便签 / 批注面板）、阅读与研究面板折叠

## v1.x — 更早

- 前身 [PaperRss](https://github.com/ohmyangboy/PaperRss)（macOS / Swift，GPL-3.0）与 NanJuPaper 南橘（Windows / Electron 初版）
