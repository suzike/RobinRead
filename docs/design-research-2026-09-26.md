# 知更·排版与阅读体验深度调研报告

> 日期：2026-09-26 ｜ 版本基线：v2.4.9 ｜ 方法：代码库现状盘点 + 4 路并行外部调研（顶级阅读产品 / 杂志编辑设计 / 中文排版与字体 / AI 阅读生态）

## 一、调研目的

为知更下一阶段「重量级功能叠加」提供决策依据：排版、写作、布局美化、字体、杂志风格五个维度，从全球最佳实践中提炼可落地的功能方向。

## 二、现状盘点（v2.4.9 阅读体验底细）

**已有的扎实底座：**

- **渲染管线**：`src/main/ArticleExtractCore.js`（jsdom+Readability 双引擎 → 白名单重建式消毒）→ utilityProcess 工作进程池预抓取；渲染端 `reader.js` 有 DOM 级排版归一（`_restructureArticle`、画廊并排、尾巴清理、KaTeX、highlight.js、灯箱）。成熟度高。
- **排版设置**：仅 serif/sans、页宽三档、行距三档、字号 12–26px（`AppStore.js readerLayout()` ~L2730，`app.js applyReaderLayout()` L168 写 CSS 变量）。无字重/字距/缩进/对齐/边距调节。
- **主题**：亮/暗双套 + OKLCH 主题引擎（`theme-engine.js`）+ 中国色主题设计器（`theme-designer.js`，含 WCAG 检测/色盲模拟/JSON 导入导出）；深色插图反相已做像素级线稿识别。缺 sepia 等中间档。
- **杂志视图**：列表形态的封面卡片网格（`list.js _renderMagazine` L237）+ 3D 翻页动画（`robin.css` L2955，0.32s rotateY）。**无封面故事/目录页/分栏/页码等真杂志结构**。
- **翻译**：每源三态 + 单篇记忆 + 逐句 `<span.nj-t>` 双语注入（`reader.js _wrapSentenceUnits` 等）。
- **AI**：LLMService（DeepSeek/OpenAI 兼容+局域网 HTTP+流式）、流式摘要卡、划词解释/翻译/多轮追问、D 键一键精读、AIHOT 热点+AI 日报、AI 探索（画像→提议→本地验证，24h 缓存）。
- **辅助**：TOC 轨道、进度记忆（300 条）、五色高亮/便签（KnowledgeEngine SQLite）、稍后读、FTS5 全文检索、快捷键全家桶、本地 TTS、导出 MD/打印 PDF。
- **上游借鉴机制**：`_reference/PaperRss/` 整仓 vendored，注释标记「借鉴上游 vX.Y」，`scripts/diag-phase7-upstream.js` 端到端探针。

**核心缺口**（对照 Readwise Reader / 微信读书 / Medium）：

1. 排版控制太粗——无自定义字体、无字重/段距/缩进/两端对齐、档位少。
2. 无内置开源中文字体，正文依赖系统字体栈。
3. 杂志视图是「卡片网格」不是「期刊」——没有封面故事、目录、分栏正文、页码。
4. 无 EPUB 导出、无分享卡片、无高亮外同步（Obsidian/Notion）。
5. 无阅读统计、无相似文章/聚类、无稍后读智能队列。
6. TTS 无播放列表/进度拖动；无分页模式（翻页只是动画）。

## 三、业界标杆扫描

### 3.1 顶级阅读产品

- **Readwise Reader**：Ghostreader 自定义 prompt 体系；Enchantments 把交互件嵌进正文；排版粒度极细（含 Atkinson Hyperlegible/OpenDyslexic 无障碍字体、字号 14–80px、分页/滚动双模式）；Daily Review 用间隔重复+抽签复活旧高亮（变率奖励）。
- **Matter**：口碑核心是「默认排版无需设置即美」——精致衬线+舒展行距+高质感暗色；自定义只做减法。教训：默认值比设置项重要。
- **Reeder 2025 新版**：弃版本号重做成「读/看/听统一收件箱」——一条时间线吃下 RSS/社媒/播客/稍后读。
- **Instapaper Premium**：RSVP 逐词速读（Speed Read）；TTS 做成播放列表连播而非单篇朗读。
- **Apple Books / Kindle**：排版自定义的粒度天花板（两端对齐+连字符+页边距+双栏）；Kindle「主题包」概念（场景化一键切换）值得抄。
- **Foliate / Koodo**：桌面 EPUB 阅读器能力清单——自动连字符、竖排、弹注脚、注释存纯 JSON；Koodo 与知更同栈（Electron），四级标注样式可参考。
- **微信读书**：划线即社交（书友划线热区）；多字体+四档背景（纯白/米黄/护眼/夜间）；AI 问书（答案限定书内）；用户拿脚本给网页版换霞鹜文楷——说明「好字体」是中文阅读刚需。
- **死亡产品遗产**：Pocket（2025.7 关停）→ 教训是导出必须含正文（EPUB/HTML），只存不读是病灶；Omnivore（2024.11，被 ElevenLabs 收编）→ 免费托管无商业模式必死，「读转听」被资本背书；Artifact → 纯 AI 推荐新闻流规模不足。**反证刚需**：过滤降噪、digest 节时、高亮→知识库闭环、高质量听书。本地优先的知更正好站在关停潮的反面。

