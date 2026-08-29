'use strict';
/**
 * RobinRead（知更）— OKLCH 主题引擎
 *
 * 设计参考 freestyle-dsh-theme（suzike）的主题模型：
 * - 三通道：主色（强调）/ 副色（暖强调·星标）/ 面板（纸面底色），各为 OKLCH 色相+彩度+明度
 * - 配色关系（邻近/互补/分裂互补/三角色）派生副色与面板色相
 * - 明暗两套完整令牌；纸感三栏的明度层级保持纸感结构
 * - 通道锁定 / 快速变体 / 随机 / 命名（色相名 + 关系名）
 * - 令牌 JSON 导入导出；跨重启持久化
 */

// MARK: - OKLCH → sRGB

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const srgbEncode = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

export function oklchToRgb(L, C, H) {
  const rad = (H * Math.PI) / 180;
  const a = C * Math.cos(rad);
  const b = C * Math.sin(rad);
  const ll = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const mm = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const ss = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss,
    -1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss,
    -0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss,
  ].map((v) => Math.round(clamp(srgbEncode(v), 0, 1) * 255));
}

export function oklchToHex(L, C, H) {
  return '#' + oklchToRgb(L, C, H).map((v) => v.toString(16).padStart(2, '0')).join('');
}
export function oklchToRgba(L, C, H, alpha) {
  const c = oklchToRgb(L, C, H);
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;
}
export function rgbaWithAlpha(hex, alpha) {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// MARK: - 配色关系

export const HARMONIES = [
  { key: 'analogous', label: '邻近' },
  { key: 'complementary', label: '互补' },
  { key: 'split', label: '分裂互补' },
  { key: 'triadic', label: '三角色' },
  { key: 'random', label: '随机' },
];

export function huesForHarmony(primary, harmony) {
  const hue = ((Math.round(primary) % 360) + 360) % 360;
  const offsets = { analogous: [32, -22], complementary: [180, 8], split: [150, 210], triadic: [120, 240] };
  const o = offsets[harmony] || offsets.analogous;
  return { th2: (hue + o[0]) % 360, ths: (hue + o[1] + 360) % 360 };
}

// MARK: - 主题令牌

/** 明暗两套明度缺省（纸感的墨色/底位）。 */
export const DEF_LIGHT = { l1: 0.5, l2: 0.56, bg: 0.952, tx: 0.16, sb: 0.929 };
export const DEF_DARK = { l1: 0.74, l2: 0.7, bg: 0.155, tx: 0.93, sb: 0.185 };

/** 原纸主题：与 RobinRead 默认纸感一致的令牌（恢复默认时使用）。 */
export const PAPER_TOKENS = {
  version: 1,
  th: 142, th2: 42, ths: 92,
  c1: 0.055, c2: 0.095, sc: 0.022,
  l1: DEF_LIGHT.l1, l2: DEF_LIGHT.l2, bg: DEF_LIGHT.bg, tx: DEF_LIGHT.tx, sb: DEF_LIGHT.sb,
  mode: 'light',
};

export function defaultTokens(mode) {
  return { ...PAPER_TOKENS, ...(mode === 'light' ? DEF_LIGHT : DEF_DARK), mode };
}

export function switchModeTokens(t, mode) {
  const d = mode === 'light' ? DEF_LIGHT : DEF_DARK;
  return {
    ...t, l1: d.l1, l2: d.l2, bg: d.bg, tx: d.tx, sb: d.sb, mode,
  };
}

export function normalizeTokens(raw) {
  const r = raw || {};
  const mode = r.mode === 'light' ? 'light' : 'dark';
  const num = (v, fb, min, max) => clamp(Number.isFinite(Number(v)) ? Number(v) : fb, min, max);
  return {
    th: num(r.th, 142, 0, 360), th2: num(r.th2, 42, 0, 360), ths: num(r.ths, 92, 0, 360),
    c1: num(r.c1, 0.055, 0.004, 0.24), c2: num(r.c2, 0.095, 0.004, 0.26), sc: num(r.sc, 0.022, 0.002, 0.09),
    l1: num(r.l1, mode === 'light' ? 0.5 : 0.74, 0.28, 0.95),
    l2: num(r.l2, mode === 'light' ? 0.56 : 0.7, 0.05, 0.97),
    bg: num(r.bg, mode === 'light' ? 0.952 : 0.155, 0.04, 0.98),
    tx: num(r.tx, mode === 'light' ? 0.16 : 0.93, 0.03, 1),
    sb: num(r.sb, mode === 'light' ? 0.929 : 0.185, 0.04, 0.98),
    mode,
  };
}

// MARK: - 调色板（映射到 RobinRead 全部 CSS 变量）

/**
 * 生成应用全部 CSS 变量。保持纸感结构：
 * 浅色：sidebar(最沉) < list < page(最亮)；深色：sidebar(最亮) > list > page。
 */
export function fullPalette(t) {
  const light = t.mode === 'light';
  const { th, th2, ths, c1, c2, sc } = t;
  const l1 = t.l1, l2 = t.l2, bg = t.bg, tx = t.tx, sb = t.sb;

  const H = oklchToHex;
  const A = oklchToRgba;

  // 三级纸面
  const pageL = bg;
  const listL = light ? bg - 0.013 : bg + 0.016;
  const sideL = light ? bg - 0.027 : sb;
  const noteL = light ? bg - 0.04 : bg + 0.05;

  const pageC = sc * 0.32;
  const listC = sc * 0.45;
  const sideC = sc * 0.55;
  const noteC = sc * 0.85;

  const page = H(pageL, pageC, ths);
  const list = H(listL, listC, ths);
  const side = H(sideL, sideC, ths);
  const note = H(noteL, noteC, ths);

  const accent = H(l1, c1, th);
  const secondary = H(l2, c2, th2);

  // 墨色层级
  const ink = H(tx, 0.012, ths);
  const inkRGB = oklchToRgb(tx, 0.012, ths);
  const inkA = (a) => `rgba(${inkRGB[0]}, ${inkRGB[1]}, ${inkRGB[2]}, ${a})`;
  const baseInk = light ? '0, 0, 0' : '255, 255, 255';

  const onAccent = l1 > 0.62 ? H(0.14, 0.01, ths) : H(0.97, 0.01, ths);

  return {
    // 三栏纸面
    '--page-background': page,
    '--article-list-background': list,
    '--sidebar-background': side,
    // 工具栏 chrome：明度须介于 page 与 list 之间（浅色 page > chrome > list），
    // 「纸色贯通」：chrome 比 list 亮、比 page 略沉，而非之前比 list 更暗造成的顶栏色带不统一。
    // 彩度贴近 page（sc*0.34），避免工具栏色相与正文纸面分叉。
    '--chrome-background': light ? H(bg - 0.008, sc * 0.34, ths) : H(bg + 0.02, sc * 0.34, ths),

    // 强调
    '--accent': accent,
    '--accent-pressed': H(clamp(l1 + (light ? -0.05 : 0.05), 0.2, 0.95), c1, th),
    '--warm-accent': secondary,
    '--unread-dot': accent,
    '--star-color': secondary,
    '--accent-ink': onAccent,

    // 墨色
    '--text-primary': inkA(0.92),
    '--text-secondary': inkA(0.58),
    '--text-tertiary': inkA(0.38),

    // 结构线与交互
    '--separator': light ? `rgba(${baseInk}, 0.10)` : `rgba(${baseInk}, 0.10)`,
    '--row-hover': A(l1, c1, th, light ? 0.07 : 0.06),
    '--row-selected': A(l1, c1, th, light ? 0.16 : 0.14),

    // 纸片
    '--note-background': note,
    '--note-border': A(l1, c1, th, light ? 0.28 : 0.34),

    // 阅读器排版变量（正文底与纸面一致）
    '--reader-ink': inkA(0.92),
    '--reader-muted': inkA(0.58),
    '--reader-card': light ? H(bg - 0.008, sc * 0.25, ths) : H(bg + 0.03, sc * 0.3, ths),

    // 概览
    _meta: {
      page, list, side, note, accent, secondary, ink,
      light,
    },
  };
}

/** 应用调色板到文档根。 */
export function applyPalette(palette) {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(palette)) {
    if (key.startsWith('_')) continue;
    root.style.setProperty(key, value);
  }
}

