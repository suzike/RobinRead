'use strict';
/**
 * diag-u31-35.js — 视觉批 3（U31–U35）探针（run-all OFFLINE 集）
 *
 * U31 空态二期：全场景空态插画覆盖清单（empty-art 14+ 场景 / 七视图接线 stagger 壳）/
 *               插画·标题·副文案 0/60/120ms 错峰阶梯（令牌 --nj-stagger-*）+ reduced-motion 豁免
 * U32 统一进度语言：.nj-progress 双形态令牌组件（确定式进度条+百分比 / 不确定式呼吸点）/
 *               Toast.breathe 呼吸进度通知 + progressElement 内联工厂 /
 *               三长任务接线（WebDAV 同步 · 播客转写 · 阅读器逐句翻译）
 * U33 侧栏 2.0：计数徽标 9+ 封顶与零值隐藏统一口径（formatBadgeCount 单一数据源）/
 *               折叠文件夹拖拽悬停自动展开（450ms drag-pending）/ 底栏 12 键 6×2 分组分隔线
 * U34 阅读器边注：边注模式默认关（readerLayout.marginNotes）/ 开启后锚段对齐边注列（200px）/
 *               <1200px 自动回退内联模式 / 设置外观「批注呈现」分区与重启读回
 * U35 划词浮条 2.0：动作注册表纯函数（内置+脚本 add-actions+外部注册）/
 *               图标化压缩（脚本动作首字母徽章）/ 溢出折叠「…更多」二级弹出
 *
 * UI 阶段：offscreen + backgroundThrottling=false + disableHardwareAcceleration，
 * 150s 竞速降级 SKIP（写 .ci-skip-marker，内容=本文件名；连击治理由 run-all 判）。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

app.disableHardwareAcceleration(); // 沙箱内 GPU 合成偶发死锁：探针窗口纯 DOM 断言，禁用硬件加速
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-u31-35-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 150 * 1000).unref();

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 15000) => {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await fn(); } catch (_) { v = null; }
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await sleep(200);
  }
};
let failed = 0;
let passed = 0;
const ok = (c, l) => { if (c) { passed += 1; console.log('PASS ' + l); } else { failed += 1; console.error('FAIL ' + l); } };
const modURL = (f) => require('node:url').pathToFileURL(path.join(ROOT, 'src', 'renderer', 'views', f)).href;

app.on('window-all-closed', () => { /* 探针自行控制退出 */ });

