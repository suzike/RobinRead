# RobinRead（知更）全面评估与对标报告

> 生成日期：2026-08-30 ｜ 方式：6 个并行子代理（竞品调研 / 上游仓库对比 / 主进程审查 / 渲染层审查 / 功能与阅读体验盘点 / 性能专项）
> 本报告只做评估与规划，不含任何代码改动。所有代码结论均有 文件:行号 证据。

---

## 0. 结论速览

- **总评**：RobinRead 的「纸感深读 + 批注 + BYO-key AI」定位在桌面 RSS 品类中几乎没有同款竞品，批注系统（5 色高亮 + 锚定批注 + 复习算法）在桌面 RSS 里独一无二，OKLCH 主题引擎超过上游原版；**主要差距不在视觉，而在功能纵深（搜索/规则/音频/导出/同步）与工程性能（主进程重活阻塞、状态推送风暴、无 FTS）**。另外存在约 35 个真实 bug，其中 10 个属「功能损坏或数据错误」级。
- **三张清单**：待修 Bug 35 个（P0×10 / P1×11 / P2×14）｜功能增强 25 项（A 高价值低成本×8 / B 体验增强×10 / C 战略差异化×7）｜性能优化 12 项（P0×3 / P1×5 / P2×4）。
- **对标格局判断**：视觉与排版对标 Feedbin / Instapaper / Unread（安静纸感路线）是对的，不要走 Folo 的炫酷浏览路线；性能对标 Miniflux / NetNewsWire；阅读体验对标 Readwise Reader（高亮生态 + 导出闭环 + TTS）。
- **上游 PaperRss** 已从 v1.3.0-beta.1（我们 fork 点）更新 8 个版本到 v1.3.2-beta.1，主线是「Reader Engine 重构」，有 11 项可借鉴，其中 4 个是我们已继承、上游已修的 bug。

---

## 1. 现状评估

### 1.1 强项（护城河，竞品调研确认）

| 能力 | 竞品对照 |
|---|---|
| 5 色高亮 + 锚定批注 + 批注面板 + SM-2 间隔复习 | 桌面 RSS 品类几乎独一无二；多数阅读器无高亮或单色 |
| OKLCH 主题引擎 + 主题设计器（色轮/锁定/色盲模拟/WCAG 审计/导入导出） | 超过上游 ReaderAppearance（仅 3 预设），达到第一梯队定制深度 |
| 逐句级双语翻译 + 划词解释/提问（锚点持久化） | 细粒度超过多数竞品的「全文翻译」 |
| BYO-key AI（用户自带 key，隐私+成本） | 国内语境差异化占位；上游仅 AI 摘要/划词 |
| 防御性工程深度（坏缓存自愈、抓取质量守门、渲染兜底、幂等修复器） | 同类项目少见，注释记载真实事故 |
| AIHOT 热点榜 / 知识中心 / 自进化画像 / 相似报道聚类 | 独有功能矩阵 |

### 1.2 薄弱面（详见第 4/5/6 章）

- 搜索：无 FTS 索引全库 LIKE，回退路径 100% 抛错；无文章内 Ctrl+F。
- 性能架构：jsdom+Readability 在主进程同步跑；一次已读触发 5×N 聚合查询 + 侧栏整栏重建；列表无虚拟化。
- 可用性（大陆）：favicon 默认走 `google.com/s2/favicons` 且无本地缓存，目标用户基本全挂。
- 阅读体验缺口：无 TTS、无单篇导出/打印、阅读位置不跨会话、排版无按源覆盖、无稍后读。
- 平台能力缺口：无托盘/通知/开机自启/全局快捷键/备份恢复/缓存手动清理。
- i18n：英文模式部分覆盖（未收录键回退中文）。
- 后端（会员/激活码）：无限流、dev-login 事实公开后门。

---

## 2. 竞品对标（30+ 工具，开源+商业）

### 2.1 竞品格局总表（精简）