export function clearPalette() {
  const root = document.documentElement;
  for (const key of Object.keys(fullPalette(defaultTokens('light')))) {
    if (key.startsWith('_')) continue;
    root.style.removeProperty(key);
  }
}

// MARK: - 预设与提案

const HUE_NAMES = [
  [0, '朱砂'], [15, '珊珊'], [30, '琥珀'], [45, '暖金'], [60, '柠檬'],
  [90, '麦秆'], [120, '苔绿'], [145, '橄榄'], [165, '青瓷'], [185, '冰川'],
  [205, '霁蓝'], [225, '黛蓝'], [245, '石墨'], [265, '暮紫'], [285, '罗兰'],
  [305, '梅子'], [325, '樱粉'], [345, '胭脂'],
];

export function hueName(h) {
  let best = HUE_NAMES[0];
  let bd = 1e9;
  for (const p of HUE_NAMES) {
    const d = Math.abs(((h - p[0]) + 360) % 360);
    if (d < bd) { bd = d; best = p; }
  }
  return best[1];
}

export function harmonyLabel(key) {
  const f = HARMONIES.find((x) => x.key === key);
  return f ? f.label : '邻近';
}

export function buildProposal(th, harmony, nameHint) {
  const related = huesForHarmony(th, harmony);
  return {
    key: `${th}|${harmony}|${Math.random().toString(36).slice(2, 7)}`,
    th,
    harmony,
    name: nameHint || `${hueName(th)} · ${harmonyLabel(harmony)}`,
    tokens: {
      ...PAPER_TOKENS,
      th,
      th2: related.th2,
      ths: related.ths,
      c1: 0.085, c2: 0.095, sc: 0.024,
    },
  };
}

