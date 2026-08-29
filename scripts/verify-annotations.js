'use strict';
/**
 * 批注系统真机验证：生产数据副本 + 可见窗口，真人式操作 + 截屏取证。
 * 覆盖：划词高亮（五色）→ 正文渲染 → 高亮菜单换色/删除 → 划词笔记（段落便签）→
 *       重开文章重锚定恢复 → 批注面板 → 收藏 toast 直达 → H 快捷键。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const PROD = ['RobinRead', 'NanJuPaper', 'PaperRss'].map((n) => 'C:/Users/Lenovo/AppData/Roaming/' + n).find((p) => fs.existsSync(p));
const SHOTS = path.join(__dirname, '..', 'shots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

const TEMP = path.join(os.tmpdir(), `robinread-annot-${Date.now()}`);
fs.mkdirSync(TEMP, { recursive: true });
fs.mkdirSync(path.join(TEMP, 'credentials'), { recursive: true });
for (const f of ['library.db', 'library.db-shm', 'library.db-wal', 'preferences.json', 'Local State']) {
  const src = path.join(PROD, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(TEMP, f));
}
fs.copyFileSync(path.join(PROD, 'credentials', 'ai-api-key.bin'), path.join(TEMP, 'credentials', 'ai-api-key.bin'));
app.setPath('userData', TEMP);

app.whenReady().then(async () => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };
  let code = 0;
  try {
    const { AppStore } = require('../src/main/AppStore');
    const store = new AppStore(TEMP);
    const { registerIPCHandlers } = require('../src/main/ipc');
    const win = new BrowserWindow({
      show: true, width: 1500, height: 940,
      webPreferences: { preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'), contextIsolation: true },
    });
    registerIPCHandlers(store, win);
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    const run = (js) => win.webContents.executeJavaScript(js);
    const shot = async (name) => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(SHOTS, `${name}.png`), img.toPNG());
      console.log(`  [截图] shots/${name}.png`);
    };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await sleep(3500);

    // ── 0. 打开一篇段落较多的文章（今天列表前 5 篇里挑） ──
    const opened = await run(`(async () => {
      const rows = [...document.querySelectorAll('.entry-row')];
      for (let i = 0; i < Math.min(6, rows.length); i++) {
        rows[i].click();
        await new Promise((r) => setTimeout(r, 2600));
        const blocks = document.querySelectorAll('#reader-scroll [data-nj-id]');
        const marks = document.querySelectorAll('mark.nj-hl');
        if (blocks.length >= 3 || marks.length > 0) {
          return { title: (window.__robinReader?.entry?.title || '').slice(0, 40), blocks: blocks.length, existingHl: marks.length };
        }
      }
      return { title: '', blocks: 0, existingHl: 0 };
    })()`);
    check('打开文章且正文段落就绪', opened.blocks >= 3, JSON.stringify(opened));

    // 先清掉该篇旧批注（重跑脚本幂等）：通过面板/UI 删除太绕，直接 DB 清 + 前端刷新
    console.log('  [step] 获取 entryID…');
    const entryID = await run(`window.__robinReader?.entryID || ''`);
    console.log(`  [step] entryID=${JSON.stringify(entryID)}`);
    if (entryID) {
      store.database.prepare('DELETE FROM highlights WHERE item_id = ?').run(entryID);
      store.database.prepare('DELETE FROM notes WHERE item_id = ?').run(entryID);
      console.log('  [step] 旧批注已清，重开文章…');
      await run(`(async () => { await window.__robinReader.open(window.__robinReader.entryID); await new Promise((r) => setTimeout(r, 2500)); })()`);
      console.log('  [step] 重开完成');
    }

    // ── 1. 划词高亮（绿色）：模拟选区 → _doHighlight ──
    const hl1 = await run(`(async () => {
      try {
      const reader = window.__robinReader;
      const block = [...document.querySelectorAll('#reader-scroll [data-nj-id]')].find((b) => (b.textContent || '').trim().length > 120);
      if (!block) return { ok: false, why: 'no-block' };
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      const texts = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n);
      const t = texts.reduce((a, b) => ((b.textContent || '').length > (a?.textContent || '').length ? b : a), null);
      if (!t || (t.textContent || '').length < 20) return { ok: false, why: 'no-text' };
      const sel = window.getSelection();
      const range = document.createRange();
      range.setStart(t, 5);
      range.setEnd(t, Math.min(5 + 40, t.textContent.length));
      sel.removeAllRanges();
      sel.addRange(range);
      const payload = reader._selectionPayloadFor(String(sel));
      if (!payload) return { ok: false, why: 'no-payload' };
      await reader._doHighlight(payload, 'green');
      await new Promise((r) => setTimeout(r, 500));
      const marks = [...document.querySelectorAll('mark.nj-hl')];
      return { ok: marks.length > 0, count: marks.length, color: marks[0]?.dataset.color || '', text: marks[0]?.textContent?.slice(0, 30) || '' };
      } catch (e) { return { ok: false, why: 'js-error', error: String(e && e.message || e), stack: String(e && e.stack || '').slice(0, 300) }; }
    })()`);
    await shot('10-高亮-绿色');
    check('划词高亮：正文出现绿色荧光 mark', hl1.ok && hl1.color === 'green', JSON.stringify(hl1));

    // DB 侧：anchor 已落库
    const hlRows = entryID ? store.database.prepare('SELECT id, text, color, anchor FROM highlights WHERE item_id = ?').all(entryID) : [];
    check('高亮落库且带 anchor 上下文', hlRows.length === 1 && !!hlRows[0].anchor && hlRows[0].color === 'green', hlRows.length ? `anchor=${(hlRows[0].anchor || '').slice(0, 60)}` : 'no-row');

    // ── 2. 高亮点击菜单：换色（绿 → 胭脂） ──
    const recolor = await run(`(async () => {
      const reader = window.__robinReader;
      const mark = document.querySelector('mark.nj-hl');
      if (!mark) return { ok: false, why: 'no-mark' };
      mark.click();
      await new Promise((r) => setTimeout(r, 350));
      const menu = document.querySelector('.nj-hl-menu');
      const menuOk = !!menu;
      if (menuOk) {
        const dots = [...menu.querySelectorAll('.nj-hl-dot')];
        const pink = dots[3]; // yellow green blue pink purple
        pink?.click();
        await new Promise((r) => setTimeout(r, 500));
      }
      const after = document.querySelector('mark.nj-hl');
      return { ok: menuOk && after?.dataset.color === 'pink', menu: menuOk, color: after?.dataset.color || '' };
    })()`);
    await shot('11-高亮菜单-换色');
    check('高亮菜单：点击弹出 + 换色生效', recolor.ok, JSON.stringify(recolor));

    // ── 3. 划词笔记：选区 → 笔记编辑器 → 保存 → 段落便签 marker ──
    const note1 = await run(`(async () => {
      const reader = window.__robinReader;
      const block = [...document.querySelectorAll('#reader-scroll [data-nj-id]')].filter((b) => (b.textContent || '').trim().length > 120).pop();
      if (!block) return { ok: false, why: 'no-block' };
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      const texts = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n);
      const t = texts.reduce((a, b) => ((b.textContent || '').length > (a?.textContent || '').length ? b : a), null);
      if (!t || (t.textContent || '').length < 20) return { ok: false, why: 'no-text' };
      const sel = window.getSelection();
      const range = document.createRange();
      range.setStart(t, 2);
      range.setEnd(t, Math.min(2 + 30, t.textContent.length));
      sel.removeAllRanges();
      sel.addRange(range);
      const payload = reader._selectionPayloadFor(String(sel));
      if (!payload) return { ok: false, why: 'no-payload' };
      reader._showSelectionNoteEditor(payload);
      await new Promise((r) => setTimeout(r, 350));
      const editor = document.querySelector('.nj-note-editor');
      if (!editor) return { ok: false, why: 'no-editor' };
      editor.querySelector('.nj-note-editor-input').value = '这里是核心理念：必须先建立上下文再谈细节。';
      editor.querySelector('.nj-note-editor-save').click();
      await new Promise((r) => setTimeout(r, 700));
      const markers = [...document.querySelectorAll('.nj-note-marker')];
      return { ok: markers.length > 0, markers: markers.length };
    })()`);
    check('划词笔记：保存后段落出现便签 marker', note1.ok, JSON.stringify(note1));

    // marker 点击展开便签卡
    const card = await run(`(async () => {
      const marker = document.querySelector('.nj-note-marker');
      if (!marker) return { ok: false, why: 'no-marker' };
      marker.click();
      await new Promise((r) => setTimeout(r, 350));
      const c = document.querySelector('.nj-note-card');
      return { ok: !!c, content: (c?.querySelector('.nj-note-card-content')?.textContent || '').slice(0, 24) };
    })()`);
    await shot('12-便签卡');
    check('便签 marker 点击展开内容卡', card.ok, JSON.stringify(card));
    await run(`(async () => { document.querySelector('.nj-note-card-close')?.click(); await new Promise((r) => setTimeout(r, 200)); return 1; })()`);

    const noteRows = entryID ? store.database.prepare('SELECT id, content, anchor FROM notes WHERE item_id = ?').all(entryID) : [];
    check('笔记落库且带段落锚点', noteRows.length === 1 && !!noteRows[0].anchor, noteRows.length ? `anchor=${(noteRows[0].anchor || '').slice(0, 60)}` : 'no-row');

    // ── 4. H 快捷键：新选区 + KeyH → 第二条黄色高亮 ──
    const hkey = await run(`(async () => {
      const blocks = [...document.querySelectorAll('#reader-scroll [data-nj-id]')].filter((b) => (b.textContent || '').trim().length > 120);
      const block = blocks[1] || blocks[0];
      if (!block) return { ok: false, why: 'no-block' };
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      const texts = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n);
      const t = texts.reduce((a, b) => ((b.textContent || '').length > (a?.textContent || '').length ? b : a), null);
      if (!t || (t.textContent || '').length < 50) return { ok: false, why: 'no-text' };
      const sel = window.getSelection();
      const range = document.createRange();
      const start = Math.max(0, t.textContent.length - 45);
      range.setStart(t, start);
      range.setEnd(t, t.textContent.length);
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH', key: 'h', bubbles: true }));
      await new Promise((r) => setTimeout(r, 800));
      const marks = [...document.querySelectorAll('mark.nj-hl')];
      const colors = marks.map((m) => m.dataset.color);
      return { ok: marks.length >= 2 && colors.includes('yellow'), count: marks.length, colors };
    })()`);
    check('H 快捷键：选区快速黄色高亮', hkey.ok, JSON.stringify(hkey));

    // ── 5. 批注面板 ──
    const panel = await run(`(async () => {
      window.__robinReader.toggleAnnotationsPanel();
      await new Promise((r) => setTimeout(r, 400));
      const p = document.getElementById('nj-annot-panel');
      const rows = p ? p.querySelectorAll('.annot-row').length : 0;
      const count = p?.querySelector('.annot-panel-count')?.textContent || '';
      const sections = p ? [...p.querySelectorAll('.annot-section-title')].map((s) => s.textContent) : [];
      return { ok: !!p && rows >= 2, rows, count, sections };
    })()`);
    await shot('13-批注面板');
    check('批注面板：列出全部高亮与笔记', panel.ok, JSON.stringify(panel));

    // ── 6. 重开文章：高亮/便签重锚定恢复 ──
    const restore = await run(`(async () => {
      const id = window.__robinReader.entryID;
      await window.__robinReader.open(id);
      await new Promise((r) => setTimeout(r, 2800));
      const marks = document.querySelectorAll('mark.nj-hl').length;
      const markers = document.querySelectorAll('.nj-note-marker').length;
      return { ok: marks >= 2 && markers >= 1, marks, markers };
    })()`);
    await shot('14-重开恢复');
    check('重开文章：高亮 + 便签按锚点恢复', restore.ok, JSON.stringify(restore));

    // ── 7. 收藏：toast 带「查看收藏」直达 ──
    const star = await run(`(async () => {
      document.getElementById('cap-star')?.click();
      await new Promise((r) => setTimeout(r, 500));
      const toast = document.getElementById('toast-capsule');
      const action = toast?.querySelector('.toast-action');
      const label = action?.textContent || '';
      if (action) action.click();
      await new Promise((r) => setTimeout(r, 1400));
      const title = document.querySelector('.list-top-title')?.textContent || '';
      const rows = document.querySelectorAll('.entry-row').length;
      return { ok: !!action && title === '收藏' && rows > 0, label, title, rows };
    })()`);
    await shot('15-收藏直达');
    check('收藏 toast「查看收藏」直达收藏列表', star.ok, JSON.stringify(star));
    // 复原：取消收藏，避免污染用户生产习惯（副本库，但保持干净）
    await run(`(async () => { document.getElementById('cap-star')?.click(); await new Promise((r) => setTimeout(r, 400)); })()`);

    // ── 汇总 ──
    code = results.every((r) => r.ok) ? 0 : 1;
  } catch (err) {
    console.error('HARNESS ERROR:', err, err?.stack || '', JSON.stringify(err?.message ? { msg: err.message, code: err.code } : null));
    code = 1;
  }
  app.exit(code);
}).catch((err) => { console.error(err); app.exit(1); });
