'use strict';
/** R47 验收截图：微动效三连（mid 动画帧 + 落定帧）→ .tmp-shots/r47-1-mid.png / r47-2-settled.png */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r47-'));
app.setPath('userData', userData);
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 180 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const win = new BrowserWindow({
      show: true, width: 1360, height: 860,
      webPreferences: { contextIsolation: true, backgroundThrottling: false },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(900);
    // 真窗口真实类名触发动画：划词胶囊（左上定位）+ 批量条（底部）+ 历史下拉（右上）
    await win.webContents.executeJavaScript(`(() => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;background:var(--page-background,#faf8f2);';
      wrap.innerHTML = '<style>' +
        '.demo-selbar { position:absolute; left:60px; top:120px; display:flex; gap:2px; padding:4px; background:#f0ead9; border:1px solid #d8d2c2; border-radius:8px; font-family:sans-serif; font-size:12px; }' +
        '.demo-selbar button { border:none; background:transparent; padding:4px 10px; font-size:12px; }' +
        '.demo-batch { position:absolute; left:50%; bottom:40px; transform:translateX(-50%); display:flex; gap:8px; padding:8px 14px; background:#222; color:#eee; border-radius:10px; font-family:sans-serif; font-size:12px; }' +
        '.demo-history { position:absolute; right:60px; top:120px; width:220px; background:#fff; border:1px solid #ddd; border-radius:8px; padding:6px; font-family:sans-serif; font-size:12px; }' +
        '.demo-history div { padding:6px 8px; }' +
        '</style>';
      document.body.appendChild(wrap);
      const sel = document.createElement('div');
      sel.className = 'er-selbar demo-selbar';
      sel.innerHTML = '<button>复制</button><button>解释</button><button>翻译</button><button>提问</button>';
      wrap.appendChild(sel);
      const batch = document.createElement('div');
      batch.className = 'list-batch-bar demo-batch';
      batch.innerHTML = '<span>已选 2 篇</span><span>·</span><span>标为已读</span><span>收藏</span><span>稍后读</span><span>取消选择</span>';
      wrap.appendChild(batch);
      const hist = document.createElement('div');
      hist.className = 'search-history demo-history';
      hist.innerHTML = '<div>端侧大模型 功耗</div><div>车规芯片 选型</div><div>存储介质 原理</div>';
      wrap.appendChild(hist);
      return { mid: true };
    })()`);
    await sleep(45); // 动画中段（0.14-0.18s 动画的 ~1/3 处）
    await (async () => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(OUT, 'r47-1-mid.png'), img.toPNG());
      console.log('shot r47-1-mid.png');
    })();
    await sleep(600); // 落定
    await (async () => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(OUT, 'r47-2-settled.png'), img.toPNG());
      console.log('shot r47-2-settled.png');
    })();
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 700));
    app.exit(1);
  }
});
