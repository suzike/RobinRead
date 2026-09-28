'use strict';
/**
 * diag-edition-quick.js — R12 快捷收藏/稍后读探针（run-all OFFLINE 集）
 * 验证：S/L 键对选中卡切换 isStarred/isLater + 回调携带状态 + notice 反馈 + 卡片星标重绘 /
 *       文章模式 S 作用于当前文章 / 再按取消 / 无选中时提示
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-edition-quick-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 150 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false, width: 1600, height: 1000,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(600);
    const run = (tag, js) => {
      console.log('PHASE ' + tag);
      return win.webContents.executeJavaScript(`(async () => { try { ${js} } catch (e) { return { __err: String(e && e.stack || e) }; } })()`);
    };
    const a = await run('quick', `
      const mod = await import('./views/edition-reader.js');
      const calls = [];
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要 ' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const er = new mod.EditionReader({
        items: Array.from({ length: 12 }, (_, i) => mk(i)),
        fetchArticle: async () => '',
        onToggleStar: (id, s) => { calls.push(['star', id, s]); return Promise.resolve(); },
        onToggleLater: (id, l) => { calls.push(['later', id, l]); return Promise.resolve(); },
      });
      window.__er = er;
      er.present(); clearTimeout(er._autoTimer); er._doOpen();
      await new Promise(r => setTimeout(r, 1000));
      // 选中一张卡（模拟遥控导航选中）
      er._select('fx-2');
      const press = (key) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      press('s');
      await new Promise(r => setTimeout(r, 300));
      const starOn = er.items.find((x) => x.id === 'fx-2').isStarred;
      const notice1 = document.querySelector('.er-notice').textContent;
      const starInDom = !!document.querySelector('.er-sheet[data-role="a"] .er-story[data-entry-id="fx-2"] .er-star');
      press('l');
      await new Promise(r => setTimeout(r, 300));
      const laterOn = er.items.find((x) => x.id === 'fx-2').isLater;
      const laterInDom = !!document.querySelector('.er-sheet[data-role="a"] .er-story[data-entry-id="fx-2"] .er-later');
      press('s');
      await new Promise(r => setTimeout(r, 200));
      const starOff = !er.items.find((x) => x.id === 'fx-2').isStarred;
      // 文章模式 S 作用于当前文章
      await er._openArticle(er.items.find((x) => x.id === 'fx-2'));
      await new Promise(r => setTimeout(r, 800));
      press('l');
      await new Promise(r => setTimeout(r, 200));
      const artLaterOff = !er.items.find((x) => x.id === 'fx-2').isLater;
      const noticeArt = document.querySelector('.er-notice').textContent;
      er._findClose?.(); er.dismiss();
      return { calls, starOn, notice1, starInDom, laterOn, laterInDom, starOff, artLaterOff, noticeArt };
    `);
    if (a.__err) throw new Error('quick: ' + a.__err);
    ok(a.starOn === true && a.calls.some((c) => c[0] === 'star' && c[1] === 'fx-2' && c[2] === true), 'S 收藏选中卡（回调 star/fx-2/true）');
    ok(a.notice1.includes('已收藏'), 'notice 反馈（' + a.notice1 + '）');
    ok(a.starInDom, '卡片星标重绘');
    ok(a.laterOn === true && a.laterInDom, 'L 稍后读 + 时钟标记渲染');
    ok(a.starOff, '再按 S 取消收藏');
    ok(a.artLaterOff === true && a.noticeArt.includes('移出稍后读'), '文章模式 L 作用于当前文章（' + a.noticeArt + '）');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.message || e).slice(0, 400));
    app.exit(1);
  }
});
