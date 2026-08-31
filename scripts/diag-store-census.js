'use strict';
/**
 * 订阅商店目录普查 + 抽样可达性诊断（只读，不改任何源文件，幂等可重复运行）
 *
 * 用法：
 *   node scripts/diag-store-census.js           # 静态普查 + 抽样 20 源网络探测
 *   node scripts/diag-store-census.js --static  # 只跑静态普查（不发网络请求）
 *
 * 输出：
 *   1) 目录家底统计：总条数 / 去重 URL / 分类 / 语言 / 描述覆盖与长度 /
 *      siteURL 字段 / 重复源 / http 明文 / 需代理标记 / rank 缺口 / 专题覆盖
 *   2) 网络抽样：确定性抽取 20 个源（非 wechat 桥接源每 7 取 1 + 3 个 wechat2rss 桥接样本），
 *      每个 URL 一次 GET（10s 超时），统计 存活 / HTTP 错误 / 超时 / DNS 失败。
 */

const path = require('node:path');
const fs = require('node:fs');
const root = path.join(__dirname, '..');

async function main() {
  // ── 动态加载 ESM 目录模块 ──
  const { CATALOG_EXTRA } = await import('file://' + path.join(root, 'src/renderer/views/feed-store-extra.js'));
  const { CATALOG_EXTRA2 } = await import('file://' + path.join(root, 'src/renderer/views/feed-store-extra2.js'));
  const { WECHAT_ACCOUNTS } = await import('file://' + path.join(root, 'src/renderer/views/wechat-accounts.js'));

  // CATALOG_BASE / TOPICS / EDITORS_PICKS 未导出，从源码文本提取
  const src = fs.readFileSync(path.join(root, 'src/renderer/views/feed-store.js'), 'utf8');
  const baseBlock = src.split('const CATALOG_BASE = [')[1].split('\n];')[0];
  const base = [];
  const entryRe = /\{ rank: (\d+), cat: '([^']+)', lang: '([^']+)', name: '([^']+)', url: '([^']+)', desc: '([^']*)'/g;
  let m;
  while ((m = entryRe.exec(baseBlock))) {
    base.push({ rank: +m[1], cat: m[2], lang: m[3], name: m[4], url: m[5], desc: m[6] });
  }

  const CATALOG = [...base, ...CATALOG_EXTRA, ...CATALOG_EXTRA2];

  // ── 1. 静态普查 ──
  const line = '-'.repeat(64);
  console.log(line);
  console.log('一、目录静态普查');
  console.log(line);
  console.log(`CATALOG_BASE=${base.length}  CATALOG_EXTRA=${CATALOG_EXTRA.length}  CATALOG_EXTRA2=${CATALOG_EXTRA2.length}`);
  console.log(`目录总条数=${CATALOG.length}`);
  const uniqURLs = new Set(CATALOG.map((e) => e.url));
  console.log(`去重后 URL 数=${uniqURLs.size}  重复条目=${CATALOG.length - uniqURLs.size}`);

  const seen = new Map();
  const dups = [];
  for (const e of CATALOG) {
    if (seen.has(e.url)) dups.push([seen.get(e.url), e]);
    else seen.set(e.url, e);
  }
  if (dups.length) {
    console.log('重复 URL 明细：');
    for (const [a, b] of dups) console.log(`  rank ${a.rank} ${a.name}  <->  rank ${b.rank} ${b.name}  ${a.url}`);
  }

  const cats = {};
  for (const e of CATALOG) cats[e.cat] = (cats[e.cat] || 0) + 1;
  console.log('按分类：' + Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  '));

  const langs = {};
  for (const e of CATALOG) langs[e.lang] = (langs[e.lang] || 0) + 1;
  console.log(`按语言：${JSON.stringify(langs)}  （中文占比 ${(langs['中'] / CATALOG.length * 100).toFixed(1)}%）`);

  const withDesc = CATALOG.filter((e) => e.desc && e.desc.trim());
  const lens = withDesc.map((e) => [...e.desc].length);
  const avg = Math.round(lens.reduce((s, n) => s + n, 0) / CATALOG.length);
  console.log(`带描述=${withDesc.length}/${CATALOG.length}  平均长度=${avg} 字符  最短=${Math.min(...lens)}  最长=${Math.max(...lens)}`);
  console.log(`显式 siteURL 字段=${CATALOG.filter((e) => 'siteURL' in e).length}（目录只有 url=feed 地址；siteURL 由 FeedParser 抓取时推导）`);

  console.log(`http 明文源=${CATALOG.filter((e) => e.url.startsWith('http://')).length}`);
  for (const e of CATALOG.filter((x) => x.url.startsWith('http://'))) console.log(`    rank ${e.rank} ${e.name}  ${e.url}`);
  const proxy = CATALOG.filter((e) => e.name.includes('需代理'));
  console.log(`名称标注「需代理」=${proxy.length}`);
  for (const e of proxy) console.log(`    rank ${e.rank} ${e.name}  ${e.url}`);

  const ranks = new Set(CATALOG.map((e) => e.rank));
  const missing = [];
  for (let i = 1; i <= 100; i++) if (!ranks.has(i)) missing.push(i);
  console.log(`rank 去重数=${ranks.size}  范围=${Math.min(...ranks)}-${Math.max(...ranks)}  1-100 缺失 rank=[${missing.join(',')}]`);

  // 专题覆盖
  const topicsBlock = src.split('const TOPICS = [')[1].split('\n];')[0];
  const topics = [];
  const topicRe = /\{ id: '([^']+)', name: '([^']+)', desc: '([^']*)', hue: (\d+), urls: \[([^\]]+)\]/g;
  let tm;
  while ((tm = topicRe.exec(topicsBlock))) {
    topics.push({
      id: tm[1], name: tm[2], desc: tm[3],
      urls: tm[5].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean),
    });
  }
  console.log(`专题包 TOPICS=${topics.length} 个`);
  for (const tp of topics) {
    const hit = tp.urls.filter((u) => uniqURLs.has(u)).length;
    const miss = tp.urls.filter((u) => !uniqURLs.has(u));
    console.log(`  ${tp.name}(${tp.id}) 声称 ${tp.urls.length} 源 | 命中目录 ${hit} | 目录外或 URL 不匹配: ${miss.length ? JSON.stringify(miss) : '无'}`);
  }

  const picksBlock = src.split('const EDITORS_PICKS = [')[1].split('\n];')[0];
  const picks = picksBlock.split('\n').map((s) => s.trim().replace(/,$/, '').replace(/'/g, '')).filter((s) => s.startsWith('http'));
  console.log(`编辑精选 EDITORS_PICKS=${picks.length} 个 | 命中目录=${picks.filter((u) => uniqURLs.has(u)).length} | 目录外=${picks.filter((u) => !uniqURLs.has(u)).length}`);

  // 公众号目录
  console.log(`WECHAT_ACCOUNTS=${WECHAT_ACCOUNTS.length} 条 | 去重 URL=${new Set(WECHAT_ACCOUNTS.map((a) => a.url)).size} | 带描述=${WECHAT_ACCOUNTS.filter((a) => a.desc).length}`);
  const wset = new Set(WECHAT_ACCOUNTS.map((a) => a.url));
  const catWechat = CATALOG.filter((e) => e.cat === 'wechat');
  console.log(`商店 wechat 分类卡片=${catWechat.length} | 命中 375 目录=${catWechat.filter((e) => wset.has(e.url)).length} | 非 wechat2rss 域=${catWechat.filter((e) => !e.url.includes('wechat2rss')).length}`);

  // ── 2. 网络抽样（确定性、幂等）──
  if (process.argv.includes('--static')) {
    console.log(line);
    console.log('（--static：跳过网络抽样）');
    return;
  }

  console.log(line);
  console.log('二、抽样可达性探测（20 源，确定性抽样，10s 超时，GET 只读）');
  console.log(line);

  const uniq = [...seen.values()]; // 去重后的目录源
  const nonWechat = uniq.filter((e) => e.cat !== 'wechat');
  const wechatSources = uniq.filter((e) => e.cat === 'wechat');
  const sampled = [];
  for (let i = 0; i < nonWechat.length && sampled.length < 17; i += 7) sampled.push(nonWechat[i]);
  // 3 个桥接样本：公共桥主站 / slarker 公告桥 / wechat2rss 机器之心
  const bridgePicks = [
    wechatSources.find((e) => e.url.includes('hub.slarker.me')) || wechatSources[0],
    CATALOG.find((e) => e.url.includes('rsshub.woodland.cafe')),
    CATALOG.find((e) => e.url.includes('wechat2rss.bestblogs.dev')),
  ].filter(Boolean);
  sampled.push(...bridgePicks);
  // 从 375 公众号目录中抽 2 个（固定取第 1、188 条）
  sampled.push(WECHAT_ACCOUNTS[0], WECHAT_ACCOUNTS[Math.floor(WECHAT_ACCOUNTS.length / 2)]);
  const finalSample = sampled.slice(0, 20);

  const UA = 'RobinRead/2.0 (+personal RSS reader)';
  const timeoutMs = 10000;
  const results = [];
  let index = 0;
  const worker = async () => {
    while (index < finalSample.length) {
      const entry = finalSample[index++];
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let outcome;
      try {
        const res = await fetch(entry.url, {
          headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, */*' },
          signal: controller.signal, redirect: 'follow',
        });
        const body = await res.text();
        const looksFeed = /<rss|<feed|<rdf|\{\s*"version"\s*:/.test(body.slice(0, 2000));
        outcome = { status: res.status, ms: Date.now() - started, ok: res.ok && looksFeed, looksFeed, bytes: body.length };
      } catch (err) {
        const cause = err?.cause || {};
        const code = cause.code || err.name;
        outcome = { status: 0, ms: Date.now() - started, ok: false, looksFeed: false, error: code === 'TimeoutError' || err.name === 'AbortError' ? 'TIMEOUT' : code };
      } finally {
        clearTimeout(timer);
      }
      results.push({ entry, ...outcome });
      const tag = outcome.ok ? 'OK    ' : (outcome.status ? `HTTP ${outcome.status}` : String(outcome.error));
      console.log(`[${results.length}/${finalSample.length}] ${tag.padEnd(10)} ${String(outcome.ms).padStart(6)}ms  ${entry.name}  ${entry.url}${outcome.ok && !outcome.looksFeed ? '  (响应 200 但非 feed 格式)' : ''}`);
    }
  };
  await Promise.all(Array.from({ length: 5 }, () => worker()));

  const ok = results.filter((r) => r.ok).length;
  const httpFail = results.filter((r) => !r.ok && r.status > 0).length;
  const netFail = results.filter((r) => !r.ok && !r.status).length;
  console.log(line);
  console.log(`抽样合计=${results.length}  存活(2xx 且为 feed)=${ok}  HTTP 错误=${httpFail}  超时/DNS/网络错误=${netFail}`);
  console.log('注意：本机网络环境（大陆直连/代理/防火墙）会显著影响结果，结论仅代表当前探测环境的可达性。');
}

main().catch((err) => { console.error(err); process.exit(1); });
