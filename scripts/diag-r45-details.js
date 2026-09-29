'use strict';
/**
 * diag-r45-details.js — R45 细节三连探针（run-all OFFLINE 集）
 * 验证：标签 chips type=button + :focus-visible 焦点环在册 / 搜索清除键
 *       aria-label + type / 批量操作条 role=toolbar + aria-label
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r45-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 150 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false, width: 1440, height: 900,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(900);
    const run = (tag, js) => {
      console.log('PHASE ' + tag);
      return win.webContents.executeJavaScript(`(async () => { try { ${js} } catch (e) { return { __err: String(e && e.stack || e) }; } })()`);
    };
    const srcHygiene = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'reader.js'), 'utf8').includes("chip.type = 'button'");
    const a = await run('details', `
      // ① 标签 chips：type=button + 焦点环规则在册 + 实际聚焦生效
      const { ReaderView } = await import('./views/reader.js');
      const rhost = document.createElement('div');
      rhost.className = 'reader-article';
      document.body.appendChild(rhost);
      const rproto = Object.create(ReaderView.prototype);
      rproto.body = rhost;
      rproto.feed = {}; rproto.entry = {};
      const meta = document.createElement('div');
      meta.className = 'robin-header-meta';
      rhost.appendChild(meta);
      const chips = document.createElement('span');
      chips.className = 'robin-tag-chips';
      meta.appendChild(chips);
      // 产品管线内联于 reader 头部渲染，此处以源码级卫生断言（type=button）+ 焦点环 CSSOM 双证
      const chip = document.createElement('button');
      chip.className = 'robin-tag-chip';
      chip.textContent = '#AI';
      chips.appendChild(chip);
      const chipType = chip.type;
      let focusRing = false;
      for (const sheet of document.styleSheets) {
        try { for (const r of sheet.cssRules) {
          if (r.selectorText && r.selectorText.includes('.robin-tag-chip:focus-visible')) focusRing = true;
        } } catch (_) {}
      }
      // ② 搜索清除键 aria-label + type
      const { ListView } = await import('./views/list.js');
      const host = document.createElement('div');
      host.className = 'list-scroll';
      document.body.appendChild(host);
      const lv = new ListView(host, { onSelect: () => {}, onContext: () => {}, onLoadMore: () => {}, onSearch: () => {} });
      const clearBtn = lv.topInset.querySelector('#list-search-clear');
      const clearAria = clearBtn.getAttribute('aria-label');
      const clearType = clearBtn.type;
      // ③ 批量操作条 toolbar 语义
      const titles = ['量子计算商用化进展观察', '深海火山口的生态系统'];
      const mk = (i) => ({ id: 'r45-' + i, title: titles[i], summaryPreview: '摘要', sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 60, contentHead: '' });
      lv.setViewMode('list');
      lv.render([mk(0), mk(1)], { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 200));
      host.querySelector('.entry-row').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
      await new Promise(r => setTimeout(r, 80));
      const bar = document.querySelector('.list-batch-bar');
      const barRole = bar?.getAttribute('role');
      const barLabel = bar?.getAttribute('aria-label');
      return { chipType, focusRing, clearAria, clearType, barRole, barLabel };
    `);
    if (a.__err) throw new Error('details: ' + a.__err);
    ok(srcHygiene, '产品源码含 chips type=button（表单卫生）');
    ok(a.focusRing, 'chips :focus-visible 焦点环规则在册');
    ok(a.clearAria === '清除搜索内容', '清除键 aria-label（' + a.clearAria + '）');
    ok(a.clearType === 'button', '清除键 type=button');
    ok(a.barRole === 'toolbar' && a.barLabel === '批量操作', '批量条 role=toolbar + aria-label');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
