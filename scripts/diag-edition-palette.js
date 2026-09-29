'use strict';
/**
 * diag-edition-palette.js — R20 命令面板接入探针（run-all OFFLINE 集）
 * 验证：paletteCommands() 期刊开时返回 9 条 / 关时 0 条 / 「下一页」action 真实翻页 /
 *       面板 overlay z-index 920（高于期刊 900）
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-edition-pal-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 120 * 1000).unref();
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
    const a = await run('palette', `
      const mod = await import('./views/edition-reader.js');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要 ' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 40 }, (_, i) => mk(i)), fetchArticle: async () => '' });
      window.__er = er;
      er.present(); clearTimeout(er._autoTimer); er._doOpen();
      await new Promise(r => setTimeout(r, 1100));
      const cmds = er.paletteCommands();
      const labels = cmds.map((c) => c.label);
      // 「下一页」命令执行
      const idx0 = er.index;
      cmds.find((c) => c.label.includes('下一页')).action();
      for (let i = 0; i < 25; i++) { await new Promise(r => setTimeout(r, 150)); if (er.index === idx0 + 1) break; }
      const pageTurned = er.index === idx0 + 1;
      // 关闭后命令清空
      er.dismiss();
      const cmdsAfter = er.paletteCommands().length;
      // z-index 断言（样式表扫描：同名规则多条，取带 z-index 的那条）
      let z = null;
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch { continue; }
        for (const r of rules) {
          const t = r.cssText || '';
          if (t.startsWith('.cmd-palette-overlay') && r.style && r.style.zIndex) {
            z = Number(r.style.zIndex);
          }
        }
      }
      return { count: cmds.length, labels: labels.join('|'), pageTurned, cmdsAfter, z };
    `);
    if (a.__err) throw new Error('palette: ' + a.__err);
    ok(a.count === 9, '期刊命令 9 条（' + a.count + '）');
    ok(a.labels.includes('下一页') && a.labels.includes('导出当前页图片'), '含翻页/导出命令（R21 起去「期刊：」前缀）');
    ok(a.pageTurned, '「下一页」命令真实翻页（' + a.pageTurned + '）');
    ok(a.cmdsAfter === 0, '期刊关闭后命令清空');
    ok(a.z === 920, '命令面板 z-index 920 高于期刊（' + a.z + '）');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.message || e).slice(0, 400));
    app.exit(1);
  }
});
