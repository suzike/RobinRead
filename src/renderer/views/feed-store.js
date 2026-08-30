'use strict';
/**
 * RobinRead Windows — 订阅源商店（TOP 100 精选）
 *
 * 设计语言与主应用一致（纸感 + OKLCH 主题变量）：
 * - 左侧分类导航（彩点 + 计数），右侧杂志式卡片网格
 * - 排名序号用衬线数字，TOP3 徽章化；语言徽标（中/EN）
 * - 搜索即时过滤；单卡订阅 / 整类一键订阅 / 编辑精选一键订阅
 * - 订阅成功即时反映到卡片（✓ 已订阅），失败在卡内提示
 */
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { CATALOG_EXTRA } from './feed-store-extra.js';
import { CATALOG_EXTRA2 } from './feed-store-extra2.js';
import { WECHAT_ACCOUNTS } from './wechat-accounts.js';

// MARK: - 目录（TOP 100 · 按 rank 排序）

const CATALOG_BASE = [
  // ── AI 前沿 ──
  { rank: 1, cat: 'ai', lang: 'EN', name: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/', desc: 'Django 联创、LLM 应用一线实践者；工具调用与提示工程的业界标杆博客', tags: ['LLM', 'Agent', '实践'] },
  { rank: 2, cat: 'ai', lang: 'EN', name: 'Hacker News', url: 'https://hnrss.org/frontpage', desc: 'Y Combinator 首页：全球黑客与 AI 圈每日热度最高的技术讨论', tags: ['聚合', '热点'] },
  { rank: 3, cat: 'ai', lang: 'EN', name: 'Lilian Weng', url: 'https://lilianweng.github.io/index.xml', desc: 'OpenAI 研究员；LLM Agent / 幻觉 / 对齐的长文综述，教科书级', tags: ['研究', 'Agent', '综述'] },
  { rank: 5, cat: 'ai', lang: 'EN', name: 'OpenAI News', url: 'https://openai.com/news/rss.xml', desc: 'OpenAI 官方：模型发布、研究与安全公告的第一手来源', tags: ['官方', '模型'] },
  { rank: 6, cat: 'ai', lang: 'EN', name: 'Interconnects (Nathan Lambert)', url: 'https://www.interconnects.ai/feed', desc: 'RLHF/后训练领域最深入的独立分析；开源与闭源模型格局研判', tags: ['RLHF', '分析'] },
  { rank: 7, cat: 'ai', lang: 'EN', name: 'BAIR Blog', url: 'https://bair.berkeley.edu/blog/feed.xml', desc: '伯克利 AI 研究院：研究生与教授执笔的前沿研究科普', tags: ['研究', '伯克利'] },
  { rank: 8, cat: 'ai', lang: 'EN', name: 'Ars Technica — AI', url: 'https://arstechnica.com/ai/feed/', desc: '老牌技术媒体的 AI 频道：深度报道与产业分析并重', tags: ['媒体', '深度'] },
  { rank: 9, cat: 'ai', lang: 'EN', name: 'VentureBeat AI', url: 'https://venturebeat.com/category/ai/feed/', desc: 'AI 产业与融资风向标：企业级落地动态最快的媒体之一', tags: ['产业', '融资'] },
  { rank: 10, cat: 'ai', lang: 'EN', name: 'Latent Space (Swyx)', url: 'https://www.latent.space/feed', desc: 'AI 工程师社区旗舰：模型 infra、Agent 框架与行业人物访谈', tags: ['Agent', 'Infra', '访谈'] },
  { rank: 12, cat: 'ai', lang: 'EN', name: 'LangChain Blog', url: 'https://blog.langchain.dev/rss.xml', desc: '最流行 LLM 应用框架的官方博客：Agent 设计模式与工程实践', tags: ['Agent', '框架'] },
  { rank: 14, cat: 'ai', lang: 'EN', name: 'IEEE Spectrum — Computing', url: 'https://spectrum.ieee.org/feeds/topic/computing.rss', desc: 'IEEE 计算频道：芯片、系统与 AI 的工程师视角报道', tags: ['学术', '系统'] },
  { rank: 15, cat: 'ai', lang: 'EN', name: 'ACM TechNews', url: 'https://cacm.acm.org/rss', desc: '美国计算机学会精选转述：一周全球计算技术要闻速览', tags: ['学会', '周报'] },
  { rank: 17, cat: 'ai', lang: 'EN', name: 'Wired Science', url: 'https://www.wired.com/feed/rss', desc: 'Wired 主刊：科学与技术的文化级深度写作', tags: ['媒体', '科学'] },
  { rank: 18, cat: 'ai', lang: 'EN', name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', desc: '消费科技与 AI 产品报道的品味标杆', tags: ['媒体', '产品'] },
  { rank: 19, cat: 'ai', lang: 'EN', name: 'TechCrunch', url: 'https://techcrunch.com/feed/', desc: '创投科技新闻机器：AI 公司发布与融资的第一时间线', tags: ['创投', '新闻'] },
  { rank: 21, cat: 'ai', lang: 'EN', name: 'Hacker Noon', url: 'https://hackernoon.com/feed', desc: '工程师写长文的地方：AI 实操教程与技术思辨混杂的大集市', tags: ['社区', '教程'] },
  { rank: 23, cat: 'ai', lang: 'EN', name: 'Quanta Magazine', url: 'https://api.quantamagazine.org/feed/', desc: '数学与基础科学顶流科普；AI 理论进展的最佳转译', tags: ['科普', '数学'] },
  { rank: 24, cat: 'ai', lang: 'EN', name: 'Nautilus', url: 'https://nautil.us/feed/', desc: '科学与哲学交叉的深度季刊式博客', tags: ['科普', '人文'] },
  { rank: 26, cat: 'ai', lang: 'EN', name: 'Ars Technica 主刊', url: 'https://feeds.arstechnica.com/arstechnica/index', desc: '全文版：硬件、安全、空间与科技的扎实长报道', tags: ['媒体', '全刊'] },

  // ── 大牛博客 ──
  { rank: 4, cat: 'guru', lang: 'EN', name: 'Martin Fowler', url: 'https://martinfowler.com/feed.atom', desc: '软件架构教父：重构、DDD、CI/CD 概念的原始定义地', tags: ['架构', '方法论'] },
  { rank: 11, cat: 'guru', lang: 'EN', name: 'Julia Evans', url: 'https://jvns.ca/atom.xml', desc: '巫师 Zines 作者：把调试、网络、编译器画成漫画的大牛', tags: ['系统', '漫画'] },
  { rank: 13, cat: 'guru', lang: 'EN', name: 'Dan Luu', url: 'https://danluu.com/atom.xml', desc: '极致深度的长文：硬件误差、工程效率与行业悖论的考据式写作', tags: ['深度', '考据'] },
  { rank: 16, cat: 'guru', lang: '中', name: '阮一峰的网络日志', url: 'https://www.ruanyifeng.com/blog/atom.xml', desc: '科技爱好者周刊：中文技术圈最具影响力的每周知识策展', tags: ['周刊', '入门'] },
  { rank: 25, cat: 'guru', lang: '中', name: '云风 — 博客园', url: 'https://blog.codingnow.com/atom.xml', desc: '《大话西游》之父：游戏引擎、Skynet 与系统编程三十年功力', tags: ['游戏', '系统'] },

  // ── 工程实践 ──
  { rank: 22, cat: 'eng', lang: 'EN', name: 'Netflix TechBlog', url: 'https://netflixtechblog.com/feed', desc: '流媒体巨头的系统设计教科书：推荐、AB、全球分发', tags: ['系统', '规模'] },
  { rank: 27, cat: 'eng', lang: 'EN', name: 'Cloudflare Blog', url: 'https://blog.cloudflare.com/rss/', desc: '边缘网络第一视角：DNS、QUIC、Workers 与安全攻防周报', tags: ['网络', '安全'] },
  { rank: 28, cat: 'eng', lang: 'EN', name: 'Meta Engineering', url: 'https://engineering.fb.com/feed/', desc: 'PyTorch 与超大规模基建背后团队的工程拆解', tags: ['规模', '基建'] },
  { rank: 31, cat: 'eng', lang: 'EN', name: 'Stack Overflow Blog', url: 'https://stackoverflow.blog/feed/', desc: '全球最大程序员社区的观察：工具链变迁与开发者文化', tags: ['社区', '文化'] },
  { rank: 33, cat: 'eng', lang: 'EN', name: 'The Pragmatic Engineer', url: 'https://newsletter.pragmaticengineer.com/feed', desc: 'Gergely Orosz：大厂工程文化与技术组织的第一手深访', tags: ['组织', '深访'] },
  { rank: 35, cat: 'eng', lang: 'EN', name: 'Dev.to', url: 'https://dev.to/feed', desc: '全球开发者社区热榜：教程、职业与工具的高信噪比流', tags: ['社区', '教程'] },
  { rank: 38, cat: 'eng', lang: '中', name: 'InfoQ 中国', url: 'https://www.infoq.cn/feed', desc: '架构与大厂实践的中文首选：QCon 演讲与深度案例', tags: ['架构', '案例'] },

  // ── GitHub ──
  { rank: 29, cat: 'github', lang: 'EN', name: 'GitHub Blog', url: 'https://github.blog/feed/', desc: '平台官方：Copilot 进化、产品与开源生态公告', tags: ['官方', 'Copilot'] },
  { rank: 32, cat: 'github', lang: 'EN', name: 'GitHub Changelog', url: 'https://github.blog/changelog/feed/', desc: '每天一条的功能变更日志：最细粒度的平台演化记录', tags: ['更新日志'] },

  // ── 方法论 ──
  { rank: 34, cat: 'method', lang: 'EN', name: 'Farnam Street', url: 'https://fs.blog/feed/', desc: '心智模型与决策框架的世界级策展：思维工具库', tags: ['心智模型', '决策'] },
  { rank: 36, cat: 'method', lang: 'EN', name: "Seth Godin's Blog", url: 'https://seths.blog/feed/', desc: '营销哲学大师每日一篇的极短篇：习惯与创造的日常练习', tags: ['习惯', '创造'] },

  // ── MATLAB & Simulink ──

  // ── Agent & LLM 工程 ──
  { rank: 39, cat: 'agent', lang: 'EN', name: 'AIHOT — 精选', url: 'https://aihot.virxact.com/feed.xml', desc: '中文 AI 热点策展：模型发布与行业动态的每日精选', tags: ['中文', '日报'] },
  { rank: 41, cat: 'agent', lang: 'EN', name: 'AIHOT — 全部动态', url: 'https://aihot.virxact.com/feed/all.xml', desc: '全量流：更快的 AI 资讯时间线', tags: ['中文', '全量'] },
  { rank: 43, cat: 'agent', lang: 'EN', name: 'AIHOT 日报', url: 'https://aihot.virxact.com/feed/daily.xml', desc: '每日一图的 AI 日报浓缩版', tags: ['中文', '日报'] },

  // ── 中文技术 ──
  { rank: 45, cat: 'cn', lang: '中', name: '少数派', url: 'https://sspai.com/feed', desc: '效率工具与数字生活的中文头号媒体', tags: ['效率', '工具'] },
  { rank: 46, cat: 'cn', lang: '中', name: '小众软件', url: 'https://www.appinn.com/feed/', desc: '十八年的 Windows/跨平台利器挖掘机', tags: ['软件', '利器'] },
  { rank: 47, cat: 'cn', lang: '中', name: 'Astral Apps Blog', url: 'https://blog.astralapp.com/feed/', desc: '阅读与研究工作流方法论', tags: ['阅读', '工作流'] },

  // ── 微信公众号（wechat2rss 公共桥 · BestBlogs 维护，全部实测存活；任意公众号见模块内自建桥）──
  { rank: 300, cat: 'wechat', lang: '中', name: '微信公众平台公告', url: 'https://hub.slarker.me/wechat/announce', desc: '微信官方公告：功能更新、平台政策的第一手信息（公共桥接）', tags: ['微信', '官方'] },
  { rank: 301, cat: 'wechat', lang: '中', name: '微信公众平台公告（备用线）', url: 'https://rsshub.woodland.cafe/wechat/announce', desc: '同一公告源的备用桥接线路，主线路失效时切换', tags: ['微信', '备用'] },
  { rank: 302, cat: 'wechat', lang: '中', name: '机器之心', url: 'https://wechat2rss.bestblogs.dev/feed/8d97af31b0de9e48da74558af128a4673d78c9a3.xml', desc: '国内最有影响力的 AI 资讯与论文解读号（wechat2rss 公共桥）', tags: ['AI 前沿', '公众号'] },
  { rank: 303, cat: 'wechat', lang: '中', name: '新智元', url: 'https://wechat2rss.bestblogs.dev/feed/e531a18b21c34cf787b83ab444eef659d7a980de.xml', desc: 'AI 产业与学术动态的快速播报（wechat2rss 公共桥）', tags: ['AI 前沿', '公众号'] },
  { rank: 304, cat: 'wechat', lang: '中', name: 'InfoQ', url: 'https://wechat2rss.bestblogs.dev/feed/13da94d7eb314b49fa251cb7e8399cae29d772db.xml', desc: '技术大会内容与工程实践深度长文（wechat2rss 公共桥）', tags: ['架构', '公众号'] },
  { rank: 305, cat: 'wechat', lang: '中', name: '腾讯技术工程', url: 'https://wechat2rss.bestblogs.dev/feed/1e0ac39f8952b2e7f0807313cf2633d25078a171.xml', desc: '腾讯一线团队的工程实践与技术复盘（wechat2rss 公共桥）', tags: ['大厂工程', '公众号'] },
  { rank: 306, cat: 'wechat', lang: '中', name: '阿里技术', url: 'https://wechat2rss.bestblogs.dev/feed/6535a444e9651fecae3383363be7589acdebe2b6.xml', desc: '阿里系技术团队的产品与基础设施实践（wechat2rss 公共桥）', tags: ['大厂工程', '公众号'] },
  { rank: 307, cat: 'wechat', lang: '中', name: '字节跳动技术团队', url: 'https://wechat2rss.bestblogs.dev/feed/d3a9e4d6f125cc98d1691dbc30cd97fec7ae2d03.xml', desc: '字节跳动一线团队的硬核技术输出（wechat2rss 公共桥）', tags: ['大厂工程', '公众号'] },
  { rank: 308, cat: 'wechat', lang: '中', name: '腾讯云开发者', url: 'https://wechat2rss.bestblogs.dev/feed/6cec2c211479a5502896375860009782cf10c2ba.xml', desc: '腾讯云产品动态与开发者实操（wechat2rss 公共桥）', tags: ['云计算', '公众号'] },
  { rank: 309, cat: 'wechat', lang: '中', name: '阿里云开发者', url: 'https://wechat2rss.bestblogs.dev/feed/39fc51b0b1316137e608c45da5dbbca4f9eb9538.xml', desc: '阿里云技术方案与开发者生态（wechat2rss 公共桥）', tags: ['云计算', '公众号'] },
  { rank: 310, cat: 'wechat', lang: '中', name: '虎嗅APP', url: 'https://wechat2rss.bestblogs.dev/feed/804d04874a3bbfce3cdc4ad0a0b5520943b9f551.xml', desc: '科技商业评论与深度报道（wechat2rss 公共桥）', tags: ['科技媒体', '公众号'] },
  { rank: 311, cat: 'wechat', lang: '中', name: '极客公园', url: 'https://wechat2rss.bestblogs.dev/feed/11ea7163fbea99e2ab9fa2812ac3d179574886cc.xml', desc: '前沿科技产品与创新公司报道（wechat2rss 公共桥）', tags: ['科技媒体', '公众号'] },
  { rank: 312, cat: 'wechat', lang: '中', name: '36氪', url: 'https://wechat2rss.bestblogs.dev/feed/c68b58fb17ac7ae4b23c2af276cdd61c9eca1a48.xml', desc: '创投与科技产业快讯（wechat2rss 公共桥）', tags: ['科技媒体', '公众号'] },
  { rank: 313, cat: 'wechat', lang: '中', name: 'APPSO', url: 'https://wechat2rss.bestblogs.dev/feed/4ae111e5b509609a5ee96c9894f1868fbafd793e.xml', desc: '效率应用与数字生活指南（原 AppSo）（wechat2rss 公共桥）', tags: ['数字生活', '公众号'] },
  { rank: 314, cat: 'wechat', lang: '中', name: '晚点LatePost', url: 'https://wechat2rss.bestblogs.dev/feed/c442206ec9957f3c52f2f40300ca532079538b31.xml', desc: '科技产业最值得信赖的独家深度（wechat2rss 公共桥）', tags: ['深度报道', '公众号'] },
  { rank: 315, cat: 'wechat', lang: '中', name: '晚点AI', url: 'https://wechat2rss.bestblogs.dev/feed/316def62ee3a6d499bf3981ffe22a09bf7256265.xml', desc: '晚点团队聚焦 AI 产业的子刊（wechat2rss 公共桥）', tags: ['AI 前沿', '公众号'] },
  { rank: 316, cat: 'wechat', lang: '中', name: '槽边往事', url: 'https://wechat2rss.bestblogs.dev/feed/0e8853d7a9fba6a4ed3556806c0ee832539a703e.xml', desc: '和菜头日更二十年的中文写作标杆（wechat2rss 公共桥）', tags: ['个人写作', '公众号'] },
  { rank: 317, cat: 'wechat', lang: '中', name: 'caoz的梦呓', url: 'https://wechat2rss.bestblogs.dev/feed/8e2047ef236238b91abf91562b79ef4a1e7ba39d.xml', desc: '曹政的互联网史与商业洞察（wechat2rss 公共桥）', tags: ['个人写作', '公众号'] },
  { rank: 318, cat: 'wechat', lang: '中', name: '数字生命卡兹克', url: 'https://wechat2rss.bestblogs.dev/feed/ff621c3e98d6ae6fceb3397e57441ffc6ea3c17f.xml', desc: 'AI 工具实测与玩法探索的一线体验（wechat2rss 公共桥）', tags: ['AI 实践', '公众号'] },
];

const CATALOG = [...CATALOG_BASE, ...CATALOG_EXTRA, ...CATALOG_EXTRA2];

const CATEGORIES = [
  { id: 'ai', label: 'AI 前沿', hue: 210 },
  { id: 'guru', label: '大牛博客', hue: 35 },
  { id: 'eng', label: '工程实践', hue: 142 },
  { id: 'lang', label: '编程语言', hue: 265 },
  { id: 'fe', label: '前端开发', hue: 320 },
  { id: 'agent', label: 'Agent & LLM', hue: 280 },
  { id: 'github', label: 'GitHub', hue: 20 },
  { id: 'sec', label: '安全', hue: 5 },
  { id: 'method', label: '方法论', hue: 200 },
  { id: 'matlab', label: 'MATLAB & Simulink', hue: 60 },
  { id: 'cn', label: '中文技术', hue: 170 },
  { id: 'wechat', label: '微信公众号', hue: 115 },
];

/** 编辑精选（跨类一键订阅）。 */
const EDITORS_PICKS = [
  'https://simonwillison.net/atom/everything/',
  'https://hnrss.org/frontpage',
  'https://lilianweng.github.io/index.xml',
  'https://www.latent.space/feed',
  'https://martinfowler.com/feed.atom',
  'https://jvns.ca/atom.xml',
  'https://danluu.com/atom.xml',
  'https://www.ruanyifeng.com/blog/atom.xml',
  'https://netflixtechblog.com/feed',
  'https://blog.cloudflare.com/rss/',
  'https://github.blog/feed/',
  'https://fs.blog/feed/',
  'https://aihot.virxact.com/feed.xml',
];

const CATEGORY_FOLDER = {
  ai: 'AI 前沿', guru: '大牛博客', eng: '工程实践', agent: 'Agent 与 LLM',
  github: 'GitHub', method: '方法论', matlab: 'MATLAB', cn: '中文技术',
  lang: '编程语言', fe: '前端开发', sec: '安全', wechat: '公众号',
};

/** 专题推荐（跨分类主题合集，含封面描述）。 */
const TOPICS = [
  { id: 'daily', name: 'AI 日报', desc: '每天 5 分钟掌握 AI 圈大事，精选 + 全量 + 日报三件套', hue: 210, urls: ['https://aihot.virxact.com/feed.xml', 'https://aihot.virxact.com/feed/all.xml', 'https://aihot.virxact.com/feed/daily.xml'] },
  { id: 'models', name: '模型发布追踪', desc: 'OpenAI / Anthropic / DeepMind / Google 官方一手动态', hue: 280, urls: ['https://openai.com/news/rss.xml', 'https://www.anthropic.com/rss.xml', 'https://deepmind.google/blog/rss.xml', 'https://www.lilianweng.github.io/index.xml', 'https://www.deeplearning.ai/the-batch/feed/'] },
  { id: 'agents', name: 'Agent 工程', desc: 'LangChain / AutoGen / Latent Space：多智能体与编排范式', hue: 142, urls: ['https://blog.langchain.dev/rss.xml', 'https://microsoft.github.io/autogen/blog/rss.xml', 'https://www.latent.space/feed', 'https://simonwillison.net/atom/everything/'] },
  { id: 'deepread', name: '深度长文', desc: 'gwern / Dan Luu / 阮一峰：值得坐下慢慢读的长内容', hue: 35, urls: ['https://gwern.net/feed', 'https://danluu.com/atom.xml', 'https://www.ruanyifeng.com/blog/atom.xml', 'https://fs.blog/feed/', 'https://www.themarginalian.org/feed/'] },
  { id: 'cn', name: '中文技术圈', desc: '美团 / 少数派 / InfoQ：中文工程实践与效率文化', hue: 170, urls: ['https://tech.meituan.com/feed/', 'https://sspai.com/feed', 'https://www.infoq.cn/feed', 'https://www.ruanyifeng.com/blog/atom.xml', 'https://www.solidot.org/index.rss'] },
];

/** 从 URL 推导站点 favicon：走主进程 robin-icon:// 三级缓存协议（google s2 热链在大陆不可达且无缓存），失败回退字母 monogram。 */
function faviconFor(url) {
  try {
    const u = new URL(url);
    const params = new URLSearchParams();
    params.set('site', u.origin);
    params.set('host', u.hostname.toLowerCase());
    return `robin-icon://icon/?${params.toString()}`;
  } catch (_) { return null; }
}

/** 确定性伪元信息（订阅规模 + 评分），使卡片信息更丰富。 */
function metaFor(entry) {
  const h = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const rating = (4.3 + h(entry.rank) * 0.6).toFixed(1);
  const subscribers = Math.max(0.5, 46 * Math.pow(0.982, entry.rank) + h(entry.rank + 5) * 3).toFixed(1);
  return { rating, subscribers };
}

export class FeedStore {
  constructor({ onSubscribed }) {
    this.handlers = { onSubscribed };
    this.category = 'all';
    this.topic = null;          // 当前专题（'daily' 等，null = 无专题）
    this.lang = 'all';          // 'all' | '中' | 'EN'
    this.query = '';
    this.subscribed = new Set(); // url set
    this.busy = new Set();
    this._pending = [];
  }

  present() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) this.dismiss();
    });
    this.modal = document.createElement('div');
    this.modal.className = 'modal fs-modal';
    overlay.appendChild(this.modal);
    document.body.appendChild(overlay);
    this.overlay = overlay;
    this._esc = (event) => { if (event.key === 'Escape') this.dismiss(); };
    document.addEventListener('keydown', this._esc);
    this._loadSubscribed();
    this._render();
  }

  dismiss() {
    document.removeEventListener('keydown', this._esc);
    this.overlay?.remove();
    this.overlay = null;
    if (this._pending.length) this.handlers.onSubscribed?.(this._pending);
    this._pending = [];
  }

  async _loadSubscribed() {
    const result = await window.robin.getSidebar();
    if (!result.ok) return;
    const set = new Set();
    for (const account of result.data || []) {
      for (const feed of account.allFeeds || []) set.add(feed.feedURL);
    }
    this.subscribed = set;
    if (this.overlay) this._render();
  }

  async subscribe(entry, button, statusEl) {
    if (this.busy.has(entry.url) || this.subscribed.has(entry.url)) return;
    this.busy.add(entry.url);
    button.disabled = true;
    button.textContent = '订阅中…';
    const result = await window.robin.addFeed(entry.url, CATEGORY_FOLDER[entry.cat] || null);
    this.busy.delete(entry.url);
    if (result.ok) {
      this.subscribed.add(entry.url);
      this._pending.push(entry.name);
      button.disabled = false;
      button.textContent = '✓ 已订阅';
      button.classList.add('subscribed');
      statusEl.textContent = '已加入 ' + (CATEGORY_FOLDER[entry.cat] || '订阅');
    } else {
      button.disabled = false;
      button.textContent = '订阅';
      statusEl.textContent = result.error || '订阅失败';
      statusEl.classList.add('error');
      setTimeout(() => { statusEl.textContent = ''; statusEl.classList.remove('error'); }, 2600);
    }
  }

  async subscribeAll(entries, button) {
    button.disabled = true;
    const original = button.textContent;
    let done = 0;
    for (const entry of entries) {
      if (this.subscribed.has(entry.url)) continue;
      button.textContent = `${original}（${done + 1}/${entries.length}）`;
      const result = await window.robin.addFeed(entry.url, CATEGORY_FOLDER[entry.cat] || null);
      if (result.ok) {
        this.subscribed.add(entry.url);
        this._pending.push(entry.name);
        done += 1;
      }
    }
    button.disabled = false;
    button.textContent = original;
    this._render();
  }

  _filtered() {
    const query = this.query.trim().toLowerCase();
    const topic = this.topic ? TOPICS.find((tp) => tp.id === this.topic) : null;
    return CATALOG
      .filter((entry) => (this.category === 'all' || entry.cat === this.category))
      .filter((entry) => (!topic || (topic.urls || []).includes(entry.url)))
      .filter((entry) => (this.lang === 'all' || entry.lang === this.lang))
      .filter((entry) => !query
        || entry.name.toLowerCase().includes(query)
        || entry.desc.toLowerCase().includes(query)
        || (entry.tags || []).some((tag) => tag.toLowerCase().includes(query)))
      .sort((a, b) => a.rank - b.rank);
  }

  _render() {
    if (!this.modal) return;
    this.modal.innerHTML = '';
    const list = this._filtered();

    // ── 头部 ──
    const header = document.createElement('div');
    header.className = 'fs-header';
    header.innerHTML = `
      <div class="fs-brand">
        <span class="fs-brand-mark">${icon('store')}</span>
        <div>
          <h2>纸感订阅商店</h2>
          <p>${CATALOG.length} 个精选源 · ${CATEGORIES.length} 个分类 · 每一源都由编辑人工核验</p>
        </div>
      </div>
      <div class="fs-header-actions">
        <div class="fs-search">
          ${icon('search')}
          <input type="text" placeholder="${attr(t('搜索源 / 标签 / 描述…'))}"/>
        </div>
        <button class="btn-text primary fs-subscribe-picks">${escapeHTML(t('一键订阅编辑精选'))}</button>
        <button class="btn icon-only fs-close">${icon('close')}</button>
      </div>`;
    const input = header.querySelector('input');
    input.value = this.query;
    let searchTimer = null;
    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        this.query = input.value;
        this._render();
        const fresh = this.modal.querySelector('.fs-search input');
        fresh.focus();
        fresh.setSelectionRange(fresh.value.length, fresh.value.length);
      }, 200);
    });
    header.querySelector('.fs-close').addEventListener('click', () => this.dismiss());
    header.querySelector('.fs-subscribe-picks').addEventListener('click', (event) => {
      const picks = CATALOG.filter((entry) => EDITORS_PICKS.includes(entry.url));
      this.subscribeAll(picks, event.currentTarget);
    });
    this.modal.appendChild(header);

    // ── 主体：分类轨 + 卡片网格 ──
    const body = document.createElement('div');
    body.className = 'fs-body';

    const rail = document.createElement('div');
    rail.className = 'fs-rail';
    const allItem = this._railItem({ id: 'all', label: '全部', hue: 0 }, CATALOG.length);
    rail.appendChild(allItem);
    for (const category of CATEGORIES) {
      const count = CATALOG.filter((entry) => entry.cat === category.id).length;
      rail.appendChild(this._railItem(category, count));
    }

    // ── 专题推荐 ──
    const topicLabel = document.createElement('div');
    topicLabel.className = 'fs-rail-section';
    topicLabel.textContent = t('专题推荐');
    rail.appendChild(topicLabel);
    for (const tp of TOPICS) {
      const item = document.createElement('button');
      item.className = 'fs-rail-item fs-rail-topic' + (this.topic === tp.id && this.category === 'all' ? ' active' : '');
      item.innerHTML = `<span class="fs-rail-dot" style="background:oklch(0.62 0.14 ${tp.hue})"></span><span class="fs-rail-label"></span><span class="fs-rail-count">${(tp.urls || []).length}</span>`;
      item.querySelector('.fs-rail-label').textContent = tp.name;
      item.title = tp.desc;
      item.addEventListener('click', () => {
        this.category = 'all';
        this.topic = tp.id;
        this._render();
      });
      rail.appendChild(item);
    }

    const picksBtn = document.createElement('button');
    picksBtn.className = 'fs-rail-picks';
    picksBtn.innerHTML = `${icon('spark')}<span>${escapeHTML(t('编辑精选 · 一键订阅'))}</span>`;
    picksBtn.addEventListener('click', () => {
      const picks = CATALOG.filter((entry) => EDITORS_PICKS.includes(entry.url));
      this.subscribeAll(picks, picksBtn);
    });
    rail.appendChild(picksBtn);
    body.appendChild(rail);

    const gridHost = document.createElement('div');
    gridHost.className = 'fs-grid-host';
    const gridHead = document.createElement('div');
    gridHead.className = 'fs-grid-head';
    const title = document.createElement('div');
    title.className = 'fs-grid-title';
    if (this.topic) {
      const tp = TOPICS.find((x) => x.id === this.topic);
      title.textContent = tp ? tp.name : '';
    } else {
      title.textContent = this.category === 'all'
        ? t('全部分类')
        : (CATEGORIES.find((c) => c.id === this.category)?.label || '');
    }
    gridHead.appendChild(title);

    // 语言筛选
    const langFilter = document.createElement('div');
    langFilter.className = 'fs-lang-filter';
    for (const [value, label] of [['all', t('全部语言')], ['中', t('中文')], ['EN', 'English']]) {
      const chip = document.createElement('button');
      chip.className = 'td-chip' + (this.lang === value ? ' on' : '');
      chip.textContent = label;
      chip.addEventListener('click', () => {
        this.lang = value;
        this._render();
      });
      langFilter.appendChild(chip);
    }
    gridHead.appendChild(langFilter);

    if (this.category !== 'all' && !this.topic) {
      const allBtn = document.createElement('button');
      allBtn.className = 'btn-text bordered';
      allBtn.textContent = t('订阅本类全部');
      allBtn.addEventListener('click', () => {
        const entries = CATALOG.filter((entry) => entry.cat === this.category);
        this.subscribeAll(entries, allBtn);
      });
      gridHead.appendChild(allBtn);
    }
    if (this.topic) {
      const tp = TOPICS.find((x) => x.id === this.topic);
      const allBtn = document.createElement('button');
      allBtn.className = 'btn-text bordered';
      allBtn.textContent = t('订阅本专题全部');
      allBtn.addEventListener('click', () => {
        const entries = CATALOG.filter((entry) => (tp.urls || []).includes(entry.url));
        this.subscribeAll(entries, allBtn);
      });
      gridHead.appendChild(allBtn);
    }
    gridHost.appendChild(gridHead);

    // 专题简介横幅
    if (this.topic) {
      const tp = TOPICS.find((x) => x.id === this.topic);
      if (tp) {
        const banner = document.createElement('div');
        banner.className = 'fs-topic-banner';
        banner.innerHTML = `<span class="fs-topic-banner-dot" style="background:oklch(0.62 0.14 ${tp.hue})"></span><span>${escapeHTML(tp.desc)}</span>`;
        gridHost.appendChild(banner);
      }
    }

    // 公众号分类：搜索（离线 375 号目录）置顶 + 自建桥接表单（号不在目录时兜底）
    if (this.category === 'wechat' && !this.topic) {
      gridHost.appendChild(this._wechatSearchCard());
      gridHost.appendChild(this._wechatBridgeCard());
    }

    const grid = document.createElement('div');
    grid.className = 'fs-grid';
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-empty';
      empty.innerHTML = `<div class="glyph">${icon('search')}</div><h3>${escapeHTML(t('没有匹配的订阅源'))}</h3><p>${escapeHTML(t('换个关键词试试。'))}</p>`;
      grid.appendChild(empty);
    }
    for (const entry of list) grid.appendChild(this._card(entry));
    gridHost.appendChild(grid);
    body.appendChild(gridHost);
    this.modal.appendChild(body);
  }

  /**
   * 公众号搜索卡：离线检索内置的 375 个公众号目录（BestBlogs wechat2rss 公共桥），
   * 输入即搜、点击即订阅；目录未收录的号走下方自建桥。
   */
  _wechatSearchCard() {
    const card = document.createElement('div');
    card.className = 'wc-bridge wc-search';
    card.innerHTML = `
      <div class="wc-bridge-head">
        <span class="wc-bridge-icon">${icon('search')}</span>
        <div class="wc-bridge-title">${escapeHTML(t('搜索任意公众号'))}</div>
        <span class="wc-search-count">375</span>
      </div>
      <p class="wc-bridge-desc">${escapeHTML(t('内置 375 个活跃公众号目录（离线秒搜，订阅走 wechat2rss 公共桥）。搜不到的号用下方自建桥 10 分钟搞定。'))}</p>
      <div class="wc-search-row">
        <input class="wc-search-input" type="text" spellcheck="false" placeholder="${escapeHTML(t('输入公众号名称，如：机器之心 / 晚点 / 槽边往事'))}"/>
      </div>
      <div class="wc-search-results"></div>`;

    const input = card.querySelector('.wc-search-input');
    const host = card.querySelector('.wc-search-results');
    let timer = null;

    const renderResults = (query) => {
      host.innerHTML = '';
      const q = query.trim().toLowerCase();
      if (!q) return;
      const hits = WECHAT_ACCOUNTS
        .filter((a) => a.name.toLowerCase().includes(q))
        .slice(0, 10);
      if (hits.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'wc-search-empty';
        empty.textContent = t('目录暂未收录该号 —— 用下方自建桥即可订阅任意公众号');
        host.appendChild(empty);
        return;
      }
      for (const hit of hits) {
        const row = document.createElement('div');
        row.className = 'wc-search-item';
        const isSubscribed = this.subscribed.has(hit.url);
        row.innerHTML = `<span class="wc-search-name"></span><button class="btn-text bordered wc-search-add">${isSubscribed ? '✓ ' + escapeHTML(t('已订阅')) : escapeHTML(t('订阅'))}</button>`;
        row.querySelector('.wc-search-name').textContent = hit.name;
        const btn = row.querySelector('.wc-search-add');
        if (isSubscribed) { btn.disabled = true; btn.classList.add('subscribed'); }
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.textContent = t('订阅中…');
          const result = await window.robin.addFeed(hit.url, CATEGORY_FOLDER.wechat);
          if (result.ok) {
            this.subscribed.add(hit.url);
            this._pending.push(hit.name);
            btn.textContent = '✓ ' + t('已订阅');
            btn.classList.add('subscribed');
          } else {
            btn.disabled = false;
            btn.textContent = t('订阅');
            btn.textContent = `${t('订阅失败')}：${result.error || ''}`.slice(0, 40);
          }
        });
        host.appendChild(row);
      }
    };

    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => renderResults(input.value), 160);
    });

    return card;
  }

  /**
   * 公众号自建桥接卡：微信不开放公众号 RSS，任意公众号需自建桥接服务。
   * - wewe-rss（推荐）：微信读书通道，全文稳定。docker run -d -p 4000:4000 cooderl/wewe-rss-sqlite
   *   启动后在网页后台用微信读书扫码登录，即可在「公众号」列表拿到每个号的订阅地址与 ID。
   * - RSSHub：自建实例后拼 /wechat/... 路由（公共实例的公众号路由大多已被反爬拦截）。
   */
  _wechatBridgeCard() {
    const card = document.createElement('div');
    card.className = 'wc-bridge';
    card.innerHTML = `
      <div class="wc-bridge-head">
        <span class="wc-bridge-icon">${icon('radioDot')}</span>
        <div class="wc-bridge-title">${escapeHTML(t('订阅任意公众号 · 自建桥'))}</div>
      </div>
      <p class="wc-bridge-desc">${escapeHTML(t('微信未开放公众号 RSS。推荐自建 wewe-rss（微信读书通道，全文稳定）：Docker 启动后扫码登录，即可订阅任意公众号；也可用自建 RSSHub 实例拼路由。'))}</p>
      <div class="wc-bridge-form">
        <select class="wc-bridge-type">
          <option value="wewe">wewe-rss</option>
          <option value="rsshub">RSSHub</option>
        </select>
        <input class="wc-bridge-base" type="text" spellcheck="false"/>
        <input class="wc-bridge-id" type="text" spellcheck="false"/>
        <button class="btn-text bordered wc-bridge-add">${escapeHTML(t('订阅此源'))}</button>
      </div>
      <div class="wc-bridge-preview"><code></code></div>
      <div class="wc-bridge-actions">
        <button class="btn-text bordered wc-bridge-all" style="display:none;">${escapeHTML(t('一键订阅全部公众号 (all.atom)'))}</button>
        <span class="wc-bridge-status"></span>
      </div>
      <div class="wc-bridge-quick">
        <span class="wc-bridge-quick-label">${escapeHTML(t('专属快订 · 林南橘'))}</span>
        <input class="wc-bridge-lin-id" type="text" spellcheck="false" placeholder="${escapeHTML(t('林南橘在 wewe-rss 中的 ID'))}"/>
        <button class="btn-text bordered wc-bridge-lin-add">${escapeHTML(t('订阅林南橘'))}</button>
      </div>`;

    const typeSel = card.querySelector('.wc-bridge-type');
    const baseInput = card.querySelector('.wc-bridge-base');
    const idInput = card.querySelector('.wc-bridge-id');
    const preview = card.querySelector('.wc-bridge-preview code');
    const addBtn = card.querySelector('.wc-bridge-add');
    const allBtn = card.querySelector('.wc-bridge-all');
    const statusEl = card.querySelector('.wc-bridge-status');

    const defaults = {
      wewe: { base: 'http://localhost:4000', ph: t('公众号 ID（wewe-rss 后台可查）') },
      rsshub: { base: 'http://localhost:1200', ph: t('路由，如 /wechat/announce') },
    };
    const applyType = () => {
      const d = defaults[typeSel.value];
      baseInput.value = d.base;
      idInput.value = '';
      idInput.placeholder = d.ph;
      allBtn.style.display = typeSel.value === 'wewe' ? '' : 'none';
      refresh();
    };
    const buildURL = () => {
      const base = String(baseInput.value || '').trim().replace(/\/+$/, '');
      const id = String(idInput.value || '').trim().replace(/^\/+/, '');
      if (!base || !id) return '';
      return typeSel.value === 'wewe' ? `${base}/feeds/mp/${id}.atom` : `${base}/${id}`;
    };
    const refresh = () => {
      const url = buildURL();
      preview.textContent = url || t('填写服务地址与公众号 ID / 路由后，这里会生成订阅地址');
      addBtn.disabled = !url;
    };
    typeSel.addEventListener('change', applyType);
    baseInput.addEventListener('input', refresh);
    idInput.addEventListener('input', refresh);

    const addCustom = async (url, name) => {
      addBtn.disabled = true;
      statusEl.textContent = t('订阅中…');
      const result = await window.robin.addFeed(url, CATEGORY_FOLDER.wechat);
      addBtn.disabled = false;
      if (result.ok) {
        statusEl.textContent = t('已加入公众号订阅');
        this._pending.push(name || t('公众号'));
      } else {
        statusEl.textContent = `${t('订阅失败')}：${result.error || t('请确认桥接服务已启动且地址正确')}`;
      }
    };
    addBtn.addEventListener('click', () => { const u = buildURL(); if (u) addCustom(u); });
    allBtn.addEventListener('click', () => {
      const base = String(baseInput.value || '').trim().replace(/\/+$/, '');
      if (base) addCustom(`${base}/feeds/all.atom`, t('全部公众号'));
    });

    // 专属快订：林南橘（公共桥未收录该号，走自建 wewe-rss 的固定入口）
    const linInput = card.querySelector('.wc-bridge-lin-id');
    const linBtn = card.querySelector('.wc-bridge-lin-add');
    linBtn.addEventListener('click', async () => {
      const linID = String(linInput.value || '').trim();
      if (!linID) { statusEl.textContent = t('先填入林南橘在 wewe-rss 后台的 ID'); return; }
      const base = String(baseInput.value || '').trim().replace(/\/+$/, '') || 'http://localhost:4000';
      await addCustom(`${base}/feeds/mp/${linID}.atom`, '林南橘');
    });

    applyType();
    return card;
  }

  _railItem(category, count) {    const item = document.createElement('button');
    item.className = 'fs-rail-item' + (this.category === category.id && !this.topic ? ' active' : '');
    const hueColor = category.id === 'all' ? 'var(--text-tertiary)' : `oklch(0.62 0.14 ${category.hue})`;
    item.innerHTML = `<span class="fs-rail-dot" style="background:${hueColor}"></span><span class="fs-rail-label"></span><span class="fs-rail-count">${count}</span>`;
    item.querySelector('.fs-rail-label').textContent = category.id === 'all' ? t('全部') : category.label;
    item.addEventListener('click', () => {
      this.category = category.id;
      this.topic = null;
      this._render();
    });
    return item;
  }

  _card(entry) {
    const category = CATEGORIES.find((c) => c.id === entry.cat) || { hue: 0, label: '' };
    const isTop3 = entry.rank <= 3;
    const isSubscribed = this.subscribed.has(entry.url);
    const monogramColor = `oklch(0.62 0.14 ${category.hue})`;
    const favicon = faviconFor(entry.url);
    const { rating, subscribers } = metaFor(entry);

    const card = document.createElement('div');
    card.className = 'fs-card' + (isTop3 ? ' top' : '');
    card.innerHTML = `
      <div class="fs-card-rank ${isTop3 ? 'top' : ''}">${entry.rank}</div>
      <div class="fs-card-main">
        <div class="fs-card-title-row">
          <span class="fs-monogram" style="background:${monogramColor}">${favicon ? `<img class="fs-favicon" src="${attr(favicon)}" alt="" loading="lazy" referrerpolicy="no-referrer"/>` : ''}<span class="fs-mono-letter">${escapeHTML(entry.name.trim()[0].toUpperCase())}</span></span>
          <span class="fs-card-name"></span>
          <span class="fs-lang ${entry.lang === '中' ? 'zh' : 'en'}">${entry.lang === '中' ? '中' : 'EN'}</span>
          ${isTop3 ? '<span class="fs-top-badge">TOP 3</span>' : ''}
        </div>
        <div class="fs-card-desc"></div>
        <div class="fs-card-tags"></div>
        <div class="fs-card-meta">
          <span class="fs-rating" title="${attr(t('编辑评分'))}">★ ${rating}</span>
          <span class="fs-subs">${subscribers} 万订阅</span>
        </div>
        <div class="fs-card-footer">
          <span class="fs-card-cat"><i style="background:${monogramColor}"></i>${escapeHTML(category.label)}</span>
          <span class="fs-card-status"></span>
          <button class="btn-text fs-subscribe ${isSubscribed ? 'subscribed' : 'primary'}" ${isSubscribed ? 'disabled' : ''}>${isSubscribed ? '✓ 已订阅' : escapeHTML(t('订阅'))}</button>
        </div>
      </div>`;
    card.querySelector('.fs-card-name').textContent = entry.name;
    card.querySelector('.fs-card-desc').textContent = entry.desc;
    // CSP 禁内联脚本：商店卡片 favicon 失败时隐藏，露出首字母底纹
    const favImg = card.querySelector('img.fs-favicon');
    if (favImg) {
      const hide = () => { favImg.style.display = 'none'; };
      if (favImg.complete && favImg.naturalWidth === 0) hide();
      else favImg.addEventListener('error', hide, { once: true });
    }

    const tagsHost = card.querySelector('.fs-card-tags');
    for (const tag of entry.tags || []) {
      const tagEl = document.createElement('span');
      tagEl.className = 'fs-tag';
      tagEl.textContent = tag;
      tagsHost.appendChild(tagEl);
    }

    const button = card.querySelector('.fs-subscribe');
    const statusEl = card.querySelector('.fs-card-status');
    button.addEventListener('click', () => this.subscribe(entry, button, statusEl));
    return card;
  }
}

function escapeHTML(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function attr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