| 工具 | 平台 | 开源 | 定位与最大亮点 |
|---|---|---|---|
| Feedly | Web/移动 | 否 | 商业标杆；Feedly AI 优先级排序/降噪/实体识别 |
| Inoreader | Web/移动 | 否 | 极客首选；规则引擎+智能文件夹+永久归档全文搜索+网页监测 |
| NewsBlur | Web/移动 | 是 | Intelligence Trainer 训练器，蓝/深/灰三栏分流 |
| Feedbin | Web | 否 | $5/月极简优雅；纸质主题+Newsletter 转 RSS+API 生态 |
| Readwise Reader | Web/移动 | 否 | 「稍后读+RSS+高亮」终极机；Ghostreader、播客转写、全库搜索 |
| Reeder | macOS/iOS | 否 | Apple 生态最美；手势导航、按源覆盖排版 |
| NetNewsWire | macOS/iOS | 是 | 原生极速，免费开源 |
| Unread | iOS | 否 | 编辑级排印 + 全手势 |
| Fluent Reader / RSS Guard / Raven Reader | 桌面 | 是 | 桌面开源系（Raven 同为 Electron，可架构对标） |
| Folo (Follow) | 全平台 | 是 | RSSHub 团队；按内容类型分视图+Daily Brief+共享 Lists |
| Miniflux / FreshRSS / TTRSS / CommaFeed | 自托管 | 是 | 服务端系；Miniflux 资源占用极低 |
| FocusReader | Android | 是 | 全文翻译+AMOLED+关键词屏蔽+播客 |
| Particle / Bulletin / Nunti | Web/移动 | 否 | AI 新一代：事件聚合摘要 / 主题检索 / AI 音频晨报 |
| Instapaper / Wallabag / Karakeep | 稍后读 | 混合 | 衬线纸感排版 / 批注+ePub 导出 / LLM 自动打标 |
| 已死：Artifact(2024-01)、Omnivore(2024-11)、Pocket(2025-07) | — | — | 启示：纯阅读工具必须靠工作流绑定（高亮/笔记/导出/搜索）建立迁移成本 |

### 2.2 (a) 前端可视化美观性

- **最佳**：Reeder > Readwise Reader > Folo > Feedbin > Unread。
- **RobinRead 现状**（基于官网截图分析）：纸感三栏 + 无边框标题栏 + 主题设计器已属业内少有的本地深度定制；主要差距是**动效层**（列表进入/面板展开/主题切换过渡）与**字体导入**，以及列表质量点等未完成 UI 残留（见 B22）。
- **建议方向**：继续走 Feedbin/Instapaper 的安静纸感路线（不要 Folo 化）；补一层克制的过渡动效；主题导入/导出/分享 + 自定义字体导入是主题设计器截图直接暴露的两个缺口；可选列表形态（卡片/杂志式）作为低优先级。

### 2.3 (b) 软件性能

- **最佳**：Miniflux（Go 单二进制+条件请求，RobinRead 的 etag 实践与其同源）、NetNewsWire（原生毫秒冷启）、Inoreader（服务端规模化全文索引）。
- **RobinRead 现状**：本地 SQLite + Readability 缓存 + 后台预抓架构上限高（优于 Raven Reader 等 Electron 同类）；**真正缺的是 FTS5 全文索引和「重活不阻塞主进程」**。桌面端最难追的是 Inoreader 式服务端规模化，但本地 FTS5 是把性能优势转化为体验优势的最低成本路径。

### 2.4 (c) 阅读体验（核心维度）

逐项对标结论：

| 体验项 | 竞品最佳实践 | RobinRead 现状与差距 |
|---|---|---|
| 正文提取 | Readwise/Inoreader 服务端按站点配方+失败回退原网页 | Readability+容器启发式属主流；缺「按站点记忆手动修正+失败自动降级原网页」 |
| 排版控制 | Unread 编辑级；Reeder 支持按源覆盖 | 字号/行距/页宽/字体/明暗/纸纹齐全达第一梯队；缺自定义字体、按源覆盖、分栏 |
| 过滤/规则/自动化 | NewsBlur 训练器三栏；Inoreader Rules→动作 | 有关键词过滤+信噪评分，但**评分只过滤不排序**（文案还写「越靠前」，B23）；无规则动作（星标/通知/移动） |
| 快捷键/手势 | Reeder 全手势；NewsBlur 单键流 | 应用内快捷键体系成熟（j/k/空格/H/C/V/D/S/M…）；无系统级全局快捷键、无手势 |
| 高亮/笔记/导出 | Readwise 导出 Obsidian/Notion；Wallabag ePub/PDF | 高亮批注领先；**导出闭环缺失**——后端 `kbExportMarkdown` 完整但无 UI 入口（B25），无阅读器内导出/打印（B 无 print） |
| TTS/播客 | Readwise 播客转写+AI 章节；Instapaper TTS；Nunti AI 电台 | 完全空白；Windows 可用免费 Edge TTS 低成本补齐 |
| AI 摘要/日报 | Ghostreader v3、Folo Daily Brief、Particle 事件聚合 | AI 精读/划词/简报已有且 BYO-key 差异化；缺自动生成+推送、高亮自动整理、基于全库问答 |
| 阅读进度 | Feedly/Inoreader/Readwise 云同步 | 本地且**仅会话级**（内存 Map，重启即丢） |
| 全文搜索 | Inoreader 永久归档即时搜索 | 有搜索但 LIKE 全库扫且回退路径必崩；无 FTS5；无文章内 Ctrl+F |
| 微信公众号 | Ego Reader 托管整套目录零配置 | wechat2rss 需自建桥，上手成本高；已有 375 号离线目录+桥接表单可继续降门槛 |
| Newsletter | Feedbin/Inoreader 转发邮箱→RSS | 无 |
| 同步后端兼容 | RSS Guard/Reeder 支持十余种 | 仅 FreshRSS（GReader API）；Miniflux/TTRSS 同协议可低成本加 |

