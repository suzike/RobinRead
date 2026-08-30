'use strict';
/**
 * diag-extract-worker.js — 正文提取 utilityProcess 工作进程端到端探测
 *
 * 与 diag-phase1-renderer.js 同款骨架：独立临时 userData（os.tmpdir 隔离）+ 主进程内起
 * 本地 HTTP 服务器提供可控抓取目标；不需要窗口（纯主进程模块行为验证）。
 *
 * 覆盖：
 *   (a)  extract 经 worker 路径成功返回正文（含关键字符串、isSanitized）
 *   (a2) 该任务确实由 worker 完成（stats.worker 计数增加）
 *   (b)  杀掉 worker 后 extract 仍成功（冷却期回退主进程路径）
 *   (b2) 冷却结束后自动重启新 worker 并成功（重启路径）
 *   (c)  priority 排序：塞满 prefetch 后 user 任务插队先完成（worker 串行，首个 prefetch 除外）
 *   (c2) 队列上限：灌满 prefetch 后丢弃 prefetch（extract-queue-full），user 不丢
 *   (d)  头像过滤：pbs.twimg.com/profile_images 的 img 被 sanitizedHTML 剔除、普通图保留
 *   (e)  RSS 正文路径：直接调 sanitizedHTML 同步导出，不经过 worker、行为不变
 *   (f)  worker 报错 → 回退主进程原逻辑（404 双重失败后按原语义 reject）
 *
 * 幂等：全部数据落在一次性临时目录；本地端口随机；退出码 0=全 PASS，1=有 FAIL。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');

// 必须在 require ArticleExtractor 之前设置：QUEUE_CAP 在模块加载时读取
process.env.ROBIN_EXTRACT_QUEUE_CAP = '8';

const { app } = require('electron');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-extract-worker-'));
app.setPath('userData', userData);

const ArticleExtractor = require('../src/main/ArticleExtractor');

const SLOW_MS = 600;
const MARK = '工作进程正文标记WORKERPATH-OK';
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/notfound') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('nope');
    return;
  }
  let title = '测试文章';
  if (u.pathname.startsWith('/slow/')) title = `慢预抓文章${u.pathname.split('/').pop()}`;
  else if (u.pathname === '/fast') title = '用户任务快文章';
  const para = `${title}——这一段本地正文用于通过提取质量门槛判定，内容必须足够长才能被 Readability 采纳为有效文章正文。`;
  const paras = Array.from({ length: 8 }, (_, i) => `<p>${para}（第 ${i + 1} 段，标记 ${MARK}）</p>`).join('');
  const send = () => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>${title}</title></head><body><article><h1>${title}</h1>${paras}</article></body></html>`);
  };
  if (u.pathname.startsWith('/slow/')) setTimeout(send, SLOW_MS);
  else send();
});

app.whenReady().then(async () => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(Boolean(ok));
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let code = 1;
  const watchdog = setTimeout(() => {
    console.log('FAIL watchdog — 探测总时长超 300s，强制退出');
    app.exit(1);
  }, 300000);

  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const stats = () => ArticleExtractor._extractorWorker.stats();

    // ── (a) worker 路径：extract 成功且确实由 worker 完成 ──
    // 首次 fork 可能遭遇环境冷启动（磁盘/杀软拖慢 utilityProcess 首启）→ 该次任务按设计
    // 回退主进程；这里允许重试（最多 3 次）以吸收环境噪音，最终必须由 worker 完成。
    let a = null;
    let s0 = stats();
    let s1 = s0;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      a = await ArticleExtractor.extract(`${base}/article`);
      s1 = stats();
      if (s1.worker > s0.worker) break;
      if (attempt < 3) {
        console.log(`NOTE (a) 第 ${attempt} 次尝试走了回退（冷启动），等待重启冷却后重试`);
        await sleep(1300);
        s0 = stats();
      }
    }
    check('(a) extract 经 worker 路径成功返回正文（含关键字符串且已消毒）',
      !!a && a.isSanitized === true && a.html.includes(MARK) && a.text.includes(MARK) && a.text.length >= 120,
      `textLen=${a && a.text.length} sourceURL=${a && a.sourceURL}`);
    check('(a2) 该任务确实由 worker 完成（stats.worker +1）', s1.worker === s0.worker + 1,
      `before=${s0.worker} after=${s1.worker}`);

    // ── (e) RSS 正文路径：sanitizedHTML 同步导出，不经过 worker ──
    const s2 = stats();
    const rssHTML = '<p>纸感阅读正常段落内容</p><script>alert(1)</script><p onclick="x()">点击</p><img src="https://example.com/pic.jpg">';
    const t0 = Date.now();
    const rssOut = ArticleExtractor.sanitizedHTML(rssHTML, 'https://example.com/weekly/1');
    const syncMs = Date.now() - t0;
    const s3 = stats();
    check('(e) sanitizedHTML 同步导出行为不变（剥 script/onclick、保正文与图片、同步返回）',
      !rssOut.includes('<script') && !rssOut.includes('onclick')
        && rssOut.includes('纸感阅读正常段落内容') && rssOut.includes('https://example.com/pic.jpg') && syncMs < 50,
      `ms=${syncMs} out=${rssOut.slice(0, 140)}`);
    check('(e2) RSS 路径不经过 worker（stats 完全不变）', JSON.stringify(s3) === JSON.stringify(s2),
      `before=${JSON.stringify(s2)} after=${JSON.stringify(s3)}`);

    // ── (d) 头像过滤：profile_images 剔除、普通图保留 ──
    const avatarHTML = '<p>推文正文第一段</p>'
      + '<img src="https://pbs.twimg.com/profile_images/12345/avatar_normal.jpg" alt="发推者头像">'
      + '<p>第二段</p>'
      + '<img src="https://pbs.twimg.com/media/realphoto.jpg?format=jpg" alt="内容图">'
      + '<img src="https://example.com/1x1.gif" data-src="https://pbs.twimg.com/profile_images/6789/lazy.jpg">';
    const avatarOut = ArticleExtractor.sanitizedHTML(avatarHTML, 'https://example.com/tweet');
    check('(d) pbs.twimg.com/profile_images 头像图被剔除（含懒加载写法）', !avatarOut.includes('profile_images'),
      avatarOut.slice(0, 200));
    check('(d2) 普通内容图（pbs.twimg.com/media）保留且带消毒属性',
      avatarOut.includes('https://pbs.twimg.com/media/realphoto.jpg') && /loading="(eager|lazy)"/.test(avatarOut),
      avatarOut.slice(0, 200));

    // ── (f) worker 报错 → 回退主进程原逻辑（404：worker 与回退双双失败 → 按原语义 reject）──
    const s4 = stats();
    const fetchErr = await ArticleExtractor.extract(`${base}/notfound`).then(() => null, (e) => e);
    const s5 = stats();
    check('(f) worker 报错任务回退主进程原逻辑（fallback +1，最终按原语义拒绝）',
      fetchErr instanceof Error && /HTTP 404/.test(fetchErr.message) && s5.fallback === s4.fallback + 1,
      `${fetchErr && fetchErr.message} fallback ${s4.fallback}->${s5.fallback}`);

    // ── (c) priority 排序：首个 prefetch 占住串行 worker，user 插队先于剩余 prefetch 完成 ──
    const order = [];
    let userDoneAt = 0;
    let lastPrefetchDoneAt = 0;
    const prefetches = [1, 2, 3].map((n) =>
      ArticleExtractor.extract(`${base}/slow/${n}`, { priority: 'prefetch' })
        .then(() => order.push(`prefetch-${n}`))
        .catch(() => order.push(`prefetch-${n}-FAILED`)));
    await sleep(250); // prefetch-1 已派发进 worker（串行执行中），prefetch-2/3 在队列排队
    const user = ArticleExtractor.extract(`${base}/fast`).then(() => { order.push('user'); userDoneAt = Date.now(); });
    prefetches[2].then(() => { lastPrefetchDoneAt = Date.now(); });
    await Promise.all([...prefetches, user]);
    check('(c) user 任务优先于排队中的 prefetch 完成', order.indexOf('user') === 1 && userDoneAt < lastPrefetchDoneAt,
      `order=${JSON.stringify(order)}`);

    // ── (c2) 队列上限（诊断覆盖 cap=8）：灌 10 个 prefetch → 装不下的被丢弃，user 不丢 ──
    let dropped = 0;
    const capRuns = [];
    for (let i = 0; i < 10; i += 1) {
      capRuns.push(ArticleExtractor.extract(`${base}/slow/c${i}`, { priority: 'prefetch' }).catch((e) => {
        if (e && e.message === 'extract-queue-full') dropped += 1;
        else throw e;
      }));
    }
    const userAccepted = await ArticleExtractor.extract(`${base}/fast`).then(() => true, () => false);
    await Promise.all(capRuns);
    check('(c2) 队列满丢 prefetch（cap=8 丢 1 个）且 user 恒被接受', dropped === 1 && userAccepted,
      `dropped=${dropped} userAccepted=${userAccepted}`);

    // ── (b) 杀 worker → 冷却期回退主进程路径 ──
    ArticleExtractor._extractorWorker.killWorker();
    await sleep(150); // 仍在 1s 重启冷却期内
    const s6 = stats();
    const b1 = await ArticleExtractor.extract(`${base}/article2`).then((r) => r.html.includes(MARK), () => false);
    const s7 = stats();
    check('(b) 杀掉 worker 后 extract 仍成功（冷却期回退主进程路径）',
      b1 === true && s7.fallback === s6.fallback + 1,
      `ok=${b1} fallback ${s6.fallback}->${s7.fallback}`);

    // ── (b2) 冷却结束 → 懒重启新 worker 并接管 ──
    await sleep(1200);
    const s8 = stats();
    const b2 = await ArticleExtractor.extract(`${base}/article3`).then((r) => r.html.includes(MARK), () => false);
    const s9 = stats();
    check('(b2) 冷却后 extract 自动重启新 worker 并成功', b2 === true && s9.worker === s8.worker + 1,
      `ok=${b2} worker ${s8.worker}->${s9.worker} restarts=${s9.restarts}`);

    code = results.every(Boolean) ? 0 : 1;
    console.log(code === 0 ? 'EXTRACT WORKER PROBE: ALL PASSED' : 'EXTRACT WORKER PROBE: FAILED');
  } catch (err) {
    console.error('HARNESS ERROR:', err && (err.stack || err.message || err));
    code = 1;
  }
  clearTimeout(watchdog);
  try { server.close(); } catch (_) { /* 退出时无所谓 */ }
  app.exit(code);
}).catch((err) => { console.error(err); app.exit(1); });
