'use strict';
/** 验证 AIHOT 预抓：刷新 feed → 预抓 item 页 → 打开时缓存命中秒开。 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
const PROD = ['RobinRead', 'NanJuPaper', 'PaperRss'].map((n) => 'C:/Users/Lenovo/AppData/Roaming/' + n).find((p) => fs.existsSync(p));
const TEMP = path.join(os.tmpdir(), `robinread-prefetch-${Date.now()}`);
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

    // 刷新 AIHOT feed，触发预抓
    const feeds = store.database.prepare("SELECT id, title FROM feeds WHERE feed_url LIKE '%aihot%'").all();
    console.log('刷新 AIHOT feeds，触发预抓...');
    for (const f of feeds) {
      await store.refreshFeed(f.id).catch(() => {});
    }
    // 等预抓完成（并发 3，约 15-20 秒）
    const cachedCount = () => store.database.prepare(
      "SELECT COUNT(*) AS n FROM article_caches WHERE item_id IN (SELECT id FROM items WHERE feed_id IN (SELECT id FROM feeds WHERE feed_url LIKE '%aihot%'))"
    ).get().n;
    for (let k = 0; k < 15; k++) {
      await new Promise((r) => setTimeout(r, 2000));
      const n = cachedCount();
      console.log(`  ${(k + 1) * 2}s 已预抓缓存=${n}`);
      if (n >= 10) break;
    }
    const totalCount = store.database.prepare(
      "SELECT COUNT(*) AS n FROM items WHERE feed_id IN (SELECT id FROM feeds WHERE feed_url LIKE '%aihot%')"
    ).get().n;
    console.log(`AIHOT 文章总数=${totalCount}，已预抓缓存=${cachedCount()}`);

    // 打开一篇已缓存的 AIHOT 文章，测打开延迟
    const sample = store.database.prepare(
      "SELECT i.id FROM items i INNER JOIN article_caches c ON c.item_id=i.id WHERE i.feed_id IN (SELECT id FROM feeds WHERE feed_url LIKE '%aihot%') LIMIT 1"
    ).get();
    if (sample) {
      const r = await run(`(async () => {
        const t0 = Date.now();
        await window.__robinReader.open(${JSON.stringify(sample.id)});
        const openMs = Date.now() - t0;
        await new Promise((r2) => setTimeout(r2, 1000));
        const len = (window.__robinReader.body?.textContent || '').length;
        return { openMs, len };
      })()`);
      console.log(`打开已缓存 AIHOT 文章: ${r.openMs}ms | ${r.len}字`);
    }
    app.exit(0);
  } catch (e) { console.error('ERR', e, e?.stack || ''); app.exit(1); }
});
