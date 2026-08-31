'use strict';
/**
 * diag-i18n-coverage.js — i18n 覆盖率诊断
 *
 * 扫描 src/renderer/** 中的 t()/tf() 调用：
 *  1. 静态字符串键  → 与 src/main/I18NStrings.js 现有键求差集（缺失清单）
 *  2. 动态键（变量/模板字符串/拼接）→ 列出调用位置，供人工核对
 *  3. 裸硬编码中文（未被 t()/tf() 包裹）→ 仅计数与列出位置（不在本次修复范围）
 *
 * 用法：node scripts/diag-i18n-coverage.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const STRINGS_PATH = path.join(ROOT, 'src', 'main', 'I18NStrings.js');

// 经人工溯源的动态常量键（来自调用处的常量表，静态正则无法直接捕获）：
// - aihot-view.js SECTIONS[].label / windows 标签 / _empty(…)
// - dialogs.js SECTIONS[].title
// - evolution-view.js sections[].label / labelForCheck map / _empty(…)
// - knowledge.js TABS[].label / _empty(…) / _emptyIn(…)
// - account.js PLANS[].title
// - theme-designer.js SIMULATIONS[].label / CHANNELS[].label
// - dialogs.js / reader.js 三元回退字面量
const TRACED_CONSTANT_KEYS = [
  '热点榜', 'AI 日报', '精选', '模型榜',
  '24 小时', '3 天', '7 天', '30 天',
  '加载失败', '暂无数据', '稍后再来看看。', '无匹配结果', '换个关键词试试。',
  '暂无日报', 'AIHOT 每天生成一期 AI 日报，稍后再来。', '换个筛选条件试试。',
  '在热点榜 / 精选卡片上点 ⭐ 收藏，会保存在本机。', '暂无榜单', 'AIHOT 模型排行榜暂时无法获取。',
  '通用', '账号', '反馈',
  '诊断', '源健康', '兴趣画像', '推荐', 'AI 反馈', '信息密度',
  '数据库完整性', '未读堆积', 'AI 配置', '订阅源数量',
  '看板', '复习', '回顾', '热力图', '统计', '标签', '搜索',
  '今天还没有知识沉淀', '阅读时高亮或记笔记，晚上回来回顾。', '没有匹配',
  '还没有高亮', '在阅读器中选中文字后点击高亮按钮。',
  '还没有笔记', '在阅读器中点笔记按钮添加你的第一条笔记。',
  '还没有反链', '其他笔记用 [[链接]] 引用这条笔记后，会出现在这里。',
  '复习队列空了', '高亮一篇文章的重要段落并加入复习，它会按记忆曲线回来。',
  '还没有收藏集', '收藏集帮助你按主题归档文章，可从阅读器加入。',
  '收藏集是空的', '从阅读器或列表中把文章加入这个收藏集。',
  '还没有标签', 'AI 质量评估会自动生成标签，也可以手动添加。',
  '暂无相关文章', '这个标签还没有关联文章。',
  '还没有智能文件夹', '创建一个按关键词自动聚合文章的智能文件夹。',
  '暂无健康数据', '刷新订阅后自动累积抓取成功率。',
  '画像还是空的', '多读几篇、收藏或高亮文章后，这里会浮现你的兴趣。',
  '暂无推荐', '先阅读一些文章，让画像成长起来。',
  '月卡会员',
  '正常视觉', '红色盲', '绿色盲', '蓝色盲',
  '主色', '副色', '面板',
  '仅打包版（安装版）可用，当前环境不支持。',
  '精读失败', '摘要生成失败', '预览深色', '预览浅色',
];
// 动态实参扫描的误报（非 i18n 键，是 ID/枚举值字面量）
const NON_KEY_LITERALS = new Set(['light', 'manual', 'dark']);

function listJsFiles(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...listJsFiles(p));
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

function unescapeKey(raw) {
  return raw.replace(/\\(['"\\])/g, '$1');
}

// 从源码中移除注释与正则字面量的简易扫描器（够用即可，按字符状态机）
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let mode = 'code'; // code | line | block | sq | dq | tpl | regex
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && next === '/') { mode = 'line'; i += 2; out += '  '; continue; }
      if (c === '/' && next === '*') { mode = 'block'; i += 2; out += '  '; continue; }
      if (c === "'") { mode = 'sq'; out += c; i += 1; continue; }
      if (c === '"') { mode = 'dq'; out += c; i += 1; continue; }
      if (c === '`') { mode = 'tpl'; out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out += c; } else { out += ' '; }
      i += 1; continue;
    }
    if (mode === 'block') {
      if (c === '*' && next === '/') { mode = 'code'; out += '  '; i += 2; } else { out += c === '\n' ? '\n' : ' '; i += 1; }
      continue;
    }
    if (mode === 'sq' || mode === 'dq') {
      const quote = mode === 'sq' ? "'" : '"';
      if (c === '\\') { out += src.substr(i, 2); i += 2; continue; }
      if (c === quote) { mode = 'code'; }
      out += c; i += 1; continue;
    }
    if (mode === 'tpl') {
      if (c === '\\') { out += src.substr(i, 2); i += 2; continue; }
      if (c === '`') { mode = 'code'; }
      out += c; i += 1; continue;
    }
  }
  return out;
}

function analyze() {
  const files = listJsFiles(RENDERER);
  const staticKeys = new Map(); // key -> [{file,line,hasFallback}]
  const dynamicCalls = []; // {file,line,snippet}
  const dynamicLiterals = new Map(); // 动态调用内的静态字面量 key -> [{file,line}]
  const concatPrefixes = []; // 'xxx' + var 形式的前缀片段
  const wrapperKeys = new Map(); // _empty/_emptyIn 等包装函数的整参字面量
  const bareChinese = []; // {file,line,snippet}
  const cjkRe = /[\u4e00-\u9fff\u3400-\u4dbf]/;
  // 以字符串字面量为键、转投 t() 的包装函数（其字面量实参同样是键）
  const WRAPPER_FNS = ['_empty', '_emptyIn'];

  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    const lines = src.split('\n');

    lines.forEach((lineText, idx) => {
      const lineNo = idx + 1;

      // --- t(...) / tf(...) 调用 ---
      const callRe = /\bt(?:f)?\s*\(/g;
      let m;
      while ((m = callRe.exec(lineText)) !== null) {
        // 排除标识符前缀（如 object.t(、xxx.tf(）
        const before = lineText.slice(0, m.index);
        if (/[A-Za-z0-9_$.]$/.test(before)) continue;
        const rest = lineText.slice(m.index + m[0].length);
        const firstCh = rest.trim()[0];
        if (firstCh === undefined) continue;
        if (firstCh === "'" || firstCh === '"') {
          const q = firstCh;
          const endIdx = findStringEnd(rest, q);
          if (endIdx > 0) {
            const raw = rest.slice(1, endIdx);
            const after = rest.slice(endIdx + 1);
            if (/^\s*\+/.test(after)) {
              // 'xxx' + expr：运行时拼接键，静态片段本身不一定是键
              concatPrefixes.push({ file: rel, line: lineNo, snippet: lineText.trim().slice(0, 160), fragment: unescapeKey(raw) });
              continue;
            }
            const key = unescapeKey(raw);
            if (!staticKeys.has(key)) staticKeys.set(key, []);
            // 检查第二个参数（内联英文回退）
            const hasFallback = /^\s*,\s*['"`]/.test(after);
            staticKeys.get(key).push({ file: rel, line: lineNo, hasFallback });
          }
        } else {
          // 动态实参（三元 / || / 变量 / 模板串）：提取括号内全部字符串字面量逐个查表
          dynamicCalls.push({ file: rel, line: lineNo, snippet: lineText.trim().slice(0, 160) });
          const argText = extractBalancedParens(lineText.slice(m.index + m[0].length - 1));
          if (argText) {
            const litRe = /'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"/g;
            let lm;
            while ((lm = litRe.exec(argText)) !== null) {
              const key = unescapeKey(lm[1] !== undefined ? lm[1] : lm[2]);
              if (!key) continue;
              if (!dynamicLiterals.has(key)) dynamicLiterals.set(key, []);
              dynamicLiterals.get(key).push({ file: rel, line: lineNo });
            }
          }
        }
      }

      // --- 包装函数（_empty(title, desc) 等）：整参为字符串字面量的实参也是键 ---
      for (const fn of WRAPPER_FNS) {
        const wrapRe = new RegExp(`\\b${fn}\\s*\\(`, 'g');
        let wm;
        while ((wm = wrapRe.exec(lineText)) !== null) {
          if (/[A-Za-z0-9_$.]$/.test(lineText.slice(0, wm.index))) continue;
          const argText = extractBalancedParens(lineText.slice(wm.index + wm[0].length - 1));
          if (!argText) continue;
          for (const arg of splitTopLevelArgs(argText.slice(1, -1))) {
            const trimmed = arg.trim();
            const sq = trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2;
            const dq = trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2;
            if (!sq && !dq) continue;
            const key = unescapeKey(trimmed.slice(1, -1));
            if (!key) continue;
            if (!wrapperKeys.has(key)) wrapperKeys.set(key, []);
            wrapperKeys.get(key).push({ file: rel, line: lineNo });
          }
        }
      }

      // --- 裸中文（该行含中文但没有任何 t( / tf( 包裹）---
      if (cjkRe.test(lineText) && !/\bt(?:f)?\s*\(/.test(lineText)) {
        // 排除注释（stripComments 已把注释替换为空格，故此处命中的即为代码里的中文）
        bareChinese.push({ file: rel, line: lineNo, snippet: lineText.trim().slice(0, 160) });
      }
    });
  }

  // 现有键
  const STRINGS = require(STRINGS_PATH).STRINGS;
  const existing = new Set(Object.keys(STRINGS));

  const missing = [];
  const covered = [];
  for (const [key, sites] of staticKeys) {
    if (existing.has(key)) covered.push(key);
    else missing.push({ key, sites });
  }
  missing.sort((a, b) => a.key.localeCompare(b.key, 'zh'));

  // 动态调用中的字面量：拆分为 已收录 / 缺失（排除 ID/枚举误报）
  const dynMissing = [];
  const dynCovered = [];
  for (const [key, sites] of dynamicLiterals) {
    if (NON_KEY_LITERALS.has(key)) continue;
    if (existing.has(key) || staticKeys.has(key)) dynCovered.push(key);
    else dynMissing.push({ key, sites });
  }
  dynMissing.sort((a, b) => a.key.localeCompare(b.key, 'zh'));

  // 包装函数字面量与人工溯源常量键
  const tracedMissing = [];
  const tracedCovered = [];
  const mergedSources = [...wrapperKeys.entries()].map(([k, s]) => [k, s, 'wrapper']);
  for (const key of TRACED_CONSTANT_KEYS) mergedSources.push([key, [{ file: '(traced)', line: 0 }], 'traced']);
  for (const [key, sites] of mergedSources) {
    if (existing.has(key) || staticKeys.has(key)) tracedCovered.push(key);
    else tracedMissing.push({ key, sites });
  }
  tracedMissing.sort((a, b) => a.key.localeCompare(b.key, 'zh'));

  // 最终缺失合集（去重）
  const finalMissingMap = new Map();
  for (const { key, sites } of [...missing, ...dynMissing, ...tracedMissing]) {
    if (!finalMissingMap.has(key)) finalMissingMap.set(key, sites);
    else finalMissingMap.get(key).push(...sites);
  }
  const finalMissing = [...finalMissingMap.entries()]
    .map(([key, sites]) => ({ key, sites }))
    .sort((a, b) => a.key.localeCompare(b.key, 'zh'));

  return {
    totalFiles: files.length, staticKeys, covered, missing,
    dynamicCalls, dynamicLiterals, dynMissing, dynCovered,
    tracedMissing, tracedCovered, finalMissing,
    concatPrefixes, bareChinese, existingCount: existing.size,
  };
}

// 提取从 "(" 开始的平衡括号文本（含括号本身）；跨行不支持，找不到则返回 null
function extractBalancedParens(s) {
  if (s[0] !== '(') return null;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return s.slice(0, i + 1);
    }
  }
  return null;
}

// 按顶层逗号拆分实参（忽略引号与嵌套括号内的逗号）
function splitTopLevelArgs(s) {
  const args = [];
  let depth = 0;
  let cur = '';
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === '\\') { cur += s[i + 1] || ''; i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    if (c === ',' && depth === 0) { args.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) args.push(cur);
  return args;
}

function findStringEnd(s, quote) {
  for (let i = 1; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i += 1; continue; }
    if (c === quote) return i;
  }
  return -1;
}

function main() {
  const r = analyze();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(r.finalMissing.map((x) => x.key), null, 0));
    return;
  }
  console.log('=== i18n 覆盖率诊断 ===');
  console.log(`扫描文件数: ${r.totalFiles}`);
  console.log(`字符串表现有键: ${r.existingCount}`);
  console.log(`渲染层静态键总数（去重）: ${r.staticKeys.size}`);
  console.log(`已收录: ${r.covered.length}`);
  console.log(`缺失（静态 t/tf 直调）: ${r.missing.length}`);
  console.log(`缺失（动态调用字面量）: ${r.dynMissing.length}`);
  console.log(`缺失（包装函数/溯源常量）: ${r.tracedMissing.length}`);
  console.log(`最终缺失合计（去重）: ${r.finalMissing.length}`);
  console.log(`动态调用点: ${r.dynamicCalls.length}`);
  console.log(`运行时拼接键片段: ${r.concatPrefixes.length}`);
  console.log(`裸中文行（不在范围内）: ${r.bareChinese.length}`);
  console.log('');
  console.log('--- 最终缺失键清单 ---');
  for (const { key, sites } of r.finalMissing) {
    console.log(`${JSON.stringify(key)}`);
    for (const s of sites.slice(0, 3)) console.log(`    at ${s.file}:${s.line}`);
  }
  console.log('');
  console.log('--- 运行时拼接键片段（无法静态收录，人工核对合成结果） ---');
  const seenC = new Set();
  for (const d of r.concatPrefixes) {
    const sig = `${d.file}:${d.line}`;
    if (seenC.has(sig)) continue;
    seenC.add(sig);
    console.log(`${sig}  fragment=${JSON.stringify(d.fragment)}  ${d.snippet}`);
  }
  console.log('');
  console.log('--- 动态调用点（需人工溯源常量来源） ---');
  const seen = new Set();
  for (const d of r.dynamicCalls) {
    const sig = `${d.file}:${d.line}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    console.log(`${sig}  ${d.snippet}`);
  }
  console.log('');
  console.log('--- 裸硬编码中文行（仅列出，不在本次范围） ---');
  const seenBare = new Set();
  for (const b of r.bareChinese) {
    const sig = `${b.file}:${b.line}`;
    if (seenBare.has(sig)) continue;
    seenBare.add(sig);
    console.log(`${sig}  ${b.snippet}`);
  }
}

if (require.main === module) main();
module.exports = { analyze };