/** 精选预设（纸感向命名）。 */
export const CURATED = [
  { th: 142, harmony: 'analogous', name: '原纸' },
  { th: 168, harmony: 'analogous', name: '青瓷' },
  { th: 40, harmony: 'complementary', name: '熔岩' },
  { th: 220, harmony: 'analogous', name: '黛蓝' },
  { th: 310, harmony: 'analogous', name: '藕荷' },
  { th: 95, harmony: 'analogous', name: '苔径' },
].map((c) => buildProposal(c.th, c.harmony, c.name));

/** 智能提案：随机一批。 */
export function randomBatch(harmony, n = 8) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const th = Math.floor(Math.random() * 360);
    const h = harmony === 'random' ? HARMONIES[Math.floor(Math.random() * 4)].key : harmony;
    out.push(buildProposal(th, h));
  }
  return out;
}

// MARK: - 快速变体

export function applyVariant(t, kind, locks) {
  const next = {};
  if (kind === 'swap') {
    next.th = t.th2; next.th2 = t.th;
    next.c1 = t.c2; next.c2 = t.c1;
    next.l1 = t.l2; next.l2 = t.l1;
  } else {
    const factor = kind === 'soft' ? 0.72 : kind === 'vivid' ? 1.25 : 1;
    const delta = kind === 'bright' ? 0.045 : kind === 'deep' ? -0.045 : 0;
    if (!locks.th) { next.c1 = clamp(t.c1 * factor, 0.004, 0.24); next.l1 = clamp(t.l1 + delta, 0.28, 0.95); }
    if (!locks.th2) { next.c2 = clamp(t.c2 * factor, 0.004, 0.26); next.l2 = clamp(t.l2 + delta, 0.05, 0.97); }
    if (!locks.ths) { next.sc = clamp(t.sc * factor, 0.002, 0.09); next.bg = clamp(t.bg + delta, 0.04, 0.98); }
  }
  return { ...t, ...next };
}

