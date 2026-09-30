'use strict';
/**
 * diag-cardx-variant.js — 卡片导出「配色变体/封面滤镜」实效探针（run-all OFFLINE 集）
 * 用户反馈：两控件点击后预览无变化。
 * 根因①：自适应（auto）预览路径 renderCard 未消费 variant（导出端 renderFullPage 有 stage filter，预览/导出不一致）。
 * 根因②：news/ink/mag 等模板强制封面灰度（0,2,1 特异性）压过用户滤镜规则（0,1,1）——用户选黑白/暖调无效。
 * 修复①：auto 预览 .cardx-scale 加 variantFilter（同导出语义）。修复②：显式滤镜加 !important。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-cxvar-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 120 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };
const ROOT = path.join(__dirname, '..');

const CARD_DATA = {
  kind: 'deepRead', title: '失败清单是最被低估的资产', feedTitle: 'DEV Community', date: '2026-09-30',
  lead: '失败具有可复现、可证伪、可复利的特性，公开发布失败清单本身就是建立信任的商业策略。',
  steps: [{ t: '现象', d: '作者用三周时间收集失败清单。' }, { t: '机制', d: '可验证性带来可信度。' }],
  concepts: ['自主智能体', '失败清单', '401'], stats: [{ v: '17', l: '死掉项目' }, { v: '10+', l: '死因归纳' }],
  meta: { words: 1959, minutes: 5 },
};

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false, width: 1280, height: 860,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(ROOT, 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
    await sleep(900);
    const a = await win.webContents.executeJavaScript(`(async () => {
      const data = ${JSON.stringify(CARD_DATA)};
      // 彩色封面（红蓝渐变），保证滤镜/变体可感知
      const cv = document.createElement('canvas'); cv.width = 600; cv.height = 300;
      const g = cv.getContext('2d'); const grad = g.createLinearGradient(0, 0, 600, 300);
      grad.addColorStop(0, '#d43a2a'); grad.addColorStop(1, '#2a4bd4');
      g.fillStyle = grad; g.fillRect(0, 0, 600, 300);
      data.cover = cv.toDataURL('image/png');
      const { openCardExportModal } = await import('./card-export/preview.js');
      await openCardExportModal({ data, link: 'https://example.com/post/1' });
      const modal = document.querySelector('.modal-overlay .cardx-modal');
      if (!modal) return { __err: 'no modal' };
      const host = modal.querySelector('.cardx-host');
      const sd = () => host.shadowRoot;
      const clickSeg = (boxSel, label) => {
        const btns = [...modal.querySelectorAll(boxSel + ' button')];
        const b = btns.find(x => x.textContent.trim() === label);
        if (!b) return false;
        b.click(); return true;
      };
      const scaleFilter = () => { const el = sd().querySelector('.cardx-scale'); return el ? getComputedStyle(el).filter : '(no .cardx-scale)'; };
      const coverFilterCss = () => { const img = sd().querySelector('.xc-cover img, .xc-hero-img'); return img ? getComputedStyle(img).filter : '(no cover img)'; };
      const settle = () => new Promise(r => setTimeout(r, 140));
      const out = { autoPath: sd().querySelector('.cardx-scale') ? true : false };
      // ① 自适应路径：配色变体
      out.violetClicked = clickSeg('.cardx-variant', '暮紫'); await settle();
      out.violetFilter = scaleFilter();
      out.originalClicked = clickSeg('.cardx-variant', '原色'); await settle();
      out.originalFilter = scaleFilter();
      // ② news 模板（晚报）：封面滤镜被模板强制灰度压住的历史 bug
      const newsTpl = [...modal.querySelectorAll('.cardx-tpl')].find(x => x.textContent.includes('晚报'));
      out.newsFound = Boolean(newsTpl);
      if (newsTpl) { newsTpl.click(); await settle(); }
      out.newsDefaultCover = coverFilterCss();
      out.monoClicked = clickSeg('.cardx-filter', '黑白'); await settle();
      out.monoCover = coverFilterCss();
      out.warmClicked = clickSeg('.cardx-filter', '暖调'); await settle();
      out.warmCover = coverFilterCss();
      modal.querySelector('.cardx-close')?.click();
      return out;
    })()`);
    if (a.__err) throw new Error('cardx-variant: ' + a.__err);
    // 源码级：CSS 流式规则在册（不变）
    // 导出端一致性（源码级）：renderFullPage 自适应含 stage 变体滤镜
    const tplSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'card-export', 'templates.js'), 'utf8');
    ok(tplSrc.includes('.xc-cover img,.xc-hero-img{filter:${coverFilter(options.coverFilter)} !important}'), '模板：用户显式封面滤镜带 !important（压过模板强制灰度）');

    ok(a.autoPath, '自适应路径预览在渲染（.cardx-scale 存在）');
    ok(a.violetClicked, '配色变体「暮紫」可点击');
    ok(String(a.violetFilter).includes('hue-rotate(190deg)'), `暮紫后预览整体带紫调滤镜（${String(a.violetFilter).slice(0, 60)}）`);
    ok(a.originalClicked && (a.originalFilter === 'none' || a.originalFilter === ''), '点回「原色」滤镜清除');
    ok(a.newsFound, '「晚报」模板在册');
    ok(typeof a.newsDefaultCover === 'string' && a.newsDefaultCover !== '(no cover img)', `晚报封面元素在渲染（默认 ${String(a.newsDefaultCover).slice(0, 40)}）`);
    ok(String(a.monoCover).includes('grayscale'), `晚报+黑白：滤镜生效（${String(a.monoCover).slice(0, 50)}）`);
    ok(String(a.warmCover).includes('sepia'), `晚报+暖调：用户选择生效（${String(a.warmCover).slice(0, 50)}）`);
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