### 3.2 杂志编辑设计 → Web 落地

- **印刷原理**：编辑网格（CSS Grid，正文栏宽 30–45em）、基线网格（同一基数倍数的纵向节奏）、字号阶梯（1.25 比率+clamp()）、首字下沉（`initial-letter`，Chromium 110+）、提引卡（break-inside: avoid）、多栏+跨栏标题（`columns`+`column-span: all`）、孤行控制（widows/orphans）。
- **数字标杆**：Medium（衬线正文 Charter + 单一阅读栏 ~700px + 字体分层）；NYT（三家族分层：标题衬线/UI 无衬线/正文衬线）；FT（粉底色成品牌）；Bloomberg Businessweek（封面级头图+巨型标题的「封面感」）；Monocle/Kinfolk（米白底+大留白+细线的纸感极简）；iA（「Web 设计 95% 是排版」，正文 16–18px、行宽 ~33em）；Substack（全局统一+品牌只开放字体/强调色的分层自定义模型）。
- **现代 CSS 武器库（Electron 37 ≈ Chromium 130，除标注外全可用）**：`text-wrap: balance/pretty`、`initial-letter`、scroll-driven animations（进度条/视差）、View Transitions（SPA 过渡 111+）、COLRv1 彩色字、`@media print` + `@page`（页码页眉需 Paged.js）。**Chromium 不支持** `hanging-punctuation`（需 JS 兜底）；`text-spacing-trim`（123+）可用。

### 3.3 中文排版与字体

- **clreq 规范要点**：正文行距惯例 1.5–1.8（默认 1.6–1.7）；段落「缩进 2em+段距 0」为书刊惯例，段距式为可选风格；标点挤压在避头尾之前执行，「先挤进后推出」，避头尾取 basic 级；中西文混排自动加 ≤1/4 汉字宽间隙（盘古之白，渲染层注入不改原文）；标点悬挂中文出版物罕见，仅作可选开关；竖排 `vertical-rl` 适配繁中/文艺内容。
- **内嵌字体候选**（全部 OFL/免费可分发）：霞鹜文楷 Screen 版（文艺正文首选，GB 版合国标字形）、思源宋/黑体 VF（标题+UI，多字重）、得意黑（封面/大标题专用，官方明确不建议正文）、汇文明朝体（民国铅印复古点缀）、朱雀仿宋（仿宋正文补充）、京華老宋体（115MB 仅子集化后作标题）。
- **字体工程**：cn-font-split 子集化+unicode-range 分片（2MB/50ms），Electron 随包离线内置 `@font-face` file:// 无网络依赖；回退栈把西文字体前置实现中西分家。
- **产品对标**：微信读书/蜗牛读书的字体+字号+行距+边距+背景四件套；Kobo 支持竖排+字体目录；单读/三联的期刊型留白。

### 3.4 AI+阅读生态

- **RSS 新格局**：Folo（AI 摘要/翻译/AI 日报/MCP Server）；Feedly（Leo 学习式过滤、自然语言建订阅、批量选 25 篇跑 prompt）；NewsBlur（人工训练过滤器，Focus 视图）；Kagi News（社区策源源+AI 压缩成每日简报+同事件聚类）；Particle News（Artifact 后继，单故事多源聚合）。
- **能力谱系**：文章级（TL;DR/带引用定位的问答/术语解释）→ 订阅级（每日简报/同题聚类/周报）→ 知识级（NotebookLM 式多文档问答 + **Audio Overview 双人对话播客**，80+ 语言可打断提问）→ 发现级（相似文章/兴趣探索）。
- **音频化**：NotebookLM Audio Overview（中文对话播客）；ElevenReader（32+ 语言 130+ 音色）；「生成私有 podcast RSS 供播客客户端订阅」已成 AudioRead/Listen Later 成熟模式。
- **知识闭环**：Readwise Daily Review（间隔重复抽高亮）+ Notion/Obsidian 官方管道是行业事实标准；阅读器内嵌知识图谱仍是空白。