// MARK: - 持久化（localStorage 即时 + 主进程 preferences 跨重启）

const LS_KEY = 'robinread.customTheme';

export function persistTokens(tokens) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(tokens)); } catch (_) { /* 忽略 */ }
  try { window.robin.setThemeTokens(tokens); } catch (_) { /* 主进程可稍后同步 */ }
}

export function clearTokens() {
  try { localStorage.removeItem(LS_KEY); } catch (_) { /* 忽略 */ }
  try { window.robin.clearThemeTokens(); } catch (_) { /* 忽略 */ }
}

export function restoreTokens() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return normalizeTokens(JSON.parse(raw));
  } catch (_) { /* 忽略 */ }
  return null;
}

// MARK: - Hex → OKLCH（传统色入库用）

export function hexToOklch(hex) {
  const m = String(hex).replace('#', '');
  const srgb = [0, 1, 2].map((i) => parseInt(m.slice(i * 2, i * 2 + 2), 16) / 255);
  const lin = srgb.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  const l = 0.4122214708 * lin[0] + 0.5363325363 * lin[1] + 0.0514459929 * lin[2];
  const mm = 0.2119034982 * lin[0] + 0.6806995451 * lin[1] + 0.1073969566 * lin[2];
  const s = 0.0883024619 * lin[0] + 0.2817188376 * lin[1] + 0.6299787005 * lin[2];
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(mm);
  const s_ = Math.cbrt(s);
  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const b = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
  return { l: L, c: Math.sqrt(a * a + b * b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}

// MARK: - WCAG 对比度（视觉测试）

function relativeLuminance(hex) {
  const m = hex.replace('#', '');
  const srgb = [0, 1, 2].map((i) => parseInt(m.slice(i * 2, i * 2 + 2), 16) / 255);
  const lin = srgb.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function contrastRatio(hexA, hexB) {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

/** 对一组关键配对做视觉可用性检测（正文/主色/副色 × 纸面）。 */
export function auditPalette(palette) {
  const m = palette._meta;
  const pairs = [
    { label: '正文 / 纸面', fg: m.ink, bg: m.page, need: 4.5 },
    { label: '主色 / 纸面', fg: m.accent, bg: m.page, need: 3 },
    { label: '副色 / 纸面', fg: m.secondary, bg: m.page, need: 3 },
    { label: '主色按钮字 / 主色', fg: palette['--accent-ink'], bg: m.accent, need: 3 },
  ];
  return pairs.map((pair) => {
    const ratio = contrastRatio(pair.fg, pair.bg);
    return {
      ...pair,
      ratio,
      aa: ratio >= 4.5,
      aaa: ratio >= 7,
      pass: ratio >= pair.need,
    };
  });
}

// MARK: - 中国传统色库

/** 传统色（名称 + 色值 + 类别）。色值参考《中国色谱》通行整理。 */
export const TRADITIONAL_COLORS = [
  { name: '朱砂', hex: '#FF461F', cat: '赤' },
  { name: '胭脂', hex: '#9D2933', cat: '赤' },
  { name: '妃色', hex: '#ED5736', cat: '赤' },
  { name: '海棠', hex: '#DB5A6B', cat: '赤' },
  { name: '檀', hex: '#B36D61', cat: '赤' },
  { name: '藤黄', hex: '#FFB61E', cat: '黄' },
  { name: '缃色', hex: '#F0C239', cat: '黄' },
  { name: '秋香', hex: '#D9B611', cat: '黄' },
  { name: '黄栌', hex: '#E29C45', cat: '黄' },
  { name: '杏子', hex: '#E8A47C', cat: '黄' },
  { name: '竹青', hex: '#789262', cat: '青' },
  { name: '豆绿', hex: '#9ED048', cat: '青' },
  { name: '松花', hex: '#BCE672', cat: '青' },
  { name: '松柏', hex: '#21A675', cat: '青' },
  { name: '黛绿', hex: '#426666', cat: '青' },
  { name: '石青', hex: '#1685A9', cat: '蓝' },
  { name: '靛青', hex: '#177CB0', cat: '蓝' },
  { name: '群青', hex: '#4C8DAE', cat: '蓝' },
  { name: '鸦青', hex: '#424C50', cat: '蓝' },
  { name: '天缥', hex: '#8FB4C9', cat: '蓝' },
  { name: '黛紫', hex: '#574266', cat: '紫' },
  { name: '紫檀', hex: '#4B2E2B', cat: '紫' },
  { name: '藕荷', hex: '#E4C6D0', cat: '紫' },
  { name: '雪青', hex: '#B0A4E3', cat: '紫' },
  { name: '月白', hex: '#D6ECF0', cat: '白' },
  { name: '绾', hex: '#A98175', cat: '白' },
  { name: '苍色', hex: '#75878A', cat: '白' },
  { name: '玄青', hex: '#3D3B4F', cat: '墨' },
];

/** 传统色主题精选：主色取传统色，面板色相随配色关系，附诗意注解。 */
export const TRADITIONAL_THEMES = [
  { name: '宣纸', note: '暖米纸面，橄榄墨迹——RobinRead 本来的样子', color: '#617357', panelHue: 92 },
  { name: '竹月', note: '竹青染就，月下读帖', color: '#789262', panelHue: 130 },
  { name: '天青', note: '雨过天青云破处', color: '#1685A9', panelHue: 210 },
  { name: '胭脂', note: '胭脂一点，纸上生春', color: '#9D2933', panelHue: 30 },
  { name: '缃叶', note: '缃色书帙，秋阳晒卷', color: '#F0C239', panelHue: 75 },
  { name: '黛紫', note: '黛紫入夜，灯下抄经', color: '#574266', panelHue: 280 },
  { name: '松烟', note: '松烟制墨，鸦青作底', color: '#424C50', panelHue: 195 },
  { name: '豆蔻', note: '豆绿枝头，晨露未晞', color: '#9ED048', panelHue: 120 },
  { name: '檀香', note: '檀色沉静，适合长文', color: '#B36D61', panelHue: 45 },
  { name: '月白', note: '月白风清，素纸淡墨', color: '#8FB4C9', panelHue: 200 },
].map((entry) => {
  const ok = hexToOklch(entry.color);
  const related = huesForHarmony(ok.h, 'analogous');
  return {
    key: `trad-${entry.name}`,
    th: Math.round(ok.h),
    harmony: 'analogous',
    name: entry.name,
    note: entry.note,
    colorHex: entry.color,
    tokens: {
      ...PAPER_TOKENS,
      th: Math.round(ok.h),
      c1: Number(clamp(ok.c, 0.02, 0.24).toFixed(3)),
      l1: Number(ok.l.toFixed(2)),
      th2: related.th2,
      ths: entry.panelHue,
    },
  };
});

/** 从传统色生成主题令牌（传统色板点击用）。 */
export function tokensFromTraditionalColor(entry, baseTokens) {
  const ok = hexToOklch(entry.hex);
  const related = huesForHarmony(ok.h, 'analogous');
  return {
    ...(baseTokens || PAPER_TOKENS),
    th: Math.round(ok.h),
    c1: Number(clamp(ok.c, 0.02, 0.24).toFixed(3)),
    l1: Number(ok.l.toFixed(2)),
    th2: related.th2,
    ths: related.ths,
  };
}

// MARK: - 最近应用

const RECENT_KEY = 'robinread.recentThemes';

export function pushRecent(tokens, name) {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    const entry = { tokens: normalizeTokens(tokens), name: name || hueName(tokens.th), at: Date.now() };
    const filtered = list.filter((item) => item.name !== entry.name);
    filtered.unshift(entry);
    localStorage.setItem(RECENT_KEY, JSON.stringify(filtered.slice(0, 6)));
  } catch (_) { /* 忽略 */ }
}

export function recentThemes() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch (_) {
    return [];
  }
}