### 2.5 功能差距清单（别人有我们没有，按价值排序）

1. **全文搜索 FTS5 索引**（已有全部本地数据，`node:sqlite` 开虚表即可，性价比第一）
2. **过滤/自动化规则引擎**（从「源级关键词屏蔽」升级到规则→动作）
3. **TTS 朗读/听文章**（Edge TTS 免费）
4. **AI 日报自动生成+推送**（简报已有雏形，缺自动生成与新内容触发）
5. **跨设备同步**（阅读位置/高亮/批注；CloudBase 账号体系已有，最自然延伸）
6. **高亮/批注导出闭环**（Markdown/Obsidian/ePub/PDF）
7. **Newsletter 邮箱订阅**
8. **自定义字体导入 + 主题分享**
9. 网页变更监测（Inoreader 独门，进阶）
10. 按内容类型视图（Folo 方向，与深读定位较远，最低优先级）

### 2.6 行业趋势（2024-2026）

AI 摘要→AI 助手/问答→定时晨报三段式演进；播客化抢占通勤场景；社交化回潮（共享 Lists）；BYO-key 与托管 AI 并存（前者在中国尤其成立）；订阅源枯竭催生「补源」功能竞争（Newsletter/网页监测/桥）；「归档对抗链接腐坏」成为共识。死亡产品共同启示：**靠工作流绑定（高亮/笔记/导出/搜索）建立迁移成本才能活**——正是批注体系应继续做深的战略理由。

---

## 3. 上游 PaperRss 对标（fork 点 v1.3.0-beta.1 → HEAD v1.3.2-beta.1）

上游快照后发布 8 个版本（126 commits），主线是 **Reader Engine 重做 + 正式发布链路**：beta.2 Reader Engine 重构+MathJax+LRU 缓存+FeedIconStore → beta.3 ArticlePreparationPolicy → beta.4 Sparkle 自动更新+签名公证 → v1.3.0 正式版（ReaderAppearance）→ v1.3.2 代码高亮+多图画廊+X 头像过滤。另发现上游在规划 Tauri 跨平台 V2——RobinRead 实质已走在其 V2 计划前面。

### 3.1 建议借鉴清单（按 价值×成本 排序）