## 四、24 个功能叠加方向

> 标注：🔴P0 = 直接放大既有优势 / 🟡P1 = 次优先 / ⚪P2 = 远期或条件成熟再上；「借鉴」给出对标来源；「落点」给出代码落脚处。

### A. 排版引擎与字体层（地基，做了全盘受益）

**1. 专业排版面板（Type Engine v2）** 🔴
把 readerLayout 从 4 项扩成完整面板：字重、字距（±0.1em 步进）、段落风格二态（首行缩进 2em+段距 0 ⇄ 段距式无缩进，clreq）、两端对齐+避头尾、页边距、标题/正文/引文分层设置。借鉴 Apple Books/Kindle/Foliate 的粒度。落点：`AppStore.js readerLayout()` 扩字段 + `robin.css` 变量 + 设置页 `_appearance()`。

**2. 内置字库与字体 Pairing（字体工坊）** 🔴
离线内嵌 4–5 款 OFL 中文字体：霞鹜文楷 Screen（文艺正文）、思源宋 VF（经典正文）、得意黑（封面大标题）、汇文明朝体（复古点缀）、朱雀仿宋；cn-font-split 子集化控体积。标题字/正文字/引文字三通道独立配置（NYT 三家族模式、Medium Charter 模式）。微信读书用户脚本换字体证明这是刚需。落点：`resources/fonts/` + `@font-face` + 排版面板字体选择器。

**3. 版式主题包（Typography Themes）** 🟡
一键切换的场景化/刊物化预设：「知更纸刊」「单读风」「纽约客风」「墨水屏」「护眼大字」……每包=字体搭配+字阶+行距+段落风格+配色+装饰开关；JSON 导入导出复用 `theme-designer.js` 的导入导出惯例，天然可社区分享。借鉴 Kindle 主题包+Substack 分层模型。

**4. 中文微排版（CJK Micro-typography）** 🔴
标点挤压（`text-spacing-trim` Chromium 123+，降级 JS 兜底）、避头尾 basic 禁则、中西文混排自动盘古之白（渲染层注入 ≤0.25em，不改原文）、可选标点悬挂（行尾至多 1 个）。这是中文产品的差异化壁垒——国际阅读器全都不做，而 clreq 已给出完整规范。落点：`reader.js _normalizeArticle` 管线内新增微排版 pass。

**5. 基线网格与字号阶梯重构** 🟡
robin.css 纵向节奏统一取基数倍数，标题字阶按 1.25 比率+clamp() 派生；配内部校对模式（渐变背景显示基线）。iA 式「节奏即美」的地基工程，为 6/7 号方向铺路。

### B. 杂志化结构层（把「杂志感」做实）

**6. 真·期刊结构（Daily Edition 每日刊）** 🔴（本报告最重方向）
刷新后自动「排版出一期」：封面故事（当日最重要一篇，Businessweek 式头图+巨型标题）+ 本期目录页（分类章节+页码锚点直达）+ 期刊导航。AI 定头条（或按未读权重），现有杂志网格变成期刊内页。这是「知更=纸刊」定位的具象化，竞品（Feedly/Inoreader/Folo）都没有。

**7. 杂志内页版式（Article Layout）** 🔴
阅读页新增「刊排版」模式：首字下沉（`initial-letter` ✓）、跨栏标题（`column-span: all`）、AI/规则抽取金句做提引卡（pull quote 侧浮）、杂志式图注（figcaption 编号+细线）、Tufte 页边注。落点：`reader.js _restructureArticle` 加版式分支 + robin.css 新版式类。

**8. 纸感系统 2.0** 🟡
补齐中间主题档（米黄/护眼绿/报纸灰，对照微信读书四档）；纸张纹理分级（道林纸/新闻纸/铜版纸）；印刷感装饰（细线分隔、small caps 栏头、oldstyle 数字）。已有噪点纹理+OKLCH 引擎，纯增量。

**9. 真分页模式（Paged Mode）** 🟡
翻页从「动画」升级为「分页排版」：按视口高度分页、页码显示、点边距/方向键翻页、滚动⇄分页双模式记忆（Readwise paged scroll、Foliate 模式）。分页页码与 6 号目录页、19 号 PDF 导出同源。

