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
    ok(appSrc.includes('scheduleRefreshListPull') && appSrc.includes("refreshStatus?.state === 'refreshing'"), 'D1b 渲染层刷新中列表重拉合批在场（app.js）');

    console.log(failed === 0 ? 'ALL PASSED' : `${failed} 项失败`);
    try { store.database.close(); } catch (_) { /* 探针直关即可 */ }
    app.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error('PROBE ERROR:', err && err.stack || err);
    app.exit(2);
  }
});
