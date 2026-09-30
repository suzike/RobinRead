'use strict';
/**
 * e2e-card-export.js — 精读卡片导出 E2E（离线）
 * 走真实链路：preload 白名单 → ipc.js card:renderPng（隐藏窗口两遍渲染）
 *            → app:writeBinaryFile / app:copyImage（落盘与剪贴板回读）
 *            → preview.js 在真实渲染层页面内开弹窗（模板切换 / shadow DOM 预览 / Esc 关闭）
 * 运行：npx electron scripts/e2e-card-export.js   （退出码 0 = PASS）
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, clipboard } = require('electron');

const ROOT = path.join(__dirname, '..');
let failed = 0;
const ok = (cond, name, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failed += 1;
};

// 注册期只用到 on/snapshot/preferences，其余 handler 均为惰性调用
const fakeStore = {
  on: () => {},
  snapshot: () => ({ sidebarCounts: {}, refreshStatus: {} }),
  preferences: { get: () => null, set: () => {}, flushSync: () => {} },
};

const CARD_DATA = {
  kind: 'deepRead',
  title: '推理成本下降90%背后：一场静悄悄的算力革命',
  feedTitle: '机器之心',
  date: '2026年9月24日',
  cover: null,
  lead: '当所有人盯着训练集群的规模竞赛时，真正决定大模型商业化的推理成本正在被系统性压低。',
  steps: [
    { t: '现象：成本陡降', d: '18 个月内主流 API 千 token 价格下降约 90%。' },
    { t: '机制：三条主线', d: 'KV Cache 压缩、投机解码与算子融合叠加。' },
  ],
  concepts: ['KV Cache', '投机解码', 'MoE'],
  stats: [{ v: '-90%', l: 'API 千 token 成本' }, { v: '3.2×', l: '长文本吞吐' }],
  counter: '未讨论量化精度损失的累积效应。',
  quotes: ['推理成本的下降速度，第一次超过了模型能力的增长速度。'],
  actions: ['用开源量化模型复测成本基线'],
  conclusion: '把长上下文从可选实验变为默认架构。',
  meta: { words: 2400, minutes: 8 },
};

app.whenReady().then(async () => {
  // 看门狗：任何环节卡死 60s 后强制退出并报错
  const watchdog = setTimeout(() => { console.error('FAIL  E2E 超时（60s）'); app.exit(2); }, 60000);
  const savePath = path.join(app.getPath('temp'), `robin-e2e-card-${Date.now()}.png`);
  try {
    const { registerIPCHandlers } = require(path.join(ROOT, 'src', 'main', 'ipc'));
    console.log('[e2e] register handlers');
    const win = new BrowserWindow({
      show: false, width: 1280, height: 820,
      webPreferences: {
        preload: path.join(ROOT, 'src', 'main', 'preload.js'),
        contextIsolation: true,
      },
    });
    registerIPCHandlers(fakeStore, win);
    win.webContents.on('console-message', (_e, _level, message) => {
      if (String(message).startsWith('[e2e-page]')) console.log(message);
    });
    console.log('[e2e] loadFile index.html');
    await win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
    await new Promise((r) => setTimeout(r, 800));
    console.log('[e2e] page loaded, run in-page script');

    const result = await win.webContents.executeJavaScript(`(async () => {
      const data = ${JSON.stringify(CARD_DATA)};
      const out = {};
      const log = (m) => console.log('[e2e-page] ' + m);
      const unwrap = (res, msg) => { if (!res || res.ok !== true) throw new Error((res && res.error) || msg); return res.data; };
      try {
        log('renderCardPng r1 begin');
        const r1 = unwrap(await window.robin.renderCardPng({ templateId: 'paper', data, options: { templateId: 'paper', qr: null }, zoom: 2, ratio: null }), 'render fail');
        out.r1 = { w: r1.width, h: r1.height, len: r1.base64.length };
        log('r1 ok ' + JSON.stringify(out.r1));
        out.save = unwrap(await window.robin.writeBinaryFile(${JSON.stringify(savePath)}, r1.base64), 'save fail');
        out.copy = unwrap(await window.robin.copyImage(r1.base64), 'copy fail');
        log('save/copy ok');
        const r2 = unwrap(await window.robin.renderCardPng({ templateId: 'min', data, options: { templateId: 'min', qr: null }, zoom: 2, ratio: 4 / 3 }), 'render2 fail');
        out.r2 = { w: r2.width, h: r2.height, len: r2.base64.length };
        log('r2 ok ' + JSON.stringify(out.r2));
        // 超载 16:9（画幅硬合同）：6 栏密排仍装不下 → 整卡 contain 缩进精确 16:9 画幅（1333×750×zoom，绝不回落长图）
        const LONG = Array.from({ length: 14 }, (_, i) => '第' + (i + 1) + '段：纸感阅读的关键不在于仿旧，而在于把注意力还给文字本身。版心、行距、页边与留白共同构成节奏，让长文在屏幕上也保有翻阅的呼吸感，安静是最重要的排版变量，中英混排 Mixed English 与数字 2026 亦不例外，本段用于超载多栏铺满验证。').join('\\n\\n');
        const longData = { ...data, title: '超载长文的 16:9 多栏铺满', lead: LONG, content: LONG, sections: LONG };
        const r3 = unwrap(await window.robin.renderCardPng({ templateId: 'paper', data: longData, options: { templateId: 'paper', qr: null }, zoom: 3, ratio: 9 / 16 }), 'render3 fail');
        out.r3 = { w: r3.width, h: r3.height, len: r3.base64.length };
        log('r3 ok ' + JSON.stringify(out.r3));
        // 多栏注入断言（fill.cols → column-count + 无整卡缩小）
        const tpl = await import('./card-export/templates.js');
        const fitted = tpl.renderCardFitted(longData, { templateId: 'paper' }, { ratio: 9 / 16, fill: { compact: true, density: 2, cols: 3 } });
        out.colsCss = (fitted.css.match(/column-count:3/g) || []).length;
        const pg = tpl.renderStagePage(longData, { templateId: 'paper' }, { zoom: 3, ratio: 9 / 16, fill: { compact: true, density: 2, cols: 3 }, finalZoom: 1 });
        out.colsInPage = (pg.html.match(/column-count:3/g) || []).length > 0;
        out.noShrink = !/zoom:0\.\d+ !important/.test(pg.html);

        log('import preview.js');
        const mod = await import('./card-export/preview.js');
        log('open modal');
        await mod.openCardExportModal({ data, link: 'https://example.com/post/1' });
        const overlay = document.querySelector('.modal-overlay .cardx-modal');
        out.modalOpen = Boolean(overlay);
        out.tplCount = overlay ? overlay.querySelectorAll('.cardx-tpl').length : 0;
        const host = overlay ? overlay.querySelector('.cardx-host') : null;
        out.previewCard = Boolean(host && host.shadowRoot && host.shadowRoot.querySelector('.xc-card'));
        const secondTpl = overlay ? overlay.querySelectorAll('.cardx-tpl')[1] : null;
        if (secondTpl) secondTpl.click();
        await new Promise((r) => setTimeout(r, 120));
        out.switchedTpl = Boolean(host && host.shadowRoot.querySelector('.xc-card.xc-t-ink'));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await new Promise((r) => setTimeout(r, 60));
        out.modalClosed = !document.querySelector('.modal-overlay .cardx-modal');
      } catch (e) {
        out.error = (e && e.message) || String(e);
      }
      log('in-page done ' + JSON.stringify(out).slice(0, 300));
      return out;
    })()`);
    clearTimeout(watchdog);

    ok(!result.error, 'E2E 页面脚本无异常', result.error || '');
    ok(result.r1 && result.r1.w >= 1500 && result.r1.len > 30000, 'IPC card:renderPng 自适应档', JSON.stringify(result.r1 || {}));
    ok(result.r2 && result.r2.w === 1500 && result.r2.h === 2000, 'IPC card:renderPng 3:4 档（隐藏窗口复用 + 两遍渲染）', JSON.stringify(result.r2 || {}));
    ok(result.r3 && result.r3.w === 3999 && result.r3.h === 2250 && result.r3.len > 30000, 'IPC 超载 16:9 画幅硬合同（1333×750×3 精确画幅，contain 不回落长图）', JSON.stringify(result.r3 || {}));
    ok((result.colsCss || 0) >= 1, '多栏 fill 注入 column-count:3', `colsCss=${result.colsCss}`);
    ok(result.colsInPage && result.noShrink, '导出页多栏铺满且无整卡缩小', `inPage=${result.colsInPage} noShrink=${result.noShrink}`);
    ok(result.save === true, 'IPC app:writeBinaryFile');
    ok(result.copy === true, 'IPC app:copyImage');
    ok(result.modalOpen === true, 'preview.js 弹窗打开');
    ok(result.tplCount === 10, '模板清单 10 款', `count=${result.tplCount}`);
    ok(result.previewCard === true, 'shadow DOM 卡片预览渲染');
    ok(result.switchedTpl === true, '切换模板后重渲染（墨岩）');
    ok(result.modalClosed === true, 'Esc 关闭弹窗');

    // 主进程侧回读验证
    const pngBuf = fs.existsSync(savePath) ? fs.readFileSync(savePath) : null;
    const pngMagic = pngBuf && pngBuf[0] === 0x89 && pngBuf[1] === 0x50 && pngBuf[2] === 0x4e && pngBuf[3] === 0x47;
    ok(Boolean(pngBuf && pngMagic && pngBuf.length > 30000), '落盘文件为合法 PNG', pngBuf ? `${Math.round(pngBuf.length / 1024)}KB` : 'missing');
    ok(!clipboard.readImage().isEmpty(), '剪贴板可读回非空图片');
  } catch (e) {
    console.error('FAIL  E2E 异常:', e);
    failed += 1;
  } finally {
    try { fs.unlinkSync(savePath); } catch (_) { /* 忽略 */ }
  }
  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
  app.exit(failed === 0 ? 0 : 1);
});
