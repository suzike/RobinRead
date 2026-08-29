# RobinRead · 知更 — 品牌方案

## 命名

| 项 | 值 |
|---|---|
| 中文名 | **知更**（知更鸟） |
| 英文名 / exe 名 | **RobinRead** |
| appId | `com.robinread.app` |
| 产物名 | `RobinRead-${version}-setup.exe` / `-portable.exe` |
| 数据目录 | `%APPDATA%\RobinRead` |
| 偏好键前缀 | `RobinRead.*`（localStorage：`robinread.*`） |
| Slogan | Reading First, AI Second · 双语流转，克制智能化 |

**为什么是知更鸟：**

1. **知更 = 知晓更迭**。RSS 阅读器的本质就是"追踪更新"——名字直接解释产品做什么。
2. **晨讯报信者**。知更鸟是黎明即鸣的"早鸟"，西方传统里是晨间新闻的象征，与产品的"晨间速览 / 今日 AI 简报"功能天然对应。
3. **橘色胸羽延续血统**。从 PaperRss → 南橘（NanJuPaper）一直延续暖橘色调与"中国传统色"主题体系，知更鸟的红橘胸羽无缝承接，UI 主题无需重做。
4. **彻底脱离 "Paper"**。NanJuPaper 仍含原品牌词根 Paper；RobinRead 与原仓库（PaperRss / ohmyangboy）零关联。

## Logo（折纸知更鸟）

- **构成**：米白纸底（带折角高光）上的折纸风格知更鸟，向左伫立——炭色头背与尾羽、橘色渐变胸羽（三折面）、青绿折翅、暖灰喙、米白点睛；喙下衔一枝青绿嫩枝（呼应"订阅枝头"）。
- **寓意**：折纸 = 纸感排版的传承；鸟 = 讯息与更新；橘胸 = 南橘血统。
- **风格**：平面多折面（faceted），无描边，任意尺寸可缩放，16px 下仍可辨识。

### 色板

| 用途 | 色 | HEX |
|---|---|---|
| 纸底 | 米白 | `#F6F0E2` |
| 头/背/尾 | 炭墨 | `#33312C` / `#3A3833` |
| 胸羽亮面 | 柿橙 | `#F7A85C` |
| 胸羽主体 | 朱柿渐变 | `#F2913D → #E4600B` |
| 翅/枝 | 松绿 | `#6F8A5A` / `#7C9A63` |
| 喙 | 暖灰 | `#A99F92` |

### 文件

| 文件 | 用途 |
|---|---|
| `logo.svg` | 图标矢量源（1024 画布），改色的唯一入口 |
| `icon-1024.png` | 高清位图（关于页 / 商店截图） |
| `icon.ico` | Windows 多尺寸（16–256），可直接替换 `assets/icon.ico` |
| `wordmark-lockup.svg` | 横版字标组合（启动页 / README） |

重渲染：`npx electron scripts/render-logo.js brand-proposal/robinread`

## 备选方案

| 名 | 寓意 | 气质 |
|---|---|---|
| **青鸟 CyanWing** | 「青鸟殷勤为探看」——神话信使，蓝青色系 | 古典、神话感 |
| **雁书 YanShu** | 鸿雁传书——书信与远方的古典意象 | 文气、克制 |

## 采用 RobinRead 需要改动的位置（清单）

1. `package.json`：name/productName/appId/artifactName/description
2. `assets/icon.ico` + `icon.png` ← 本目录文件直接替换
3. `src/main/main.js`：userData 目录名、迁移逻辑（改为三级链 PaperRss→NanJuPaper→RobinRead 或直接 PaperRss/NanJuPaper→RobinRead）
4. `src/main/Persistence/LibraryDatabase.js`：偏好键前缀 + 迁移
5. `src/renderer/app.js`：localStorage 前缀 + 迁移
6. `src/main/AihotService.js`：UA `NanJuPaper/1.4` → `RobinRead/1.5`
7. `index.html` title、关于页文案、README
8. 顺手清理项（见品牌审查报告）：`window.paper` 桥接 API、`styles/paper.css` 文件名与 `paper-*` CSS 类、I18NStrings 死字符串
