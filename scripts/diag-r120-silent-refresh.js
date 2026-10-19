'use strict';
/**
 * diag-r120-silent-refresh.js — R120 后台静默刷新 + 灌文窗口探针（run-all OFFLINE 集，_fetchForFeed stub 零网络）
 *
 * 背景（用户实报三连）：
 *  ① 启动/批量刷新时整个工具卡死——根因是单源整段一个同步事务（node:sqlite 全同步），
 *    叠加启动 800ms 即刷与刷新前同步跑的每日 housekeeping，把主进程事件循环堵死。
 *  ② 源内容很多只入库几篇——_applyParsedEntries 的 90 天硬窗把全历史源截断（首抓也被截）。
 *
 * 验证项：
 *  A1 分片让行：300 篇大源灌库期间心跳最大间隙 < 600ms（无分片时单事务堵死远超此值） *  A2 灌库期间事件循环持续转动（心跳 tick 数充足，而非憋一整段）
 *  B1 首抓不吃 90 天窗：跨 400 天的 300 篇全量入库
 *  B2 首抓封顶 500：700 篇 XML → 500 篇入库（防巨库炸弹）
 *  B3 常规刷新窗口 365 天：已有 1 篇的源，喂 300d×100 + 400d×20 → 只进 300d 的 100 篇
 *  B4 幂等：同内容再刷新 0 新增（id 去重）
 *  C1 housekeeping 移出刷新热路径：refresh() 同步路径不执行；45s 空闲定时器已挂
 *  D1 静态锚：启动刷新延迟 10s；渲染层刷新中列表重拉合批（scheduleRefreshListPull）在场
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r120-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 150 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };

const DAY = 24 * 3600;
const bodyHTML = (n) => `<p>${'量子计算与纠错码的正文内容。'.repeat(220)}</p><p>第 ${n} 段：用于灌库分片验证的重复正文。</p>`;

app.whenReady().then(async () => {
  try {
    const { AppStore } = require('../src/main/AppStore');
    const { LOCAL_ACCOUNT_ID, nowSeconds } = require('../src/main/Models');
    const store = new AppStore(app.getPath('userData'));
    const now = nowSeconds();

    // 三个源：A=300 篇跨 400 天（首抓全量验证 + 分片心跳）；B=700 篇（首抓封顶）；C=预置 1 篇（365 天窗）
    const mkEntries = (count, ageOf) => Array.from({ length: count }, (_, i) => ({
      id: `item-${i}`, title: `文章 ${i}`, author: '作者', url: `https://probe.example/${i}`,
      publishedAt: now - ageOf(i) * DAY, summary: `摘要 ${i}`, contentHTML: bodyHTML(i), enclosure: null,
    }));
    const feedA = store.feedsRepo.insertFeed({ accountID: LOCAL_ACCOUNT_ID, title: '全量源A', siteURL: 'https://a.example', feedURL: 'https://a.example/rss' });
    const feedB = store.feedsRepo.insertFeed({ accountID: LOCAL_ACCOUNT_ID, title: '封顶源B', siteURL: 'https://b.example', feedURL: 'https://b.example/rss' });
    const feedC = store.feedsRepo.insertFeed({ accountID: LOCAL_ACCOUNT_ID, title: '窗口源C', siteURL: 'https://c.example', feedURL: 'https://c.example/rss' });
    store.articlesRepo.upsertEntry({
      id: `local:${feedC.id}:seed`, accountID: LOCAL_ACCOUNT_ID, externalID: 'seed', feedID: feedC.id,
      title: '预置篇', author: null, url: 'https://c.example/seed', publishedAt: now, summary: '', contentHTML: null, dateArrived: now,
    });

    const parsedFor = {};
    parsedFor[feedA.id] = mkEntries(300, (i) => (i % 3) * 150 + 10); // 10/160/310 天混布（超 90 天的占 2/3）
    parsedFor[feedB.id] = mkEntries(700, (i) => i % 400 + 5);
    parsedFor[feedC.id] = [...mkEntries(100, () => 300), ...mkEntries(20, () => 400).map((e, i) => ({ ...e, id: `old-${i}` }))];
    store._fetchForFeed = async (feed) => ({
      notModified: false,
      parsed: { title: feed.title, siteURL: feed.siteURL, iconURL: null, entries: parsedFor[feed.id] || [] },
      etag: null, lastModified: null,
    });

    // C1 前置：housekeeping 打桩（refresh 同步路径绝不能调它）
    let housekeepingCalls = 0;
    store.housekeeping = () => { housekeepingCalls += 1; };

    // ── A1/A2/B1/B2/B3 + C1：一轮批量刷新 ──
    let last = Date.now(); let maxGap = 0; let ticks = 0;
    const hb = setInterval(() => { const t = Date.now(); if (t - last > maxGap) maxGap = t - last; last = t; ticks += 1; }, 5);
    await store.refresh('manual');
    clearInterval(hb);

    const countItems = (feedID) => store.database.prepare('SELECT COUNT(*) c FROM items WHERE feed_id = ?').get(feedID).c;
    const nA = countItems(feedA.id);
    const nB = countItems(feedB.id);
    const nC = countItems(feedC.id);

    ok(nA === 300, `B1 首抓不吃 90 天窗：300/300 篇全量入库（实际 ${nA}）`);
    ok(nB === 500, `B2 首抓封顶 500（700 篇 XML → 实际 ${nB}）`);
    ok(nC === 101, `B3 常规窗口 365 天：预置1 + 300d×100 进，400d×20 拒（实际 ${nC}）`);
    ok(maxGap < 600, `A1 灌库期间心跳最大间隙 ${maxGap}ms < 600ms（分片让行生效；无分片时单事务远超此值）`);
    ok(ticks >= 5, `A2 事件 loop 持续转动（灌库窗口内心跳 ${ticks} 拍 ≥5；整段堵死时≈0）`);
    ok(housekeepingCalls === 0 && store._housekeepingTimer != null, `C1 housekeeping 移出热路径（调用 ${housekeepingCalls} 次；空闲定时器已挂 ${!!store._housekeepingTimer}）`);
    if (store._housekeepingTimer) { clearTimeout(store._housekeepingTimer); store._housekeepingTimer = null; }

    // ── B4 幂等：同内容再刷 0 新增 ──
    await store.refresh('manual');
    ok(countItems(feedA.id) === 300, 'B4 同内容重刷 0 新增（id 去重）');

    // ── D1 静态锚：启动延迟 + 渲染层合批 ──
    const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
    const appSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
    ok(/R120[\s\S]{0,400}10s[\s\S]{0,200}}, 10000\);/.test(mainSrc) || /}, 10000\);/.test(mainSrc), 'D1a 启动刷新延迟 10s（main.js）');
    ok(appSrc.includes('scheduleRefreshListPull') && appSrc.includes("refreshStatus?.state === 'refreshing'"), 'D1b 渲染层刷新中列表重拉合批（app.js）');

    // ── E 组（R120.7 真实库剖析后的追加修复）──
    // E1 分片按字节自适应：30 篇 × 40KB 正文（1.2MB）必须切成多片（>128KB/片），且全程心跳 <300ms
    {
      const feedE = store.feedsRepo.insertFeed({ accountID: LOCAL_ACCOUNT_ID, title: '巨文源E', siteURL: 'https://e.example', feedURL: 'https://e.example/rss' });
      const bigBody = `<p>${'巨文正文内容。'.repeat(4000)}</p>`; // ≈ 24KB 字符
      let ingestCalls = 0;
      const orig = AppStore.prototype._ingestEntriesSync;
      AppStore.prototype._ingestEntriesSync = function (...a) { ingestCalls += 1; return orig.apply(this, a); };
      let lastT = Date.now(); let maxGapE = 0;
      const hbE = setInterval(() => { const t = Date.now(); if (t - lastT > maxGapE) maxGapE = t - lastT; lastT = t; }, 5);
      await store._applyParsedEntriesChunked(feedE, Array.from({ length: 30 }, (_, i) => ({
        id: `big-${i}`, title: `巨文 ${i}`, url: `https://e.example/${i}`,
        publishedAt: now - i * DAY, summary: '巨文摘要', contentHTML: bigBody, enclosure: null,
      })));
      clearInterval(hbE);
      AppStore.prototype._ingestEntriesSync = orig;
      ok(countItems(feedE.id) === 30, `E1a 巨文源 30 篇全量入库（实际 ${countItems(feedE.id)}）`);
      ok(ingestCalls >= 5, `E1b 按字节自适应切多片（30×24KB → ${ingestCalls} 片 ≥5）`);
      ok(maxGapE < 300, `E1c 巨文灌库心跳最大间隙 ${maxGapE}ms < 300ms`);
    }

    // E2 FTS 回填：游标续跑（只补剩余）+ 刷新中让位 + 完成置位
    {
      const feedF = store.feedsRepo.insertFeed({ accountID: LOCAL_ACCOUNT_ID, title: '回填源F', siteURL: 'https://f.example', feedURL: 'https://f.example/rss' });
      store._applyParsedEntries(store.feedsRepo.feed(feedF.id), Array.from({ length: 60 }, (_, i) => ({
        id: `bf-${i}`, title: `回填 ${i} robinread-probe`, url: `https://f.example/${i}`,
        publishedAt: now - i * DAY, summary: '摘要', contentHTML: `<p>${'回填正文。'.repeat(800)}</p>`, enclosure: null,
      })));
      store.preferences.set('RobinRead.fts.backfilled', false);
      store.preferences.set('RobinRead.fts.backfill.cursor', 0);
      // E2a 刷新进行中回填让位：1.6s 内游标不得推进
      store.refreshStatus = { state: 'refreshing' };
      const bfPromise = store._ftsBackfill();
      await new Promise((r) => setTimeout(r, 1600));
      const cursorDuring = Number(store.preferences.get('RobinRead.fts.backfill.cursor', 0));
      store.refreshStatus = { state: 'idle' };
      await bfPromise;
      ok(cursorDuring === 0, `E2a 刷新进行中回填让位（1.6s 内游标未动=${cursorDuring === 0}）`);
      ok(store.preferences.get('RobinRead.fts.backfilled') === true, 'E2b 回填完成置完成标记');
      // E2c 游标续跑：置回 feedF 第 40 篇的 rowid 再跑 → 只补剩余 20 篇（不从头重跑）
      store.preferences.set('RobinRead.fts.backfilled', false);
      const midRowid = Number(store.database.prepare(`
        SELECT a.rowid AS rid FROM articles a
        INNER JOIN items i ON i.id = a.item_id
        WHERE i.feed_id = ? ORDER BY a.rowid LIMIT 1 OFFSET 40
      `).get(feedF.id).rid);
      const maxRowid = Number(store.database.prepare('SELECT MAX(rowid) m FROM articles').get().m);
      store.preferences.set('RobinRead.fts.backfill.cursor', midRowid);
      let resumedBatches = 0;
      const origTx = store.database.transaction.bind(store.database);
      store.database.transaction = (fn) => { resumedBatches += 1; return origTx(fn); };
      await store._ftsBackfill();
      store.database.transaction = origTx;
      ok(store.preferences.get('RobinRead.fts.backfilled') === true,
        `E2c 游标续跑（从 feedF+40 处续，本轮仅 ${resumedBatches} 批而非全库重扫）`);
      ok(resumedBatches > 0 && resumedBatches <= 6, `E2c 续跑批量级正确（${resumedBatches} 批 ≈ 剩余 20 行/每批 20）`);
      void maxRowid;
    }

    // E3 批量超时 + E4 新鲜度跳过 + E5 死源过滤口径（'scheduled' 也跳）
    {
      const seen = [];
      store._fetchForFeed = async (feed, opts) => {
        seen.push({ id: feed.id, timeoutMs: opts?.timeoutMs });
        return { notModified: true, etag: null, lastModified: null };
      };
      const feedG = store.feedsRepo.insertFeed({ accountID: LOCAL_ACCOUNT_ID, title: '新鲜源G', siteURL: 'https://g.example', feedURL: 'https://g.example/rss' });
      const feedH = store.feedsRepo.insertFeed({ accountID: LOCAL_ACCOUNT_ID, title: '陈旧源H', siteURL: 'https://h.example', feedURL: 'https://h.example/rss' });
      const feedI = store.feedsRepo.insertFeed({ accountID: LOCAL_ACCOUNT_ID, title: '死源I', siteURL: 'https://i.example', feedURL: 'https://i.example/rss' });
      store.feedsRepo.updateFeed(feedG.id, (f) => ({ ...f, lastRefreshedAt: nowSeconds() })); // 刚刷过
      store.feedsRepo.updateFeed(feedH.id, (f) => ({ ...f, lastRefreshedAt: nowSeconds() - 3600 }));
      store.feedsRepo.updateFeed(feedI.id, (f) => ({ ...f, lastRefreshedAt: nowSeconds() - 3600 }));
      store.database.prepare('INSERT INTO feed_health (feed_id, fetch_success_count, fetch_failure_count, consecutive_failures, is_dead) VALUES (?, 0, 9, 9, 1) ON CONFLICT(feed_id) DO UPDATE SET is_dead = 1').run(feedI.id);

      seen.length = 0;
      await store.refresh('scheduled');
      const schedIds = new Set(seen.map((s) => s.id));
      ok(!schedIds.has(feedG.id), 'E4a 定时刷新跳过周期内已刷源（新鲜源G 未被打）');
      ok(!schedIds.has(feedI.id), 'E5a 定时刷新跳过死源（源I 未被打——既有 bug：scheduled 口径从未生效）');
      ok(seen.length > 0 && seen.every((s) => s.timeoutMs === 15000), `E3a 批量刷新超时收紧 15s（样本 ${JSON.stringify(seen[0] || null)}）`);

      seen.length = 0;
      await store.refresh('manual');
      const manualCalls = seen.filter((s) => s.id === feedI.id);
      ok(manualCalls.length === 1 && manualCalls[0].timeoutMs === 30000, 'E3b+E5b 手动刷新含死源且保持默认 30s（复活路径不变）');

      seen.length = 0;
      store.feedsRepo.updateFeed(feedH.id, (f) => ({ ...f, lastRefreshedAt: nowSeconds() - 3600 })); // 上一轮 scheduled 刚刷过它，重置回陈旧
      await store.refresh('launch');
      const launchIds = new Set(seen.map((s) => s.id));
      ok(!launchIds.has(feedG.id) && launchIds.has(feedH.id), 'E4b 启动刷新跳过 15 分钟内已刷源（G 跳 / H 打）');
    }

    console.log(failed === 0 ? 'ALL PASSED' : `${failed} 项失败`);
    try { store.database.close(); } catch (_) { /* 探针直关即可 */ }
    app.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error('PROBE ERROR:', err && err.stack || err);
    app.exit(2);
  }
});
