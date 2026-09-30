'use strict';
/**
 * diag-cardx-scenes.js — 场景排版系统探针（run-all OFFLINE 集）
 * 用户提案：每个尺寸一套独立排版脚本。断言：
 * ① 预览：切画幅后 .sp-card 换上该场景专属类（sp-square/tall/slide/poster/cinema/classic），结构特征随场景变化；
 * ② 场景预设 chips 一键切换（小红书 3:4 → sp-tall）；
 * ③ 导出：renderScenePage 六画幅输出尺寸精确（750×750 / 750×1000 / 750×1333 / 1000×750 / 1333×750 / 1763×750）；
 * ④ 真 IPC：card:renderPng sceneId 走场景页（16:9 → 2666×1500 @zoom2 精确）。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, ipcMain } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-scn-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 240 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };
const ROOT = path.join(__dirname, '..');

app.whenReady().then(async () => {
  try {
    // ③ 纯函数层：六画幅精确尺寸 + 场景标记
    const scenes = await import(pathToFileURL(path.join(ROOT, 'src/renderer/card-export/scenes.js')).href);
    const data = {
      kind: 'deepRead', title: '场景排版系统上线：每个尺寸都有专属版式', feedTitle: '知更实验室', date: '2026-09-30',
      lead: '选定画幅即切换该画幅的专属排版，构图、模块取舍与字号节奏随场景变化。',
      steps: [{ t: 'square', d: '1:1 中轴对称' }, { t: 'tall', d: '3:4 顶图信息流' }, { t: 'slide', d: '16:9 左右分区' }],
      concepts: ['1:1', '3:4', '16:9'], stats: [{ v: '6', l: '场景版式' }, { v: '0', l: '回落' }],
    };
    const want = { '1:1': [750, 750, 'sp-square'], '3:4': [750, 1000, 'sp-tall'], '9:16': [750, 1333, 'sp-poster'], '4:3': [1000, 750, 'sp-classic'], '16:9': [1333, 750, 'sp-slide'], '2.35:1': [1763, 750, 'sp-cinema'] };
    for (const [id, [w, h, cls]] of Object.entries(want)) {
      const pg = scenes.renderScenePage(data, { sceneId: id, tplId: 'paper', height: h }, 2);
      ok(pg.width === w * 2 && pg.height === h * 2 && pg.html.includes(cls), `锁定画幅导出页 ${id} → ${w * 2}×${h * 2} 精确（${pg.width}×${pg.height}，${cls}）`);
    }
    const measurePg = scenes.renderScenePage(data, { sceneId: '4:3', tplId: 'paper' }, 2);
    ok(measurePg.height == null, `测量页（height 缺省）→ height:null 供求解器量自然高（${measurePg.height}）`);
    // 零截断：line-clamp 移除 + 超长内容末段完整在册
    ok(!scenes.renderSceneCard(data, { sceneId: '4:3', tplId: 'paper' }).css.includes('-webkit-line-clamp'), '零截断：line-clamp 已移除');
    const LONG32 = Array.from({ length: 32 }, (_, i) => `第${i + 1}段落全文：比例合同的排版引擎必须把所有内容放进约定横纵比的画幅，字号保持基准，画布等比放大。`).join('\n\n');
    const longSc = scenes.renderSceneCard({ ...data, content: LONG32, lead: '' }, { sceneId: '3:4', tplId: 'paper' });
    ok(longSc.html.includes('第32段落全文'), '超长内容末段完整渲染（零截断）');
    const struct = scenes.renderSceneCard(data, { sceneId: '16:9', tplId: 'paper' });
    ok(struct.html.includes('sp-left') && struct.html.includes('sp-right'), '16:9 结构：左右分区（sp-left/sp-right）');
    const struct916 = scenes.renderSceneCard(data, { sceneId: '9:16', tplId: 'paper' });
    ok(struct916.html.includes('sp-hero'), '9:16 结构：hero 压图（sp-hero）');

    // ①② 真实弹窗：切画幅/预设 → 场景类切换
    const win = new BrowserWindow({
      show: false, width: 1280, height: 900,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(ROOT, 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
    await sleep(900);
    const a = await win.webContents.executeJavaScript(`(async () => {
      const data = ${JSON.stringify({ ...data, cover: null })};
      const { openCardExportModal } = await import('./card-export/preview.js');
      await openCardExportModal({ data, link: 'https://example.com/1' });
      const modal = document.querySelector('.modal-overlay .cardx-modal');
      const host = modal.querySelector('.cardx-host');
      const cardCls = () => host.shadowRoot.querySelector('.sp-card')?.className || '';
      const stageW = () => { const m = (host.shadowRoot.querySelector('.cardx-stage')?.getAttribute('style') || '').match(/width:\\s*(\\d+)px/); return m ? Number(m[1]) : 0; };
      const pickRatio = async (label, wantW) => {
        const b = [...modal.querySelectorAll('.cardx-ratio button')].find(x => x.textContent.trim() === label);
        if (!b) return { clicked: false };
        b.click();
        const t0 = Date.now();
        while (Date.now() - t0 < 8000) { await new Promise(r => setTimeout(r, 150)); if (stageW() === wantW) { await new Promise(r => setTimeout(r, 200)); break; } }
        return { clicked: true, cls: cardCls(), w: stageW() };
      };
      const pickPreset = async (label, wantCls) => {
        const b = [...modal.querySelectorAll('.cardx-preset-chip')].find(x => x.textContent.trim() === label);
        if (!b) return { clicked: false };
        b.click();
        const t0 = Date.now();
        while (Date.now() - t0 < 9000) {
          await new Promise(r => setTimeout(r, 160));
          if (cardCls().includes(wantCls)) { await new Promise(r => setTimeout(r, 250)); break; }
        }
        return { clicked: true, cls: cardCls(), w: stageW(), cap: (modal.querySelector('[class*=cap]')?.textContent || '').slice(0, 40) };
      };
      const out = {};
      out.s11 = await pickRatio('1:1', 750);
      out.s169 = await pickRatio('16:9', 1333);
      out.s916 = await pickRatio('9:16', 750);
      out.preset = await pickPreset('小红书 3:4', 'sp-tall');
      modal.querySelector('.cardx-close')?.click();
      return out;
    })()`);
    if (a.__err) throw new Error('scenes: ' + a.__err);
    ok(a.s11.clicked && a.s11.cls.includes('sp-square') && a.s11.w === 750, `1:1 预览 → sp-square（${a.s11.cls.slice(0, 30)} / ${a.s11.w}px）`);
    ok(a.s169.clicked && a.s169.cls.includes('sp-slide') && a.s169.w === 1333, `16:9 预览 → sp-slide 左右分区（${a.s169.cls.slice(0, 30)} / ${a.s169.w}px）`);
    ok(a.s916.clicked && a.s916.cls.includes('sp-poster') && a.s916.w === 750, `9:16 预览 → sp-poster 海报（${a.s916.cls.slice(0, 30)} / ${a.s916.w}px）`);
    ok(a.preset.clicked && a.preset.cls.includes('sp-tall') && a.preset.w === 750, `预设「小红书 3:4」→ sp-tall 信息流（${a.preset.cls.slice(0, 30)} / ${a.preset.w}px）`);
    ok(String(a.preset.cap).includes('场景版式'), `caption 标注场景版式（${a.preset.cap}）`);

    // ④ 真 IPC：比例合同——短内容 16:9 精确基准；长内容 4:3 放大后比例恒定（负载抖动重试一次）
    const { registerIPCHandlers } = require(path.join(ROOT, 'src', 'main', 'ipc'));
    const fakeStore = { on: () => {}, snapshot: () => ({ sidebarCounts: {}, refreshStatus: {} }), preferences: { get: () => null, set: () => {}, flushSync: () => {} } };
    registerIPCHandlers(fakeStore, win);
    const ipcOnce = () => win.webContents.executeJavaScript(`(async () => {
      const D = ${JSON.stringify(data)};
      const res = await window.robin.renderCardPng({ templateId: 'paper', data: D, options: { templateId: 'paper', sceneId: '16:9', qr: null }, zoom: 1, ratio: 9 / 16 });
      const LONG32 = Array.from({ length: 14 }, (_, i) => '第' + (i + 1) + '段落全文：比例合同的排版引擎必须把所有内容放进约定横纵比的画幅，字号保持基准，画布等比放大，文字重新回流。' ).join('\\n\\n');
      const res2 = await window.robin.renderCardPng({ templateId: 'paper', data: { ...D, content: LONG32, lead: '' }, options: { templateId: 'paper', sceneId: '4:3', qr: null }, zoom: 1, ratio: 3 / 4 });
      const ok1 = res && res.ok ? { w: res.data.width, h: res.data.height } : { err: res && res.error };
      const ok2 = res2 && res2.ok ? { w: res2.data.width, h: res2.data.height } : { err: res2 && res2.error };
      return { short: ok1, long: ok2 };
    })()`).catch((e) => ({ __throw: String(e && e.message || e).slice(0, 120) }));
    let r = await ipcOnce();
    if (r.__throw) { await sleep(1200); r = await ipcOnce(); }
    if (r.__throw) throw new Error('IPC scene 渲染两次均失败: ' + r.__throw);
    ok(r.short.w === 1333 && r.short.h === 750, `IPC 短内容 16:9 → 基准精确 1333×750（${r.short.w}×${r.short.h}）`);
    const ratioLong = r.long.w / r.long.h;
    ok(Math.abs(ratioLong - 4 / 3) < 0.01 && r.long.w > 1000, `IPC 长内容 4:3 → 画布放大且比例恒定（${r.long.w}×${r.long.h}，ratio ${ratioLong.toFixed(3)}）`);

    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    try { fs.writeFileSync(path.join(__dirname, '..', '.tmp-shots', 'scenes-err.txt'), String(e && e.stack || e)); } catch (_) {}
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
function pathToFileURL(p) { return require('node:url').pathToFileURL(p); }
