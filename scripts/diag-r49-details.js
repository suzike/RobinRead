'use strict';
/**
 * diag-r49-details.js — R49 细节三连探针（卡片导出弹窗周边，run-all OFFLINE 集）
 * ① cardx 侧栏/预览区细滚动条规则在册（对齐 modal-sidebar 模式）
 * ② 预设 chips/分段按钮 :focus-visible 焦点环在册 + chips title 悬停说明
 * ③ caption title 比例合同说明在册
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r49-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 150 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };
const ROOT = path.join(__dirname, '..');

const CARD_DATA = {
  kind: 'deepRead', title: 'R49 细节验收', feedTitle: '知更', date: '2026-09-30',
  lead: '细节三连：滚动条/焦点环/悬停说明。', meta: { words: 800, minutes: 2 },
};

app.whenReady().then(async () => {
  try {
    const cssSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'styles', 'robin.css'), 'utf8');
    ok(/\.cardx-side::-webkit-scrollbar\s*,\s*\.cardx-preview::-webkit-scrollbar\s*\{\s*width:\s*5px;/.test(cssSrc), 'CSS：cardx 侧栏/预览 5px 细滚动条在册');
    ok(/\.cardx-side:hover::-webkit-scrollbar-thumb/.test(cssSrc) && cssSrc.includes('.cardx-preview:hover::-webkit-scrollbar-thumb'), 'CSS：悬停显主题色 thumb 在册');
    ok(/\.cardx-preset-chip:focus-visible,\s*\.cardx-seg button:focus-visible,\s*\.cardx-tpl:focus-visible\s*\{/.test(cssSrc), 'CSS：chips/分段/模板焦点环在册');
    ok(cssSrc.includes('.cardx-preset-chip:active { transform: scale(0.96); }'), 'CSS：chips 按压回弹在册');
    const pvSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'card-export', 'preview.js'), 'utf8');
    ok(pvSrc.includes("b.title = t('一键套用该场景的画幅、版式与排版')"), 'JS：预设 chips 悬停说明在册');
    ok(pvSrc.includes('画幅为比例合同'), 'JS：caption 比例合同说明在册');

    const win = new BrowserWindow({
      show: false, width: 1280, height: 860,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(ROOT, 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
    await sleep(900);
    const a = await win.webContents.executeJavaScript(`(async () => {
      const data = ${JSON.stringify(CARD_DATA)};
      const { openCardExportModal } = await import('./card-export/preview.js');
      await openCardExportModal({ data, link: 'https://example.com/1' });
      const modal = document.querySelector('.modal-overlay .cardx-modal');
      if (!modal) return { __err: 'no modal' };
      const chip = modal.querySelector('.cardx-preset-chip');
      const side = modal.querySelector('.cardx-side');
      const out = {
        chipTitle: chip ? chip.title : '',
        chipCount: modal.querySelectorAll('.cardx-preset-chip').length,
        sideScrollbarWidth: side ? getComputedStyle(side).scrollbarWidth : '',
      };
      return out;
    })()`);
    if (a.__err) throw new Error('r49: ' + a.__err);
    // :focus-visible 只认键盘路径：页内先聚焦首个 chip，真实 Tab 移动焦点后读取下一个 chip 的焦点环
    await win.webContents.executeJavaScript(`(() => { document.querySelector('.modal-overlay .cardx-modal .cardx-preset-chip')?.focus(); return 1; })()`);
    win.webContents.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    await sleep(200);
    const b = await win.webContents.executeJavaScript(`(() => {
      const modal = document.querySelector('.modal-overlay .cardx-modal');
      if (!modal) return { __err: 'modal gone' };
      const el = document.activeElement;
      const s = getComputedStyle(el);
      return { cls: el.className || el.tagName, isChip: !!el.closest('.cardx-modal'), outline: s.outlineStyle, outlineW: s.outlineWidth, outlineC: s.outlineColor };
    })()`);
    if (b.__err) throw new Error('r49-focus: ' + b.__err);
    console.log("DBG", JSON.stringify(b));
    ok(b.isChip && String(b.cls).includes('cardx-preset-chip') && b.outline === 'solid' && parseFloat(b.outlineW) > 0, `Tab 移焦后 chip 出现焦点环（${String(b.cls).slice(0, 24)} → ${b.outline} ${b.outlineW}）`);
    await win.webContents.executeJavaScript(`(() => { document.querySelector('.modal-overlay .cardx-modal')?.querySelector('.cardx-close')?.click(); return 1; })()`);
    ok(a.chipCount === 6, `场景预设 6 chips（${a.chipCount}）`);
    ok(a.chipTitle.includes('一键套用'), `chips 悬停说明生效（${String(a.chipTitle).slice(0, 20)}）`);
    ok(a.sideScrollbarWidth === 'thin', `侧栏 scrollbar-width: thin（${a.sideScrollbarWidth}）`);
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
