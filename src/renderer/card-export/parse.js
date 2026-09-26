/* ==========================================================================
   知更 RobinRead — AI 产物 Markdown → 精读卡片结构化数据
   映射 LLMService 三套 prompt 的约定章节（**标题**：/ ## 标题 均可识别），
   任何非标准输出都降级为段落流，保证必出卡片。纯函数、无 DOM 依赖。
   ========================================================================== */

const SECTION_ALIASES = {
  lead: ['主旨', '一句话总览', '总览', '核心观点'],
  steps: ['论证脉络', '脉络'],
  concepts: ['关键概念', '概念'],
  points: ['核心要点', '要点'],
  stats: ['证据与数据', '关键数据与事实', '关键数据', '数据'],
  counter: ['局限与另一面', '另一面', '局限'],
  quotes: ['金句摘录', '金句'],
  actions: ['读后行动', '行动'],
  conclusion: ['结论与启示', '结论'],
};

const ALIAS_LOOKUP = (() => {
  const map = new Map();
  for (const [key, aliases] of Object.entries(SECTION_ALIASES)) {
    for (const a of aliases) map.set(a, key);
  }
  return map;
})();

function findSectionKey(label) {
  const clean = String(label || '').replace(/[（(].*?[)）]/g, '').trim();
  if (ALIAS_LOOKUP.has(clean)) return ALIAS_LOOKUP.get(clean);
  for (const [alias, key] of ALIAS_LOOKUP) {
    if (clean.startsWith(alias) || alias.startsWith(clean)) return key;
  }
  return null;
}

/** 去除行内 Markdown 标记（加粗/斜体/代码/链接）。 */
export function stripInline(s) {
  return String(s || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/__([^_]*)__/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 按列表标记/空行切分为条目。 */
function listify(text) {
  const items = [];
  let current = null;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) { current = null; continue; }
    const m = line.match(/^(?:[-*+]\s+|\d{1,2}[.、)）]\s*)(.*)$/);
    if (m) { current = m[1]; items.push(current); }
    else if (current != null) { current += ' ' + line; items[items.length - 1] = current; }
    else { items.push(line); }
  }
  return items;
}

/** 条目 → {t, d}：优先加粗小标题，否则取首句。 */
function splitHeadBody(raw) {
  const s = stripInline(raw);
  const bold = String(raw || '').match(/\*\*([^*]+)\*\*\s*[：:]?\s*([\s\S]*)/);
  if (bold) return { t: stripInline(bold[1]), d: stripInline(bold[2]) };
  const m = s.match(/^(.{1,30}?[。！？；;])\s*(.*)$/);
  if (m && m[2]) return { t: m[1], d: m[2] };
  return { t: s, d: '' };
}

/** 从文本提取 ≤3 个关键数字做 callout（百分比/倍数/金额/大数）。 */
export function extractStats(text, limit = 3) {
  const src = stripInline(text);
  if (!src) return [];
  const patterns = [
    /-?\d+(?:\.\d+)?\s?(?:%|％)/g,
    /\d+(?:\.\d+)?\s?(?:倍|x|×)/gi,
    /[¥$€]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:万|亿|k|K|M))?/g,
    /\d[\d,]*(?:\.\d+)?\s?(?:万|亿)(?:\s?(?:元|美元|人|台|辆|次))?/g,
  ];
  const found = [];
  const seen = new Set();
  for (const re of patterns) {
    re.lastIndex = 0;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      const v = m[0].replace(/\s+/g, '');
      const key = v.replace(/[,，]/g, '');
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ v, index: m.index });
      if (found.length >= limit * 3) break;
    }
  }
  found.sort((a, b) => a.index - b.index);
  const out = [];
  for (const f of found) {
    const label = clauseLabel(src, f.index, f.v.length);
    out.push({ v: f.v, l: label });
    if (out.length >= limit) break;
  }
  return out;
}

/** 数字所在短句 → 精简标签（去掉数字本身，≤12 字）。 */
function clauseLabel(src, index, len) {
  const before = src.slice(Math.max(0, index - 60), index);
  const after = src.slice(index + len, index + len + 40);
  const sentence = ((before.split(/[。！？；;\n]/).pop() || '') + (after.split(/[。！？；;\n]/)[0] || ''));
  const clauses = sentence.split(/[，,、（）()]/).map((s) => s.trim()).filter(Boolean);
  const clause = (clauses.find((c) => before.endsWith(c) || c.length > 0) || '').trim();
  let label = clause.replace(/^[:：\s]+/, '');
  if (label.length > 12) label = label.slice(0, 12);
  return label || '关键数据';
}

const WRAP_RE = /^[「『“"''](.+)[」』”"'']$/;

function cleanQuote(s) {
  let t = stripInline(s).replace(/^>\s*/, '');
  const m = t.match(WRAP_RE);
  if (m) t = m[1];
  return t.trim();
}

/**
 * 解析 AI 产物 Markdown 为卡片正文数据（文章标题/来源/日期/封面由调用方补充）。
 * @returns {{lead,steps,points,concepts,stats,counter,quotes,actions,conclusion,prose,meta}}
 */
