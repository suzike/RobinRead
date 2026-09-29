'use strict';
/** R24 验收截图：排版面板字号行 + 命令面板三组（期刊/全局/来源，去冒号新命名）→ .tmp-shots/r24-*.png */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r24-shot-'));
app.setPath('userData', userData);
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 180 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const win = new BrowserWindow({
      show: true, width: 1600, height: 1000,
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
    // ① 排版面板：五行（行距密度/字号/页边距/栏宽/首字下沉）
    await win.webContents.executeJavaScript(`(async () => {
      const mod = await import('./views/edition-reader.js');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i + '：排版面板与命令面板', summaryPreview: '摘要文本用于排版面板截图：字号三档与三组命令一并验收。', sourceTitle: '潮流周刊', publishedAt: 1758902400 + i * 86400, isRead: i % 3 === 0, readMinutes: 4, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 12 }, (_, i) => mk(i)), startIndex: 0, reduceMotion: false, onOpen: () => {}, fetchArticle: async () => '' });
      window.__er = er;
      er.present();
      await new Promise(r => setTimeout(r, 1500));
      er._toggleTypePanel(document.querySelector('.er-type'));
      await new Promise(r => setTimeout(r, 500));
      return { rows: document.querySelectorAll('.er-type-row').length };
    })()`);
    await sleep(300);
    await shot('r24-1-type-panel-fontsize.png');
    // ② 命令面板：期刊 → 全局 → 来源 三组，去冒号新命名
    await win.webContents.executeJavaScript(`(async () => {
      document.querySelector('.er-type-panel')?.remove();
      const { CommandPalette } = await import('./views/command-palette.js');
      const edition = window.__er.paletteCommands();
      const global = [
        { group: '全局', label: '今天', keywords: 'today 今日 open', icon: 'sun', hint: '1', action: () => {} },
        { group: '全局', label: '未读', keywords: 'unread 未读 open', icon: 'envelopeClosed', hint: '2', action: () => {} },
        { group: '全局', label: '收藏', keywords: 'starred 收藏 star open', icon: 'star', action: () => {} },
        { group: '全局', label: '稍后读', keywords: 'later 稍后读 open', icon: 'clock', action: () => {} },
        { group: '全局', label: '切换杂志 / 列表视图', keywords: 'magazine list 杂志 列表', icon: 'newspaper', action: () => {} },
        { group: '全局', label: '切换浅色 / 深色主题', keywords: 'theme 主题 深色', icon: 'appearance', action: () => {} },
        { group: '全局', label: '知更纸刊（默认）', keywords: 'preset 版式 预设', icon: 'bookOpen', action: () => {} },
        { group: '全局', label: '新闻晚报', keywords: 'preset 版式 报纸', icon: 'newspaper', action: () => {} },
        { group: '全局', label: '设置', keywords: 'settings 设置 open', icon: 'gear', action: () => {} },
        { group: '全局', label: '刷新全部订阅', keywords: 'refresh 刷新 订阅', icon: 'refresh', action: () => {} },
      ];
      const sources = [
        { group: '来源', label: '潮流周刊', keywords: 'feed 来源 潮流周刊', icon: 'globe', action: () => {} },
        { group: '来源', label: '阮一峰的网络日志', keywords: 'feed 来源 阮一峰', icon: 'globe', action: () => {} },
        { group: '来源', label: '少数派', keywords: 'feed 来源 少数派', icon: 'globe', action: () => {} },
      ];
      const palette = new CommandPalette();
      palette.present([...edition, ...global, ...sources]);
      await new Promise(r => setTimeout(r, 600));
      const heads = [...document.querySelectorAll('.cmd-group-head')].map((h) => h.textContent).join(',');
      return { heads };
    })()`);
    await sleep(300);
    await shot('r24-2-palette-three-groups.png');
    // ③ 面板下滚到底：露出「全局」组头裸名命令与「来源」组头裸源名
    await win.webContents.executeJavaScript(`(async () => {
      const list = document.querySelector('.cmd-palette-list');
      if (list) list.scrollTop = list.scrollHeight;
      await new Promise(r => setTimeout(r, 300));
      const heads = [...document.querySelectorAll('.cmd-group-head')].map((h) => h.textContent).join(',');
      return { heads, at: list ? Math.round(list.scrollTop) : -1 };
    })()`);
    await sleep(300);
    await shot('r24-3-palette-scrolled.png');
    // ④ 滚到「全局」组头置顶：露出 全局组头 + 今天/未读/收藏/稍后读/切换杂志 / 列表视图
    await win.webContents.executeJavaScript(`(async () => {
      const heads = [...document.querySelectorAll('.cmd-group-head')];
      const g = heads.find((h) => h.textContent === '全局');
      if (g) g.scrollIntoView({ block: 'start' });
      await new Promise(r => setTimeout(r, 300));
      return { heads: heads.map((h) => h.textContent).join(','), firstVisible: g?.textContent || 'none' };
    })()`);
    await sleep(300);
    await shot('r24-4-palette-global-head.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('SHOT-FAIL', e && e.stack || e);
    app.exit(1);
  }
});