**10. View Transitions 过场 + 滚动驱动进度** ⚪
列表⇄杂志⇄文章改用 View Transitions API 做共享元素过渡（封面图→文章头图连续变形），替换现有 0.32s keyframe；阅读进度条改 scroll-driven animation（纯 CSS 零 JS）。Chromium 111+/115+ 全支持，现有翻页动效的质感跃迁。

### C. 阅读辅助层

**11. 聚焦阅读模式（Focus）** 🟡
禅模式（隐藏一切 chrome）、段落聚焦渐暗遮罩、可选 Bionic Reading 词首加粗（英文源）、打字机滚动（当前段保持屏幕黄金位）。落点：reader.js 阅读模式状态机 + 快捷键。

**12. 目录/进度 2.0** ⚪
TOC 轨道升级：可点击锚点+当前章节高亮+滚动位置缩略图（minimap 思路）；分页模式下显示「第 n 页/共 N 页」。

**13. 双语对照刊 2.0** 🟡
现有逐句插译升级为三种杂志式双语版式（原译分行/双栏对照/译文纸片），译文字号-1 级灰阶化，标题双语分层；支持「对照版」导出 MD/PDF。差异化杀器：没有竞品把翻译做成「排版」。

### D. AI 深读层

**14. 同题聚类 Full Coverage** 🔴
刷新后同事件多源报道 AI 聚类成「一事一群」：群内并陈各源标题（媒体对照视角）、一键 AI 融合摘要+分歧点分析。借鉴 Kagi 聚类/Particle 多源聚合。被验证的刚需（降噪），且 RSS 天然多源是聚类最好的原料——AIHOT 已有聚类雏形可扩。

**15. 每日晨报（Morning Edition）** 🔴
自有订阅聚合 → LLM 排版出一份「晨报」：头版头条+要闻+金句+分类版块，杂志化呈现、可 TTS 连播、可导出。与现有 AIHOT 外部热点日报互补（一个向内、一个向外）。借鉴 Kagi News 每日简报/Folo AI 日报。

**16. AI 侧栏研究员（引用定位问答）** 🟡
一键精读升级 NotebookLM 式：答案带原文引用锚点、点击跳转高亮原句、多轮追问、术语卡沉淀。已有 LLMService+划词 popover，增量在「引用定位」——把 AI 结论钉回原文，可信度跃升。

**17. 高亮复盘与外同步（Daily Review）** 🟡
间隔重复抽签复活旧高亮（每次约 5 条）做成每日卡片流；高亮+笔记一键同步 Obsidian/Notion（Markdown 管道、本地优先）。Readwise 验证过的知识闭环刚需；已有五色高亮+SQLite（KnowledgeEngine），就差「复盘仪式感」和「出口」。

### E. 多模态层

**18. 知更电台（TTS 2.0）** 🟡
本地 TTS 升级：播放列表连播（Instapaper 模式）、进度拖动、音色/倍速；生成私有 podcast RSS 供手机播客客户端订阅（AudioRead 成熟模式，LLMService 已有局域网 HTTP 底子）；远期接云端神经语音/双人对话播客（NotebookLM Audio Overview 形态，Omnivore 被语音公司收购=「读转听」被资本背书）。

**19. EPUB/纸刊 PDF 工厂** 🟡
文章→EPUB 导出（带封面/目录/内嵌字体）；单篇/整期→印刷级 PDF（print stylesheet+`@page`+Paged.js 页码页眉，`printToPDF`）。Pocket 关停最大教训=数据必须可带走；「把知更印成纸质」是杂志定位的情感闭环。

**20. 金句分享卡片工厂（Share Card）** 🟡
选中文本/高亮→生成杂志风分享长图（多模板：宋体大字报/文楷竖排/极简引文卡，含来源二维码），一键存图。微信生态传播刚需+增长钩子，竞品空白。

### F. 知识与效率层

**21. 阅读统计仪表盘** ⚪
阅读时长/字数/速度、每日 streak、周报、来源结构分析。轻量但留存利器，数据源现成（进度记忆+高亮时间戳）。

**22. 命令面板 + Vim 导航** ⚪
Ctrl+K 命令面板全功能可达、Vim 键位（j/k/d/u/gg/G）、快捷键备忘单。桌面端对 Power User 的差异化诚意。

**23. 智能稍后读队列** 🟡
队列按预估阅读时长+新旧排序、今日目标（读 N 篇）、超龄自动归档。反「只存不读」（Pocket 死因），把稍后读从「坟墓」变「收件箱」。

**24. 自定义 CSS 注入（Boosts 式）** ⚪
高级用户可给阅读页注入自定义 CSS+主题包导入导出画廊。借鉴 Arc Boosts——让用户「改页面」而非只调参数，社区生态入口。

