'use strict';
/**
 * 订阅源商店 · 目录扩展二（GitHub 精选 · 第二批 100 源）
 *
 * 来源：awesome-rsshub-routes、plenaryapp/awesome-rss-feeds、chinese-independent-blogs
 * 覆盖：AI 前沿 / 编程语言官方 / 大厂工程 / 前端 / 安全 / Agent 工具 / 中文社区
 */
export const CATALOG_EXTRA2 = [
  // ── AI 前沿 ──
  { rank: 101, cat: 'ai', lang: 'EN', name: 'Google AI Blog', url: 'https://blog.google/technology/ai/rss/', desc: 'Google 官方 AI 动态：Gemini 与前沿研究的第一手来源', tags: ['官方', 'Gemini'] },
  { rank: 102, cat: 'ai', lang: 'EN', name: 'Google Research Blog', url: 'https://research.google/blog/rss/', desc: 'Google 研究院官方博客：系统、理论与应用研究进展', tags: ['官方', '研究'] },
  { rank: 103, cat: 'ai', lang: 'EN', name: 'arXiv — AI', url: 'https://rss.arxiv.org/rss/cs.AI', desc: '人工智能方向每日预印本，学术前沿最速递', tags: ['论文', '预印本'] },
  { rank: 104, cat: 'ai', lang: 'EN', name: 'arXiv — Machine Learning', url: 'https://rss.arxiv.org/rss/cs.LG', desc: '机器学习方向每日预印本，研究脉搏一手掌握', tags: ['论文', 'ML'] },
  { rank: 105, cat: 'ai', lang: 'EN', name: 'arXiv — NLP', url: 'https://rss.arxiv.org/rss/cs.CL', desc: '自然语言处理与计算语言学方向预印本', tags: ['论文', 'NLP'] },
  { rank: 106, cat: 'ai', lang: 'EN', name: 'arXiv — Computer Vision', url: 'https://rss.arxiv.org/rss/cs.CV', desc: '计算机视觉方向预印本：扩散模型与多模态前沿', tags: ['论文', 'CV'] },
  { rank: 109, cat: 'ai', lang: 'EN', name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/', desc: 'MIT 科技评论：AI 与未来科技的权威深度报道', tags: ['媒体', '深度'] },
  { rank: 110, cat: 'ai', lang: 'EN', name: 'Nature', url: 'https://www.nature.com/nature.rss', desc: '《自然》主刊：AI 交叉研究的最高殿堂之一', tags: ['学术', '期刊'] },
  { rank: 111, cat: 'ai', lang: 'EN', name: 'Hacker News — AI', url: 'https://hnrss.org/newest?q=AI', desc: 'HN 上所有提到 AI 的帖子：最快捕捉社区讨论焦点', tags: ['聚合', '热点'] },
  { rank: 112, cat: 'ai', lang: 'EN', name: 'Hacker News — LLM', url: 'https://hnrss.org/newest?q=LLM', desc: 'HN 上所有提到 LLM 的帖子：大模型讨论实时流', tags: ['聚合', 'LLM'] },

  // ── 编程语言官方 ──
  { rank: 113, cat: 'lang', lang: 'EN', name: 'React Blog', url: 'https://react.dev/rss.xml', desc: 'React 官方博客：版本发布与最佳实践', tags: ['前端', '框架'] },
  { rank: 115, cat: 'lang', lang: 'EN', name: 'Rust Blog', url: 'https://blog.rust-lang.org/feed.xml', desc: 'Rust 官方博客：语言版本与工具链发布', tags: ['语言', '官方'] },
  { rank: 116, cat: 'lang', lang: 'EN', name: 'Go Blog', url: 'https://go.dev/blog/feed.atom', desc: 'Go 官方博客：语言特性与工程实践', tags: ['语言', '官方'] },
  { rank: 117, cat: 'lang', lang: 'EN', name: 'Python Insider', url: 'https://blog.python.org/feeds/posts/default', desc: 'Python 官方博客：版本路线图与生态公告', tags: ['语言', '官方'] },
  { rank: 118, cat: 'lang', lang: 'EN', name: 'Node.js Blog', url: 'https://nodejs.org/en/feed/blog.xml', desc: 'Node.js 官方博客：运行时发布与安全通告', tags: ['语言', '官方'] },
  { rank: 120, cat: 'lang', lang: 'EN', name: 'TypeScript Blog', url: 'https://devblogs.microsoft.com/typescript/feed/', desc: 'TypeScript 官方博客：类型系统与编译器演进', tags: ['语言', '官方'] },
  { rank: 121, cat: 'lang', lang: 'EN', name: 'Swift Blog', url: 'https://www.swift.org/atom.xml', desc: 'Swift 官方博客：语言演进与 Swift 生态', tags: ['语言', '官方'] },
  { rank: 122, cat: 'lang', lang: 'EN', name: 'Kotlin Blog', url: 'https://blog.jetbrains.com/kotlin/feed/', desc: 'JetBrains Kotlin 官方博客：语言与工具链', tags: ['语言', '官方'] },

  // ── 前端开发 ──
  { rank: 123, cat: 'fe', lang: 'EN', name: 'Smashing Magazine', url: 'https://www.smashingmagazine.com/feed/', desc: '前端与设计旗舰杂志：CSS、性能、可访问性', tags: ['设计', 'CSS'] },
  { rank: 124, cat: 'fe', lang: 'EN', name: 'A List Apart', url: 'https://alistapart.com/main/feed/', desc: 'Web 标准与设计思想的元老刊物', tags: ['标准', '设计'] },
  { rank: 125, cat: 'fe', lang: 'EN', name: 'CSS-Tricks', url: 'https://css-tricks.com/feed/', desc: 'CSS 技巧宝库：布局、动画与最佳实践', tags: ['CSS', '技巧'] },
  { rank: 126, cat: 'fe', lang: 'EN', name: 'Codrops', url: 'https://tympanus.net/codrops/feed/', desc: '创意前端效果：炫技与实现细节并重', tags: ['创意', '动效'] },
  { rank: 127, cat: 'fe', lang: 'EN', name: 'Astro Blog', url: 'https://astro.build/rss.xml', desc: 'Astro 框架官方：内容优先的现代 Web 构建', tags: ['框架', 'SSG'] },
  { rank: 128, cat: 'fe', lang: 'EN', name: 'Svelte Blog', url: 'https://svelte.dev/blog/rss.xml', desc: 'Svelte/SvelteKit 官方：编译期框架的演进', tags: ['框架', '官方'] },
  { rank: 129, cat: 'fe', lang: 'EN', name: 'Next.js Blog', url: 'https://nextjs.org/feed.xml', desc: 'Next.js 官方博客：React 全栈框架动态', tags: ['框架', 'React'] },
  { rank: 130, cat: 'fe', lang: 'EN', name: 'Nuxt Blog', url: 'https://nuxt.com/blog/rss.xml', desc: 'Nuxt 官方博客：Vue 全栈框架进展', tags: ['框架', 'Vue'] },
  { rank: 131, cat: 'fe', lang: 'EN', name: 'Tailwind CSS Blog', url: 'https://tailwindcss.com/feeds/feed.xml', desc: 'Tailwind 官方：原子化 CSS 与 v4 进展', tags: ['CSS', '框架'] },
  { rank: 132, cat: 'fe', lang: 'EN', name: 'Chrome Developers', url: 'https://developer.chrome.com/blog/feed.xml', desc: 'Chrome 团队：新 Web API 与性能工程', tags: ['浏览器', '性能'] },
  { rank: 133, cat: 'fe', lang: 'EN', name: 'Product Hunt', url: 'https://www.producthunt.com/feed', desc: '每日新品发现：AI 产品与工具的风向标', tags: ['产品', '新品'] },

  // ── 大厂工程实践 ──
  { rank: 134, cat: 'eng', lang: 'EN', name: 'AWS News Blog', url: 'https://aws.amazon.com/blogs/aws/feed/', desc: 'AWS 官方博客：云服务发布与架构实践', tags: ['云', '官方'] },
  { rank: 135, cat: 'eng', lang: 'EN', name: 'Google Developers', url: 'https://developers.googleblog.com/feeds/posts/default/', desc: 'Google 开发者官方博客：平台与工具链', tags: ['官方', '平台'] },
  { rank: 136, cat: 'eng', lang: 'EN', name: 'Mozilla Hacks', url: 'https://hacks.mozilla.org/feed/', desc: 'Mozilla 开发者博客：Web 平台与 Firefox', tags: ['浏览器', '开源'] },
  { rank: 137, cat: 'eng', lang: 'EN', name: 'Vercel Blog', url: 'https://vercel.com/atom', desc: 'Vercel 官方：前端部署、边缘计算与 DX', tags: ['部署', '边缘'] },
  { rank: 138, cat: 'eng', lang: 'EN', name: 'Supabase Blog', url: 'https://supabase.com/rss.xml', desc: '开源 BaaS 官方：Postgres 与后端即服务', tags: ['BaaS', 'Postgres'] },
  { rank: 139, cat: 'eng', lang: 'EN', name: 'Stripe Blog', url: 'https://stripe.com/blog/feed.rss', desc: 'Stripe 官方：支付系统与工程文化', tags: ['支付', '官方'] },
  { rank: 140, cat: 'eng', lang: 'EN', name: 'JavaScript Weekly', url: 'https://javascriptweekly.com/rss/', desc: '每周 JS 生态精选：工具、库与文章策展', tags: ['周刊', 'JS'] },
  { rank: 141, cat: 'eng', lang: 'EN', name: 'This Week in Rust', url: 'https://this-week-in-rust.org/atom.xml', desc: 'Rust 社区周报：crate、RFC 与文章精选', tags: ['周刊', 'Rust'] },
  { rank: 142, cat: 'eng', lang: 'EN', name: 'Golang Weekly', url: 'https://golangweekly.com/rss/', desc: 'Go 生态周报：库、教程与社区动态', tags: ['周刊', 'Go'] },
  { rank: 143, cat: 'eng', lang: 'EN', name: 'ByteByteGo', url: 'https://blog.bytebytego.com/feed', desc: '系统设计图解：架构模式与面试高频题', tags: ['系统设计', '图解'] },
  { rank: 144, cat: 'eng', lang: 'EN', name: 'Software Engineering Radio', url: 'https://feeds.feedburner.com/se-radio', desc: 'SE Radio 播客：资深工程师的深度技术访谈', tags: ['播客', '访谈'] },
  { rank: 145, cat: 'eng', lang: 'EN', name: 'Real Python', url: 'https://realpython.com/atom.xml', desc: 'Python 实战教程：从语法到生产级的系统讲解', tags: ['教程', 'Python'] },
  { rank: 146, cat: 'eng', lang: 'EN', name: 'freeCodeCamp News', url: 'https://www.freecodecamp.org/news/rss/', desc: '免费编程学习社区：教程与职业成长', tags: ['教程', '社区'] },
  { rank: 147, cat: 'eng', lang: 'EN', name: 'Scott Hanselman', url: 'https://www.hanselman.com/blog/feed/rss', desc: '微软技术布道者：.NET、终端与开发者效率', tags: ['.NET', '效率'] },

  // ── 安全 ──
  { rank: 148, cat: 'sec', lang: 'EN', name: 'Krebs on Security', url: 'https://krebsonsecurity.com/feed/', desc: '安全调查记者：网络犯罪与勒索的深度追踪', tags: ['安全', '调查'] },
  { rank: 149, cat: 'sec', lang: 'EN', name: 'Schneier on Security', url: 'https://www.schneier.com/feed/', desc: 'Bruce Schneier：密码学与安全政策的权威评论', tags: ['安全', '密码学'] },
  { rank: 151, cat: 'sec', lang: 'EN', name: 'The Hacker News', url: 'https://feeds.feedburner.com/TheHackersNews', desc: '全球网络安全资讯：漏洞、攻击与防御动态', tags: ['安全', '资讯'] },
  { rank: 153, cat: 'sec', lang: '中', name: '安全客 AnQuanKe', url: 'https://api.anquanke.com/data/v1/rss', desc: '中文安全技术平台：漏洞分析与攻防实战', tags: ['安全', '中文'] },
  { rank: 154, cat: 'sec', lang: 'EN', name: 'CISA News', url: 'https://www.cisa.gov/news.xml', desc: '美国网络安全局：官方漏洞通告与告警', tags: ['安全', '官方'] },

  // ── Agent & 开发工具 release ──
  { rank: 155, cat: 'agent', lang: 'EN', name: 'Claude Code Releases', url: 'https://github.com/anthropics/claude-code/releases.atom', desc: 'Anthropic 官方 CLI 编码代理的版本发布流', tags: ['Agent', 'CLI'] },
  { rank: 156, cat: 'agent', lang: 'EN', name: 'Gemini CLI Releases', url: 'https://github.com/google-gemini/gemini-cli/releases.atom', desc: 'Google Gemini 终端编码代理的发布日志', tags: ['Agent', 'CLI'] },
  { rank: 157, cat: 'agent', lang: 'EN', name: 'OpenAI Codex Releases', url: 'https://github.com/openai/codex/releases.atom', desc: 'OpenAI Codex CLI 的版本发布流', tags: ['Agent', 'CLI'] },
  { rank: 158, cat: 'agent', lang: 'EN', name: 'MCP Specification', url: 'https://github.com/modelcontextprotocol/specification/releases.atom', desc: '模型上下文协议规范的演进发布', tags: ['MCP', '协议'] },
  { rank: 159, cat: 'agent', lang: 'EN', name: 'MCP Servers Releases', url: 'https://github.com/modelcontextprotocol/servers/releases.atom', desc: '官方 MCP 服务器集合的版本更新', tags: ['MCP', '工具'] },
  { rank: 160, cat: 'agent', lang: 'EN', name: 'LangChain Releases', url: 'https://github.com/langchain-ai/langchain/releases.atom', desc: 'LangChain 框架的版本发布与破坏性变更', tags: ['框架', 'Agent'] },

  // ── GitHub 生态 ──
  { rank: 161, cat: 'github', lang: 'EN', name: 'uv Releases', url: 'https://github.com/astral-sh/uv/releases.atom', desc: 'Rust 写的极速 Python 包管理器的发布流', tags: ['Python', '工具'] },
  { rank: 162, cat: 'github', lang: 'EN', name: 'Zed Releases', url: 'https://github.com/zed-industries/zed/releases.atom', desc: 'Rust 写的高性能代码编辑器的发布日志', tags: ['编辑器', 'Rust'] },
  { rank: 163, cat: 'github', lang: 'EN', name: 'Bun Releases', url: 'https://github.com/oven-sh/bun/releases.atom', desc: '极速 JS 运行时与打包器的版本发布', tags: ['运行时', '工具'] },
  { rank: 164, cat: 'github', lang: 'EN', name: 'Biome Releases', url: 'https://github.com/biomejs/biome/releases.atom', desc: 'Rust 写的 JS 格式化与 lint 工具发布流', tags: ['工具', 'Lint'] },
  { rank: 165, cat: 'github', lang: 'EN', name: 'GitHub Copilot Changelog', url: 'https://github.blog/changelog/label/copilot/feed/', desc: 'Copilot 产品变更日志：新功能与能力更新', tags: ['Copilot', '更新'] },
  { rank: 166, cat: 'github', lang: 'EN', name: 'GitHub Blog', url: 'https://github.blog/feed/', desc: 'GitHub 官方博客：产品、工程与开源生态', tags: ['官方', '工程'] },
  { rank: 167, cat: 'github', lang: 'EN', name: 'Fluent Reader Releases', url: 'https://github.com/yang991178/fluent-reader/releases.atom', desc: '跨平台开源 RSS 阅读器的版本更新', tags: ['RSS', '阅读器'] },
  { rank: 168, cat: 'github', lang: 'EN', name: 'FreshRSS Releases', url: 'https://github.com/FreshRSS/FreshRSS/releases.atom', desc: '自托管 RSS 服务的发布与安全更新', tags: ['RSS', '自托管'] },

  // ── 中文社区 ──
  { rank: 169, cat: 'cn', lang: '中', name: 'V2EX — 最热', url: 'https://www.v2ex.com/feed/tab/hot.xml', desc: '中文技术社区的今日热门话题', tags: ['社区', '热点'] },
  { rank: 170, cat: 'cn', lang: '中', name: 'V2EX — 技术', url: 'https://www.v2ex.com/feed/tab/tech.xml', desc: 'V2EX 技术节点：编程与工程讨论', tags: ['社区', '技术'] },
  { rank: 171, cat: 'cn', lang: '中', name: 'Linux.do', url: 'https://linux.do/latest.rss', desc: 'Discourse 技术社区：开发与效率工具热议', tags: ['社区', '工具'] },
  { rank: 172, cat: 'cn', lang: '中', name: 'NodeSeek', url: 'https://rss.nodeseek.com/', desc: '服务器与网络技术社区最新话题', tags: ['社区', '服务器'] },
  { rank: 173, cat: 'cn', lang: '中', name: 'IT之家', url: 'https://www.ithome.com/rss/', desc: 'IT 资讯与数码产品的中文第一线', tags: ['资讯', '数码'] },
  { rank: 174, cat: 'cn', lang: '中', name: '掘金', url: 'https://juejin.cn/rss', desc: '中文开发者社区：前端、后端与 AI 工程文章', tags: ['社区', '文章'] },

  // ── 大牛博客（补充）──
  { rank: 176, cat: 'guru', lang: 'EN', name: 'Hillel Wayne', url: 'https://www.hillelwayne.com/post/index.xml', desc: '形式化方法与软件正确性：工程与理论的桥梁', tags: ['形式化', '理论'] },
  { rank: 178, cat: 'guru', lang: 'EN', name: 'Overreacted (Dan Abramov)', url: 'https://overreacted.io/rss.xml', desc: 'React 核心作者：UI 工程与心智模型随笔', tags: ['React', '哲学'] },
  { rank: 179, cat: 'guru', lang: 'EN', name: 'rachelbythebay', url: 'https://rachelbythebay.com/w/atom.xml', desc: '匿名系统工程师：分布式系统与运维的硬核碎碎念', tags: ['系统', '运维'] },
  { rank: 180, cat: 'guru', lang: '中', name: '张鑫旭', url: 'https://www.zhangxinxu.com/wordpress/feed/', desc: '中文 CSS 第一人：前端细节与浏览器兼容考据', tags: ['CSS', '中文'] },
  { rank: 183, cat: 'guru', lang: '中', name: '代码家', url: 'https://daimajia.com/feed', desc: '独立开发者：产品与代码的长期主义实践', tags: ['独立开发', '中文'] },

  // ── 方法论（补充）──
  { rank: 184, cat: 'method', lang: 'EN', name: 'Wait But Why', url: 'https://waitbutwhy.com/feed', desc: '用漫画拆解复杂议题：AI、效率与人类未来', tags: ['长文', '漫画'] },
  { rank: 185, cat: 'method', lang: 'EN', name: 'Scott Young', url: 'https://www.scotthyoung.com/blog/feed/', desc: '《超速学习》作者：学习方法与认知科学', tags: ['学习', '认知'] },
  { rank: 186, cat: 'method', lang: 'EN', name: 'Ness Labs', url: 'https://nesslabs.com/feed', desc: '心智效能：神经科学视角的专注与创造力', tags: ['心智', '专注'] },
  { rank: 187, cat: 'method', lang: 'EN', name: 'Derek Sivers', url: 'https://sive.rs/en.atom', desc: '极简主义企业家：关于选择与专注的短篇', tags: ['决策', '极简'] },

  // ── MATLAB & 科学计算（全部经实测验证可用）──
  { rank: 188, cat: 'matlab', lang: 'EN', name: 'MathWorks — Deep Learning', url: 'https://blogs.mathworks.com/deep-learning/feed/', desc: 'MATLAB 官方深度学习博客：模型训练、部署与 Simulink 集成实战', tags: ['MATLAB', 'Simulink', 'AI'] },
  { rank: 189, cat: 'matlab', lang: 'EN', name: 'MathWorks — MATLAB Community', url: 'https://blogs.mathworks.com/community/feed/', desc: 'MATLAB 社区博客：用户故事、File Exchange 精选与技巧', tags: ['MATLAB', '社区'] },
  { rank: 190, cat: 'matlab', lang: 'EN', name: 'MathWorks — Engineering', url: 'https://blogs.mathworks.com/engineering/feed/', desc: 'MathWorks 工程博客：数值计算、建模仿真与工程落地', tags: ['MATLAB', '仿真'] },
  { rank: 191, cat: 'matlab', lang: 'EN', name: 'MathWorks — Developer Zone', url: 'https://blogs.mathworks.com/developer/feed/', desc: 'MATLAB 开发者专区：代码工程化、App 设计与测试', tags: ['MATLAB', '工程化'] },

  // ── 技术媒体（补充）──
  { rank: 192, cat: 'ai', lang: 'EN', name: 'The Decoder', url: 'https://the-decoder.com/feed/', desc: 'AI 政策与伦理：监管、版权与治理的深度报道', tags: ['政策', '伦理'] },
  { rank: 193, cat: 'ai', lang: 'EN', name: 'Import AI', url: 'https://importai.substack.com/feed', desc: 'Jack Clark 的 AI 趋势周报：产业与政策的交叉分析', tags: ['周报', '政策'] },
  { rank: 194, cat: 'eng', lang: 'EN', name: 'Airbnb Tech Blog', url: 'https://medium.com/airbnb-engineering/feed', desc: 'Airbnb 工程博客：数据、设计系统与规模', tags: ['工程', '数据'] },
  { rank: 197, cat: 'eng', lang: 'EN', name: 'Pinterest Engineering', url: 'https://medium.com/pinterest-engineering/feed', desc: 'Pinterest 工程：推荐系统与视觉搜索', tags: ['工程', '推荐'] },
  { rank: 198, cat: 'eng', lang: 'EN', name: 'Databricks Blog', url: 'https://www.databricks.com/blog/feed.xml', desc: 'Databricks 官方：数据湖仓与 Spark/ML 实践', tags: ['数据', 'ML'] },

  // ── 高质量补充（全部经实测验证：可达、活跃、内容充实）──
  { rank: 201, cat: 'eng', lang: 'EN', name: 'Stack Overflow Blog', url: 'https://stackoverflow.blog/feed/', desc: '全球最大开发者社区的官方博客：工具、文化与行业调查', tags: ['社区', '文化'] },
  { rank: 202, cat: 'method', lang: 'EN', name: 'The Pragmatic Engineer', url: 'https://newsletter.pragmaticengineer.com/feed', desc: 'Gergely Orosz：软件工程行业第一手的深度 newsletter', tags: ['行业', '工程文化'] },
  { rank: 203, cat: 'guru', lang: 'EN', name: 'All Things Distributed', url: 'https://www.allthingsdistributed.com/atom.xml', desc: 'AWS CTO Werner Vogels：分布式系统与云架构的一线思考', tags: ['架构', '云'] },
  { rank: 204, cat: 'eng', lang: 'EN', name: 'LWN.net', url: 'https://lwn.net/headlines/rss', desc: 'Linux 与内核社区的老牌深度周刊：内核、安全与生态', tags: ['Linux', '内核'] },
  { rank: 205, cat: 'lang', lang: 'EN', name: 'Rust Blog', url: 'https://blog.rust-lang.org/feed.xml', desc: 'Rust 官方博客：版本发布、语言演进与生态公告', tags: ['Rust', '官方'] },
  { rank: 207, cat: 'ai', lang: 'EN', name: 'Ahead of AI (Sebastian Raschka)', url: 'https://magazine.sebastianraschka.com/feed', desc: '《Building LLMs from Scratch》作者：LLM 原理与大模型实战', tags: ['LLM', '原理'] },
  // ── 顶级补充（arXiv/Swift/Mozilla，实测内容量与更新频率俱佳）──
  { rank: 210, cat: 'ai', lang: 'EN', name: 'arXiv — CS.AI 每日', url: 'http://export.arxiv.org/rss/cs.AI', desc: 'AI 领域最新论文每日流（139 篇/日级更新）：第一时间跟踪前沿研究', tags: ['论文', '前沿'] },
  { rank: 211, cat: 'lang', lang: 'EN', name: 'Swift.org 官方', url: 'https://www.swift.org/atom.xml', desc: 'Swift 语言官方博客：版本演进、编译器与服务器生态的第一手长文', tags: ['Swift', '官方'] },
  { rank: 212, cat: 'fe', lang: 'EN', name: 'Mozilla Hacks', url: 'https://hacks.mozilla.org/feed/', desc: 'Mozilla 开发者技术长文：Web 标准、性能与安全的前沿实践', tags: ['Web', '标准'] },
];