export function parseArtifactToCard(content, kind = 'summary') {
  const raw = String(content || '');
  const plain = stripInline(raw);
  const meta = { words: plain.length, minutes: Math.max(1, Math.round(plain.length / 400)) };
  const empty = { lead: '', steps: [], points: [], concepts: [], stats: [], counter: '', quotes: [], actions: [], conclusion: '', prose: [] };
  if (!plain) return { ...empty, meta };

  try {
    // 1) 按章节标题分桶
    const buckets = new Map();
    let current = null;
    let headersFound = false;
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) { if (current) buckets.get(current).push(''); continue; }
      const stripped = trimmed.replace(/^#{1,6}\s*/, '').replace(/^\*+/, '').replace(/\*+$/, '');
      // 形态一：整行就是纯章节标题（## 主旨 / **结论** 等，无冒号）——只认精确 alias，防误伤正文
      const bare = stripped.replace(/[：:]\s*$/, '').trim();
      const bareKey = bare.length <= 14 ? ALIAS_LOOKUP.get(bare) : null;
      if (bareKey) {
        headersFound = true;
        if (!buckets.has(bareKey)) buckets.set(bareKey, []);
        current = bareKey;
        continue;
      }
      // 形态二：标题：内容（同行为主）
      const hm = stripped.match(/^([^：:]{1,14})[：:]\s*(.*)$/);
      if (hm) {
        const key = findSectionKey(hm[1]);
        if (key) {
          headersFound = true;
          if (!buckets.has(key)) buckets.set(key, []);
          const rest = hm[2].trim();
          if (rest) buckets.get(key).push(rest);
          current = key;
          continue;
        }
      }
      if (current) buckets.get(current).push(trimmed);
    }

    const textOf = (key) => (buckets.get(key) || []).join('\n').trim();
    const out = { ...empty };

    if (headersFound) {
      out.lead = stripInline(textOf('lead'));
      out.steps = listify(textOf('steps')).map(splitHeadBody).filter((s) => s.t);
      out.points = listify(textOf('points')).map(splitHeadBody).filter((s) => s.t);
      out.counter = stripInline(textOf('counter'));
      out.conclusion = stripInline(textOf('conclusion'));
      out.quotes = listify(textOf('quotes')).map(cleanQuote).filter(Boolean);
      out.actions = listify(textOf('actions')).map((s) => stripInline(s)).filter(Boolean);

      const conceptItems = listify(textOf('concepts'));
      const terms = [];
      for (const item of conceptItems) {
        for (const part of item.split(/[；;]/)) {
          const t = stripInline(part).split(/[：:（(]/)[0].trim();
          if (t && t.length <= 16 && !terms.includes(t)) terms.push(t);
        }
      }
      out.concepts = terms.slice(0, 8);

      const statsSecRaw = textOf('stats');
      out.stats = extractStats(statsSecRaw || listify(statsSecRaw).join('。'));
      if (out.stats.length === 0 && listify(statsSecRaw).length > 0) {
        out.points = out.points.concat(listify(statsSecRaw).map(splitHeadBody).filter((s) => s.t));
      }
    } else {
      // 2) 无章节结构（普通摘要/非标准输出）：首段作导语，其余列表作要点，段落流兜底
      const items = listify(raw);
      const isBulleted = /^\s*(?:[-*+]|\d{1,2}[.、)）])\s/m.test(raw);
      if (isBulleted && items.length > 1) {
        out.lead = items[0].length <= 160 ? stripInline(items[0]) : stripInline(items[0]).slice(0, 120);
        out.points = items.slice(1).map(splitHeadBody).filter((s) => s.t);
      } else {
        const paras = raw.split(/\r?\n\s*\r?\n/).map((p) => stripInline(p)).filter(Boolean);
        out.lead = paras[0] || '';
        out.prose = paras.slice(1);
      }
    }

    // 3) 结构过薄时补段落流（如只有主旨没有要点）
    if (!out.lead && out.prose.length === 0 && !out.points.length && !out.steps.length) {
      out.prose = plain.split(/(?<=[。！？])\s*/).reduce((acc, s) => {
        if (!s.trim()) return acc;
        const last = acc[acc.length - 1];
        if (last && (last + s).length <= 220) acc[acc.length - 1] = last + s;
        else acc.push(s.trim());
        return acc;
      }, []);
    }
    return { ...out, meta };
  } catch (_) {
    return { ...empty, lead: plain.slice(0, 160), prose: [plain], meta };
  }
}

/** 从正文 HTML 提取首图 URL（封面用，无图返回 null）。 */
export function extractFirstImage(html) {
  if (!html) return null;
  const m = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
  const url = m && m[1];
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/** 嗅探 base64 图片 mime 并包装为 data URI（fetchImageBytes 只返回裸 base64）。 */
export function base64ImageToDataURI(b64) {
  const s = String(b64 || '');
  if (!s) return null;
  let mime = 'image/jpeg';
  if (s.startsWith('/9j/')) mime = 'image/jpeg';
  else if (s.startsWith('iVBOR')) mime = 'image/png';
  else if (s.startsWith('UklGR')) mime = 'image/webp';
  else if (s.startsWith('R0lGOD')) mime = 'image/gif';
  return `data:${mime};base64,${s}`;
}