| # | 能力 | 上游实现要点 | RobinRead 落点 | 成本 |
|---|---|---|---|---|
| 1 | favicon 本地缓存+失败记忆 | 内存→磁盘→网络三级缓存，失败 5 天重试窗，并发上限 6，新 URL 覆盖旧请求 | 新建 `src/main/FeedIconStore.js`；当前用 google.com/s2 且无缓存，大陆全挂（见 B08） | 小-中 |
| 2 | X/Twitter 头像过滤 | sanitizer 剔除 `pbs.twimg.com/profile_images/` | `ArticleExtractor.js:219` img 白名单处按 URL 前缀拒绝 | 小 |
| 3 | 版本比较预发布语义 | SemanticVersion，pre-release < release | `UpdateCheckService.js:47-58`（我们继承了 bug，见 B10） | 小 |
| 4 | 冷启动静默检查更新 | 启动静默查，发现新版才提示 | `main.js` 启动时调 checkForUpdate + 渲染层角标（已有 NEW 胶囊可复用） | 小 |
| 5 | 右键「复制文章 ID」 | 列表上下文菜单 | `views/context-menu.js` | 极小 |
| 6 | 代码语法高亮 | 本地 highlight.js，`language-*` 标注门控零成本 | `reader.js` 渲染后按 `pre>code[class*=language-]` 着色；vendor 本地打包 | 中 |
| 7 | 多图并排画廊行 | 相邻纯图块归一为 flex 行 | `reader.js` 渲染管线包 `.nj-img-row` + robin.css | 小-中 |
| 8 | feed 正文格式规范化 | 按内容判 html/转义 html/markdown/混合/纯文本 5 种格式；判 markdown 前先剥公式 | `ArticleExtractor.js` 新增 normalize 步骤（`articleContent()` :690 消毒前）；现 markdown 源显示裸符号、双重转义源显示标签文本（B 档功能） | 中-大 |
| 9 | 数学公式条件渲染 | containsMath 门控，仅公式文章注入 | Electron 更简单：renderer 按需引 KaTeX | 中 |
| 10 | PreparedArticle LRU+相邻预取 | LRU(12)+内容指纹失效+世代计数防竞态；J/K 切换瞬间渲染消除遮罩 | AppStore 加 LRU，列表选中时预取相邻（当前每次 open 全量 IPC+sanitize+遮罩） | 中 |
| 11 | 缓存 normalization revision 自愈 | revision 升号让旧缓存惰性重清洗 | 已有阈值式自愈，加 revision 字段更通用 | 中 |

**无需跟进**：Sparkle（Electron 有 electron-updater 生态）、公证签名（Windows 体系另议）、CloudKit、全屏 titlebar/毛玻璃/Zen（纯 AppKit；我们的禅模式已覆盖）、Tauri 评估文档（但其「共享契约：数据库规范/消息协议/Reader 资源/行为 fixtures」分层建议值得读）。

### 3.2 上游已修、我们继承的问题

| # | 问题 | RobinRead 证据 |
|---|---|---|
| B1 | 预发布版本比较错误（beta 误判为更新） | `UpdateCheckService.js:51-58`（见 B10） |
| B2 | X 正文头像未过滤 | `ArticleExtractor.js:317` 仅做 webp→jpg |
| B3 | favicon 无缓存（大陆加重版） | `sidebar.js:467-481`（见 B08） |
| B4 | 文章切换无内存缓存/预取 | `reader.js:64-105`（见性能⑫/借鉴#10） |
| B5 | Markdown/转义 HTML 源不识别 | `AppStore.js:690`（见借鉴#8） |
| B6 | 翻译批次携带全文序列化 | `reader.js:1230`（见性能⑧） |
| B7 | RSSHub 引用块误判 | `ArticleExtractor.js:42-47`——但我们的容器评分只用于网页提取路径，feed 路径整篇消毒，上游具体 bug 不触发（低） |

**对照确认未继承**（快照前上游已修，我们已带）：content:encoded 命名空间剥离、翻译失败计数上限、删源清选中、预取弱摘要污染缓存（我们有独立等价机制）。

**RobinRead 领先项**：双引擎网页提取、OKLCH 主题引擎、逐句双语翻译、高亮批注、AIHOT/知识库/进化引擎、相似报道聚类、TOC 轨道（后两者已从上游更早版本移植）。

---

## 4. 待修 Bug 清单

