'use strict';
/** R1 阅读排版面板可视化验收截图：封面 / 头条对开+面板（标准态）/ 舒朗+宽页边+首字下沉 / 沉浸定稿 → .tmp-shots/r1-*.png */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r1-shot-'));
app.setPath('userData', userData);
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 180 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const win = new BrowserWindow({
      show: false, width: 1600, height: 1000,
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
      const mod = await import('./views/edition-reader.js');
      localStorage.removeItem('robinread.editionTypography');
      const PALETTES = [
        ['#C9BFA8', '#8F8368'], ['#A8B2B9', '#5F6B73'], ['#C4A98E', '#7D6650'],
        ['#9FAF9A', '#5F6F58'], ['#BBA7B4', '#6E5A6B'], ['#B9A28C', '#6F5A46'],
      ];
      const svgImg = (i) => {
        const p = PALETTES[i % PALETTES.length];
        const kind = i % 3;
        const base = "<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='__A__'/><stop offset='1' stop-color='__B__'/></linearGradient></defs><rect width='800' height='600' fill='url(#g)'/>__EXTRA__</svg>".replace('__A__', p[0]).replace('__B__', p[1]);
        const extras = [
          "<circle cx='610' cy='160' r='95' fill='rgba(255,253,246,0.34)'/><circle cx='610' cy='160' r='58' fill='rgba(255,253,246,0.22)'/><path d='M0 470 L190 330 L340 470 L520 300 L800 520 L800 600 L0 600 Z' fill='rgba(32,28,22,0.30)'/><path d='M0 520 L260 400 L470 540 L800 420 L800 600 L0 600 Z' fill='rgba(32,28,22,0.44)'/>",
          "<rect x='90' y='90' width='270' height='270' fill='rgba(255,253,246,0.30)'/><rect x='150' y='150' width='270' height='270' fill='rgba(32,28,22,0.18)'/><circle cx='600' cy='420' r='120' fill='rgba(255,253,246,0.26)'/><rect x='90' y='520' width='620' height='6' fill='rgba(255,253,246,0.5)'/>",
          "<rect x='70' y='80' width='660' height='16' fill='rgba(255,253,246,0.55)'/><rect x='70' y='120' width='520' height='12' fill='rgba(255,253,246,0.4)'/><rect x='70' y='150' width='600' height='12' fill='rgba(255,253,246,0.34)'/><circle cx='620' cy='400' r='130' fill='rgba(255,253,246,0.3)'/><rect x='70' y='330' width='380' height='10' fill='rgba(32,28,22,0.26)'/><rect x='70' y='360' width='330' height='10' fill='rgba(32,28,22,0.2)'/><rect x='70' y='390' width='360' height='10' fill='rgba(32,28,22,0.16)'/>",
        ];
        // encodeURIComponent 不编码单引号，会截断 _firstImage 的 src 提取，需显式转义
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(base.replace('__EXTRA__', extras[kind])).replace(/'/g, '%27');
      };
      const TITLES = ['上海ToF工厂停产的三年', 'The Quiet Web：RSS 读者的安静回归', '越王勾践剑的合金配比与铸造工艺', 'OpenClaw 2.0 是一个缩影',
        '为什么杂志排版在屏幕上依然成立', '神经语音的韵律边界', '系统的知识来源于对碎片的整理', '田湖的孩子：一段乡村教育实录',
        '长时间暴露于蓝光下的睡眠研究综述', '一座县城书店的第十二次搬迁', '深海光缆：互联网的隐形脊梁', '手冲咖啡的萃取参数决策树',
        '从纸质月票到交通卡的三十年', '极简主义者的工具箱清单', '城市步行道的十个细节', '译名之争：如何称呼一颗新行星'];
      const SUMS = [
        '纸感阅读的关键不在于仿旧，而在于把注意力还给文字本身：版心、行距、页边与留白共同构成节奏，让长文在屏幕上也保有翻阅的呼吸感，中英混排 Mixed English 与数字 2026 亦不例外。',
        '我们访谈了十二位仍在坚持深度阅读的人，他们的共同点并非时间充裕，而是各自建立了一套对抗碎片化的仪式——有人固定在清晨，有人依赖纸质笔记，有人干脆关掉所有通知。',
        '这项工艺的复兴始于一次偶然的考古发现：配比数据藏在一份残损的手稿里，现代冶金设备花了三个月才复现出接近原品的延展性，而真正的难点在于火候的手感。',
        '如果把阅读器看作一间书房，那么书架的秩序感决定了停留时长：封面是门面，目录是走廊，正文是房间，而页码与页眉，则是每个房间门口那盏不高不低的灯。',
      ];
      const CN = ['一', '二', '三'];
      const mk = (i) => ({
        id: 'fx-' + i,
        title: i < 16 ? TITLES[i] : TITLES[i % 16] + '（' + CN[Math.floor((i - 16) / 16)] + '）',
        summaryPreview: SUMS[i % 4].slice(0, 62 + (i % 5) * 14),
        sourceTitle: '潮流周刊',
        publishedAt: 1758902400 + i * 86400,
        isRead: i % 3 === 0, isStarred: i % 7 === 0,
        readMinutes: 3 + (i % 9),
        contentHead: '<p><img src="' + svgImg(i) + '"></p>',
      });
      const items = Array.from({ length: 40 }, (_, i) => mk(i));
      const er = new mod.EditionReader({ items, startIndex: 0, reduceMotion: false, onOpen: () => {}, fetchArticle: async () => '' });
      er.present();
      window.__er = er;
      await new Promise(r => setTimeout(r, 1600));
      return 'ok';
    })()`);
    await shot('r1-1-cover.png');
    // 定位首个 feature（头条）模板页并翻到它，确认存在带头条卡
    const feat = await win.webContents.executeJavaScript(`(async () => {
      const er = window.__er;
      const t = er.pages.findIndex(p => p.template === 'feature');
      const idx = t >= 0 ? t : 1;
      er._go(idx);
      await new Promise(r => setTimeout(r, 1600));
      const ov = document.querySelector('.er-overlay');
      return { idx, template: er.pages[idx].template, hasLead: !!ov.querySelector('.er-story.r-lead'), hasSum: !!ov.querySelector('.er-story.r-lead .er-sum'),
        imgOk: ov.querySelectorAll('.er-img img.ok').length, imgAll: ov.querySelectorAll('.er-img img').length };
    })()`);
    console.log('feature-page ' + JSON.stringify(feat));
    await sleep(300);
    // 点 Aa 打开排版面板（默认标准态），点击后验证面板真实存在
    const panelOn = await win.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 3; i++) {
        if (!document.querySelector('.er-type-panel')) document.querySelector('.er-type').click();
        await new Promise(r => setTimeout(r, 450));
        if (document.querySelector('.er-type-panel')) return true;
      }
      return false;
    })()`);
    console.log('panel-on ' + panelOn);
    await sleep(700); // 等面板淡入动画（0.18s）完全结束后再截，避免半透明叠印帧
    await shot('r1-2-panel-standard.png');
    // 面板内实点：舒朗 + 宽页边 + 首字下沉；等重排后验证头条首字与行距已变
    const applied = await win.webContents.executeJavaScript(`(async () => {
      document.querySelector('.er-type-panel [data-key="density"][data-val="airy"]').click();
      document.querySelector('.er-type-panel [data-key="margin"][data-val="wide"]').click();
      document.querySelector('.er-type-panel [data-key="firstCap"][data-val="on"]').click();
      await new Promise(r => setTimeout(r, 1600));
      const ov = document.querySelector('.er-overlay');
      const cap = ov.querySelector('.er-story.r-lead .er-sum .er-cap');
      return { density: ov.dataset.density, margin: ov.dataset.margin, hasCap: !!cap,
        capFont: cap ? getComputedStyle(cap).fontSize : '' };
    })()`);
    console.log('applied ' + JSON.stringify(applied));
    await sleep(300);
    await shot('r1-3-panel-airy-wide.png');
    // 关面板，沉浸定稿态
    await win.webContents.executeJavaScript(`(async () => { document.querySelector('.er-type').click(); await new Promise(r => setTimeout(r, 500)); return !document.querySelector('.er-type-panel'); })()`);
    await sleep(400);
    await shot('r1-4-immersive.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('SHOT-FAIL', e && e.stack || e);
    app.exit(1);
  }
});
