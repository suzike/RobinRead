'use strict';
/**
 * run-all.js — 回归探针统一入口
 *
 * 用法：
 *   node scripts/run-all.js          # 本地全量（含真实网络的探针）
 *   node scripts/run-all.js --ci     # CI 精简集（仅离线可判定的探针）
 *
 * 每个探针以退出码判定（0=PASS）；全部结束后打印汇总，任一失败则整体退出 1。
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const OFFLINE = [
  { file: 'scripts/diag-db-health.js', runner: 'electron', desc: 'FTS 行映射 + 嵌套事务 + 灌文性能（离线）' },
  { file: 'scripts/diag-needs-extraction.js', runner: 'node', desc: 'needsExtraction 判定（离线单元）' },
  { file: 'scripts/diag-phase8-gate.js', runner: 'electron', desc: '会员全量释放 + 默认刷新间隔（离线）' },
  { file: 'scripts/diag-phase9-typography.js', runner: 'node', desc: '排版引擎 v2：盘古之白 + 设置链路（离线）' },
  { file: 'scripts/diag-phase12-knowledge.js', runner: 'electron', desc: '知识增强：图谱数据/问答受控路径（离线）' },
  { file: 'scripts/diag-phase13-backup.js', runner: 'electron', desc: '自动备份：首查快照/配置/开关（离线）' },
  { file: 'scripts/diag-phase9-font-smoke.js', runner: 'electron', desc: '排版引擎+每日刊头真实渲染烟雾（离线）' },
  { file: 'scripts/diag-edition-magazine.js', runner: 'electron', desc: '期刊翻页 2.0：对开版面/折页/封面/滑轨（离线）' },
  { file: 'scripts/diag-edition-typography.js', runner: 'electron', desc: 'R1 阅读排版：密度/页边/首字下沉面板（离线）' },
  { file: 'scripts/diag-edition-paper.js', runner: 'electron', desc: 'R2 纸张质感：四态循环/夜间独立偏好/牛皮变量（离线）' },
  { file: 'scripts/diag-edition-selection.js', runner: 'electron', desc: 'R3 划词工具条：胶囊/复制/弹层/选区守卫（离线）' },
  { file: 'scripts/diag-edition-progress.js', runner: 'electron', desc: 'R4 阅读进度：滑轨剩余时间/文章进度线预估（离线）' },
  { file: 'scripts/diag-edition-lightbox.js', runner: 'electron', desc: 'R5 灯箱增强：滚轮缩放/双击/键盘切图（离线）' },
  { file: 'scripts/diag-edition-micro.js', runner: 'electron', desc: 'R6 版面微交互：落页错落淡入/hover 精修（离线）' },
  { file: 'scripts/diag-edition-cover.js', runner: 'electron', desc: 'R7 封面升级：期号大字/头条大图/无图回退（离线）' },
  { file: 'scripts/diag-edition-toc.js', runner: 'electron', desc: 'R8 滑轨分段/目录树状（离线）' },
  { file: 'scripts/diag-edition-colwidth.js', runner: 'electron', desc: 'R9 栏宽舒适度：三档切换/分页联动/持久化（离线）' },
  { file: 'scripts/diag-edition-find.js', runner: 'electron', desc: 'R11 期刊内搜索：Ctrl+F/计数/跳页定位（离线）' },
  { file: 'scripts/diag-edition-quick.js', runner: 'electron', desc: 'R12 快捷收藏/稍后读：S/L 键/回调/重绘（离线）' },
  { file: 'scripts/diag-edition-export.js', runner: 'electron', desc: 'R13 当前页导出：captureRect/剪贴板/浮层收起（离线）' },
  { file: 'scripts/diag-edition-keys.js', runner: 'electron', desc: 'R14 快捷键速查：? 呼出/8 行/Esc 往复（离线）' },
  { file: 'scripts/diag-edition-session.js', runner: 'electron', desc: 'R15 会话统计：翻页/读文累计/退出小结（离线）' },
  { file: 'scripts/diag-edition-fx.js', runner: 'electron', desc: 'R16 动作音效：tick/done/开纸声/开关静默（离线）' },
  { file: 'scripts/diag-edition-accent.js', runner: 'electron', desc: 'R17 纸感联动强调色：四态日/夜档位（离线）' },
  { file: 'scripts/diag-edition-resume.js', runner: 'electron', desc: 'R18 续读提醒：落位+文案/无记忆静默（离线）' },
  { file: 'scripts/diag-edition-focus.js', runner: 'electron', desc: 'R19 段落聚焦：P 开关/点击/↑↓/翻页重聚焦（离线）' },
  { file: 'scripts/diag-edition-palette.js', runner: 'electron', desc: 'R20 命令面板接入：期刊命令/翻页执行/z 层级（离线）' },
  { file: 'scripts/diag-palette-groups.js', runner: 'electron', desc: 'R21 面板分组小节头：组头渲染/键盘跳过/组名可搜（离线）' },
  { file: 'scripts/diag-row-quick.js', runner: 'electron', desc: 'R22 行内快捷操作：三键挂载/隐藏浮现/IPC 参数（离线）' },
  { file: 'scripts/diag-list-batch.js', runner: 'electron', desc: 'R23 批量多选：Ctrl/Shift 圈选/批量条/批设通道（离线）' },
  { file: 'scripts/diag-search-history.js', runner: 'electron', desc: 'R26 搜索历史下拉：Enter 记忆/去重上限/点选即搜（离线）' },
  { file: 'scripts/diag-list-nav.js', runner: 'electron', desc: 'R28 键盘导航：J/K 光标/钳位/Enter 打开/叠态（离线）' },
  { file: 'scripts/diag-cv-auto.js', runner: 'electron', desc: 'R30 跳屏渲染：cv:auto 行卡/可达性/渲染耗时（离线）' },
  { file: 'scripts/diag-r31-polish.js', runner: 'electron', desc: 'R31 精修：摘要净化/工具栏统一/纸感融合/封面图策略（离线）' },
  { file: 'scripts/diag-palette-move.js', runner: 'electron', desc: 'R32 面板零重建导航+开合动效（离线）' },
  { file: 'scripts/diag-render-sig.js', runner: 'electron', desc: 'R33 渲染签名去重+新到高亮（离线）' },
  { file: 'scripts/diag-edition-cache.js', runner: 'electron', desc: 'R34 重排缓存/margin 折叠装箱/内容守恒/will-change（离线）' },
  { file: 'scripts/diag-tools-relocate.js', runner: 'electron', desc: 'R35 工具条迁位/零干涉/真点击命中（离线）' },
  { file: 'scripts/diag-dup-img.js', runner: 'electron', desc: 'R37 同址重复图折叠/figure 壳清理/文本守恒（离线）' },
  { file: 'scripts/diag-img-ratio.js', runner: 'electron', desc: 'R38 图片宽高占位/表情豁免/失败不塌（离线）' },
  { file: 'scripts/diag-r39-details.js', runner: 'electron', desc: 'R39 细节：时间/来源悬停全量+清除键命中区（离线）' },
  { file: 'scripts/diag-r40-details.js', runner: 'electron', desc: 'R40 细节：chips 换行/历史键盘导航/工具条 aria（离线）' },
  { file: 'scripts/diag-r41-details.js', runner: 'electron', desc: 'R41 细节：失败图点击重试/空态刷新/star 提示（离线）' },
  { file: 'scripts/diag-r42-details.js', runner: 'electron', desc: 'R42 细节：输入收起历史/外链提示/iframe 懒加载（离线）' },
  { file: 'scripts/diag-r43-details.js', runner: 'electron', desc: 'R43 细节三连：速查面板 dialog/历史 listbox/窄窗进度让位（离线）' },
  { file: 'scripts/diag-r44-details.js', runner: 'electron', desc: 'R44 细节三连：滑轨键盘翻页/刻度 title/装载呼吸点（离线）' },
  { file: 'scripts/diag-r45-details.js', runner: 'electron', desc: 'R45 细节三连：chips 卫生/清除键 aria/批量条 toolbar（离线）' },
  { file: 'scripts/diag-r46-details.js', runner: 'electron', desc: 'R46 细节三连：底部呼吸点/zoom-in 光标/分割条 hover（离线）' },
  { file: 'scripts/diag-d2-urlread.js', runner: 'electron', desc: 'R-D3 链接精读：URL 抓取渲染/合成 entry（离线）' },
  { file: 'scripts/diag-d5-cardfull.js', runner: 'electron', desc: 'R-D5 卡片弹窗全屏切换/还原（离线）' },
  { file: 'scripts/diag-r47-motion.js', runner: 'electron', desc: 'R47 微动效三连：三出场动画规则命中（离线）' },
  { file: 'scripts/diag-r48-details.js', runner: 'electron', desc: 'R48 收官：弹层出场/目录关闭/reduce-motion 覆盖（离线）' },
  { file: 'scripts/diag-kb-trendfit.js', runner: 'electron', desc: '知识中心趋势图适配：画布四缘落在卡片内容区（离线）' },
  { file: 'scripts/diag-cardx-variant.js', runner: 'electron', desc: '卡片配色变体/封面滤镜实效：自适应路径+模板覆盖（离线）' },
  { file: 'scripts/diag-cardx-ratiohard.js', runner: 'electron', desc: '卡片画幅硬合同：超长文四档画幅精确生效（离线）' },
  { file: 'scripts/diag-cardx-scenes.js', runner: 'electron', desc: '场景排版系统：六画幅专属版式+预设切换+IPC 精确（离线）' },
  { file: 'scripts/diag-r49-details.js', runner: 'electron', desc: 'R49 细节三连：cardx 滚动条/焦点环/悬停说明（离线）' },
  { file: 'scripts/diag-r50-details.js', runner: 'electron', desc: 'R50 细节三连：Esc 关弹层/关闭键焦点环/图 hover 提亮（离线）' },
  { file: 'scripts/diag-r51-details.js', runner: 'electron', desc: 'R51 细节三连：列表 hover 时间/星标回弹/书签色条（离线）' },
  { file: 'scripts/diag-r52-details.js', runner: 'electron', desc: 'R52 细节三连：设置导航可达性/图标染色/滚动条（离线）' },
  { file: 'scripts/diag-r53-details.js', runner: 'electron', desc: 'R53 收官：面板空态出路/最近徽标/滚动条（离线）' },
  { file: 'scripts/diag-r54-openfeed.js', runner: 'electron', desc: 'R54 开卷三连：简报缓存落顶/文章微入场/续读提示降噪（离线）' },
  { file: 'scripts/diag-r55-escorder.js', runner: 'electron', desc: 'R55 浮层秩序三连：Esc 逐层裁决/模态焦点归还/胶囊仪式 Esc（离线）' },
  { file: 'scripts/diag-r56-press.js', runner: 'electron', desc: 'R56 按压纪律三连：active 态补齐/悬停不位移/命令面板退场（离线）' },
  { file: 'scripts/diag-r57-numeric.js', runner: 'electron', desc: 'R57 数字纪律三连：tabular-nums 全量/相对时间 60s 静默刷新/时长口径（离线）' },
  { file: 'scripts/diag-r58-truncate.js', runner: 'electron', desc: 'R58 截断与光学三连：line-clamp 口径表/截断必有出路/meta 行光学（离线）' },
  { file: 'scripts/diag-r59-emptyout.js', runner: 'electron', desc: 'R59 空态出路三连：空态 CTA 三态归簇/垂直节奏令牌化/搜索无结果清空出路（离线）' },
  { file: 'scripts/diag-r60-loading.js', runner: 'electron', desc: 'R60 加载语言三连：骨架形状令牌统一/图片shimmer与失败占位几何/动作按钮loading态（离线）' },
  { file: 'scripts/diag-r61-feedback.js', runner: 'electron', desc: 'R61 反馈语义三连：toast成功失败图标色语义/破坏性确认警示色/收藏星稍后读pop对称（离线）' },
  { file: 'scripts/diag-r62-darkparity.js', runner: 'electron', desc: 'R62 暗色parity三连：accent对比度实算审计/封面图亮度曲线档/阴影三档暗色映射固化（离线）' },
  { file: 'scripts/diag-r63-scroll.js', runner: 'electron', desc: 'R63 滚动细节三连：浮层内滚动条全量主题化/列表顶底edge淡出遮/新文章到达滚动锚定（离线）' },
  { file: 'scripts/diag-r64-toastorder.js', runner: 'electron', desc: 'R64 toast 秩序三连：堆叠上限3+同类合并×N计数/退场12px镜像对称/按钮键盘可达焦点暂停（离线）' },
  { file: 'scripts/diag-r65-forms.js', runner: 'electron', desc: 'R65 设置与表单三连：开关命中区≥40px+表格行hover同语言/focus环audit+字段级错误态/改动行内对勾确认样板（离线）' },
  { file: 'scripts/diag-r66-typo.js', runner: 'electron', desc: 'R66 阅读排版三连：标题断行balance扩面/--font-mono等宽单一事实源+引用块三家族归U5正典/hover零布局位移程序化固化（离线）' },
  { file: 'scripts/diag-r67-icons.js', runner: 'electron', desc: 'R67 图标语义三连：收藏星/稍后读时钟/已读勾全域同形/stroke 1.75归簇全量扫描/纯图标按钮title+aria双补（离线）' },
  { file: 'scripts/diag-r68-window.js', runner: 'electron', desc: 'R68 窗口与布局三连：极窄窗记档固化(主窗980/阅读窗480)/分栏把手双击重置出厂宽/禅模式进出焦点归还与滚动保位（离线）' },
  { file: 'scripts/diag-r69-gesture.js', runner: 'electron', desc: 'R69 手势与滚动三连：阅读器滚轮过滚动不冒泡/双击正文空白回顶/列表杂志互切保持滚动位置（离线）' },
  { file: 'scripts/diag-r70-retry.js', runner: 'electron', desc: 'R70 错误与重试三连：网络失败toast带重试动作/图片批量全部重试/AI面板inline重试（离线）' },
  { file: 'scripts/diag-r71-i18n.js', runner: 'electron', desc: 'R71 文案与国际化三连：句读全角口径固化/t()键表差集清零(160键补录)/日期本地化跟随界面语言（离线）' },
  { file: 'scripts/diag-r72-perceive.js', runner: 'electron', desc: 'R72 性能感知三连：冷启动静态骨架先行/长文分叶渐进渲染平滑/视图互切保位合并验收（离线）' },
  { file: 'scripts/diag-r73-consistency.js', runner: 'electron', desc: 'R73 收官一致性三连：z-index谱表文档化+值域固化/焦点环选区滚动条三件套accent终检/reduced-motion全量断言（离线）' },
  { file: 'scripts/diag-r74-details.js', runner: 'electron', desc: 'R74 正文排版语义件三连：kbd键帽/中文em着重号(cjk-em语言感知)/sub·sup行高保护（离线）' },
  { file: 'scripts/diag-r75-details.js', runner: 'electron', desc: 'R75 链接与文内锚点三连：#脚注导航修复(消毒层id转存+fragment保真+滚动闪高亮)/外链域名悬停/图链让位灯箱修双触发（离线）' },
  { file: 'scripts/diag-r76-details.js', runner: 'electron', desc: 'R76 列表与表格三连：任务列表复真(input→nj-task勾选态保真)/表格横滚左右缘渐隐遮/嵌套列表marker形态演进（离线）' },
  { file: 'scripts/diag-r77-details.js', runner: 'electron', desc: 'R77 图文节奏三连：图片加载完成淡入(nj-img-loaded+CSSTransition实证)/hr出版化双线菱形/文末终止符(不进朗读翻译单元)（离线）' },
  { file: 'scripts/diag-r78-details.js', runner: 'electron', desc: 'R78 收官三连：译文切换保位(比率恢复)/译文容器微排版+表格同享/F33真bug修复(译文容器display)+pre横滚提示同族（离线）' },
  { file: 'scripts/diag-r79-details.js', runner: 'electron', desc: 'R79 版面艺术品位三连：lead首段1.07em导语(缩进式让位)/h2下划线退役(U5-②短横线唯一章节标记)/42em行长护栏文字通道（离线）' },
  { file: 'scripts/diag-r80-details.js', runner: 'electron', desc: 'R80 动效编排三连：进文三拍(眉题→标题→meta 0/60/120ms njRise)/article-rise阶梯重排0.18s起(标题先行)/标题下划线scaleX生长（离线）' },
  { file: 'scripts/diag-r81-details.js', runner: 'electron', desc: 'R81 纸面质感三连：眉题folio线/阅读面网点微肌理(浅2.6%暗1.6%)/TTS高亮accent派生+硬编码rgba退役（离线）' },
  { file: 'scripts/diag-r82-details.js', runner: 'electron', desc: 'R82 阅读仪式三连：完读终止符IO绽放(reduced恒可见)/继续读行卡错峰/灯箱图注条延迟入场（离线）' },
  { file: 'scripts/diag-r83-details.js', runner: 'electron', desc: 'R83 艺术批次收官：新动效闭包+no-preference档位/60ms阶梯谱系归簇/JS reduced门全量/陈年digest-caret悬空补齐（离线）' },
  { file: 'scripts/diag-r84-details.js', runner: 'electron', desc: 'R84 沉浸刊头三连：首图全幅出血hero(槽令牌+max-width破框)/灯晕vignette(暗档加深)/农历folio(Intl中华历法hanidec)（离线）' },
  { file: 'scripts/diag-r85-details.js', runner: 'electron', desc: 'R85 结构谱三连：tocRail几何化落位+图点码条glyph/活跃章刻度生长+章节名1.4s闪光/进度线h2记号针（离线）' },
  { file: 'scripts/diag-r86-details.js', runner: 'electron', desc: 'R86 视点引导三连：Intl.Segmenter分词首重(中文1字/西文≤3字)/Aa面板开关+guideFocus持久化+布局事件即时重排/祖先链排除区(代码高亮span层不可绕)（离线）' },
  { file: 'scripts/diag-r87-details.js', runner: 'electron', desc: 'R87 长文折叠三连：h2章节折叠(真长文门/键盘可达/拖选链接不触发)/TOC与锚点跳转自动展开/折叠计数胶囊(attr呈现零文本污染)（离线）' },
  { file: 'scripts/diag-r88-details.js', runner: 'electron', desc: 'R88 滚动驱动收官：进度线scroll()时间线直驱(timeline-scope提升+档门)/插图view()视差微浮现/艺术批次闭包谱系审计（离线）' },
  { file: 'scripts/diag-r89-details.js', runner: 'electron', desc: 'R89/R90/R92/R93 排版度量基座：任意深度42em文字通道(table/pre子树豁免+em联动)/嵌套缩放地板(table13/pre12/code12——用户实见11.08px根治)（离线）' },
  { file: 'scripts/diag-r91-details.js', runner: 'electron', desc: 'R91/R94 diff形态治理：GitHub diff表语义化(±行底色/@@分段/行号槽)+裸pre patch识别hljs着色软换行+commit元信息卡+数据表横线律（离线）' },
  { file: 'scripts/diag-r97-details.js', runner: 'electron', desc: 'R94-②/R95/R97 头部秩序：动作分层核心2键+更多浮层(外点/Esc关)+chips≤3+标题-正文空洞收紧(divider12/16+顶槽22)+段落节奏基线（离线）' },
  { file: 'scripts/diag-r96-details.js', runner: 'electron', desc: 'R96 正文边缘净化：头部头像/阅读原文/关联链接农场清除(实文≥50字停扫)+尾部链接农场清除+正文保全（离线）' },
  { file: 'scripts/diag-r99-details.js', runner: 'electron', desc: 'R99 commit页头噪音簇子元素清扫(Browse/SHA链接+avatar头像+作者碎片, diff表门控零波及)+进度线0%气泡静默（离线）' },
  { file: 'scripts/diag-tts-neural.js', runner: 'node', desc: '神经语音 GEC v2 修复：EdgeTTS 原生客户端(魔改SHA256+CS64逐位移植)+官方Python对拍黄金值+msedge-tts 弃用（离线单元）' },
  { file: 'scripts/diag-edition-speak.js', runner: 'electron', desc: 'R116 期刊神经语音朗读链：er-speak钮+正文分块≤600字+链推进完毕归空+Esc中途停读不退刊+回版面停读兜底+引擎音色语速块长跟随配置（离线stub）' },
  { file: 'scripts/diag-auditfix-main.js', runner: 'electron', desc: '2026-10 审查修复·主进程：更新校验/缓存命中/取消链/VACUUM映射/写盘token（离线）' },
  { file: 'scripts/diag-auditfix-render.js', runner: 'electron', desc: '2026-10 审查修复·渲染层：监听器退订/灯箱/竞态/键盘单触发/搜索闭环（离线）' },
  { file: 'scripts/diag-auditfix-ui.js', runner: 'electron', desc: '2026-10 审查修复·视觉：进度条/缓动/暗色/accent-ink/衬线栈/透明阶梯（离线）' },
  { file: 'scripts/diag-u1-u5.js', runner: 'electron', desc: 'U1–U5 视觉轮：阴影/动效令牌归簇+侧栏折叠动画与指示条+行卡抬升与光标左条+阅读排版（离线）' },
  { file: 'scripts/diag-u6-u10.js', runner: 'electron', desc: 'U6–U10 视觉轮：暗色表面三档与阴影加深档+季节套包+图标描边/阶梯统一+滚动条 hover 加宽与 smooth 限锚点+resize 过渡抑制（离线）' },
  { file: 'scripts/diag-u11-u15.js', runner: 'electron', desc: 'U11–U15 视觉轮：插画空态与骨架屏/进度语言+按压开关悬停微交互+Toast 栈三态与进度通知+设置全屏化导航搜索+期刊封面确定性版画（离线）' },
  { file: 'scripts/diag-u16-u20.js', runner: 'electron', desc: 'U16–U20 收官视觉轮：chart-kit 图表 dpr/令牌色/入场动画（折线生长/柱条升起/reduced-motion 终态）+命令面板 2.0（模糊高亮/图标行/预览窗格）+焦点环三档与设置/自进化导航 ↑↓+标题栏拖拽态与 snap 提示层+字号阶梯归簇与跨视图漂移合并（离线）' },
  { file: 'scripts/diag-u21-25a.js', runner: 'electron', timeout: 480000, desc: '视觉批 1：U21 字体族套装（四套版式皮肤+自定义字体+设置选择器/输入/即时预览+持久化+reader 双变量链）+U22 共享元素转场（FLIP 快照/幽灵飞入/reduced-motion 直达）+U23 主题切换渐变（过渡类 300ms 摘除/启动不渐变）+U24 触控板手势（捏合字号/滚动语义保持/触屏长按右键）+U25 阅读年报（年度聚合/四数据卡 countup/关键词云/确定性 SVG 分享卡）（离线）' },
  { file: 'scripts/diag-u26-30.js', runner: 'electron', timeout: 480000, desc: '视觉批 2：U26 高 DPI 走查（125/150/175% 缩放仿真三档——三栏不塌视口钳制/列表行高一致/阅读器版心/底栏 6×2 不折行/设置分区零横向溢出）+U27 微交互音效（WebAudio 三枚合成音振荡器+增益包络 ≤0.3s+设置→通用开关默认关+能力不可达静默）+U28 拖拽体系（列表行拖入收藏/稍后读批量加入+放置高亮+订阅源树同组拖拽排序插入位指示持久化 feeds.sort_order）+U29 打印排版（@media print 浮层家族隐退/标题防孤行/正文单栏全宽+阅读器一键打印按钮+CDP 打印媒体仿真）+U30 命令面板自学习（执行频次 preferences JSON map 200 条上限+相关度+频次对数排名提升+最近使用保留）（离线）' },
  { file: 'scripts/diag-u31-35.js', runner: 'electron', timeout: 480000, desc: '视觉批 3：U31 空态二期（empty-art 14+ 场景库+七视图空态接线 stagger 壳+插画/标题/副文案 0/60/120ms 错峰阶梯令牌+reduced-motion 豁免 CDP 仿真）+U32 统一进度语言（.nj-progress 双形态令牌组件：确定式进度条+百分比/不确定式呼吸点+Toast.breathe 呼吸进度通知+progressElement 内联工厂+三长任务接线：WebDAV 同步/播客转写/阅读器逐句翻译）+U33 侧栏 2.0（计数徽标 9+ 封顶与零值隐藏统一口径 formatBadgeCount+折叠文件夹拖拽悬停 450ms 自动展开 drag-pending+底栏 12 键 6×2 三分组分隔线）+U34 阅读器边注（readerLayout.marginNotes 默认关+设置外观批注呈现开关+开启后锚段对齐 200px 边注列+防重叠顺延+<1200px 自动回退内联+重启读回）+U35 划词浮条 2.0（buildSelectionActionPlan 动作注册表纯函数：内置 AI 三键+复制+高亮+笔记+脚本 add-actions+外部注册口/脚本动作首字母徽章图标化/溢出折叠「…更多」二级弹出）（离线）' },
  { file: 'scripts/diag-u36-40.js', runner: 'electron', timeout: 480000, desc: '视觉批 4（收官批）：U36 杂志卡 2.0（封面卡三变体自动选型 classic 经典居中/split 左图右文/immersive 全幅沉浸 pickMagCardVariant 纯函数+悬停视差 --nj-par-x/y 钳位 ±6px+reduced-motion 双门豁免）+U37 表格化高级设置（规则列表六列表格 优先级/名称/操作符/动作/命中数/启停+行内启停开关与优先级微钮+FreshRSS 账号表+邮箱账户表+settingsTable 通用表格）+U38 首启引导流（无订阅源判定+localStorage 记账三步浮层：欢迎添加订阅/AI 配置可跳过/完成揭示快捷键卡+设置→通用重看引导重开入口）+U39 全屏阅读仪式感（禅模式进入/退出呼吸编舞 遮罩→标题→正文 0/60/120ms 三级 stagger+聚焦模式顶部细进度线）+U40 终局一致性 pass（批 F-I 七视图令牌审计零裸值程序化扫描+仪式时长令牌四档 grow/spin/breathe/pulse+徽章/旋转家族同值归簇+标点全角审计）（离线）' },
  { file: 'scripts/diag-r45-details.js', runner: 'electron', desc: 'R45 细节三连：chips 卫生/清除键 aria/批量条 toolbar（离线）' },
  { file: 'scripts/diag-r39-details.js', runner: 'electron', desc: 'R39 细节三连：时间/来源悬停全量+清除键命中区（离线）' },
  { file: 'scripts/diag-r40-details.js', runner: 'electron', desc: 'R40 细节三连：chips 换行/历史键盘导航/工具条 aria（离线）' },
  { file: 'scripts/diag-card-export.js', runner: 'electron', desc: '精读卡片导出：解析器+模板+离屏截图（离线）' },
  { file: 'scripts/diag-f1-fulltext.js', runner: 'electron', desc: 'F1 全文抓取：三态偏好/后台队列补抓入库/FTS/并发≤2/存量回补/徽标（离线）' },
  { file: 'scripts/diag-f2-rules.js', runner: 'electron', desc: 'F2 过滤规则：CRUD/灌文规则生效/作用域/操作符/正则安全/测试器/回放幂等/单事务/耗时回归（离线）' },
  { file: 'scripts/diag-f3-media.js', runner: 'electron', desc: 'F3 媒体中心：enclosure入库/媒体视图筛选/单实例/进度续播/倍速/队列连播/离线下载/TTS互斥/查询耗时（离线）' },
  { file: 'scripts/diag-f4-topics.js', runner: 'electron', desc: 'F4 话题盯梢：CRUD/三路聚合/AI精筛降级/滚动保留/频率/视图渲染/触点（离线）' },
  { file: 'scripts/diag-f5-platform.js', runner: 'electron', desc: 'F5 平台适配：v15迁移/B站与微博适配器(mock)/UID提取/添加UI四tab(含网页追更)/试抓预览/刷新分派/媒体联动/去重/耗时回归（离线）' },
  { file: 'scripts/diag-f6-mail.js', runner: 'electron', desc: 'F6 邮件订阅：v16迁移/密码DPAPI不落库/IMAP客户端(mock IMAPS真TLS)/MIME解码/账户与白名单/刷新增量与幂等/正文消毒/断线恢复/并发≤2/耗时回归（离线）' },
  { file: 'scripts/diag-f7-sync.js', runner: 'electron', desc: 'F7 WebDAV 同步：客户端PROPFIND/GET/PUT/MKCOL/MOVE与错误分类/超时/快照roundtrip与8MB与5000护栏/合并幂等并集新者胜/双设备端到端假DAV/本地优先红线/自动同步节流/冲突不上传/凭据DPAPI/设置分区与命令面板/刷新不受影响（离线）' },
  { file: 'scripts/diag-f8-research.js', runner: 'electron', desc: 'F8 AI 研究：v17迁移与老库升级/gather本地FTS相关度与AIHOT注入与去重与上限/AIHOT失败降级/流式生成落库/引用编号约束提示词/取消草稿保留与再次覆盖/追问追加区段/历史重开删除/单飞锁/无Key降级/知识中心tab与命令面板与引用芯片UI（离线）' },
  { file: 'scripts/diag-f9-rag.js', runner: 'electron', desc: 'F9 全库 RAG：v18迁移与老库升级/gather四路(FTS文章+知识库+正文缓存命中段截窗+AIHOT)与去重与上限30/正文检索限集EXPLAIN与200篇10MB级耗时<300ms/ask流式落库与sources_json与引用编号约束prompt/多轮上下文同会话含首轮QA新会话隔离/无Key明确报错与纯检索不调LLM/单飞锁与取消保留已流/会话列表重开删除级联重命名/知识中心会话侧栏与消息气泡与引用芯片与素材浮层与取消按钮UI/旧kb:ask入口与tab切换清理订阅回归（离线）' },
  { file: 'scripts/diag-f10-picks.js', runner: 'electron', desc: 'F10 智能精选：标题分词画像(30天行为×词频 Top120)/评分排序(命中0.6+源打开率0.25+新鲜度0.15)与已读稍后读排除/新鲜度同分新者先/空画像降级纯新鲜度+提示态/不感兴趣24h排除注入时间过期/UI精选切换与画像摘要条Top8chips与行渲染与名次/播报文稿本地模板含TopN标题与TTS mock与媒体互斥/200篇<200ms/排除重启持久化/列表简报媒体回归（离线）' },
  { file: 'scripts/diag-f11-obsidian.js', runner: 'electron', desc: 'F11 Obsidian 导出：pickDirectory对话框mock与内存token授权(未授权拒绝/取消不变/重启实例失效)/文件树Articles+Highlights+_meta游标/文件名sanitize与id8/frontmatter字段与YAML冒号引号转义与tags并集/HTML转MD无残留标签/1MB截断/增量hash命中零写mtime不变/改1条仅重写该文件/用户文件永不删除/全量重导全重写/坏JSON游标容错自愈/3000高亮2000护栏/只导高亮范围开关/设置Obsidian分区渲染与预览统计（离线）' },
  { file: 'scripts/diag-f13-similar.js', runner: 'electron', desc: 'F13 相关文章+线索：similar 相关性/500 篇性能/reader 文末卡片/线索聚类/追踪话题（离线）' },
  { file: 'scripts/diag-f14-sort.js', runner: 'electron', desc: 'F14 智能排序+密度：画像排序/空画像降级/密度三档/四态透传/200ms（离线）' },
  { file: 'scripts/diag-f15-tags.js', runner: 'electron', desc: 'F15 AI 自动标签：继承打标(v20)/AI 批量打标(mock LLM)/解析失败静默/每小时节流注入时间/复核过滤 chips/图谱含 AI 标签/无 Key 静默/开关持久化+设置知识分区（离线）' },
  { file: 'scripts/diag-f16-dashboard.js', runner: 'electron', desc: 'F16 源体检仪表盘：指标聚合与健康分(A>B,B红)/总览三计数/缓存 60s 注入时钟/建议文案/详情接口/UI tab 渲染与过滤/203 源 <300ms 无 N+1（离线）' },
  { file: 'scripts/diag-f12-books.js', runner: 'electron', desc: 'F12 文集成书：v19迁移与幂等与老库无损/文集CRUD与右键加入文集菜单/60篇成书EPUB结构(mimetype/nav/3月分章/60篇/源icon封面与纯色回退)/1000篇5卷每卷200确定性/自动成书24h节流与有新文章才成与manual不自动/书架UI列表待取徽标按钮/打开目录showItemInFolder与待取清除/200篇<2s/feed_ids持久化独立连接回读/删除清理自动目录且用户pickSavePath书保留（离线）' },
  { file: 'scripts/diag-f17-windows.js', runner: 'electron', desc: 'F17 多窗并读：弹出窗创建与标题/同 entryID 聚焦去重/上限4窗第5拒/主窗关闭级联/弹出窗 reader 渲染+已读批注写回同库/右键与工具栏入口/TTS媒体构造选项禁用（离线）' },
  { file: 'scripts/diag-f18-monitor.js', runner: 'electron', desc: 'F18 网页追更：v21迁移与级联与幂等/首抓只存基线零文章/变化合成文章含ins高亮与缓存通路/段落删除折叠N段已移除/无变化零文章/追更源列表侧栏正常/更改选择器重建hash与重抓基线/停止追更不再抓取/30min节流注入时间与force跳过/500KB提取diff<1s（离线）' },
  { file: 'scripts/diag-f19-radio.js', runner: 'electron', desc: 'F19 简报电台：模板文稿降级(无AI Top10含日期开场)/AI改写mock与失败静默降级/分句合成链mock逐句预取/上一句下一句暂停停止/位置记忆跨重启续听hash失效/四方互斥(开电台停媒体朗读精选反向亦然)/合成缓存同hash零重合成/简报浮层+命令面板入口/胶囊句序第X/Y句（离线）' },
  { file: 'scripts/diag-f20-goals.js', runner: 'electron', desc: 'F20 阅读目标与专注会话：目标持久化(日/周/0=关/越界钳制)/进度环3篇5目标60%/达标恭喜一次性同日跨重启不重复/周进度条聚合/专注面板倒计时注入时间加速/会话小结计数与剪贴板/中途退出确认/目标关闭进度环隐藏（离线）' },
  { file: 'scripts/diag-f21-events.js', runner: 'electron', desc: 'F21 事件聚类去重：v22迁移与老库无损/多源相似标题聚成一簇/不相似不聚/增量入库并簇与代表迁移/7天窗口外不聚/阈值边界0.55/幂等与rebuild补跑零重复/summaries载荷(N源/成员/死簇回收)/事件模式渲染(工具栏切换/分组卡/收合态代表/N源徽标/展开成员/作用域过滤)/入库钩子不阻塞灌文/500条聚类<2s（离线）' },
  { file: 'scripts/diag-f22-transcribe.js', runner: 'electron', desc: 'F22 播客转文字稿：v22迁移/mock ASR端点(multipart+模型+鉴权头+segments)/默认关闭未配置报错与非法URL拒绝/状态机queued→running→done/进度推送含转写中%/失败HTTP500落error列与重试恢复/单飞排队maxActive=1/本地优先零远端请求/临时文件即删/幂等/FTS关键字过滤(含<3字符LIKE回退与kind叠加)/AI摘要无Key拒绝与mock生成落库/UI转写按钮未配置灰置与稿徽标与文字稿面板时间戳与复制与摘要置顶与Esc让位/配置与文字稿跨重启持久化（离线）' },
  { file: 'scripts/diag-f23-garden.js', runner: 'electron', desc: 'F23 知识花园·知更养成：v23迁移与老库无损/数值模型(完读浇水/批注种子N字门槛/断读枯萎一级不掉回零/长假封顶两级/回读复活/连击重计/防刷UNIQUE单次)/五阶段跃迁纯函数与服务级/知更羽毛五档升级/开花报告(7天窗口/阶段跃迁/新开花投影)/markRead与批注钩子接线/gardenArt确定性SVG逐字节同输出/浮层花园+报告双tab/阶段跃迁入场动画/reduced-motion豁免/侧栏花园徽章/Esc关浮层（离线）' },
  { file: 'scripts/diag-f24-mirror.js', runner: 'electron', desc: 'F24 观点对照镜：v23迁移perspectives/召回(相似引擎复用/时间差≥14天同文异龄优先/不同源加分/噪声过滤/不含自身)/mock LLM批量判定(一次prompt/JSON解析/围栏容错/非法relation兜底none/坏输出parseFailed不落库)/持久化防重(同对二次mirror零调用/唯一约束)/单飞锁与cancelAI取消零落库canceller清理/无Key降级(相似旧文明示未判定零调用)/UI按钮显隐(观点词/AI可用/两者皆否)/判定中转圈与取消/侧板三组卡片流(标题+日期+理由)/卡片点击跳转/降级侧板/空态/换文无残留（离线）' },
  { file: 'scripts/diag-f25-debate.js', runner: 'electron', timeout: 480000, desc: 'F25 AI 反方辩手：v24迁移debates(status/verdict CHECK)与老库重启无损/钢人开场(mock LLM)落库/编造引用过滤/多轮回合流(用户+AI顺序/回合计数)/轮数上限6超限拒绝/verdict两态落库与重复裁决拒绝/存为批注落highlights管线+花园种子钩子/单飞互斥(requestInProgress+canceller注册debate:<entryID>)/取消空场收场发言保留canceller清理/空场复用不堆行/prompt注入防护(article包裹+4000截断+用户发言只进reader区不进system+伪标记中性化)/解析器围栏与纯文本降级/无Key灰置与missingAPIKey拒绝/一篇多辩历史保留/UI灰置与开场气泡与引用芯片高亮跳转与用户气泡与回合推进与裁决定格与存为批注（离线）' },
  { file: 'scripts/diag-f26-quiz.js', runner: 'electron', timeout: 480000, desc: 'F26 读后点亮测验：v24迁移quizzes/quiz_lights/review_queue加列与老库重启无损/出题JSON容错(围栏+杂文/坏JSON null/非法选项数剔题/越界answer剔题/超量截3/空选项)/出题落库与单飞互斥canceller/取消空卷/坏输出拒绝可重试/判分逐题结果/最高分保留与最近一次投影/点亮quiz_lights PK防重与未达标不点亮/图谱合并投影lit=1+litCount/错题SM-2真实入队(source=quiz+quiz_json快照/同毫秒多卡不互吞/dueReviews投影/记忆曲线评分)/无Key灰置/UI按钮500字显隐与无Key灰置/浮层三题逐答/出分+点亮+复习队列提示+历史最高/解析回显/再测一次/关闭浮层（离线）' },
  { file: 'scripts/diag-f27-capsule.js', runner: 'electron', desc: 'F27 时间胶囊：v25迁移time_capsules(status/annotation_kind CHECK)与highlights/notes origin加列与索引/封存30-90-365天open_at精确与非法期限拒绝与批注缺失拒绝与同批注在途防重与留言截断/到期懒结算(未到期不浮出/注入时钟到期浮现/同日多枚open_at升序/pendingCount/opened即剔防重复/due幂等无定时器)/开启仪式数据面(status翻转+opened_at+opens_count/批注原文+文章上下文/alreadyOpen幂等/笔记胶囊/批注已删降级)/简报段投影(只含到期sealed/标题+原文+封存天数/DIGEST_MAX封顶/开启后剔除)/时钟回拨不浮出/重启读回胶囊与opened历史与origin列无损/preload-IPC-reader封存卡-侧栏徽章-app浮层仪式简报段-CSS reduced-motion豁免-i18n锚点/UI徽章计数+浮层到期卡+开启仪式文案+前往文章+徽章回落（离线）' },
  { file: 'scripts/diag-f28-bundle.js', runner: 'electron', desc: 'F28 批注漂流瓶：导出包结构(format/version/文章元数据/正文消毒/批注全量含anchor颜色/suggestedName.robin/轻量模式)/三道闸(恶意HTML白名单剔除script-iframe-onerror/超10MB拒绝/版本不符与format不符与坏JSON明确报错)/漂流入库(platform=drift合成源/确定性entryID/正文缓存is_sanitized/作者署名/同源重导URL归并)/同源合并(已存在只并批注/同文同位哈希去重/冲突同位异文并存不覆盖/origin=imported+uid落库/整包重导零重复/超大anchor截断/条数封顶500)/再导出往返(导入身份随身携带/落盘读回一致/跨库导入批注存活/uid跨库保持/B库重导零重复)/pickSavePath mock写盘与取消零写盘/右键菜单打包(mock保存对话框真写盘)/命令面板导入(mock打开对话框真导入+toast统计)/漂流文章入列表（离线）' },
  { file: 'scripts/diag-f29-weekly.js', runner: 'electron', desc: 'F29 AI 周刊编辑部：v26迁移weeklies(status CHECK/week_start UNIQUE)/聚合窗口(周一起止本地时区/窗外不进版面/标题来源标签批注)/无Key模板降级(template=true/无AI导语/标签聚合+完读排行/空窗口failed)/mock LLM合同(导语≤200/编造ID板块整块丢弃/混合板块剔编造留真文/金句逐字校验编造出局/坏输出failed可重试)/week_start防重(幂等alreadyReady/原生INSERT撞UNIQUE)/取消重试(canceller注册清理/取消落failed/重试翻ready)/自动触发(周一踢上周刊/周内一次节流/非Monday跳过/AppStore刷新钩子)/EPUB结构(PK魔数/mimetype/OPF书名第N期/板块分章金句末章/非ready拒绝)/重启读回(跨迁移无损/期号升序倒序列表)/preload-IPC-侧栏入口-视图锚点-CSS-i18n/UI报头期号日期范围板块金句历史导航Esc（离线）' },
  { file: 'scripts/diag-f30-course.js', runner: 'electron', desc: 'F30 自学课程引擎：v26迁移courses(status CHECK/days_total)与course_days(PK即UNIQUE/completed_at)与重复落库拒/无Key拒绝(missingAPIKey零残留/available灰置数据面)/候选召回(关键词扩展/FTS多词合并去重/180天窗外剔除/标签双向包含通道/封顶40/召回为空明确报错)/大纲生成(围栏容错/编造文章ID剔除计数/20天越界钳制14/缺天回填/每天1-3篇/同文不重复/要点落库/7天档/clampDays/坏JSON零残留)/今日课推进(day1起步/跳天拒绝/未读完拒绝含计数/打卡进度1-14/重复打卡幂等/解锁下一天/新一天未读态/quizHook预留)/放弃与重建(abandon/已弃打卡拒/todayCourse finished/重复放弃拒/重建新行共存/active在前)/毕业(7天逐日打卡courseDone/status=done/todayCourse finished)/preload-IPC-侧栏-视图锚点-CSS令牌-i18n/UI课程卡进度条今日课文章行读完自动勾选完成打卡推进/无Key创建键灰置与表单文案/重启读回进度保留（离线）' },
  { file: 'scripts/diag-f35-voice.js', runner: 'electron', desc: 'F35 语音指挥舱：口令表模糊匹配单测(zh/en 暂停继续停止/下一篇/上一篇/收藏长短语优先/讲重点/关闭浮层/口语噪声/未知口令null/空串纯标点null/归一化空格标点)/服务开关默认关与跨重启持久化与快照voiceEnabled投影/能力探测降级(mock 不可用→口令按钮环6键替浮球且真实可用:下一句推进/收藏真IPC落库/暂停toggle)/互斥(开关关播放中不浮出/非朗读态不挂识别/播放中挂mock SR zh-CN continuous/停止摘除)/浮球识别文本+动作标签气泡/未知口令只展示不动作/权限拒绝denied不再重试/无Key讲重点跳下一篇/关闭浮层/设置语音分区开关+能力徽章+口令表6行+Web Speech隐私说明/preload-IPC-icons-CSS零字面量-i18n锚点（离线）' },
  { file: 'scripts/diag-f36-clock.js', runner: 'electron', desc: 'F36 阅读生物钟：v27迁移reading_clock(PK(day,hour)/hour CHECK 0-23/count+total_ms)/小时桶累计(onRead喂count重复已读幂等/pulse喂total_ms超限钳制噪声丢弃)/markRead钩子注入时钟定桶/高峰判定(7天窗口/加权纯函数近一天胜6天前30次/Top2确定性/相邻合并窗口HH:00-HH:00)/冷启动样本<20不判定/窗口边界8天前不进窗+35天惰性清理/对齐动作(刷新锚点偏峰建议HH:00/锚点在峰不提示/无锚点给建议/无峰静默/峰内专注提示一次性每天/开关关不提示)/三开关跨重启读回+快照preferences.clock投影/热力条UI 24桶+高峰cell+样本注记+对齐三开关/简报生物钟行浮出与开关关隐藏/刷新设置页建议条/专注提示条浅色主题+进入专注模式+同日一次/reader脉冲clockPulse通道静态锚点/CSS零字面量/注入时钟确定性（离线）' },
  { file: 'scripts/diag-f33-autotrans.js', runner: 'electron', desc: 'F33 外文源自动译：v28迁移translations(PK item_id/lang/translated_html/segments_json/is_complete/FK级联)与archives同批/分段切分(块级边界/碎块合并/单巨块不硬切)/mock LLM多块逐块译按序拼接/消毒(LLM输出script-iframe-onerror-onclick剥除后才落库/进LLM输入已消毒)/幂等(完整译文零请求cached=true/hasTranslations批量探测)/单飞并发≤2队列排队重复入队防重/订阅开关(默认关/中文条目不入队/开开关kick灌文入队后台译完/关开关登记失效)/失败重试断点续译(块2连败failed登记segments保留0-1/重试不重译已完成块/修好后续译完成)/取消队列摘除等待方唤醒/无Key灰置拒绝/列表译徽标投影与UI/阅读器译文按钮双容器切换与进度/设置自动翻译分区/i18n（离线）' },
  { file: 'scripts/diag-f34-archive.js', runner: 'electron', desc: 'F34 网页存档馆：v28迁移archives(PK item_id/html_captured/captured_at/html_size/FK级联)与translations同批/存档落行体积字节口径/重存档覆盖更新/空正文拒绝/6MB超限拒绝rejected计数/列表搜索(标题/来源LIKE/倒序/来源时间体积投影)/统计篇数字节与取消存档联动/MHTML结构(MIME-Version/multipart+boundary开合配对/charset-TransferEncoding-ContentLocation/RFC2047标题/正文撞边界轮换/未存档报错)/回落判定(无缓存无正文回落fromArchive/缓存空壳回落/健康缓存不回落/取消存档回落失效)/追更自动存档(默认关/开关持久化/灌文钩子快照/关闭不快照)/存储统计接入/右键存档此文/侧栏存档馆入口/存档馆浮层列表搜索导出(mock保存对话框真写盘)取消/存档模式徽记横条/i18n（离线）' },
  { file: 'scripts/diag-f37-revisit.js', runner: 'electron', timeout: 480000, desc: 'F37 深读重访：v29迁移revisits(entry_id UNIQUE/status CHECK/guidance_json)与source_profiles同批与重启无损/登记三道闸(markRead钩子长文≥1500字 due=read_at+30d/短文跳过/已有SM-2复习卡跳过同文不重复登记/UNIQUE防重/不存在拒绝)/30d到期懒结算(未到期零浮出/到期浮现标题来源距上次天数/多卡due升序)/done-skipped推迟语义(done终态不复浮/skipped新due过后结算翻回pending再浮出/max(原due,回应时刻)起算晚回应不瞬到/非法动作与缺卡拒绝/revisit:changed推送)/每日一次温和提示(nudge当天呼吸一次同日不重复次日再呼吸空计数不呼吸)/AI重读指引(mock生成3条落库/缓存防重烧二次零LLM/批注进prompt/解析容错围栏杂文坏JSON纯数字剔除超量截3/points备用合同/坏输出拒绝不落缓存/无Key降级degraded零LLM/单飞互斥canceller取消)/注入时钟确定性/侧栏徽章+浮层到期卡+指引卡片流+已读过了退场+Esc/UI阶段150s竞速SKIP（离线）' },
  { file: 'scripts/diag-f38-spectrum.js', runner: 'electron', timeout: 480000, desc: 'F38 来源立场光谱：v29迁移source_profiles(feed_id PK/profile_json/analyzed_at/FK级联)与revisits同批与重启无损/批量画像JSON合同容错(围栏杂文/profiles对象与裸数组双合同/单元素裸数组形状/越界index剔除/缺index顺位兜底/重复index先到先得/非法spectrum剔条badSpectrum计数/越界钳位±100/非法风格置空画像保留/全无效null可重析)/布点投影(-100→0/+100→1/0→0.5/同值近邻抖动错开次序保持/22点同值压缩回收轴内/超容量不越界)/Top20源选取(近90天完读计数排序/窗外不进/LIMIT/删除源不进)/批量分析一批prompt/缺槽不落下次补判/无Key灰置grey+说明零LLM/7天过期重析(expired计数/needsReanalyze刷新钩子/profile过期视同无)/force全量重析/forEntry文章级联动(有画像带画像/无画像null)/单飞锁canceller取消/注入时钟确定性/阅读器光谱小图标显隐有画像显无画像隐+popover位置标记画像风格tag/知识中心光谱tab轴+布点+点源详情+分析按钮过期重析真IPC（离线）' },
  { file: 'scripts/diag-f39-api.js', runner: 'electron', timeout: 480000, desc: 'F39 阅读数据开放 API：配置与令牌(默认端口7962/端口1024-65535校验/令牌启动生成落库)/生命周期(start同步/127.0.0.1绑定实证/stop端口立即释放/幂等/重启/退出自动stop+main.js锚点)/鉴权(无token 401/错token 401/空Bearer 401/正确Bearer 200/tokenMatches timingSafeEqual)/只读红线(POST 405/未知404/无token写方法401鉴权先行/全响应无CORS头)/五端点JSON形状与分页(stats存储+阅读统计/feeds标题+健康分+无凭据/annotations分页limit-offset+翻页+越界空页+正文全文永不出现/reading-clock 24桶/capsules/weeklies元数据)/限流(125发120过5限429+Retry-After/计数在案)/请求日志开关(开记/关清)/令牌重生成(旧即刻失效新可用落库)/设置分区UI真渲染(徽标/端口/令牌)+api:* IPC真调用/静态锚点(preload/IPC/分区/CSS/i18n/AppStore自启/零依赖node:http)（离线）' },
  { file: 'scripts/diag-f40-challenge.js', runner: 'electron', timeout: 480000, desc: 'F40 挑战赛季：v30迁移challenges(列齐备/status CHECK/索引)+garden_state.challenge_decor列+老库重跑幂等/模板挑战零AI(3模板全可用/新源尝鲜5源各1篇spreadFeeds/书单真实存在/窗口=days×86400)/LLM书单合同容错(mock编造ID剔除/同文去重/不足回填/围栏杂文/坏JSON invalidResponse零残留/解析器entries与裸数组双合同)/单飞active唯一(第二创建拒绝dedupCreate/放弃后可再开)/进度懒算+提前完成(markRead真钩子计进度/重复完读防刷/读满target即刻done+reward_granted+花园限定装饰到账challenge_decor/重复不重复发奖)/超时failed(ends_at过懒结算翻failed/无装饰无扣分温和设计)/挑战卡SVG确定性(同输入逐字节同输出/不同令牌色与完成数不同/主题XSS转义)/放弃重建(非active拒弃/重建共存/failed-abandoned历史诚实展示)/重启读回(挑战行+装饰无损)/UI花园浮层第3tab+模板3按钮+UI创建挑战进度条剩余天数书单勾选+历史failed徽标+Esc/静态锚点(preload 6通道/IPC/花园视图/CSS/i18n/AppStore钩子/迁移链)（离线）' },
  { file: 'scripts/diag-f31-pocket.js', runner: 'electron', timeout: 480000, desc: 'F31 口袋知更：配置(默认关/7963/loopback/端口1024-65535校验/令牌首开生成落库)/生命周期(start同步/127.0.0.1绑定实证/幂等/可连/stop端口立即释放/重启)/绑定模式(无confirmLan拒绝/确认切0.0.0.0运行中重启生效/accessURL局域网IP/切回)/鉴权(无token登录页/错token登录页/login 302+HttpOnly cookie/错登录报错)/列表页(标题来源/XSS转义/分页20+翻页/未读过滤/过滤出口)/文章页(标题+正文/服务侧script-iframe再消毒/标为已读表单/上一篇下一篇/done回执/404)/已读回传(无token 401/带token 302/真落库is_read/不存在404/表单token通路/其他写方法不放宽)/限流(注入时钟61发60过1限429+Retry-After)/二维码(未运行null/运行url+svg/确定性逐字节)/退出停服(shutdown自动stop+端口释放/main.js will-quit锚点/AppStore自启双锚)/设置分区UI真渲染(徽标/二维码/停止按钮)+pocket:* IPC真调用/静态锚点(preload/IPC/分区/CSS/i18n/零依赖node:http)（离线）' },
  { file: 'scripts/diag-f32-userscript.js', runner: 'electron', timeout: 480000, desc: 'F32 知更实验室·用户脚本：v31迁移(user_scripts列齐备/索引/链尾序/重跑幂等)/内置示例(构造幂等种子/权限声明/注释即文档/真实可跑+幂等不叠加·经沙箱)/.ruser导入(合法往返/权限白名单裁剪/坏JSON拒绝/缺name拒绝/64KB执行闸拒绝/空代码拒绝/野权限拒绝/语法错误编译预检拒绝/非对象拒绝)/文件导入(256KB大小闸/合法带bytes)/启停删(enabledScripts投影/不存在拒绝)/示例导出JSON真实可再导入/沙箱经专用帧真执行(变换生效/无return保持/异常隔离坏脚本跳过计数后续照跑/多脚本列表序/权限声明制未声明丢弃/全局遮蔽document-window-fetch不可达/context白名单title-url/actions声明收集权限要求坏fn丢弃上限6/空脚本零开销/runActionFn字符串结果+异常隔离)/UI实验室分区真渲染(脚本列表/权限展示/导入导出按钮)+userScripts:* IPC/老库无损+示例删除不复活(新store实证)/静态锚点(AppStore/preload 8通道/IPC/reader钩子+按钮+IPC拉取/沙箱红线严格模式+全局遮蔽+无eval/专用帧唯一unsafe-eval+主页面CSP不放松/分区/CSS/i18n/DDL只进迁移链)（离线）' },
  { file: 'scripts/diag-phase10-export.js', runner: 'node', desc: '导出工厂：EPUB 结构 + 对照版式/自定义CSS 链路（离线）' },
  { file: 'scripts/e2e-card-export.js', runner: 'electron', desc: '精读卡片导出 E2E：真 IPC 链路+预览弹窗（离线）' },
  { file: 'scripts/diag-r120-silent-refresh.js', runner: 'electron', desc: 'R120 后台静默刷新：灌库分片让行(心跳间隙<600ms+事件loop持续转)+首抓不吃90天窗全量300篇+首抓封顶500+常规窗365天(300d进400d拒)+同内容重刷0新增+housekeeping移出热路径(45s空闲单飞)+静态锚(启动延迟10s/渲染层列表重拉合批)（离线）' },
  { file: 'scripts/diag-r121-feed-manager.js', runner: 'electron', desc: 'R121 批量订阅管理：侧栏更多行管理入口+订阅管理浮层6行分组+行点击/Shift连选区间+搜索过滤后全选只选可见+一键移除确认框真删(6→4)+浮层行数同步+Esc关闭+静态锚(侧栏Shift连选/右键批量管理入口)（离线）' },
];
const ONLINE = [
  { file: 'scripts/selftest.js', runner: 'electron', desc: '核心自测套件（真实数据形状）' },
  { file: 'scripts/diag-phase6-node.js', runner: 'electron', desc: '主进程服务探针' },
  { file: 'scripts/diag-phase4-explore.js', runner: 'electron', desc: '探索后端（真实网络 20-60s）' },
  { file: 'scripts/diag-phase7-upstream.js', runner: 'electron', desc: '上游借鉴包端到端' },
  { file: 'scripts/diag-phase11-neural-tts.js', runner: 'electron', desc: '神经语音在线合成（真实网络）' },
];

const ci = process.argv.includes('--ci');
const suite = ci ? OFFLINE : OFFLINE.concat(ONLINE);
const results = [];

// SKIP 治理（批 G 审查 P2）：环境降级 SKIP（exit 0）不可无限连击——同一探针连续 2 次
// SKIP（服务级/UI 级）判 FAIL，防真回归被环境噪声永久漏成绿。探针 SKIP 时写标记文件。
const SKIP_STATE_FILE = path.join(__dirname, '.ci-skip-state.json');
const SKIP_MARKER = path.join(__dirname, '.ci-skip-marker');
let skipState = {};
try { skipState = JSON.parse(fs.readFileSync(SKIP_STATE_FILE, 'utf8')) || {}; } catch (_) { skipState = {}; }

for (const probe of suite) {
  const runner = probe.runner === 'node' ? 'node' : 'npx';
  const args = probe.runner === 'node'
    ? [probe.file]
    : ['electron', probe.file];
  process.stdout.write(`\n===== ${probe.desc} (${probe.file}) =====\n`);
  const probeStart = Date.now();
  try { fs.rmSync(SKIP_MARKER, { force: true }); } catch (_) { /* 无旧标记即可 */ }
  // electron 探针被看门狗击杀（exit=null，Desktop Heap 耗尽致新窗口创建同步死锁）→
  // 新进程重试一次：堆配额随进程重置，环境性偶发自此自愈（非代码回归，不复现即过）
  let result = null;
  let retried = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    result = spawnSync(runner, args, {
      cwd: path.join(__dirname, '..'),
      // stderr 同步 inherit：失败时探针自身报错能直接出现在套件日志里（不再被丢弃）
      stdio: ['ignore', 'inherit', 'inherit'],
      // 探针可声明 probe.timeout（重型双阶段探针：服务级+UI 级在 CI 高载下 5 分钟不够）
      timeout: probe.runner === 'node' ? 60000 : (probe.timeout || 300000),
      shell: process.platform === 'win32',
    });
    // 顺序注意：timeout 击杀时 spawnSync 会同时置 result.error（ETIMEDOUT）——
    // 重试判定必须先于 result.error 检查，否则环境性挂起永远跳过重试
    if (result.status === 0) break;
    if (attempt === 0 && result.status === null && probe.runner !== 'node') {
      // status=null = 看门狗击杀（win32 shell 包装下 signal 不恒为 SIGTERM）：
      // Desktop Heap 耗尽致新窗口创建同步死锁——新进程重试一次，堆配额重置
      retried = true;
      console.log(`>>> RETRY ${probe.file}（看门狗击杀=环境性挂起，新进程重试一次）`);
    } else break;
  }
  let ok = result.status === 0;
  // SKIP 门限：探针本次运行期间写过 SKIP 标记（mtime 晚于探针启动且内容为本探针）→ 连击 +1；≥2 判 FAIL
  let skippedThisRun = false;
  try {
    const marker = fs.readFileSync(SKIP_MARKER, 'utf8');
    const st = fs.statSync(SKIP_MARKER);
    if (st.mtimeMs >= probeStart && marker.trim() === probe.file) {
      skippedThisRun = true;
      skipState[probe.file] = (skipState[probe.file] || 0) + 1;
      try { fs.writeFileSync(SKIP_STATE_FILE, JSON.stringify(skipState, null, 2)); } catch (_) { /* 状态丢失仅重置连击 */ }
      if (skipState[probe.file] >= 2) {
        ok = false;
        console.log(`>>> SKIP-GATE ${probe.file} 连续 ${skipState[probe.file]} 次 SKIP（UI 探针长期被环境降级），判 FAIL 防真回归漏成绿`);
      } else {
        console.log(`>>> SKIP-1 ${probe.file}（连续第 ${skipState[probe.file]} 次 SKIP，下次再 SKIP 即判 FAIL）`);
      }
    } else if (skipState[probe.file]) {
      delete skipState[probe.file];
      try { fs.writeFileSync(SKIP_STATE_FILE, JSON.stringify(skipState, null, 2)); } catch (_) { /* 忽略 */ }
    }
  } catch (_) { /* 标记不存在：非 SKIP，重置在下方 } */ }
  if (!skippedThisRun && skipState[probe.file]) {
    delete skipState[probe.file];
    try { fs.writeFileSync(SKIP_STATE_FILE, JSON.stringify(skipState, null, 2)); } catch (_) { /* 忽略 */ }
  }
  results.push({ ...probe, ok, status: result.status, retried, skipped: skippedThisRun });
  console.log(ok ? `>>> PASS ${probe.file}${retried ? '（重试自愈）' : ''}` : `>>> FAIL ${probe.file} (exit=${result.status})`);
}

console.log('\n===== SUMMARY =====');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.file} — ${r.desc}`);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length}/${results.length} FAILED` : `\nALL ${results.length} PASSED`);
process.exit(failed.length ? 1 : 0);
