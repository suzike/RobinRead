'use strict';
/**
 * diag-img-ratio.js — R38 图片宽高占位探针（run-all OFFLINE 集）
 * 验证：width/height 属性 → aspectRatio 占位 + 100% 宽 / 微信 data-ratio 同效 /
 *       小尺寸内联图（表情）不参与 / 失败图占位不塌陷
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-img-ratio-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 150 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false, width: 1000, height: 900,
      webPreferences: { contextIsolation: true, backgroundThrottling: false },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(600);
    const run = (tag, js) => {
      console.log('PHASE ' + tag);
      return win.webContents.executeJavaScript(`(async () => { try { ${js} } catch (e) { return { __err: String(e && e.stack || e) }; } })()`);
    };
    const a = await run('ratio', `
      const { ReaderView } = await import('./views/reader.js');
      const host = document.createElement('div');
      host.className = 'reader-article';
      host.style.cssText = 'width:600px;';
      document.body.appendChild(host);
      const proto = Object.create(ReaderView.prototype);
      proto.body = host;
      host.innerHTML = \`
        <p><img id="g1" src="https://127.0.0.1:1/never.jpg" width="800" height="450"></p>
        <p><img id="g2" src="https://127.0.0.1:1/never2.jpg" data-ratio="0.5625"></p>
        <p>正文 <img id="g3" src="https://127.0.0.1:1/emoji.png" width="24" height="24"> 表情不参与。</p>
        <p><img id="g4" src="https://127.0.0.1:1/broken.jpg" width="800" height="450"></p>\`;
      host.querySelectorAll('img').forEach((im) => proto._decorateImage(im));
      const ar = (id) => parseFloat(host.querySelector(id).style.aspectRatio);
      const marked = (id) => host.querySelector(id).classList.contains('nj-img-ratio');
      const pW = host.querySelector('#g1').parentElement.clientWidth;
      const w1 = host.querySelector('#g1').getBoundingClientRect().width;
      // 失败态：等错误重试链走完（1.2s 重试 + 立即二次失败）
      await new Promise(r => setTimeout(r, 1700));
      const g4 = host.querySelector('#g4');
      const failedKept = g4.classList.contains('nj-img-failed') && parseFloat(g4.style.aspectRatio) > 0 && g4.getBoundingClientRect().height > 100;
      return {
        ar1: Math.round(ar('#g1') * 100) / 100, marked1: marked('#g1'), w1: Math.round(w1),
        ar2: Math.round(ar('#g2') * 100) / 100, marked2: marked('#g2'),
        marked3: marked('#g3'),
        failedKept, pW,
      };
    `);
    if (a.__err) throw new Error('ratio: ' + a.__err);
    ok(a.ar1 === 1.78 && a.marked1, 'width/height 属性 → 16:9 占位（' + a.ar1 + '）');
    ok(a.w1 === a.pW, '占位图撑满栏内容宽（' + a.w1 + '/' + a.pW + '）');
    ok(a.ar2 === 1.78 && a.marked2, '微信 data-ratio 同效（' + a.ar2 + '）');
    ok(!a.marked3, '24px 表情图不参与占位');
    ok(a.failedKept, '失败图占位不塌陷（failed 态 + 等比框保留）');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
