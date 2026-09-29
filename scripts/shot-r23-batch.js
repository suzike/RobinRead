'use strict';
/** R23 批量多选验收截图：真窗口真 Ctrl/Shift 点击圈选 → .tmp-shots/r23-*.png */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r23-shot-'));
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
    const clickAt = (x, y, modifiers = []) => {
      win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, modifiers });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, modifiers });
    };
    const r = await win.webContents.executeJavaScript(`(async () => {
      const { ListView } = await import('./views/list.js');
      document.getElementById('app') && (document.getElementById('app').style.display = 'none');
      const host = document.createElement('div');
      host.className = 'list-scroll';
      host.style.cssText = 'position:fixed;inset:0;z-index:400;background:var(--bg,#faf8f2);';
      document.body.appendChild(host);
      const lv = new ListView(host, { onSelect: () => {}, onContext: () => {}, onLoadMore: () => {}, onSearch: () => {} });
      window.__lv = lv;
      const titles = [
        '端侧大模型的功耗拐点：一部手机的推理实录',
        '再见，RSS 阅读器的「已读焦虑」：三周不用标记已读之后',
        '城市夜班公交观察记：凌晨四点的司机与乘客',
        '手工面包店的发酵时间表：48 小时慢工艺',
        '山脊线上的气象站：一个人的高山冬季',
        '旧书市集淘书指南：版本、品相与砍价分寸',
      ];
      const mk = (i) => ({ id: 'r23-' + i, title: titles[i], summaryPreview: '这篇文章的摘要预览用于展示列表行的两行摘要排版效果。', sourceTitle: '潮流周刊', publishedAt: 1758902400 + i * 86400, isRead: i === 4, isStarred: i === 1, contentHead: '' });
      lv.setViewMode('list');
      lv.render(Array.from({ length: 6 }, (_, i) => mk(i)), { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 350));
      const c = (i) => {
        const rc = document.querySelector('.entry-row[data-entry-id="r23-' + i + '"]').getBoundingClientRect();
        return { x: rc.x + 300, y: rc.y + rc.height / 2 };
      };
      return { rows: [c(0), c(1), c(2), c(3), c(4), c(5)] };
    })()`);
    if (!r || !r.rows) throw new Error('fixture failed');
    // ① Ctrl+点击第 2 行单选
    clickAt(r.rows[1].x, r.rows[1].y, ['control']);
    await sleep(350);
    // ② Shift+点击第 5 行 → 区间 1..4 共 4 篇
    clickAt(r.rows[4].x, r.rows[4].y, ['shift']);
    await sleep(450);
    await shot('r23-1-batch-selected.png');
    // ③ 悬停已选行（快捷操作条与选中态并存的样子）
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(r.rows[2].x), y: Math.round(r.rows[2].y) });
    await sleep(400);
    await shot('r23-2-batch-hover.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('SHOT-FAIL', e && e.stack || e);
    app.exit(1);
  }
});
