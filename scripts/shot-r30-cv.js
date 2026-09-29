'use strict';
/** R30 验收截图：content-visibility 长列表滚到中部无空壳 → .tmp-shots/r30-*.png */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r30-shot-'));
app.setPath('userData', userData);
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 180 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const win = new BrowserWindow({
      show: true, width: 1440, height: 900,
      webPreferences: {
        contextIsolation: true, backgroundThrottling: false,
        preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(800);
    const shot = async (name) => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(OUT, name), img.toPNG());
      console.log(`shot ${name}`);
    };
    await win.webContents.executeJavaScript(`(async () => {
      const { ListView } = await import('./views/list.js');
      document.getElementById('app') && (document.getElementById('app').style.display = 'none');
      const host = document.createElement('div');
      host.className = 'list-scroll';
      host.style.cssText = 'position:fixed;inset:0;z-index:400;background:var(--bg,#faf8f2);overflow:auto;';
      document.body.appendChild(host);
      const topics = ['端侧大模型', '夜班公交', '面包发酵', '山脊气象站', '旧书市集', '城市水系', '菜场经济学', '旧钢琴修复'];
      const mk = (i) => ({ id: 'r30-' + i, title: '文' + String.fromCharCode(65 + (i % 26)) + (i * 37 % 501) + '-' + i + ' ' + topics[i % 8] + '观察手记', summaryPreview: '这篇的摘要预览用于长列表跳屏渲染验收：视口外的行跳过布局与绘制，视口内的行必须完整呈现、无一空壳。', sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 600, isRead: i % 4 === 0, isStarred: i % 9 === 0, contentHead: '' });
      const lv = new ListView(host, { onSelect: () => {}, onContext: () => {}, onLoadMore: () => {}, onSearch: () => {} });
      window.__lv = lv;
      lv.setViewMode('list');
      lv.render(Array.from({ length: 80 }, (_, i) => mk(i)), { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 400));
      // 滚到中部再回读：cv:auto 行应即时完整布局
      host.scrollTop = 1600;
      await new Promise(r => setTimeout(r, 350));
      const blank = [...host.querySelectorAll('.entry-row')].filter((r) => {
        const rc = r.getBoundingClientRect();
        return rc.top < window.innerHeight && rc.bottom > 46 && !r.textContent.trim();
      }).length;
      return { blankInView: blank };
    })()`);
    await sleep(250);
    await shot('r30-1-longlist-mid.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('SHOT-FAIL', e && e.stack || e);
    app.exit(1);
  }
});