### P0 — 功能损坏 / 数据错误（10 个，建议立即修）

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| B01 | 搜索回退路径 100% 抛错 + 主路径无索引 | `AppStore.js:799,817` | `replace(/([%_])/g, '\$1')` 是恒等替换未转义；`ESCAPE ''` 空串非法，SQLite 执行必报错。主路径 fullTextSearch（:752,772）写法正确可用，但无结果回退到 searchEntries 即崩。修法：照抄 fullTextSearch 写法 + `ESCAPE '\'` |
| B02 | FreshRSS 同步顺序颠倒：离线已读被回滚成未读 | `AppStore.js:1117-1134` | `_reconcileStates`（按服务器覆盖本地）先于 `_drainOutbox`（推送本地变更）执行；用户看到「刚读完又变未读」，要等下一轮同步才修正。修法：先 drain 再 reconcile，或对账跳过 outbox pending 项 |
| B03 | AI 摘要卡 click 监听无限叠加 | `reader.js:912,935,949,1004-1011` | 每个流式 delta 重绘一次都 addEventListener；生成百次 delta 后点击触发 N 次（偶数次=点了没反应；未生成分支重复触发报「任务进行中」）。修法：建卡时一次性绑定或 `onclick` 覆盖式 |
| B04 | _openBody 渲染竞态：旧文章覆盖新选中 | `reader.js:145,158` | :109-:153 均有 `this.entryID === entryID` 守卫，唯 :145/:158 缺失；慢抓取的 A 返回后覆盖已渲染的 B，界面与数据失配不自愈。修法：await 汇合后统一守卫 |
| B05 | LLM 流式零超时可永久挂起，取消也失效 | `LLMService.js:244-257` | fetchWithTimeout 只覆盖到响应头，body 读取（:196/:209-241）零超时；卡死时 onDelta 不再回调，cancelAI 检测不到，该 key 永占 requestInProgress。FreshRSSClient.js:101-108 同模式。修法：AbortController 生命周期覆盖 body 消费全程 + 持有 controller 引用实现取消 |
| B06 | ui-prompt 按 ESC 后 Promise 永不 resolve | `ui-prompt.js:27` | 按钮路径都 resolve，唯 ESC 只移除 DOM；所有 `await promptBox/confirmBox` 调用方（dialogs.js:570-576 三连 prompt、knowledge.js:517-523 等）取消后永久挂起 |
| B07 | AIHOT 侧栏未读徽标恒 0 | `aihot-view.js:231` | `_flatHot` 全文件仅此一处引用、从未赋值，`_sectionUnread` 恒 return 0，徽标功能整体失效 |
| B08 | favicon 走 google.com/s2 且无本地缓存（大陆不可达） | `sidebar.js:467-481`、`Models.js:233` | 目标用户网络下侧栏+列表全部图标反复失败/字母占位；上游 FeedIconStore 已解（三级缓存+失败记忆）。与借鉴#1 同一件事 |
| B09 | 退出不落盘：最后 150ms 偏好写入丢失 | `LibraryDatabase.js:111-120`、`main.js`（无 before-quit） | 关窗即 quit，150ms 防抖定时器不执行；窗口位置/主题等最后一次修改丢失。修法：before-quit 同步 flush + DB close |
| B10 | 版本比较预发布语义错误 | `UpdateCheckService.js:47-58` | `split(/[.-]/)` 数字逐段比较，`1.3.0-beta.5` 会被判为 > `1.3.0`；若推送 beta tag 会把稳定版用户升到 beta。上游 56516c9 已修 |

### P1 — 安全 / 明显体验损伤（11 个）

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| B11 | markdown.js 链接属性注入 XSS | `markdown.js:9-11,32` | escapeHTML 不转义双引号，URL 字符类允许 `"`；`[x](https://e.com/"onmouseover="...)` 可注入事件属性。sink：reader.js:909,1549,1686,2672、aihot-view.js:664（AI 输出含不可信正文回流的场景）。修法：转义引号 + URL 属性级转义或 DOM 构建 |
| B12 | 主题设计器 HueWheel 每次 _render 泄漏 2 个 window 监听器 | `theme-designer.js:176-179,559` | 拖滑杆每个 input 事件全量重渲并 new HueWheel，旧监听器不解绑；一次调色泄漏上百个 mousemove/mouseup，整窗鼠标回调链线性变长 |
| B13 | 高亮越界：同节点内选区包到节点末尾 | `reader.js:1863-1864` | 第二个 splitText 守卫用错节点长度（split 后 node 已变短，条件恒假）；段内选中词组会高亮到句尾/段尾（落库正确，仅当前会话视觉错） |
| B14 | AIHOT _load 无请求令牌：旧响应渲染到新板块 | `aihot-view.js:102-130,158-168` | 快速切换板块时慢响应晚到覆盖快响应，「热点榜」显示日报数据/「暂无数据」 |
| B15 | AIHOT 数字字段裸插值进 innerHTML | `aihot-view.js:343,353,373,691-704` | rank/sourceCount 未数值化未转义（同卡片其他字段都有 esc()）；远端字段类型失控即 XSS。修法：`Number()‖0` 或统一 esc |
| B16 | ai_artifacts 孤儿行永不清理，库无限增长 | `DatabaseMigrations.js:233-235` + `AppStore.js:907-911` | 外键 `ON DELETE SET NULL` 置 NULL 后 `NULL NOT IN (...)` 恒不为真，housekeeping 删不掉；每删一文其摘要/精读/全文翻译产物（segments_json 大字段）永久残留。修法：加 `OR item_id IS NULL` |
| B17 | 后端无限流 + dev-login 公开后门 | `cloudfunctions/njpaper-api/index.js:399-434,274-304` | login/register/redeem 无任何限流（scrypt 爆破/PG 打爆/CPU DoS）；dev-login 仅以「微信未配置」为门禁，线上未配置时任何人可登入共享会员账号。修法：入口按 uid+IP 滑动窗限流 + dev-login 显式环境变量开关 |
| B18 | outbox 重试退避恒 60s，指数退避不存在 | `Repositories.js:447` | `30 * (2 ** Math.min(6, 1))` 中 `Math.min(6,1)` 是常量 1，attempt_count 未参与；凭据失效时每分钟重放每条 outbox |
| B19 | i18n 硬编码：英文模式下仍是中文 | `app.js:566,573`、`aihot-view.js:24-28`、`knowledge.js:24-32`、`evolution-view.js:9-17` | 「星期X」动态拼 key 不在字符串表；timeAgo 全硬编码中文；日期格式硬编码中文 |
| B20 | 灯箱点击关闭时泄漏 keydown 监听 | `reader.js:2406-2413` | 点按关闭不移除 esc 监听，直到下一次按 ESC 才自清 |
| B21 | addFeed 检查-插入竞态，可插入重复源 | `AppStore.js:432-456` | 检查与插入间隔最长 30s fetch，`idx_feeds_url` 非唯一；双击/并发重复入库（置信约 75%）。修法：唯一索引或插入前复查 |

