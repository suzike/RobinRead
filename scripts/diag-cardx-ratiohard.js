'use strict';
/**
 * diag-cardx-ratiohard.js — 卡片画幅硬合同探针（run-all OFFLINE 集）
 * 用户需求：选中任一画幅，预览与导出都必须严格 = 该画幅——超长文绝不回落自然高度长图。
 * 实现：超载 ladder 扩到 6 栏；仍超 → 整卡等比 contain 缩进精确画幅（预览居中、导出 zoom !important 同构）。
 * 断言：真实弹窗中超长文逐档点 4:3/16:9/9:16/1:1，预览 stage 宽高比精确匹配；标注不含「回落」。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-rh-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 180 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };
const ROOT = path.join(__dirname, '..');

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false, width: 1280, height: 900,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(ROOT, 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
    await sleep(900);
    const a = await win.webContents.executeJavaScript(`(async () => {
      // 超长文（此前 4 栏也装不下 → 必走 contain；这是用户实测场景）
      const LONG = Array.from({ length: 16 }, (_, i) => '第' + (i + 1) + '段：纸感阅读的关键不在于仿旧，而在于把注意力还给文字本身。版心、行距、页边与留白共同构成节奏，让长文在屏幕上也保有翻阅的呼吸感，安静是最重要的排版变量，中英混排 Mixed English 与数字 2026 亦不例外，本段用于画幅硬合同验证。').join('\\n\\n');
      const data = { kind:'deepRead', title:'画幅硬合同：超长文也必须精确出画幅', feedTitle:'T', date:'2026-09-30', lead: LONG, content: LONG, sections: LONG, meta:{words:9800,minutes:26} };
      const { openCardExportModal } = await import('./card-export/preview.js');
      await openCardExportModal({ data, link: 'https://example.com/1' });
      const modal = document.querySelector('.modal-overlay .cardx-modal');
      if (!modal) return { __err: 'no modal' };
      const host = modal.querySelector('.cardx-host');
      const cap = modal.querySelector('.cardx-caption') || modal.querySelector('.cardx-cap');
      const caption = () => (cap ? cap.textContent : (modal.querySelector('[class*=cap]')?.textContent || ''));
      const ratioOf = () => {
        const st = host.shadowRoot.querySelector('.cardx-stage');
        if (!st) return null;
        const r = st.getBoundingClientRect();
        const zf = getComputedStyle(host.shadowRoot.querySelector('.cardx-scale') || st).zoom || 1;
        return { w: Math.round(r.width / zf), h: Math.round(r.height / zf), inline: (st.getAttribute('style') || '').slice(0, 90) };
      };
      const stageW = () => { const m = (host.shadowRoot.querySelector('.cardx-stage')?.getAttribute('style') || '').match(/width:\s*(\d+)px/); return m ? Number(m[1]) : 0; };
      // 等待渲染真正落定：stage 内联宽度到达目标值（ladder 多轮测量可超 1s；且换挡会取消上一次渲染）
      const pick = async (label, wantW) => {
        const b = [...modal.querySelectorAll('.cardx-ratio button')].find(x => x.textContent.trim() === label);
        if (!b) return { clicked: false };
        b.click();
        const t0 = Date.now();
        while (Date.now() - t0 < 12000) {
          await new Promise(r => setTimeout(r, 150));
          if (stageW() === wantW) { await new Promise(r => setTimeout(r, 300)); break; }
        }
        return { clicked: true, active: b.classList.contains('active'), st: ratioOf(), cap: caption().slice(0, 60), gotW: stageW() };
      };
      const out = {};
      out.r43 = await pick('4:3', 1000);    // 产品定义：4:3 = 横版宽高比（宽:高），1000×750
      out.r169 = await pick('16:9', 1333);
      out.r916 = await pick('9:16', 750);   // 9:16 = 竖版手机全屏，750×1333
      out.r11 = await pick('1:1', 750);
      modal.querySelector('.cardx-close')?.click();
      return out;
    })()`);
    if (a.__err) throw new Error('ratiohard: ' + a.__err);
    const near = (st, w, h) => st && Math.abs(st.w - w) <= 2 && Math.abs(st.h - h) <= 2;
    ok(a.r43.clicked && near(a.r43.st, 1000, 750), `4:3 → 预览 stage 精确 1000×750（${a.r43.st ? a.r43.st.w + '×' + a.r43.st.h : 'no stage'}）`);
    ok(a.r169.clicked && near(a.r169.st, 1333, 750), `16:9 → 预览 stage 精确 1333×750（${a.r169.st ? a.r169.st.w + '×' + a.r169.st.h : 'no stage'}）`);
    ok(a.r916.clicked && near(a.r916.st, 750, 1333), `9:16 → 预览 stage 精确 750×1333（${a.r916.st ? a.r916.st.w + '×' + a.r916.st.h : 'no stage'}）`);
    ok(a.r11.clicked && near(a.r11.st, 750, 750), `1:1 → 预览 stage 精确 750×750（${a.r11.st ? a.r11.st.w + '×' + a.r11.st.h : 'no stage'}）`);
    const caps = [a.r43.cap, a.r169.cap, a.r916.cap, a.r11.cap].join('|');
    ok(!caps.includes('回落'), '标注不再出现「回落长图」');
    ok(caps.includes('场景版式') || caps.includes('缩放进画幅') || caps.includes('铺满'), `超长文走场景版式/contain/铺满（${caps.slice(0, 80)}）`);
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
