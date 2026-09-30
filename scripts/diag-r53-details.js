'use strict';
/**
 * diag-r53-details.js — R53 收官细节三连探针（命令面板，run-all OFFLINE 集）
 * ① 空态「清空搜索」出路按钮（输入无匹配时出现，点击回全量）
 * ② 最近使用命令「最近」徽标
 * ③ 面板列表滚动条 5px 悬停主题化
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r53-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 120 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };
const ROOT = path.join(__dirname, '..');

app.whenReady().then(async () => {
  try {
    const cssSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'styles', 'robin.css'), 'utf8');
    ok(cssSrc.includes('.cmd-empty-reset') && /:hover\s*\{\s*border-color:\s*var\(--accent\)/.test(cssSrc.slice(cssSrc.indexOf('.cmd-empty-reset'), cssSrc.indexOf('.cmd-empty-reset') + 700)), 'CSS：空态出路按钮在册');
    ok(cssSrc.includes('.cmd-recent-tag'), 'CSS：「最近」徽标在册');
    ok(/\.cmd-palette-list::-webkit-scrollbar\s*\{\s*width:\s*5px;/.test(cssSrc), 'CSS：面板列表 5px 滚动条在册');

    const win = new BrowserWindow({
      show: false, width: 1280, height: 860,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(ROOT, 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
    await sleep(900);
    const a = await win.webContents.executeJavaScript(`(async () => {
      const mod = await import('./views/command-palette.js');
      const CP = mod.CommandPalette || mod.default;
      const cp = new CP();
      try { localStorage.setItem('robinread.palette.recent', JSON.stringify(['测试命令乙'])); } catch (_) {}
      cp.present([
        { label: '测试命令甲', action: () => {}, group: 'G' },
        { label: '测试命令乙', action: () => {}, group: 'G' },
      ]);
      cp._filter(''); // 空查询 → 最近置顶 + 徽标
      await new Promise(r => setTimeout(r, 100));
      const recentTag0 = document.querySelectorAll('.cmd-recent-tag').length;
      cp._filter('zzz不存在');
      await new Promise(r => setTimeout(r, 100));
      const emptyBtn = document.querySelector('.cmd-empty-reset');
      let restored = 0;
      if (emptyBtn) { emptyBtn.click(); await new Promise(r => setTimeout(r, 100)); restored = document.querySelectorAll('.cmd-item').length; }
      cp.dismiss();
      return { recentTag0, hasEmptyBtn: !!emptyBtn, restored };
    })()`);
    ok(a.recentTag0 >= 1, `最近使用命令带「最近」徽标（${a.recentTag0} 个）`);
    ok(a.hasEmptyBtn, '空态出现「清空搜索，显示全部命令」出路按钮');
    ok(a.restored >= 2, `点击出路按钮回到全量命令（${a.restored} 条）`);
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