### P2 — 打磨 / 死代码 / 加固（14 个）

| # | 问题 | 位置 |
|---|---|---|
| B22 | 列表渲染「信噪评分 5 点 + 阅读时长」但三个 CSS 文件均无对应样式，实际不可见——UI 未完成 | `list.js:135-150` |
| B23 | 设置「个性化强度」文案称「越靠前」，实现只过滤不排序，文案与实现不符 | `dialogs.js:268` vs `AppStore.js:295-303` |
| B24 | 智能文件夹半成品：query 字段无任何消费方，也未接入侧栏/列表 | `knowledge.js:678-717`、`sidebar.js:58-60` |
| B25 | 单篇导出 Markdown 后端+preload 完整但渲染层零调用，无 UI 入口 | `KnowledgeEngine.js:328-340`、`preload.js:154` |
| B26 | 自诊断分级死代码：critical 分支永不可达（300 与 500 阈值顺序反了） | `EvolutionEngine.js:262` |
| B27 | KnowledgeEngine/EvolutionEngine 绕过迁移体系 ad-hoc 建表；highlights(item_id)/notes(item_id)/article_tags(tag) 高频列无索引 | `KnowledgeEngine.js:16-64`、`EvolutionEngine.js:22-60` |
| B28 | 主窗口 `sandbox:false`（preload 仅用 contextBridge/ipcRenderer，可开 sandbox） | `ipc.js:47` |
| B29 | `aihot:extractURL` 允许渲染层驱动主进程抓任意 URL，无私网段/端口限制（XSS 后即内网探测面） | `ipc.js:391` → `AihotService.js:249-253` |
| B30 | macOS activate 重建窗口后 IPC 闭包持有已销毁窗口（Windows 主平台不触发，地雷） | `main.js:115-119`、`ipc.js:309-315` |
| B31 | OPML 导入只按 URL 建源，不继承标题与 outline 文件夹层级 | `AppStore.js:598` |
| B32 | 订阅商店「★评分 / N万订阅」由 rank 哈希生成的确定性伪数据（合规/误导风险） | `feed-store.js:155-161` |
| B33 | AuthService._writeState 非原子写，崩溃瞬间可能截断 JSON（读侧有兜底） | `AuthService.js:344-348` |
| B34 | 429 限流也走「换 UA 重试」，会加重限流 | `FeedService.js:38-48` |
| B35 | 死源（连续 5 次失败标记）仍每轮全量重试，拖满 30s 超时窗 | `Repositories.js:166-170` |

**审查确认无问题的项**（避免误修）：SQL 全线参数化；正文 XSS 主路径（RSS 与抓取均经主进程白名单消毒）；target=_blank 已带 rel=noopener；ui-prompt 无 window.confirm/prompt/alert 直调残留；支付/激活码条件 PATCH 幂等；DPAPI 凭据处理；高亮翻译缓存 hash 污染主源已处理。

