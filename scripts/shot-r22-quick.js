'use strict';
/** R22 行内快捷操作验收截图：列表行 hover 浮现三连 → .tmp-shots/r22-*.png（真窗口真鼠标） */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r22-shot-'));
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
    const hover = (x, y) => win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) });
    const click = (x, y) => {
      win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
    };

    // 布景：满窗列表（杂志刊头关闭 → scope 用 unread 视野无刊头），行带收藏/稍后读混合态
    const r = await win.webContents.executeJavaScript(`(async () => {
      const { ListView } = await import('./views/list.js');
      document.getElementById('app') && (document.getElementById('app').style.display = 'none');
      const host = document.createElement('div');
      host.className = 'list-scroll';
      host.style.cssText = 'position:fixed;inset:0;z-index:9999;background:var(--bg,#faf8f2);';
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
      const mk = (i, over = {}) => ({ id: 'r22-' + i, title: titles[i], summaryPreview: '这篇文章的摘要预览用于展示列表行的两行摘要排版效果，滚轮向下翻阅可以看到更多条目。', sourceTitle: '潮流周刊', publishedAt: 1758902400 + i * 86400, isRead: i === 4, isStarred: i === 2, isLater: i === 2, contentHead: '', ...over });
      lv.setViewMode('list');
      lv.render(Array.from({ length: 6 }, (_, i) => mk(i)), { kind: 'unread' }, null, true);
      await new Promise(r => setTimeout(r, 350));
      const row2 = document.querySelector('.entry-row[data-entry-id="r22-1"]');
      const starBtn = row2.querySelector('.q-star');
      const rect = starBtn.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, w: window.innerWidth, h: window.innerHeight };
    })()`);
    if (!r || !r.w) throw new Error('fixture failed: ' + JSON.stringify(r));
    // ① 悬停普通行：浮现三连（真 hover）
    hover(r.x, r.y);
    await sleep(450);
    await shot('r22-1-list-hover.png');
    // ② 悬停「收藏+稍后读」行：星星/时钟常亮态
    const r2 = await win.webContents.executeJavaScript(`(() => {
      const el = document.querySelector('.entry-row[data-entry-id="r22-2"] .q-star');
      const rc = el.getBoundingClientRect();
      return { x: rc.x + rc.width / 2, y: rc.y + rc.height / 2 };
    })()`);
    hover(r2.x, r2.y);
    await sleep(450);
    await shot('r22-2-list-hover-active.png');
    // ③ 真点击收藏键（右侧第二行），观察状态回流（无主进程 handler 时静默，仅记录浮条可见）
    click(r.x, r.y);
    await sleep(200);
    hover(r.x, r.y);
    await sleep(300);
    // ④ 杂志卡：hover 封面浮现浮条
    await win.webContents.executeJavaScript(`(async () => {
      const titles = ['端侧大模型的功耗拐点：一部手机的推理实录', '再见，RSS 阅读器的「已读焦虑」', '城市夜班公交观察记', '手工面包店的发酵时间表', '山脊线上的气象站', '旧书市集淘书指南'];
      const mk = (i) => ({ id: 'r22m-' + i, title: titles[i], summaryPreview: '摘要预览', sourceTitle: '潮流周刊', publishedAt: 1758902400 + i * 86400, isRead: i === 4, isStarred: i === 2, isLater: i === 2, contentHead: '' });
      window.__lv.setViewMode('magazine');
      window.__lv.render(Array.from({ length: 6 }, (_, i) => mk(i)), { kind: 'unread' }, null, true);
      await new Promise(r => setTimeout(r, 400));
    })()`);
    const r3 = await win.webContents.executeJavaScript(`(() => {
      const el = document.querySelector('.nj-mag-card[data-entry-id="r22m-1"]');
      const rc = el.getBoundingClientRect();
      return { x: rc.x + rc.width / 2, y: rc.y + rc.height / 3 };
    })()`);
    hover(r3.x, r3.y);
    await sleep(450);
    await shot('r22-3-mag-hover.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('SHOT-FAIL', e && e.stack || e);
    app.exit(1);
  }
});
