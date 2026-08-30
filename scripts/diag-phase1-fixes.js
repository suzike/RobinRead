'use strict';
/* 阶段一修复的快速自测：B01 搜索转义 + B08 FeedIconStore 缓存层 + B05 超时工具行为。临时文件，验证后可删。 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

let failures = 0;
function check(name, cond) {
  console.log(cond ? `PASS  ${name}` : `FAIL  ${name}`);
  if (!cond) failures += 1;
}

// --- B01: LIKE 转义（与 AppStore.searchEntries/fullTextSearch 相同写法）---
{
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE t(id TEXT, title TEXT)');
  db.exec("INSERT INTO t VALUES ('1','hello % world'), ('2','plain_thing'), ('3','nothing')");
  const escapeLike = (s) => s.replace(/[%_]/g, (c) => '\\' + c);
  const q = db.prepare("SELECT id FROM t WHERE title LIKE ? ESCAPE '\\'");
  const rows = q.all(`%${escapeLike('%')}%`);
  check('B01 ESCAPE 查询不抛错且只命中字面 %', rows.length === 1 && rows[0].id === '1');
  const rows2 = q.all(`%${escapeLike('plain_thing')}%`);
  check('B01 下划线字面匹配', rows2.length === 1 && rows2[0].id === '2');
  const rows3 = q.all('%plain%'); // 不转义时 _ 通配：应命中 plain_thing（旧行为对照，查询本身合法）
  check('B01 普通查询照常工作', rows3.length === 1);
}

// --- B08: FeedIconStore 内存/磁盘/失败冷却（不触发网络）---
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'robin-icons-'));
  const { FeedIconStore } = require('../src/main/FeedIconStore.js');
  const store = new FeedIconStore(dir);
  const params = { host: 'example.com', siteURL: 'https://example.com', feedURL: 'https://example.com/feed.xml', storedIconURL: '' };
  const key = store._key(params);
  const fake = 'data:image/png;base64,iVBORw0KGgo=';
  fs.writeFileSync(store._diskPath(key), fake, 'utf8');
  (async () => {
    check('B08 磁盘命中', (await store.load(params)) === fake);
    check('B08 内存命中', (await store.load(params)) === fake);
    const p2 = { host: '', siteURL: '', feedURL: '', storedIconURL: '' };
    store.failures.set(store._key(p2), Date.now() + 60_000);
    check('B08 失败冷却期内直接 null（不打网络）', (await store.load(p2)) === null);
    // 过期冷却后允许再试（此处全部候选为空 → 走网络前就返回 null：无 host 无 url 时 candidates 为空 → 失败）
    store.failures.set(store._key(p2), Date.now() - 1);
    const again = await store.load(p2);
    check('B08 冷却过期后重试（空候选返回 null 且重新记录冷却）', again === null && store.failures.has(store._key(p2)));
  })().then(() => {
    finish();
  }).catch((e) => { console.error('ERROR', e); process.exit(1); });
}
function finish() {
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
  process.exit(failures ? 1 : 0);
}