---

## 5. 功能增强清单

### A 档 — 高价值低成本（建议第一批）

1. **搜索升级 FTS5**：`node:sqlite` 建 FTS5 虚表（title/summary/author/正文缓存），修 B01 同时把「输入即卡」变「即时返回」；这是竞品调研中所有对手的标配留存功能。
2. **favicon 三级缓存**（上游借鉴#1，与 B08 同一件事）：主进程抓取→磁盘缓存→IPC data URL；可选默认源换成可自建/可替换（DuckDuckGo icons 服务或直接抓站点 favicon）。
3. **阅读位置持久化跨会话**：现有内存 Map（reader.js:47）落 localStorage 或 preferences。
4. **单篇导出补全 UI**：`kbExportMarkdown` 后端已有（B25），阅读器加「导出 Markdown / 复制全文 / 打印（window.print→存 PDF）」菜单。
5. **文章内 Ctrl+F**：Electron `findInPage` 或渲染层自实现高亮查找。
6. **X/Twitter 头像过滤**（上游借鉴#2）+ **右键复制文章 ID**（借鉴#5）+ **冷启动静默更新检查**（借鉴#4）。
7. **排序真正落地**：列表加排序切换（时间/未读优先/信噪分），或让「个性化强度」真正参与排序并同步修 B22/B23（把不可见的评分点变成可见的排序结果）。
8. **翻译批不重传整篇 HTML**（上游 B6）：句级 data-sent 已有 ID，按 ID 传参即可（同时是性能⑧的一半）。

### B 档 — 阅读体验增强（中成本）

9. 代码语法高亮（上游借鉴#6，本地 highlight.js 按 language-* 门控）
10. 多图并排画廊行（借鉴#7，`.nj-img-row`）
11. feed Markdown/转义 HTML 格式规范化（借鉴#8，判格式前先剥公式）
12. 数学公式条件渲染（借鉴#9，KaTeX 按需注入）
13. PreparedArticle LRU + 相邻预取（借鉴#10，消除打开文章遮罩，J/K 瞬开）
14. TTS 朗读（Windows Edge TTS 免费高质量中文语音，划句朗读/全文朗读）
15. 系统托盘 + 新文章通知 + 关闭到托盘 + 开机自启
16. 数据备份/恢复（library.db 一键导出/导入）+ 存储管理页（缓存体积展示 + 手动清理）
17. 主题导入/导出/分享 + 自定义字体导入（主题设计器两个直接缺口）
18. 稍后读队列（独立于星标的阅读清单）

### C 档 — 战略差异化（大成本，按商业节奏）

19. 跨设备云同步：阅读位置/高亮/批注/已读状态（CloudBase 账号已有，竞品全部商业服务的标配）
20. AI 日报自动生成+推送 + 高亮自动整理成知识卡片
21. Newsletter 专属邮箱（邮件变 RSS 条目）
22. Miniflux / Tiny Tiny RSS 同步（与 FreshRSS 同为 GReader 协议，复用 FreshRSSClient）
23. 网页变更监测（无 RSS 站点抓正文 diff）
24. 英文 i18n 补全（B19 + 全量键收录）
25. 无障碍（aria 角色/焦点管理/键盘 Tab，长线）

---

## 6. 性能与体验优化清单

### P0 — 架构级（用户可感知程度最高）

- **① 正文提取迁出主进程**：jsdom+Readability+双引擎正则同步跑在主进程（`ArticleExtractor.js:594-597`），并发 3 预抓 + 用户打开叠加时阻塞全部 IPC（列表点击/已读/状态推送排队，「后台预抓时 UI 僵住」）。方案：`utilityProcess` 或 worker_threads + 全局并发闸 + jsdom `window.close()` 释放。
- **② 状态推送风暴瘦身**：一次 markRead = 主进程 5×N 条聚合查询（`TimelineQueryService.js:62-130`）+ 全量 snapshot IPC + 渲染层侧栏整栏重建（`app.js:1379-1380`）+ 列表整量重取（`app.js:1382`，已加载 2000 条时每点一次已读重传 2000 行）。方案：侧栏用已有 `updateCounts`（`sidebar.js:265,434`）增量更新；未读计数反规范化缓存；列表优先走已有补丁路径；`_retainedUnreadIDs` 加上限（`AppStore.js:70,623`，会话读几百篇后 unread 过滤 SQL 变成几百个 `?`）。
- **③ 搜索 FTS5 化**（同功能 A1，`AppStore.js:749-783` 现 LIKE 全库扫含 article_caches.text 全文）。