## 五、路线图建议

> 落地进度（随实现更新）：✅ **第一波全部完成**。方向 1/4（排版引擎 v2：段落风格/对齐/字距/中文微排版 + cjk-micro.js 盘古之白 + text-spacing-trim）；方向 2 完整（内置霞鹜文楷 Screen v1.522 正文 + 得意黑 v2.0.1 标题通道，OFL 授权随包，正文字体三选、标题字体独立选字）；方向 6（每日刊头：报头双细线/封面故事/本期目录，杂志视图置顶）；方向 7 大部（首字下沉 + 图注编号排版；AI 金句提引卡与页边注留待 AI 侧管线成熟后接入）。✅ **第二波基本完成**：方向 15（今日简报）与 17（知识闭环：间隔复习/每日回顾/导出五件套/统计）经查**已存在**；方向 14 补全最后缺口——AI 对比速读（聚类行按钮 → 多源融合对比：一句话结论/各源侧重/分歧与互补，来源编号可跳转）；方向 13 落地——双语对照版式两态（逐句紧跟/对照分行，设置可选）。✅ **第三波进展**：方向 19 v1——单篇 EPUB 导出（零依赖 EpubBuilder：手写 ZIP+CRC32，mimetype 首条目 store 规范，经 Python zipfile 严格解析器独立校验；导出菜单新增「导出为 EPUB 电子书」）；方向 19b——整期 EPUB（EpubBuilder 升级多章节 builder，刊头「导出本期 EPUB」把当前列表 ≤40 篇打包成带目录电子书）；方向 24——自定义 CSS 注入（设置页实时编辑，热应用+跨重启保持）；方向 11——聚焦模式落地（禅模式经查已有，本轮补段落渐暗：胶囊按钮+F 键，指针所在段保持清晰）；方向 22——命令面板落地（Ctrl/Cmd+Shift+P 唤起，16+ 命令：作用域直达/视图主题切换/简报知识库设置/字号/订阅源直达，子串过滤+键盘导航，真键事件烟雾验证）；方向 20 分享卡片由并行工作完成（卡片导出 PNG + E2E）。剩余：19 的纸刊级 PDF 精排、18 知更电台、23 智能稍后读队列。探针：diag-phase9-typography / diag-phase9-font-smoke（7 步）/ diag-phase10-export 均入 run-all --ci 离线集（现共 7 项）。

- **第一波（排版地基+杂志具象化，1–2 个版本）**：1 排版面板 → 4 中文微排版 → 2 内置字库 → 6 每日刊结构 → 7 杂志内页版式。这五个连起来就是「知更=最好排版的中文阅读器」的完整叙事。
- **第二波（AI 结构化+闭环）**：14 同题聚类 → 15 每日晨报 → 17 高亮复盘/外同步 → 13 双语对照刊。
- **第三波（多模态+生态）**：19 EPUB/PDF 工厂 → 18 知更电台 → 20 分享卡片 → 3/9/11/23 其余按需。

**优先级判断依据**：① 排版/字体是竞品集体短板且是知更定位核心；② 聚类+晨报+复盘是「被验证的刚需」（ Pocket/Artifact 死亡反证）；③ EPUB/分享卡片兼具用户价值与传播价值；④ 分页/统计/命令面板价值真实但不构成叙事主线。

## 附：主要参考来源

- clreq（W3C 中文排版需求）https://www.w3.org/TR/clreq/
- 霞鹜文楷 https://github.com/lxgw/LxgwWenKai ｜ Screen 版 https://github.com/lxgw/LxgwWenKai-Screen ｜ 得意黑 https://github.com/atelier-anchor/smiley-sans ｜ 未来荧黑 https://github.com/welai/glow-sans ｜ 朱雀仿宋 https://github.com/TrionesType/zhuque
- cn-font-split https://github.com/KonghaYao/cn-font-split
- MDN：initial-letter / CSS multicol / text-wrap / scroll-driven animations / View Transitions / @page ｜ Paged.js https://pagedjs.org/
- Medium 排版体系 https://medium.design/cast-of-characters-99ddce3d1864 ｜ iA https://ia.net/topics/95-typography ｜ Typewolf https://www.typewolf.com/
- Readwise Reader 文档 https://docs.readwise.io/reader ｜ Kagi News https://blog.kagi.com/kagi-news ｜ Feedly AI https://feedly.com/new-features
- Pocket 导出页 https://getpocket.com/export ｜ 产品关停盘点（Failory/beemind 等）
