'use strict';
/** 综合诊断：打开延迟 + 正文残留，找出剩余可优化点。 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
const PROD = ['RobinRead', 'NanJuPaper', 'PaperRss'].map((n) => 'C:/Users/Lenovo/AppData/Roaming/' + n).find((p) => fs.existsSync(p));
const TEMP = path.join(os.tmpdir(), `robinread-opt-${Date.now()}`);
fs.mkdirSync(TEMP, { recursive: true });
fs.mkdirSync(path.join(TEMP, 'credentials'), { recursive: true });
for (const f of ['library.db', 'library.db-shm', 'library.db-wal', 'preferences.json', 'Local State']) {
  const src = path.join(PROD, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(TEMP, f));
}
fs.copyFileSync(path.join(PROD, 'credentials', 'ai-api-key.bin'), path.join(TEMP, 'credentials', 'ai-api-key.bin'));
app.setPath('userData', TEMP);

app.whenReady().then(async () => {
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
    await new Promise((r) => setTimeout(r, 3000));

    // 找几篇代表文章：微信（虎嗅）、AIHOT 摘要型
    const huxiu = store.database.prepare("SELECT i.id, a.title FROM items i INNER JOIN articles a ON a.item_id=i.id INNER JOIN feeds f ON f.id=i.feed_id WHERE f.title='虎嗅APP' ORDER BY a.published_at DESC LIMIT 1").get();
    const aihot = store.database.prepare("SELECT i.id, a.title FROM items i INNER JOIN articles a ON a.item_id=i.id INNER JOIN feeds f ON f.id=i.feed_id WHERE f.feed_url LIKE '%aihot%' AND a.content_html IS NOT NULL ORDER BY a.published_at DESC LIMIT 1").get();

    // 测打开延迟 + 残留
    const test = async (id, label) => {
      if (!id) return;
      const r = await run(`(async () => {
        const t0 = Date.now();
        await window.__robinReader.open(${JSON.stringify(id)});
        const openMs = Date.now() - t0;
        await new Promise((r2) => setTimeout(r2, 1500));
        const b = window.__robinReader.body;
        const text = (b?.textContent || '').replace(/\\s+/g, ' ').trim();
        return { openMs, len: text.length, head: text.slice(0, 70), tail: text.slice(-50) };
      })()`);
      console.log(`[${label}] 打开 ${r.openMs}ms | ${r.len}字`);
      console.log(`  开头: ${r.head}`);
      console.log(`  结尾: ${r.tail}`);
    };
    if (huxiu) await test(huxiu.id, '虎嗅(微信)');
    if (aihot) await test(aihot.id, 'AIHOT');

    app.exit(0);
  } catch (e) { console.error('ERR', e, e?.stack || ''); app.exit(1); }
});
