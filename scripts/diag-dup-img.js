'use strict';
/**
 * diag-dup-img.js — R37 同址重复图折叠探针（run-all OFFLINE 集）
 * 验证：相邻同址重复折叠 / 相隔同址重复折叠（首次保留）/ figure 壳连体移除 /
 *       不同图不受影响 / 查询串差异视为同图
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-dup-img-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 120 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false, width: 1440, height: 900,
      webPreferences: { contextIsolation: true, backgroundThrottling: false },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(600);
    const run = (tag, js) => {
      console.log('PHASE ' + tag);
      return win.webContents.executeJavaScript(`(async () => { try { ${js} } catch (e) { return { __err: String(e && e.stack || e) }; } })()`);
    };
    const a = await run('dedupe', `
      const { ReaderView } = await import('./views/reader.js');
      const host = document.createElement('div');
      document.body.appendChild(host);
      const proto = Object.create(ReaderView.prototype);
      proto.body = host;
      proto.feed = { siteURL: 'https://example.com/' };
      proto.entry = { url: 'https://example.com/a' };
      const IMG = 'https://img.example.com/cover.jpg';
      const IMG2 = 'https://img.example.com/chart.png';
      host.innerHTML = \`
        <figure><img src="\${IMG}?wx_fmt=jpeg"></figure>
        <p>引言段落。</p>
        <p><img src="\${IMG}" width="1" height="0"></p>
        <div><img src="\${IMG}?wx_fmt=png"></div>
        <p>中段。</p>
        <figure><img src="\${IMG}"></figure>
        <p><img src="\${IMG2}"></p>
        <p><img src="\${IMG2}"></p>
        <p>结尾。</p>\`;
      proto._normalizeArticle();
      await new Promise(r => setTimeout(r, 50));
      const imgs = [...host.querySelectorAll('img')].map((im) => im.src);
      const figures = host.querySelectorAll('figure').length;
      return {
        total: imgs.length,
        coverCount: imgs.filter((s) => s.includes('cover.jpg')).length,
        chartCount: imgs.filter((s) => s.includes('chart.png')).length,
        figures,
        hasIntro: host.textContent.includes('引言段落'),
        hasEnd: host.textContent.includes('结尾'),
      };
    `);
    if (a.__err) throw new Error('dedupe: ' + a.__err);
    ok(a.total === 2, '四张同址/异址图收敛为 2 张（实际 ' + a.total + '）');
    ok(a.coverCount === 1, '封面同址重复（含查询串差异）只留首次（' + a.coverCount + ' 张）');
    ok(a.chartCount === 1, 'chart.png 重复同样折叠（' + a.chartCount + ' 张）');
    ok(a.figures === 1, '保留封面 figure、被删图 figure 壳连体移除（余 ' + a.figures + ' 个）');
    ok(a.hasIntro && a.hasEnd, '正文文本不受影响');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
