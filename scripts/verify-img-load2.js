'use strict';
/** 可靠的图片加载验证：绕过 img-proxy 后，微信文章图片实际加载速度。 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
const PROD = ['RobinRead', 'NanJuPaper', 'PaperRss'].map((n) => 'C:/Users/Lenovo/AppData/Roaming/' + n).find((p) => fs.existsSync(p));
const TEMP = path.join(os.tmpdir(), `robinread-imgl-${Date.now()}`);
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

    const row = store.database.prepare(
      "SELECT i.id, a.title FROM items i INNER JOIN articles a ON a.item_id=i.id INNER JOIN feeds f ON f.id=i.feed_id WHERE f.title='腾讯技术工程' AND a.content_html LIKE '%img-proxy%' ORDER BY a.published_at DESC LIMIT 1"
    ).get();
    if (!row) { console.log('no sample'); app.exit(0); return; }

    const r = await run(`(async () => {
      try {
        const t0 = Date.now();
        await window.__robinReader.open(${JSON.stringify(row.id)});
        await new Promise((r2) => setTimeout(r2, 2000));
        const imgs = [...document.querySelectorAll('#reader-scroll .reader-article img')];
        // 记录每张图从 open 到 loaded 的时间（近似）
        const ev = () => ({
          loaded: imgs.filter((x) => x.complete && x.naturalWidth > 0).length,
          broken: imgs.filter((x) => x.complete && x.naturalWidth === 0).length,
          pending: imgs.filter((x) => !x.complete).length,
        });
        let st = ev();
        let elapsed = 0;
        for (let k = 0; k < 20 && st.pending > 0; k++) {
          await new Promise((r2) => setTimeout(r2, 1000));
          elapsed += 1;
          st = ev();
        }
        const qpic = imgs.filter((i) => /mmbiz\.qpic\.cn/.test(i.src)).length;
        return {
          title: (window.__robinReader.entry?.title || '').slice(0, 24),
          total: imgs.length, qpic, ...st,
          secondsToSettle: elapsed,
        };
      } catch (e) { return { error: String(e && e.message || e).slice(0, 80) }; }
    })()`);
    console.log(JSON.stringify(r, null, 1));
    app.exit(0);
  } catch (e) { console.error('ERR', e, e?.stack || ''); app.exit(1); }
});