### P1 — 规模化必做

- **④ 去重查询消灭全表扫**：`_entryExistsByURL` 用 `REPLACE(a.url,'&amp;','&')=?`（`AppStore.js:523-527`），每篇新文章入库前全表扫一次；50 篇新文章=50 次全表扫。方案：入库时写规范化 url 列 + 索引。
- **⑤ 刷新调度治理**：全并发 allSettled（`AppStore.js:945`，100 源=100 并发 fetch+同步解析堆积）、无 jitter 同拍齐发、死源不跳过（B35）。方案：并发池（6-8）+ 随机错峰 + 死源降频/跳过 + 429 不换 UA（B34）。
- **⑥ 列表虚拟化/分段渲染 + 聚类降复杂度**：无虚拟化 2000 行常驻 DOM（`list.js:63-99`）；clusterSimilar O(n²) 两两 Jaccard（`list.js:286-306`，1000 条=50 万次比对）挂在整表重建路径；多账户分页 offset 语义不正确（`AppStore.js:388-394`）。
- **⑦ 批量事务 + PRAGMA 调优**：markAllRead 逐条 autocommit 最多 5000 次 fsync（`AppStore.js:645-654`）、对账/清理同样；WAL 未设 `synchronous=NORMAL`、未设 `busy_timeout`（`LibraryDatabase.js:20-23`）。
- **⑧ IPC 大 payload 瘦身**：`ai:delta` 每 token 传累计全文 O(n²)（`AppStore.js:1467,1542`）改传增量；翻译每批重传整篇 annotatedHTML（`reader.js:1230`，与 A8 同一件事）。

### P2 — 打磨

- **⑨ 升级首启修复例程延后**：3 个全表扫级修复在窗口创建前同步跑（`main.js:94-102`、`AppStore.js:92-183`），老用户升级首启窗口推迟数秒——延后到 ready-to-show 之后。
- **⑩ 阅读器滚动优化**：每帧对所有段落块 getBoundingClientRect（`reader.js:1140-1157,2549-2557`）改 IntersectionObserver；长文打开的 20 轮拍平+5 步重排管线（`reader.js:446-489`）可缓存结果。
- **⑪ backdrop-filter 低端降级**：列表 sticky 头 blur(20px) 常驻合成（`robin.css:395-403`），低端 GPU 滚动掉帧时可降级为半透明纯色。
- **⑫ 打开文章 LRU 缓存**（同借鉴#10）：每次 open 全量 IPC+sanitize+遮罩。

---

## 7. 建议路线图（未动手，仅规划）

**阶段一：稳定器（小改动、高收益）**
修完 P0 十个 bug（B01-B10）+ 后端限流与 dev-login 开关（B17）+ favicon 缓存（B08/借鉴#1）。其中 B01/B06/B10 是几行的修复；B03/B04/B07 各加一次守卫/赋值；B02 调换两行顺序；B05 补 AbortController 生命周期。

**阶段二：体验跃升**
性能 P0（①②③）+ A 档功能（FTS5、阅读位置持久化、导出 UI、Ctrl+F、排序落地）+ B12/B13/B19 等交互修复。这一阶段结束后「打开快、搜得到、读得顺、导得出」四件事闭环。

**阶段三：差异化纵深**
B 档（高亮代码/公式/画廊/LRU 预取/TTS/托盘/备份/字体）按用户反馈排序；C 档（云同步、AI 日报自动化、Newsletter、多后端同步）跟随会员商业化节奏推进。

---

## 附录：调研来源与证据

- 竞品调研来源：Zapier 2026 RSS 横评、Feedly/Inoreader/NewsBlur/Feedbin/Readwise/Reeder/NetNewsWire/Folo/Miniflux/FreshRSS 等官网与更新日志（30+ 工具，每个至少一个一手来源）
- 上游对比：本地快照 `_reference/PaperRss`（= tag v1.3.0-beta.1）vs GitHub HEAD dac2883（2026-08-30，126 commits），GitHub Releases/Issues API
- 代码审查：src/main 与 server/cloudfunctions、src/renderer 全量只读审查，功能盘点覆盖 49 个源文件约 2.6 万行
