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
      const stageBox = () => {
        const st = host.shadowRoot.querySelector('.cardx-stage');
        if (!st) return null;
        const m = (st.getAttribute('style') || '').match(/width:\\s*(\\d+)px;\\s*height:\\s*(\\d+)px/);
        return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
      };
      // 等待渲染真正落定：stage 比例到达目标（v2 比例合同：长文画布会放大，宽度不固定）
      const pick = async (label, rw, rh) => {
        const b = [...modal.querySelectorAll('.cardx-ratio button')].find(x => x.textContent.trim() === label);
        if (!b) return { clicked: false };
        b.click();
        const t0 = Date.now();
        let box = null;
        while (Date.now() - t0 < 15000) {
          await new Promise(r => setTimeout(r, 180));
          box = stageBox();
          if (box && Math.abs(box.w / box.h - rw / rh) < 0.02 && box.w > 400) { await new Promise(r => setTimeout(r, 350)); break; }
        }
        return { clicked: true, active: b.classList.contains('active'), st: box || { w: 0, h: 0 }, dbg: (host.shadowRoot.querySelector('.cardx-stage')?.getAttribute('style') || '(no-stage)'), cap: caption().slice(0, 60) };
      };
      const out = {};
      out.r43 = await pick('4:3', 4, 3);    // 比例合同：长文画布放大，比例恒定
      out.r169 = await pick('16:9', 16, 9);
      out.r916 = await pick('9:16', 9, 16);
      out.r11 = await pick('1:1', 1, 1);
      modal.querySelector('.cardx-close')?.click();
      return out;
    })()`);
    if (a.__err) throw new Error('ratiohard: ' + a.__err);
    const nearRatio = (st, wr, hr) => st && Math.abs(st.w / st.h - wr / hr) < 0.02 && Math.min(st.w, st.h) >= 712;
    ok(a.r43.clicked && nearRatio(a.r43.st, 4, 3), `4:3 → 比例恒定（${a.r43.st ? a.r43.st.w + '×' + a.r43.st.h : 'no stage'}，长文画布放大）[dbg: ${a.r43.dbg}]`);
    ok(a.r169.clicked && nearRatio(a.r169.st, 16, 9), `16:9 → 比例恒定（${a.r169.st ? a.r169.st.w + '×' + a.r169.st.h : 'no stage'}）`);
    ok(a.r916.clicked && nearRatio(a.r916.st, 9, 16), `9:16 → 比例恒定（${a.r916.st ? a.r916.st.w + '×' + a.r916.st.h : 'no stage'}）`);
    ok(a.r11.clicked && nearRatio(a.r11.st, 1, 1), `1:1 → 比例恒定（${a.r11.st ? a.r11.st.w + '×' + a.r11.st.h : 'no stage'}）`);
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