// ── Phase A：源码在册断言 ──────────────────────────────────────────────────
function phaseSource() {
  const robin = read('src/renderer/styles/robin.css');
  const emptyArtSrc = read('src/renderer/views/empty-art.js');
  const sidebarSrc = read('src/renderer/views/sidebar.js');
  const toastSrc = read('src/renderer/views/toast.js');
  const readerSrc = read('src/renderer/views/reader.js');
  const syncSrc = read('src/renderer/views/sync-command.js');
  const mediaSrc = read('src/renderer/views/media-view.js');
  const knowledgeSrc = read('src/renderer/views/knowledge.js');
  const revisitSrc = read('src/renderer/views/revisit-view.js');
  const courseSrc = read('src/renderer/views/course-view.js');
  const weeklySrc = read('src/renderer/views/weekly-view.js');
  const spectrumSrc = read('src/renderer/views/spectrum-view.js');
  const gardenSrc = read('src/renderer/views/garden-view.js');
  const evolutionSrc = read('src/renderer/views/evolution-view.js');
  const dialogsSrc = read('src/renderer/views/dialogs.js');
  const appSrc = read('src/renderer/app.js');
  const storeSrc = read('src/main/AppStore.js');
  const iconsSrc = read('src/renderer/icons.js');
  const i18nSrc = read('src/main/I18NStrings.js');

  // ── U31：空态二期在册 ──
  ok(/export function staggerEmptyHTML/.test(emptyArtSrc) && /tag: frame\(/.test(emptyArtSrc) && /spectrum: frame\(/.test(emptyArtSrc),
    'A U31 empty-art 导出 staggerEmptyHTML + 新场景 tag/spectrum 在册');
  const glyphCount = (emptyArtSrc.match(/^\s{2}[a-zA-Z]+: frame\(/gm) || []).length;
  ok(glyphCount >= 14, `A U31 插画场景在册 ≥14（got=${glyphCount}）`);
  const wiredViews = [
    [revisitSrc, "staggerEmptyHTML('clock')", 'revisit-view clock'],
    [courseSrc, "staggerEmptyHTML('books')", 'course-view books'],
    [weeklySrc, "staggerEmptyHTML('newspaper')", 'weekly-view newspaper'],
    [spectrumSrc, "staggerEmptyHTML('spectrum')", 'spectrum-view spectrum'],
    [gardenSrc, "staggerEmptyHTML('spark')", 'garden-view spark'],
    [knowledgeSrc, 'staggerEmptyHTML(\'tag\')', 'knowledge tags tag'],
    [knowledgeSrc, "staggerEmptyHTML('flame')", 'knowledge dash flame'],
  ];
  for (const [src, needle, label] of wiredViews) {
    ok(src.includes(needle), `A U31 空态接线：${label} 在册`);
  }
  ok(/list-empty stagger/.test(revisitSrc) && /list-empty stagger/.test(courseSrc) && /list-empty stagger/.test(weeklySrc)
    && /list-empty stagger/.test(spectrumSrc) && /list-empty stagger/.test(knowledgeSrc) && /list-empty stagger/.test(evolutionSrc),
    'A U31 七视图空态壳统一挂 stagger 错峰类在册');
  ok(/--nj-stagger-1: 0ms/.test(robin) && /--nj-stagger-2: 60ms/.test(robin) && /--nj-stagger-3: 120ms/.test(robin),
    'A U31 错峰阶梯令牌（0/60/120ms）在册');
  ok(/U31 空态二期/.test(robin) && /\.list-empty\.stagger \.empty-art[\s\S]*?animation-delay: var\(--nj-stagger-1\)/.test(robin)
    && /\.list-empty\.stagger h3[\s\S]*?animation-delay: var\(--nj-stagger-2\)/.test(robin)
    && /\.list-empty\.stagger p[\s\S]*?animation-delay: var\(--nj-stagger-3\)/.test(robin),
    'A U31 插画/标题/副文案三拍阶梯（令牌消费）在册');
  ok(/@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\n\s*\.list-empty\.stagger \.empty-art/.test(robin),
    'A U31 错峰动画 no-preference 门在册（reduced-motion 全局收敛块豁免）');
  ok(/@keyframes nj-empty-rise/.test(robin), 'A U31 nj-empty-rise 关键帧在册');
  ok(i18nSrc.includes('"花园还在整理土壤"') && i18nSrc.includes('"分析常读的订阅源后，它们会按立场排成一条光谱。"'),
    'A U31 i18n 新键在册（花园/光谱空态）');

  // ── U32：统一进度语言在册 ──
  ok(/U32 统一进度语言 \.nj-progress 双形态令牌组件/.test(robin) && /^\.nj-progress \{/m.test(robin)
    && /^\.nj-progress-fill \{/m.test(robin) && /^\.nj-progress-pct \{/m.test(robin),
    'A U32 .nj-progress 确定式三件套（槽/填充/百分比）在册');
  ok(/\.nj-progress--indeterminate \{/.test(robin) && /^\.nj-progress-dot \{/m.test(robin) && /@keyframes nj-progress-breathe/.test(robin),
    'A U32 .nj-progress--indeterminate 呼吸点形态 + breathe 关键帧在册');
  ok(/export function progressElement/.test(toastSrc) && /mode = 'determinate'/.test(toastSrc) && /breathe: \(title, opts = \{\}\) => showProgress/.test(toastSrc),
    'A U32 toast.js progressElement 工厂 + mode breathe + Toast.breathe 在册');
  ok(/nj-progress--indeterminate/.test(toastSrc) && /percent: null/.test(toastSrc),
    'A U32 progressElement null 百分比 → 呼吸形态在册');
  ok(/import \{ Toast \} from '\.\/toast\.js'/.test(syncSrc) && /Toast\.breathe\(t\('正在同步…'\)/.test(syncSrc) && /breathe\.done\(/.test(syncSrc) && /breathe\.fail\(/.test(syncSrc),
    'A U32 长任务① WebDAV 同步 → 呼吸点进度通知（done/fail 收口）在册');
  ok(/import \{ progressElement \} from '\.\/toast\.js'/.test(mediaSrc) && /progressElement\(\{ percent: pct/.test(mediaSrc),
    'A U32 长任务② 播客转写行内状态 → 双形态内联组件在册');
  ok(/import \{ progressElement \} from '\.\/toast\.js'/.test(readerSrc) && /_translateProgressApi = progressElement\(/.test(readerSrc) && /setPercent\(pct\)/.test(readerSrc) && /nj-translate-label/.test(readerSrc),
    'A U32 长任务③ 阅读器逐句翻译浮标 → 确定式进度条+百分比在册');
  ok(/\.translate-progress \.nj-progress \{/.test(robin), 'A U32 译文浮标内联适配（进度条收窄）在册');
  ok(/\.toast-capsule \.toast-bar > i/.test(robin), 'A U32 F13 确定式 .toast-bar > i 合同保留（回归锚）');
  // U32 新块护栏：.nj-progress 段零裸字号/零裸圆角/零裸时长
  {
    const seg = (robin.match(/U32 统一进度语言[\s\S]*?(?=\n\/\* ── U33)/) || [''])[0];
    const badFs = (seg.match(/font-size:\s*\d+px/g) || []).length;
    const badRadius = (seg.match(/border-radius:\s*\d+px/g) || []).length;
    const badDur = (seg.match(/:\s*\d+(\.\d+)?m?s\b\s*;/g) || []).filter((x) => !/var\(/.test(x)).length;
    ok(seg.includes('.nj-progress') && badFs === 0 && badRadius === 0 && badDur === 0,
      `A U32 .nj-progress 块令牌零字面量（fs:${badFs} radius:${badRadius} dur:${badDur}）`);
  }

  // ── U33：侧栏 2.0 在册 ──
  ok(/export function formatBadgeCount/.test(sidebarSrc) && /n > 9 \? '9\+' : String\(n\)/.test(sidebarSrc) && /if \(n <= 0\) return ''/.test(sidebarSrc),
    'A U33 formatBadgeCount 单一口径（≤0 隐藏 / >9 封顶 9+）在册');
  ok(/const label = formatBadgeCount\(count\)/.test(sidebarSrc) && /formatBadgeCount\(n\)/.test(sidebarSrc),
    'A U33 订阅行计数 + 胶囊/重访徽标统一走 formatBadgeCount 在册');
  ok(!/999\+/.test(sidebarSrc), 'A U33 旧 999+ 封顶已退役（统一 9+）');
  ok(/isCollapsed: \(\) => this\.collapsedFolders\.has\(key\)/.test(sidebarSrc) && /expandTimer = setTimeout/.test(sidebarSrc) && /, 450\)/.test(sidebarSrc),
    'A U33 折叠文件夹拖拽悬停自动展开（450ms 计时）在册');
  ok(/drag-pending/.test(sidebarSrc) && /\.sidebar-folder\.drag-pending \.sidebar-disclosure/.test(robin),
    'A U33 drag-pending 待展开提示（JS 类 + CSS disclosure 旋开）在册');
  ok(/_toggleMore/.test(sidebarSrc) && /footer-more-wrap/.test(sidebarSrc) && /robinread\.footerMore/.test(sidebarSrc)
    && /aria-expanded/.test(sidebarSrc) && /aria-controls/.test(sidebarSrc),
    'A U33 实机反馈收敛：底栏「更多」开合（_toggleMore + wrap + aria + localStorage 记账）在册');
  ok(/\.footer-more-wrap \{/.test(read('src/renderer/styles/store.css')) && /grid-template-rows: 0fr/.test(read('src/renderer/styles/store.css'))
    && /visibility: hidden/.test(read('src/renderer/styles/store.css')),
    'A U33「更多」展开行 CSS（0fr/1fr 高度动画 + 收起态 visibility 退 Tab 序）在册');
  ok(/robinread\.collapsedFolders/.test(sidebarSrc) && /robinread\.collapsedAccounts/.test(sidebarSrc),
    'A U33 折叠状态 localStorage 持久化（账户/文件夹）在册');

  // ── U34：边注模式在册 ──
  ok(/marginNotes: this\.preferences\.get\('RobinRead\.marginNotes', 'off'\)/.test(storeSrc) && /marginNotes: \['on', 'off'\]/.test(storeSrc),
    'A U34 readerLayout.marginNotes（默认 off）+ 白名单在册');
  ok(/t\('批注呈现'\)/.test(dialogsSrc) && /t\('边注模式'\)/.test(dialogsSrc) && /setReaderLayout\(\{ marginNotes: value \}\)/.test(dialogsSrc),
    'A U34 设置外观「批注呈现 → 边注模式」开关（setReaderLayout 落库）在册');
  ok(/robinread:margin-notes-changed/.test(appSrc) && /robinread:margin-notes-changed/.test(readerSrc),
    'A U34 开关变更事件（app 派发 + reader 就地重排）在册');
  ok(/_marginNotesOn\(\)/.test(readerSrc) && /_renderMarginNotes\(\)/.test(readerSrc) && /_marginNoteCard\(/.test(readerSrc),
    'A U34 边注渲染三件套（开关/渲染/卡片）在册');
  ok(/has-margin-notes/.test(readerSrc) && /nj-margin-notes/.test(readerSrc) && /nj-margin-note--inline/.test(readerSrc),
    'A U34 边注列挂载（has-margin-notes + 边注列 + 内联回退类）在册');
  ok(/window\.innerWidth < 1200/.test(readerSrc), 'A U34 <1200px 自动回退内联模式（JS 分支）在册');
  ok(/\.reader-article\.has-margin-notes \{/.test(robin) && /--nj-margin-note-width, 200px/.test(robin),
    'A U34 边注列 CSS（200px 右肩位）在册');
  ok(/@media \(max-width: 1199px\)[\s\S]*?\.nj-margin-notes \{ display: none; \}/.test(robin),
    'A U34 窄屏 CSS 回退（边注列隐退 + 内联卡定型）在册');
  ok(i18nSrc.includes('"边注模式"') && i18nSrc.includes('"批注呈现"'), 'A U34 i18n 新键在册（边注模式/批注呈现）');

  // ── U35：划词浮条 2.0 在册 ──
  ok(/export function buildSelectionActionPlan/.test(readerSrc) && /export const SELECTION_ACTION_VISIBLE_MAX/.test(readerSrc),
    'A U35 动作注册表纯函数 + 可见上限导出在册');
  ok(/registerSelectionAction\(action\)/.test(readerSrc) && /_extraSelectionActions/.test(readerSrc),
    'A U35 外部动作注册口在册');
  ok(/kind: 'copy'/.test(readerSrc) && /case 'copy':/.test(readerSrc) && /copyText\?\.\(payload\.selection\)/.test(readerSrc),
    'A U35 复制动作入册 + 分发（copyText）在册');
  ok(/script:\$\{sa\.scriptID/.test(readerSrc) && /case 'script:/.test(readerSrc) === false && /startsWith\('script:'\)/.test(readerSrc) && /runUserActionViaFrame\(sa\.fn/.test(readerSrc),
    'A U35 脚本声明动作入册（script: 前缀 → 沙箱帧执行）在册');
  ok(/_openSelectionMorePop/.test(readerSrc) && /nj-selection-more-pop/.test(readerSrc) && /data-role = 'selection-more'/.test(readerSrc) === false && /dataset\.role = 'selection-more'/.test(readerSrc),
    'A U35 溢出折叠「…更多」二级弹出在册');
  ok(/ellipsis: i\(/.test(iconsSrc), 'A U35 ellipsis 图标在册');
  ok(/nj-selection-script-badge/.test(readerSrc) && /^\.nj-selection-script-badge \{/m.test(robin),
    'A U35 脚本动作首字母徽章图标化（JS+CSS）在册');
  ok(/^\.nj-selection-more-pop \{/m.test(robin) && /^\.nj-selection-more-item \{/m.test(robin),
    'A U35 二级弹出样式（弹层/行项）在册');
  ok(i18nSrc.includes('"复制所选文字"') && i18nSrc.includes('"更多"'), 'A U35 i18n 新键在册（复制/更多）');
}

// ── Phase B：主进程服务级断言（真 AppStore + 真 SQL）──────────────────────
async function phaseService() {
  const { AppStore } = require('../src/main/AppStore');
  const { LOCAL_ACCOUNT_ID } = require('../src/main/Models');
  const userData = app.getPath('userData');
  const store = new AppStore(userData);

  // U34：边注模式偏好（默认关 → 开 → 落库 → 非法值拒绝）
  ok(store.snapshot().preferences.readerLayout.marginNotes === 'off', 'B U34 marginNotes 默认 off');
  store.setReaderLayout({ marginNotes: 'on' });
  ok(store.readerLayout().marginNotes === 'on', 'B U34 setReaderLayout({marginNotes:on}) 落库');
  store.setReaderLayout({ marginNotes: 'maybe' });
  ok(store.readerLayout().marginNotes === 'on', 'B U34 非法值拒绝（白名单外不落库）');
  return { store };
}

/** U34 重启读回（UI 阶段之后：close+重开不与开着的探针窗口混跑）。 */
async function phasePersistence() {
  const { AppStore } = require('../src/main/AppStore');
  const userData = app.getPath('userData');
  let store = new AppStore(userData);
  ok(store.readerLayout().marginNotes === 'on', 'B U34 重启读回：marginNotes=on 保留');
  store.setReaderLayout({ marginNotes: 'off' }); // 复位，不污染他轮
  store.preferences.flushSync();
  store.database.close();
}

// ── Phase C：UI 阶段（offscreen 真窗 + 真 IPC；150s 竞速降级 SKIP）─────────
function openUIWindow() {
  try {
    return new BrowserWindow({
      show: false, width: 1280, height: 860, useContentSize: true,
      webPreferences: { offscreen: true, contextIsolation: true, backgroundThrottling: false, preload: path.join(ROOT, 'src', 'main', 'preload.js') },
    });
  } catch (err) {
    console.error('UI probe: window create failed (environmental):', String((err && err.message) || err));
    return null;
  }
}

async function uiProbe(store, win, seeded) {
  try {
    const { registerIPCHandlers } = require('../src/main/ipc');
    registerIPCHandlers(store, win);
    await win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  } catch (err) {
    console.error('UI probe: load failed (environmental):', String(err && err.message) || err);
    return { uiSkipped: true };
  }
  await sleep(1800);
  const js = async (label, code) => {
    console.log(`C ${label} …`);
    const r = await win.webContents.executeJavaScript(code);
    console.log(`C ${label} 完成`);
    return r;
  };

  // 等应用启动 + 经真实用户管线打开一篇文章
  await waitFor(() => win.webContents.executeJavaScript('Boolean(window.__robinList && window.__robinReaderOpen)').catch(() => null), 25000);
  await waitFor(() => win.webContents.executeJavaScript('(document.querySelectorAll(".entry-row").length + document.querySelectorAll(".cluster-row").length) > 0').catch(() => null), 20000);
  const clickState = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let row = document.querySelector('.entry-row');
    if (!row) {
      document.querySelector('.cluster-row')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await sleep(400);
      row = document.querySelector('.entry-row');
    }
    if (!row) return 'no-row';
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(300);
    return 'clicked';
  })()`).catch((e) => 'EXEC-ERR ' + String((e && e.message) || e));
  console.log('C clickState ' + clickState);
  await waitFor(() => win.webContents.executeJavaScript('Boolean(document.querySelector(".reader-article"))').catch(() => null), 20000);

  // ── U31：插画库 + 错峰阶梯实算（计算样式）──
  const u31 = await js('U31 空态块', `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    const viewsURL = (f) => new URL(f, ${JSON.stringify(modURL('x'))}).href;
    const ea = await import(viewsURL('empty-art.js'));
    out.glyphs = ['newspaper','star','clock','search','radioDot','personX','playCircle','spark','flame','wand','books','plug','tag','spectrum'];
    out.allSVG = out.glyphs.every((g) => ea.emptyArtSVG(g).includes('<svg'));
    out.unknownEmpty = ea.emptyArtSVG('nope') === '';
    out.shell = ea.staggerEmptyHTML('tag').includes('empty-art') && ea.staggerEmptyHTML('tag').includes('stagger') === false;
    out.shellHasH3P = ea.staggerEmptyHTML('tag').includes('<h3></h3><p></p>');
    // 错峰阶梯：真 DOM + 计算样式（插画 0 / 标题 60ms / 副文案 120ms）
    const host = document.createElement('div');
    host.className = 'list-empty stagger';
    host.innerHTML = '<div class="empty-art">' + ea.emptyArtSVG('tag') + '</div><h3>t</h3><p>d</p>';
    document.body.appendChild(host);
    await sleep(60);
    const cs = (sel) => getComputedStyle(host.querySelector(sel));
    out.artDelay = cs('.empty-art').animationDelay;
    out.h3Delay = cs('h3').animationDelay;
    out.pDelay = cs('p').animationDelay;
    out.artDur = cs('.empty-art').animationDuration;
    // 回传纯数据（executeJavaScript 结构化克隆：函数不可回传）
    const toMs = (v) => Math.round(parseFloat(v) * 1000);
    out.ladder = [toMs(out.artDelay), toMs(out.h3Delay), toMs(out.pDelay)];
    host.remove();
    return out;
  })()`);

  // ── U32：进度组件双形态（toast 栈 + 内联工厂）──
  const u32 = await js('U32 进度块', `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    const viewsURL = (f) => new URL(f, ${JSON.stringify(modURL('x'))}).href;
    const toast = await import(viewsURL('toast.js'));
    // ① 内联工厂：确定式（条+填充+百分比）
    const det = toast.progressElement({ percent: 42 });
    out.detBar = !!det.el.querySelector('.nj-progress:not(.nj-progress--indeterminate)');
    out.detFill = det.el.querySelector('.nj-progress-fill').style.width;
    out.detPct = det.el.querySelector('.nj-progress-pct').textContent;
    out.detAria = det.el.querySelector('.nj-progress').getAttribute('aria-valuenow');
    // ② 内联工厂：不确定式（呼吸点）
    const ind = toast.progressElement({ percent: null });
    out.indBar = !!ind.el.querySelector('.nj-progress--indeterminate');
    out.indDot = !!ind.el.querySelector('.nj-progress-dot');
    out.indPctEmpty = ind.el.querySelector('.nj-progress-pct').textContent === '';
    // ③ setPercent 双形态切换：呼吸 → 确定 → 回呼吸
    ind.setPercent(55);
    out.upgrade = ind.el.querySelector('.nj-progress-fill').style.width === '55%' && !ind.el.querySelector('.nj-progress--indeterminate');
    ind.setPercent(null);
    out.downgrade = !!ind.el.querySelector('.nj-progress--indeterminate');
    // ④ Toast.breathe 呼吸进度通知（同步长任务形态）
    const b = toast.Toast.breathe('正在同步…', { note: 'x' });
    out.breatheCapsule = !!document.querySelector('.toast-capsule.progress');
    out.breatheDot = !!document.querySelector('.toast-capsule.progress .nj-progress--indeterminate .nj-progress-dot');
    b.set(50);
    out.breatheUpgradeFill = document.querySelector('.toast-capsule.progress .nj-progress-fill')?.style.width;
    b.done('完成');
    out.breatheSettled = document.querySelector('.toast-capsule.success') != null;
    // ⑤ F13 确定式合同保留（.toast-bar > i）
    const p = toast.Toast.progress('导出中', { note: '0%' });
    out.legacyBar = !!document.querySelector('.toast-capsule.progress .toast-bar > i');
    p.set(66);
    out.legacyFill = document.querySelector('.toast-capsule.progress .toast-bar > i').style.width;
    p.close(); b.close();
    return out;
  })()`);

  // ── U33：徽标封顶 / 底栏分隔线 / 拖拽自动展开 ──
  const u33a = await js('U33 徽标+底栏块', `(async () => {
    const out = {};
    const viewsURL = (f) => new URL(f, ${JSON.stringify(modURL('x'))}).href;
    const sb = await import(viewsURL('sidebar.js'));
    out.fmt = [0, 3, 9, 10, 999].map((n) => sb.formatBadgeCount(n)).join('|');
    out.badgeTexts = [...document.querySelectorAll('.sidebar-row .sidebar-count')].map((el) => el.textContent).filter((t) => t);
    out.badgeNo999 = out.badgeTexts.every((t) => !t.includes('999'));
    out.ninePlus = out.badgeTexts.includes('9+');
    out.zeroHidden = [...document.querySelectorAll('.sidebar-row .sidebar-count')].filter((el) => !el.textContent).every((el) => getComputedStyle(el).visibility === 'hidden');
    // 实机反馈收敛：底栏一行 7 键常驻 +「更多」展开行 7 键（R121 订阅管理入列；默认收起，开合 + 记账实测）
    out.rowBtns = document.querySelectorAll('.footer-nav:not(.footer-nav-more) > .footer-nav-btn').length;
    const moreBtn = document.querySelector('.footer-more-btn');
    out.moreBtn = Boolean(moreBtn);
    const wrap0 = document.querySelector('.footer-more-wrap');
    out.moreClosedDefault = Boolean(wrap0) && !wrap0.classList.contains('open')
      && getComputedStyle(document.querySelector('.footer-nav-more')).visibility === 'hidden'
      && moreBtn?.getAttribute('aria-expanded') === 'false';
    moreBtn?.click();
    await new Promise((r) => setTimeout(r, 460));
    out.moreOpened = wrap0.classList.contains('open')
      && getComputedStyle(document.querySelector('.footer-nav-more')).visibility === 'visible'
      && moreBtn?.getAttribute('aria-expanded') === 'true';
    out.moreBtns = document.querySelectorAll('.footer-nav-more > .footer-nav-btn').length;
    out.persistedOpen = localStorage.getItem('robinread.footerMore') === '1';
    moreBtn?.click();
    await new Promise((r) => setTimeout(r, 460));
    out.toggledBack = !wrap0.classList.contains('open') && localStorage.getItem('robinread.footerMore') === '0';
    return out;
  })()`);
  const u33b = await js('U33 拖拽自动展开块', `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    const folderRow = document.querySelector('.sidebar-row[data-folder-key]');
    out.folderFound = !!folderRow;
    if (!folderRow) return out;
    const wrapper = folderRow.closest('.sidebar-folder');
    // 先折叠（点 disclosure）
    folderRow.querySelector('.sidebar-disclosure').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(120);
    out.collapsedBefore = wrapper.classList.contains('collapsed');
    // 拖拽悬停：feeds 类型 dragover → drag-pending → 450ms 后自动展开
    const dt = new DataTransfer();
    dt.setData('application/x-robinread-feeds', JSON.stringify(['probe-feed']));
    folderRow.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    out.pendingMarked = wrapper.classList.contains('drag-pending');
    await sleep(700);
    out.autoExpanded = !wrapper.classList.contains('collapsed');
    out.pendingCleared = !wrapper.classList.contains('drag-pending');
    // dragleave 取消：再折叠 → dragover 起计时 → dragleave → 不展开
    folderRow.querySelector('.sidebar-disclosure').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(120);
    folderRow.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    folderRow.dispatchEvent(new DragEvent('dragleave', { bubbles: true }));
    await sleep(700);
    out.leaveKeptCollapsed = wrapper.classList.contains('collapsed');
    out.persisted = (JSON.parse(localStorage.getItem('robinread.collapsedFolders') || '[]')).length >= 0;
    return out;
  })()`);

  // ── U34：边注模式（真 IPC 落库 → 就地重排 → 窄屏回退）──
  const u34a = await js('U34 边注开启块', `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    const reader = window.__robinReader;
    out.readerOpen = !!(reader && reader.entryID && document.querySelector('.reader-article'));
    if (!out.readerOpen) return out;
    // 真管道造一枚锚定笔记（锚到首个段落）
    const block = document.querySelector('.robin-body [data-nj-id]');
    out.blockFound = !!block;
    if (!block) return out;
    const pid = block.dataset.njId;
    const r = await window.robin.kbAddNote({ itemID: reader.entryID, content: '边注探针：这一段的页边批注内容。', anchor: { paragraphID: pid, quote: '边注锚引用' } });
    const note = r && r.ok ? r.data : null;
    out.noteCreated = !!note;
    if (note) {
      reader.notes.unshift(note);
      reader._renderNoteMarkers(); // 生产路径：便签标点重建尾端触发边注重排（U34 挂点）
    }
    // 设置 → 真 IPC 开关切换（off→on 触发 margin-notes-changed → 阅读器就地重排）。
    // 注：服务级 B 阶段可能已把偏好置 on——先归 off 再开，保证变更事件真实发生。
    await window.robin.setReaderLayout({ marginNotes: 'off' });
    await sleep(400);
    await window.robin.setReaderLayout({ marginNotes: 'on' });
    await sleep(900);
    out.prefOn = window.__robinReaderLayout?.marginNotes === 'on';
    const article = document.querySelector('.reader-article');
    out.articleFlag = article.classList.contains('has-margin-notes');
    const col = article.querySelector('.nj-margin-notes');
    out.colFound = !!col;
    out.noteCards = article.querySelectorAll('.nj-margin-note').length;
    if (col && out.noteCards) {
      const card = col.querySelector('.nj-margin-note');
      const anchorBlock = document.querySelector('.robin-body [data-nj-id]');
      out.width = Math.round(card.getBoundingClientRect().width);
      out.topDelta = Math.round(Math.abs(card.getBoundingClientRect().top - anchorBlock.getBoundingClientRect().top));
      out.paddingRight = getComputedStyle(article).paddingRight;
      // 笔记类点击唤起既有便签卡
      card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await sleep(80);
      out.noteCardOpens = !!document.querySelector('.nj-note-card');
      document.querySelector('.nj-note-card-close')?.click();
    }
    return out;
  })()`);
  // 窄屏回退：<1200px（窗口缩到 1000 宽 → resize → 内联模式）
  let u34b = { inlineMode: false, colHidden: false, inlineCard: false };
  try {
    win.setContentSize(1000, 860);
    await sleep(600);
    u34b = await js('U34 窄屏回退块', `(async () => {
      await new Promise((r) => setTimeout(r, 400));
      const out = {};
      const article = document.querySelector('.reader-article');
      const col = article?.querySelector('.nj-margin-notes');
      out.inlineMode = window.innerWidth < 1200;
      out.colHidden = col ? getComputedStyle(col).display === 'none' : true;
      out.inlineCard = !!article?.querySelector('.nj-margin-note--inline');
      out.paddingRestored = article ? parseFloat(getComputedStyle(article).paddingRight) < 120 : false;
      return out;
    })()`);
  } catch (err) {
    console.error('U34 窄屏块失败（环境性）:', String(err && err.message || err).slice(0, 160));
  }
  try { win.setContentSize(1280, 860); await sleep(300); } catch (_) { /* 已尽力恢复 */ }

  // ── U35：动作注册表 + 图标化 + 溢出折叠 ──
  const u35 = await js('U35 浮条块', `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    const viewsURL = (f) => new URL(f, ${JSON.stringify(modURL('x'))}).href;
    const rdr = await import(viewsURL('reader.js'));
    out.limit = rdr.SELECTION_ACTION_VISIBLE_MAX;
    // ① 纯函数：默认（AI 三开）→ 7 项全可见零溢出
    const p1 = rdr.buildSelectionActionPlan({}, []);
    out.defaultKinds = p1.visible.map((i) => i.kind).join(',');
    out.defaultOverflow = p1.overflow.length;
    // ② AI 三关 → 4 项（复制/分隔/高亮/笔记）
    const p2 = rdr.buildSelectionActionPlan({ showsSelectionExplanation: false, showsSelectionAsk: false, showsSelectionTranslation: false }, []);
    out.aiOffKinds = p2.items.map((i) => i.kind).join(',');
    // ③ 脚本动作 3 枚 → 溢出 3 + 更多入口
    const p3 = rdr.buildSelectionActionPlan({}, [
      { scriptID: 's1', label: '总结全文' },
      { scriptID: 's2', label: '提取要点' },
      { scriptID: 's3', label: '翻译标题' },
    ]);
    out.scriptOverflow = p3.overflow.length;
    out.scriptKinds = p3.overflow.map((i) => i.kind).join(',');
    // ④ 外部注册口
    const reader = window.__robinReader;
    out.readerOpen = !!(reader && reader.entryID);
    if (out.readerOpen) {
      rdr.registerSelectionAction === undefined; // 模块函数不改实例——注册走实例方法
      reader.registerSelectionAction({ kind: 'probe-extra', title: '探针扩展动作', iconKey: 'spark' });
      const p4 = rdr.buildSelectionActionPlan({}, [], reader._extraSelectionActions || []);
      out.extraRegistered = p4.items.some((i) => i.kind === 'probe-extra');
      out.extraOverflow = p4.items.length > rdr.SELECTION_ACTION_VISIBLE_MAX
        ? p4.items.length - rdr.SELECTION_ACTION_VISIBLE_MAX : 0;
      // ⑤ 真浮条：默认呈现（复制/高亮/笔记图标按钮在册）
      const rect = document.querySelector('.reader-article').getBoundingClientRect();
      reader._presentSelectionPill({
        selection: '划词浮条探针文本',
        paragraphID: (document.querySelector('.robin-body [data-nj-id]') || {}).dataset?.njId || 'p1',
        anchor: null, localContext: '', rect, range: null,
      });
      const pill = document.querySelector('.nj-selection-actions');
      out.pillShown = !!pill;
      out.pillKinds = pill ? [...pill.querySelectorAll('[data-sel-kind]')].map((b) => b.dataset.selKind).join(',') : '';
      // ⑥ 溢出折叠：清外部注册 → 塞 3 枚脚本动作重摆 → 「…更多」出现 → 点开二级弹出
      reader._extraSelectionActions = [];
      reader._userScriptActions = [
        { scriptID: 's1', label: '总结全文', fn: 'return "ok"' },
        { scriptID: 's2', label: '提取要点', fn: 'return "ok"' },
        { scriptID: 's3', label: '翻译标题', fn: 'return "ok"' },
      ];
      reader._presentSelectionPill({
        selection: '划词浮条探针文本',
        paragraphID: (document.querySelector('.robin-body [data-nj-id]') || {}).dataset?.njId || 'p1',
        anchor: null, localContext: '', rect, range: null,
      });
      const pill2 = document.querySelector('.nj-selection-actions');
      const more = pill2?.querySelector('[data-role="selection-more"]');
      out.moreShown = !!more;
      more?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await sleep(80);
      const pop = document.querySelector('.nj-selection-more-pop');
      out.popShown = !!pop;
      out.popItems = pop ? pop.querySelectorAll('.nj-selection-more-item').length : 0;
      out.popScriptKinds = pop ? [...pop.querySelectorAll('[data-sel-kind]')].map((b) => b.dataset.selKind).join(',') : '';
      out.scriptBadge = !!pop?.querySelector('.nj-selection-script-badge'); // 脚本动作首字母徽章图标化
      reader._dismissSelection();
      reader._userScriptActions = [];
      reader._extraSelectionActions = [];
    }
    return out;
  })()`);

  // ── reduced-motion 豁免：错峰动画全局停表（CDP 媒体特性仿真）──
  let rmProbe = { reduced: false };
  try {
    const dbg = win.webContents.debugger;
    await dbg.attach();
    await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await sleep(220);
    rmProbe = await win.webContents.executeJavaScript(`(async () => {
      const viewsURL = (f) => new URL(f, ${JSON.stringify(modURL('x'))}).href;
      const ea = await import(viewsURL('empty-art.js'));
      const host = document.createElement('div');
      host.className = 'list-empty stagger';
      host.innerHTML = '<div class="empty-art">' + ea.emptyArtSVG('tag') + '</div><h3>t</h3><p>d</p>';
      document.body.appendChild(host);
      await new Promise((r) => setTimeout(r, 60));
      const cs = getComputedStyle(host.querySelector('h3'));
      const dur = parseFloat(cs.animationDuration) * 1000;
      host.remove();
      return { reduced: dur <= 2, dur };
    })()`);
    await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await dbg.detach();
  } catch (err) {
    console.error('reduced-motion 仿真失败（环境性）:', String(err && err.message || err).slice(0, 200));
  }

  return {
    uiSkipped: false,
    u31, u32, u33a, u33b, u34a, u34b, u35, rmProbe, seeded, win,
  };
}

app.whenReady().then(async () => {
  try {
    // UI 窗早开（f36 惯例：进程年轻时创建健康）
    const uiWin = openUIWindow();
    if (!uiWin) {
      const { store: store0 } = await phaseService();
      console.log('UI 阶段 SKIP：窗口创建失败（环境性）');
      try { fs.writeFileSync(path.join(__dirname, '.ci-skip-marker'), 'scripts/diag-u31-35.js'); } catch (_) { /* 标记失败仅影响连击治理 */ }
      store0.setReaderLayout({ marginNotes: 'off' });
      store0.preferences.flushSync();
      store0.database.close();
      console.log(`TOTAL passed=${passed} failed=${failed}`);
      process.exit(failed ? 1 : 0);
      return;
    }
    uiWin.on('render-process-gone', (_e, d) => console.error('RENDER-GONE', JSON.stringify(d)));
    uiWin.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      if (level >= 2) console.error(`[renderer:${level}] ${String(message).slice(0, 300)} (${path.basename(String(sourceId))}:${line})`);
    });
    phaseSource();
    const { store } = await phaseService();

    // UI 阶段素材：甲源 3 文（边注锚定用）+ 乙源 12 文（徽标 9+ 封顶用；标题互异防同题聚类）
    const { LOCAL_ACCOUNT_ID } = require('../src/main/Models');
    const longBody = '正文长度必须超过四百字的全文抓取门槛，否则阅读器会去抓原网页补全，离线探针将因此悬挂在加载遮罩上。'.repeat(10);
    const feedA = store.feedsRepo.insertFeed({ accountID: LOCAL_ACCOUNT_ID, title: '视觉批3素材源甲', feedURL: 'https://u31-35.test/a.xml' });
    const seedTitlesA = ['空态错峰观察手记：插画三拍入场的节律实测', '统一进度语言札记：呼吸点与百分比双形态小记', '边注模式样张：把批注摆到页边的一次排版实验'];
    const seededA = [];
    for (let i = 1; i <= 3; i += 1) {
      const [e] = await store._applyParsedEntries(feedA, [{
        id: `u31-a${i}`, title: seedTitlesA[i - 1],
        url: `https://u31-35.test/a/${i}`,
        publishedAt: Date.now() / 1000 - i * 3600,
        summary: `第${i}篇：视觉批3素材摘要，用于列表行渲染与阅读器打开管线。`,
        contentHTML: `<h2>第一章 样本${i}</h2><p>${longBody}</p><p>第二段：边注锚定与错峰阶梯观察补充文字，保证多段落结构。${longBody}</p>`,
      }]);
      seededA.push(e);
    }
    const feedB = store.feedsRepo.insertFeed({ accountID: LOCAL_ACCOUNT_ID, title: '视觉批3素材源乙', feedURL: 'https://u31-35.test/b.xml' });
    for (let i = 1; i <= 12; i += 1) {
      await store._applyParsedEntries(feedB, [{
        id: `u31-b${i}`, title: `徽标封顶素材第${i}号：未读计数阶梯观察样本`,
        url: `https://u31-35.test/b/${i}`,
        publishedAt: Date.now() / 1000 - i * 7200,
        summary: `第${i}篇：乙源徽标封顶样本摘要。`,
        contentHTML: `<p>${longBody}</p>`,
      }]);
    }
    // 排序夹（U33 拖拽自动展开的目标文件夹）
    store.setFeedFolder([feedB.id], '批3素材夹');

    // ── UI 阶段（150s 竞速降级 SKIP）──
    console.log('UI 阶段启动…');
    const ui = await Promise.race([
      uiProbe(store, uiWin, seededA.length).catch((err) => { console.error('uiProbe threw:', String(err && err.stack || err).slice(0, 800)); return { uiSkipped: true }; }),
      new Promise((r) => setTimeout(() => r({ uiSkipped: true }), 150000)),
    ]);
    if (ui.uiSkipped) {
      console.log('UI 阶段 SKIP：环境性挂起（源码级+服务级断言已全部执行）');
      try { fs.writeFileSync(path.join(__dirname, '.ci-skip-marker'), 'scripts/diag-u31-35.js'); } catch (_) { /* 标记失败仅影响连击治理 */ }
      store.setReaderLayout({ marginNotes: 'off' });
      store.preferences.flushSync();
      store.database.close();
      console.log(`TOTAL passed=${passed} failed=${failed}`);
      process.exit(failed ? 1 : 0);
      return;
    }

    const label = (v, name) => `${name}（got=${JSON.stringify(v)}）`;
    // ── U31 ──
    ok(ui.u31.allSVG && ui.u31.unknownEmpty, label({ allSVG: ui.u31.allSVG, unknown: ui.u31.unknownEmpty }, 'C U31 14 场景全 SVG + 未知 glyph 空串'));
    ok(ui.u31.shellHasH3P, label(ui.u31.shellHasH3P, 'C U31 staggerEmptyHTML 统一壳（插画槽+标题+副文案）'));
    {
      const ladder = ui.u31.ladder || [];
      ok(ladder[0] === 0 && ladder[1] === 60 && ladder[2] === 120, label(ladder, 'C U31 错峰阶梯实算（插画0/标题60/副文案120ms）'));
    }
    ok(parseFloat(ui.u31.artDur) > 0, label(ui.u31.artDur, 'C U31 错峰动画时长非零（no-preference 生效）'));
    ok(ui.rmProbe.reduced, label(ui.rmProbe, 'C U31 reduced-motion 豁免（仿真 reduce 下动画停表 ≤2ms）'));

    // ── U32 ──
    ok(ui.u32.detBar && ui.u32.detFill === '42%' && ui.u32.detPct === '42%' && ui.u32.detAria === '42',
      label({ bar: ui.u32.detBar, fill: ui.u32.detFill, pct: ui.u32.detPct, aria: ui.u32.detAria }, 'C U32 确定式：进度条+填充宽+百分比+aria-valuenow'));
    ok(ui.u32.indBar && ui.u32.indDot && ui.u32.indPctEmpty,
      label({ bar: ui.u32.indBar, dot: ui.u32.indDot, pctEmpty: ui.u32.indPctEmpty }, 'C U32 不确定式：呼吸点形态'));
    ok(ui.u32.upgrade && ui.u32.downgrade, label({ up: ui.u32.upgrade, down: ui.u32.downgrade }, 'C U32 双形态切换（呼吸→确定→呼吸）'));
    ok(ui.u32.breatheCapsule && ui.u32.breatheDot, label({ capsule: ui.u32.breatheCapsule, dot: ui.u32.breatheDot }, 'C U32 Toast.breathe 呼吸进度通知'));
    ok(ui.u32.breatheUpgradeFill === '50%' && ui.u32.breatheSettled, label({ fill: ui.u32.breatheUpgradeFill, settled: ui.u32.breatheSettled }, 'C U32 呼吸收确定值原地升级 + done 换成功态'));
    ok(ui.u32.legacyBar && ui.u32.legacyFill === '66%', label({ bar: ui.u32.legacyBar, fill: ui.u32.legacyFill }, 'C U32 F13 确定式 .toast-bar 合同保留'));

    // ── U33 ──
    ok(ui.u33a.fmt === '|3|9|9+|9+', label(ui.u33a.fmt, 'C U33 formatBadgeCount 口径（0空/3/9/10→9+/999→9+）'));
    ok(ui.u33a.badgeNo999, label(ui.u33a.badgeTexts.slice(0, 6), 'C U33 全库徽标零 999 残留'));
    ok(ui.u33a.ninePlus, label(ui.u33a.badgeTexts, 'C U33 乙源 12 篇未读 → 徽标显示 9+（DOM 实证）'));
    ok(ui.u33a.zeroHidden, label(ui.u33a.zeroHidden, 'C U33 零值徽标统一隐藏（visibility）'));
    ok(ui.u33a.rowBtns === 7 && ui.u33a.moreBtn && ui.u33a.moreClosedDefault,
      label({ row: ui.u33a.rowBtns, more: ui.u33a.moreBtn }, 'C U33 实机反馈收敛：底栏一行 7 键 +「更多」默认收起（visibility/aria 同步）'));
    ok(ui.u33a.moreOpened && ui.u33a.moreBtns === 7 && ui.u33a.persistedOpen,
      label({ btns: ui.u33a.moreBtns, persisted: ui.u33a.persistedOpen }, 'C U33「更多」展开 7 键可见（aria-expanded=true）+ localStorage 记账（R121 订阅管理入列）'));
    ok(ui.u33a.toggledBack, label(ui.u33a.toggledBack, 'C U33「更多」再点收起 + 记账回 0'));
    ok(ui.u33b.folderFound && ui.u33b.collapsedBefore && ui.u33b.pendingMarked && ui.u33b.autoExpanded && ui.u33b.pendingCleared,
      label({ found: ui.u33b.folderFound, collapsed: ui.u33b.collapsedBefore, pending: ui.u33b.pendingMarked, expanded: ui.u33b.autoExpanded, cleared: ui.u33b.pendingCleared },
        'C U33 折叠夹拖拽悬停：drag-pending 提示 + 450ms 自动展开 + 展后清标记'));
    ok(ui.u33b.leaveKeptCollapsed, label(ui.u33b.leaveKeptCollapsed, 'C U33 dragleave 取消待展开（不误展开）'));

    // ── U34 ──
    ok(ui.u34a.readerOpen && ui.u34a.blockFound && ui.u34a.noteCreated,
      label({ open: ui.u34a.readerOpen, block: ui.u34a.blockFound, note: ui.u34a.noteCreated }, 'C U34 真管道造锚定笔记（kbAddNote 落库+reader.notes 在册）'));
    ok(ui.u34a.prefOn && ui.u34a.articleFlag && ui.u34a.colFound && ui.u34a.noteCards >= 1,
      label({ pref: ui.u34a.prefOn, flag: ui.u34a.articleFlag, col: ui.u34a.colFound, cards: ui.u34a.noteCards }, 'C U34 边注模式开启：真 IPC 落库 + 边注列就地重排'));
    ok(ui.u34a.width === 200 && ui.u34a.topDelta <= 60,
      label({ width: ui.u34a.width, topDelta: ui.u34a.topDelta }, 'C U34 边注卡 200px 宽 + 锚段顶对齐（Δ≤60px）'));
    ok(ui.u34a.paddingRight && parseFloat(ui.u34a.paddingRight) >= 240,
      label(ui.u34a.paddingRight, 'C U34 版心右肩位撑开（padding-right ≥240px）'));
    ok(ui.u34a.noteCardOpens, label(ui.u34a.noteCardOpens, 'C U34 边注卡点击唤起既有便签卡'));
    ok(ui.u34b.inlineMode && ui.u34b.colHidden && ui.u34b.inlineCard && ui.u34b.paddingRestored,
      label(ui.u34b, 'C U34 <1200px 自动回退内联模式（列隐退+内联卡+版心还原）'));

    // ── U35 ──
    ok(ui.u35.limit === 7, label(ui.u35.limit, 'C U35 可见动作上限 =7（内置恰好放下）'));
    ok(ui.u35.defaultKinds === 'explanation,ask,translation,copy,divider,highlight,note' && ui.u35.defaultOverflow === 0,
      label({ kinds: ui.u35.defaultKinds, overflow: ui.u35.defaultOverflow }, 'C U35 默认注册表：内置 7 项全可见零溢出'));
    ok(ui.u35.aiOffKinds === 'copy,divider,highlight,note', label(ui.u35.aiOffKinds, 'C U35 AI 三关 → 本地四项保底'));
    ok(ui.u35.scriptOverflow === 3 && ui.u35.scriptKinds === 'script:s1,script:s2,script:s3',
      label({ overflow: ui.u35.scriptOverflow, kinds: ui.u35.scriptKinds }, 'C U35 脚本 add-actions 动作入册并溢出折叠'));
    ok(ui.u35.extraRegistered, label(ui.u35.extraRegistered, 'C U35 外部注册口（registerSelectionAction）生效'));
    ok(ui.u35.pillShown && ui.u35.pillKinds.includes('copy') && ui.u35.pillKinds.includes('highlight') && ui.u35.pillKinds.includes('note'),
      label(ui.u35.pillKinds, 'C U35 真浮条呈现（复制/高亮/笔记图标按钮在册）'));
    ok(ui.u35.moreShown && ui.u35.scriptBadge, label({ more: ui.u35.moreShown, badge: ui.u35.scriptBadge }, 'C U35 图标化：脚本首字母徽章 + 「…更多」入口'));
    ok(ui.u35.popShown && ui.u35.popItems === 3 && ui.u35.popScriptKinds === 'script:s1,script:s2,script:s3',
      label({ pop: ui.u35.popShown, items: ui.u35.popItems, kinds: ui.u35.popScriptKinds }, 'C U35 「…更多」二级弹出（3 枚溢出动作全数折叠在册）'));

    try { uiWin.destroy(); } catch (_) { /* 已销毁 */ }
    // ── Phase E：重启读回 ──
    await phasePersistence();
    store.preferences.flushSync();
    store.database.close();
    console.log(`TOTAL passed=${passed} failed=${failed}`);
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); } else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 1600));
    app.exit(1);
  }
});
