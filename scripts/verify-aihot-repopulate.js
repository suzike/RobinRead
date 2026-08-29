'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app } = require('electron');
const PROD = ['RobinRead', 'NanJuPaper', 'PaperRss'].map((n) => 'C:/Users/Lenovo/AppData/Roaming/' + n).find((p) => fs.existsSync(p));
const TEMP = path.join(os.tmpdir(), `robinread-repop-${Date.now()}`);
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
    const feeds = store.database.prepare("SELECT id,title FROM feeds WHERE feed_url LIKE '%aihot%'").all();
    const count = (id) => store.database.prepare('SELECT COUNT(*) AS n FROM items WHERE feed_id=?').get(id).n;
    // 手动逐个 refreshFeed 并捕获结果
    for (const f of feeds) {
      try {
        const r = await store.refreshFeed(f.id);
        console.log(`[${f.title}] refreshFeed → ${JSON.stringify(r)}`);
      } catch (e) {
        console.log(`[${f.title}] refreshFeed 抛错: ${String(e && e.message || e).slice(0, 80)}`);
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
    for (const f of feeds) {
      console.log(`[${f.title}] 文章数=${count(f.id)}`);
    }
    app.exit(0);
  } catch (e) { console.error('ERR', e, e?.stack || ''); app.exit(1); }
});
