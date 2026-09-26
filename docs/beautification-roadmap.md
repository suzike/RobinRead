# 前端美化与功能加强 10 轮路线图

> 目标：至少 10 轮重量级前端优化与功能增强；每轮独立审查 agent 验收；设计借鉴 GitHub 高星组件库（shadcn/ui 语义 token、Linear 4px 网格/发丝边框/键盘优先）。
> 基线：v2.9.0（edff2c5 已推送）

## 已完成

- **R1 设计令牌体系 v2**（4ba9313）：robin.css Design Tokens v2 层（space/radius 七档/shadow 三阶/duration 四档/ease 双曲线/focus-ring/hairline）+ 160 处系统化替换（radius 121/dur 40/ease 40）；阶梯对齐现状众数零回归。审查：PASS-WITH-NOTES（space/shadow/focus 未铺开→后续轮）。
- **R2 命令面板 2.0**（34adb16 + 修正）：三级记分排序（前缀 3/包含 2/关键词 1）、最近使用（robinread.palette.recent 上限 5 置顶）、多值 transition 第二段补齐、9/11px 入阶梯。审查：PASS-WITH-NOTES（断言仅字符串级、feed 命令 label 可重名→后续轮）。
- **R3 阅读控制中心**（d269976 + 59a5c60 修正）：新模块 reading-controls.js（Aa 浮层：版面/模式/状态/朗读四区八类参数），A 键+命令面板入口，Esc 关闭+键穿透屏蔽；审查后修正死代码实例/I18N 去重 9 键/Esc。审查：PASS-WITH-NOTES（已修完）。

## 待执行（按序）

- **R4 知识中心仪表盘可视化**：canvas 趋势 sparkline（近 30 天高亮/笔记量）、streak 连续天数火苗、标签分布横条图升级（已有基础条图，加百分比与排序切换）
- ~~R5 复习会话键盘化~~ ✅（1/2/3 评分、空格翻面、Esc 退出、当日累计计数持久化）
- **R6 列表渐进渲染 + 骨架屏**：>100 行分帧渲染（requestIdleCallback 分批 append）、统一骨架屏组件（列表/文章/知识中心复用）
- **R7 版式主题预设包**：刊物风格预设（知更纸刊/新闻晚报/极简留白/墨水屏高对比），一键应用到 readerLayout 全组参数
- **R8 灯箱画廊模式**：多图文章上一张/下一张导航 + 底部缩略图条 + 键盘 ←→
- **R9 可访问性系统化**：--focus-ring 铺开至全部可交互元素、WCAG 对比度批修（dark muted 文本）、off-ladder radius 护栏白名单化
- **R10 微交互终打磨**：space 令牌铺开（高频 padding/margin 换 --space-*）、剩余 shadow 收敛、全应用动效审计清单

## 审查规约

每轮结束：git 提交 → 开 general-purpose 独立审查 agent（给验收清单：重量级判定/质量检查/回归证据，输出 PASS/PASS-WITH-NOTES/FAIL + ≤3 条发现）→ 修正发现 → 进入下轮。断言进 phase12/13，回归 run-all --ci 9/9。
