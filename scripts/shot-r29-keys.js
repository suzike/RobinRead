'use strict';
/** R29 验收截图：列表快捷键速查面板 + J/K 光标 → .tmp-shots/r29-*.png */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r29-shot-'));
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
      host.style.cssText = 'position:fixed;inset:0;z-index:400;background:var(--bg,#faf8f2);';
      document.body.appendChild(host);
      const titles = [
        '端侧大模型的功耗拐点：一部手机的推理实录',
        '再见，RSS 阅读器的「已读焦虑」：三周不用标记已读之后',
        '城市夜班公交观察记：凌晨四点的司机与乘客',
        '手工面包店的发酵时间表：48 小时慢工艺',
        '山脊线上的气象站：一个人的高山冬季',
        '旧书市集淘书指南：版本、品相与砍价分寸',
      ];
      const mk = (i) => ({ id: 'r29-' + i, title: titles[i], summaryPreview: '这篇文章的摘要预览用于展示速查面板与光标环的同框效果。', sourceTitle: '潮流周刊', publishedAt: 1758902400 + i * 86400, isRead: i === 4, isStarred: i === 1, contentHead: '' });
      const lv = new ListView(host, { onSelect: () => {}, onContext: () => {}, onLoadMore: () => {}, onSearch: () => {} });
      window.__lv = lv;
      lv.setViewMode('list');
      lv.render(Array.from({ length: 6 }, (_, i) => mk(i)), { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 350));
      return { ok: true };
    })()`);
    // 真 J 两步 → 光标第 2 行；? 呼出速查面板同框
    const tap = (kc, vk) => {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: kc, windowsVirtualKeyCode: vk });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: kc, windowsVirtualKeyCode: vk });
    };
    tap('j', 74);
    await sleep(180);
    tap('j', 74);
    await sleep(180);
    tap('?', 191); // shift+/
    await sleep(400);
    await shot('r29-1-keys-panel.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('SHOT-FAIL', e && e.stack || e);
    app.exit(1);
  }
});
