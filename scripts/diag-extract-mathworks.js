'use strict';
/** E2E：真实用户数据副本上，验证「网页直订」文章的全文提取补全（needsExtraction → extractArticle）。 */
const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

const PROD = path.join(process.env.APPDATA, 'RobinRead');
const userData = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'robinread-extract-'));
fs.mkdirSync(path.join(userData, 'credentials'), { recursive: true });
for (const f of ['library.db', 'preferences.json', 'Local State']) {
  try { fs.copyFileSync(path.join(PROD, f), path.join(userData, f)); } catch (_) {}
}
try { fs.copyFileSync(path.join(PROD, 'credentials', 'ai-api-key.bin'), path.join(userData, 'credentials', 'ai-api-key.bin')); } catch (_) {}

// AppStore 打开前：从副本里捞出 mathworks 板块的一篇文章 id
const { DatabaseSync } = require('node:sqlite');
const dbRO = new DatabaseSync(path.join(userData, 'library.db'), { readOnly: true });
const feedRow = dbRO.prepare("SELECT id FROM feeds WHERE feed_url LIKE '%mathworks%' AND is_deleted = 0 LIMIT 1").get();
const items = feedRow
  ? dbRO.prepare('SELECT i.id AS id, a.title AS title FROM items i JOIN articles a ON a.item_id = i.id WHERE i.feed_id = ? ORDER BY i.rowid DESC LIMIT 3').all(feedRow.id)
  : [];
dbRO.close();

const T0 = Date.now();
const log = (m) => console.log('[' + Math.round((Date.now() - T0) / 1000) + 's] ' + m);
setTimeout(() => { log('WATCHDOG 退出'); app.exit(3); }, 4 * 60 * 1000).unref();

app.setPath('userData', userData);
app.whenReady().then(async () => {
  if (!items.length) { log('未找到 mathworks 订阅/文章'); app.exit(2); return; }
  const { AppStore } = require('../src/main/AppStore');
  const { net } = require('electron');
  require('../src/main/ArticleExtractor').setNetFetch((url, options) => net.fetch(url, options));
  const Core = require('../src/main/ArticleExtractCore');
  const store = new AppStore(userData);

  for (const it of items) {
    const entry = store.articlesRepo.entry(it.id);
    if (!entry) { log('entry 缺失: ' + it.id); continue; }
    const beforeLen = entry.contentHTML ? entry.contentHTML.length : 0;
    const beforeRich = /<(img|pre|table|h[2-6])[\s>]/i.test(entry.contentHTML || '');
    log('「' + (it.title || '').slice(0, 40) + '」 before: htmlLen=' + beforeLen + ' 富结构=' + beforeRich + ' needsExtraction=' + Core.needsExtraction(entry));
    try {
      const cache = await store.extractArticle(it.id);
      const html = (cache && cache.html) || '';
      const imgs = (html.match(/<img[\s>]/gi) || []).length;
      const rich = /<(img|pre|table|h[2-6]|ul|ol|figure)[\s>]/i.test(html);
      log('  after extract: htmlLen=' + html.length + ' <img>=' + imgs + ' 富结构=' + rich + ' textLen=' + ((cache && cache.text) || '').length);
    } catch (e) {
      log('  extract ERR: ' + String((e && e.message) || e).slice(0, 100));
    }
  }
  app.exit(0);
});
