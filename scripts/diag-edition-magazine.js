'use strict';
/**
 * diag-edition-magazine.js — 期刊翻页阅读 2.0 探针（run-all OFFLINE 集）
 *
 * 真实 App 页面内构造 EditionReader（fixture 40 条），逐细节断言对标上游 PaperRss：
 *  P1 版面引擎：宽窗对开（paperW≥860→spread）、全部 placements 落在版心内、页高不为零
 *  P2 页眉/页码：er-head 标题 = 源名、页码 %02d
 *  P3 封面：开书前 .er-cover 可见、书脊叶 50% 宽、三层纸叠；开书后 sheets 显现、封面隐藏
 *  P4 折页：_go(1) 过程中 .er-leaf 可见 + book 带 er-turning-fwd + sheet-a 被 clip；
 *     落页后 index 前进、leaf 收起、clip 移除
 *  P5 滑轨：刻度数 = min(pages, floor(railW/7))、当前页刻度 .on、点击跳页
 *  P6 背封页：末页（ending 形态）出现 .er-backcover
 *  P7 窄窗淡入：600px 宽 relayout 后翻页无 .er-leaf（fade 形态）
 *  P8 纸声：Audio 源为 data:audio/wav;base64
 *  P9 排版确定性：同尺寸两次 relayout 页数一致
 * 退出码 0=PASS。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-edition-mag-'));
app.setPath('userData', userData);
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 120 * 1000).unref();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function ok(cond, label) {
  if (cond) console.log(`PASS ${label}`);
  else { failed += 1; console.error(`FAIL ${label}`); }
}

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false, width: 1600, height: 1000,
      webPreferences: {
        contextIsolation: true, backgroundThrottling: false,
        preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(600);
    const run = (js) => win.webContents.executeJavaScript(`(async () => { try { ${js} } catch (e) { return { __err: String(e && e.stack || e) }; } })()`);
    const res = await run(`
      const mod = await import('./views/edition-reader.js');
      // 正文数据经 fetchArticle 注入（contextBridge 不可覆写，依赖注入是官方通路）；
      // 外层套一层 div 包裹 + 混入 2:1 data-URI 图片，验证递归展平与图片比例占位
      const IMG21 = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="%2331506B"/></svg>');
      const ARTICLE_HTML = '<div class="wrap"><div>' + Array.from({ length: 48 }, (_, i) => '<h2>第' + (i + 1) + '节</h2><p>这是一段用于正文分页器装箱测试的较长段落，讲述了一年之间阅读介质从纸页到屏幕的四次更替，以及读的人在每一次更替里寻找同一种安静的尝试与反复。段落里混有中文标点、数字 2026 与英文词 reading，用于验证换行与行高。第' + (i + 1) + '段完。</p><p>补充段落：排版引擎按块级装箱推进，两叶一对开，页眉显示标题与页码，叶底自然收口。</p>').join('') + '<p><img src="' + IMG21 + '"></p></div></div>';
      const mk = (i) => ({
        id: 'fx-' + i,
        title: ['上海ToF工厂停产的三年', 'The Quiet Web: RSS 读者survey', '越王勾践剑的合金配比与铸造工艺', 'OpenClaw 2.0 是一个缩影',
          '为什么杂志排版在屏幕上依然成立', '神经语音的韵律边界', '第292期：系统的知识来源于对碎片整理', '田湖的孩子：一段乡村教育实录'][i % 8] + ' ' + (i + 1),
        summaryPreview: '这里是一段用于测量的摘要文本，长度足以占据两到三行版面空间，用来验证标题与摘要的字号分级和行距约束是否按上游规格收口。'.slice(0, 40 + (i % 5) * 12),
        sourceTitle: '潮流周刊',
        publishedAt: 1758902400 + i * 86400,
        isRead: i % 3 === 0, isStarred: i % 7 === 0,
        contentHead: i % 2 === 0 ? '<p><img src="https://example.com/img' + i + '.jpg"></p>' : '<p>无图</p>',
      });
      const items = Array.from({ length: 40 }, (_, i) => mk(i));
      const er = new mod.EditionReader({ items, startIndex: 0, reduceMotion: false, onOpen: (it) => { window.__erOpened = it.id; }, fetchArticle: async () => ARTICLE_HTML });
      er.present();
      await new Promise(r => setTimeout(r, 120));
      window.addEventListener('error', (ev) => { window.__errLast = String(ev.message || ev); });
      window.addEventListener('unhandledrejection', (ev) => { window.__errLast = 'rej:' + String(ev.reason); });
      const ov = document.querySelector('.er-overlay');
      if (!ov) return { __err: 'overlay missing' };
      const pages1 = er.pages.map(p => ({ form: p.form, n: p.placements.length, h: p.height, tpl: p.template }));
      // P1 版面引擎
      const spreadForms = pages1.filter(p => p.form === 'spread').length;
      const paperW = ov.querySelector('.er-book').style.width;
      const inBounds = er.pages.every(p => p.placements.every(pl => pl.x >= 0 && pl.y >= 0 && pl.x + pl.w <= p.paperW + 1 && pl.h > 0));
      // P2 页眉
      const headTitle = ov.querySelector('.er-cover-back .er-head-title')?.textContent || '';
      const headNo = ov.querySelector('.er-cover-back .er-head-no')?.textContent || '';
      // P3 封面
      const coverVisible = !ov.querySelector('.er-cover').hidden;
      const leafW = ov.querySelector('.er-cover-leaf').style.width;
      const stacks = ov.querySelectorAll('.er-cover-face .er-stack').length;
      const sheetsHidden = getComputedStyle(ov.querySelector('.er-sheet[data-role="a"]')).opacity === '0';
      // 开书（封面点击路径）
      ov.querySelector('.er-cover').click();
      await new Promise(r => setTimeout(r, 900));
      const coverGone = ov.querySelector('.er-cover').hidden;
      const sheetShown = getComputedStyle(ov.querySelector('.er-sheet[data-role="a"]')).opacity === '1';
      const storyCount = ov.querySelectorAll('.er-sheet[data-role="a"] .er-story').length;
      // P4 折页
      er._go(1);
      await new Promise(r => setTimeout(r, 60));
      const leafShown = !ov.querySelector('.er-leaf').hidden;
      const turningFwd = ov.querySelector('.er-book').classList.contains('er-turning-fwd');
      const clipped = ov.querySelector('.er-sheet[data-role="a"]').classList.contains('clip-left');
      await new Promise(r => setTimeout(r, 1100));
      const settled = er.index === 1 && ov.querySelector('.er-leaf').hidden;
      const clipGone = !ov.querySelector('.er-sheet[data-role="a"]').classList.contains('clip-left');
      // P5 滑轨
      const tickCount = ov.querySelectorAll('.er-tick').length;
      const railW = ov.querySelector('.er-ticks').style.width;
      const expectTicks = Math.min(er.pages.length, Math.max(2, Math.floor(parseInt(railW) / 7)));
      const onTick = !!ov.querySelector('.er-tick.on[data-index="1"]');
      // P6 背封页
      er._go(er.pages.length - 1);
      await new Promise(r => setTimeout(r, 1300));
      const backcover = !!ov.querySelector('.er-sheet[data-role="a"] .er-backcover');
      const pageNo = ov.querySelector('.er-sheet[data-role="a"] .er-head-no')?.textContent;
      // P8 纸声
      const soundOk = /^data:audio\\/wav;base64,/.test(er._sound.src || '');
      // P9 确定性
      const countBefore = er.pages.length;
      er._relayout(false);
      const countAfter = er.pages.length;
      // P7 窄窗淡入
      window.resizeTo(600, 800);
      await new Promise(r => setTimeout(r, 500));
      const narrowForm = er.pages.every(p => p.form !== 'spread');
      er._go(er.pages.length > 2 ? 1 : 0);
      await new Promise(r => setTimeout(r, 120));
      const fadeNoLeaf = ov.querySelector('.er-leaf').hidden;
      const bFadein = ov.querySelector('.er-sheet[data-role="b"]').classList.contains('er-fadein');
      await new Promise(r => setTimeout(r, 700));
      // 还原宽窗再测文章模式
      window.resizeTo(1600, 1000);
      await new Promise(r => setTimeout(r, 600));
      // P10 文章模式：点击稿件卡 → 正文分页为对开书页
      const editionIndexBefore = er.index;
      const firstCard = ov.querySelector('.er-sheet[data-role="a"] .er-place');
      firstCard.click();
      await new Promise(r => setTimeout(r, 400));
      const artMode = er.mode === 'article';
      const artPages = er.pages.length;
      const artFirstIsArticle = er.pages[0] && er.pages[0].template === 'article';
      const artHeadBack = !!ov.querySelector('.er-sheet[data-role="a"] .er-head-back');
      const artTitleInHead = (ov.querySelector('.er-sheet[data-role="a"] .er-head-title') || {}).textContent || '';
      const artHeadHTML = (ov.querySelector('.er-sheet[data-role="a"] .er-head') || {}).outerHTML?.slice(0, 240) || 'NO-HEAD';
      const artSpread = er.pages.every(p => p.form === 'spread');
      // 正文内翻页
      er._go(1);
      await new Promise(r => setTimeout(r, 900));
      const artPage2 = er.index === 1;
      // Esc 返回版面且恢复落点
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      const backEdition = er.mode === 'edition' && er.index === editionIndexBefore;
      // P11 多显示器/窗口尺寸动态自适应：书页宽随窗口重排（page 端 resizeTo 间歇失效，改由主进程 setSize）
      const bookW1 = parseInt(ov.querySelector('.er-book').style.width);
      // P12 文章图片：递归展平后 2:1 图片占位高 = colW×0.5（clamp 后 110–400 区间）；块数据断言不依赖在屏
      er._openArticle(er.items[1] || er.items[0]).catch(() => {});
      await new Promise(r => setTimeout(r, 2600));
      const artImgH = (() => {
        for (const p of er.pages) {
          if (!p.article) continue;
          for (const b of [...(p.article.left || []), ...(p.article.right || [])]) {
            if (b.el.className === 'er-article-img') return Math.round(b.h);
          }
        }
        return -1;
      })();
      const artFlatten = er.pages.length > 1; // 单容器包裹的正文被完整展开为多页
      const stackCount = document.querySelectorAll('.er-cover-face .er-stack').length;
      const coverHiddenAttr = ov.querySelector('.er-cover').hidden;
      const sheetOpacity = getComputedStyle(ov.querySelector('.er-sheet[data-role="a"]')).opacity;
      er._closeArticle();
      await new Promise(r => setTimeout(r, 200));
      return { pages1, spreadForms, paperW, inBounds, headTitle, headNo, coverVisible, leafW, stacks, sheetsHidden,
        coverGone, sheetShown, storyCount, leafShown, turningFwd, clipped, settled, clipGone, tickCount, expectTicks,
        onTick, backcover, pageNo, soundOk, countBefore, countAfter, narrowForm, fadeNoLeaf, bFadein,
        artMode, artPages, artFirstIsArticle, artHeadBack, artTitleInHead, artSpread, artPage2, backEdition, artImgH, artFlatten,
        forms: pages1.map(p => p.form + ':' + p.tpl + ':' + p.n).join(','),
        stackCount,
        coverHiddenAttr,
        sheetOpacity,
        pageCount: er.pages.length, opened: window.__erOpened || null };
    `);
    if (res.__err) throw new Error(res.__err);
    console.log(`INFO p11=${[res.innerW1, res.bookW1, res.bookW2, res.artImgH].join('/')}`);
    console.log(`INFO forms=${res.forms} stack=${res.stackCount} coverHidden=${res.coverHiddenAttr} sheetOpacity=${res.sheetOpacity}`);
    ok(res.spreadForms === res.pages1.length && res.pages1.length > 1, `P1 对开形态：${res.spreadForms}/${res.pages1.length} 页全部 spread（paperW=${res.paperW}）`);
    ok(res.inBounds, 'P1 全部 placements 落在版心内且高度>0');
    ok(res.headTitle === '潮流周刊' && res.headNo === '01', `P2 页眉「${res.headTitle}」+ 页码「${res.headNo}」`);
    ok(res.coverVisible && res.stacks === 3 && res.sheetsHidden, 'P3 封面可见 + 三层纸叠 + sheets 隐藏');
    ok(parseInt(res.leafW) === parseInt(res.paperW) / 2, `P3 封面叶宽 = 半纸宽（${res.leafW} / ${res.paperW}）`);
    ok(res.coverGone && res.sheetShown && res.storyCount > 0, `P3 开书后封面隐藏、纸页显现（${res.storyCount} 张稿件卡）`);
    ok(res.leafShown && res.turningFwd && res.clipped, 'P4 折页：翻页叶展开 + fwd 方向 + 当前页 clip');
    ok(res.settled && res.clipGone, 'P4 落页：index 前进、翻页叶收起、clip 移除');
    ok(res.tickCount === res.expectTicks, `P5 滑轨刻度 ${res.tickCount} = min(页数, railW/7)=${res.expectTicks}`);
    ok(res.onTick, 'P5 当前页刻度高亮');
    ok(res.backcover || res.pageNo === String(res.pageCount).padStart(2, '0'), `P6 末页背封页/页码（${res.pageNo}，backcover=${res.backcover}）`);
    ok(res.soundOk, 'P8 纸声 data:audio/wav 内联');
    ok(res.countBefore === res.countAfter, `P9 排版确定性：两次 relayout 页数一致（${res.countAfter}）`);
    ok(res.narrowForm && res.fadeNoLeaf && res.bFadein, 'P7 窄窗 600px：非对开 + 淡入翻页（无折页叶）');
    ok(res.artMode && res.artPages > 1 && res.artFirstIsArticle, `P10 文章模式：点击卡片进入正文翻页（${res.artPages} 页，首页 article 模板）`);
    ok(res.artHeadBack && res.artTitleInHead, `P10 文章页眉：返回按钮 + 标题「${(res.artTitleInHead || '').slice(0, 18)}」`);
    ok(res.artSpread, 'P10 正文页全部对开形态');
    ok(res.artPage2, 'P10 正文内折页翻页正常');
    ok(res.backEdition, 'P10 Esc 返回版面且落点恢复');
    // P11 窗口尺寸自适应（主进程侧 setSize 两档，书页宽必须跟随重排）
    const w1 = 1050, w2 = 1900;
    await win.setSize(w1, 900);
    await sleep(600);
    const bw1 = await win.webContents.executeJavaScript(`parseInt(document.querySelector('.er-book').style.width)`);
    const inner1 = await win.webContents.executeJavaScript(`window.innerWidth`);
    await win.setSize(w2, 1100);
    await sleep(600);
    const bw2 = await win.webContents.executeJavaScript(`parseInt(document.querySelector('.er-book').style.width)`);
    const innerNow = await win.webContents.executeJavaScript(`window.innerWidth`);
    const expect1 = Math.min(1480, inner1 - 48), expect2 = Math.min(1480, innerNow - 48);
    ok(bw1 === expect1 && bw2 === expect2, `P11 窗口自适应：${w1}px→${bw1}px / ${w2}px→${bw2}px（期望 ${expect1}/${expect2}，inner=${inner1}/${innerNow}）`);
    ok(res.artFlatten, 'P12 嵌套容器正文完整展平（多页）');
    ok(res.artImgH >= 110 && res.artImgH <= 400, `P12 图片比例占位 ${res.artImgH}px（2:1 图 → colW×0.5 带 clamp）`);
    // P13 纸张三态循环：重新打开阅读器，右上按钮连点三轮必须走满 paper→white→book→paper 且持久化
    await win.webContents.executeJavaScript(`window.__paperEr = { open: async () => {
      const mod = await import('./views/edition-reader.js');
      const er = new mod.EditionReader({ items: window.__paperItems || [{ id: 'p1', title: '纸态', sourceTitle: 'S', publishedAt: 1758902400, contentHead: '' }], fetchArticle: async () => '<p>x</p>' });
      if (!window.__paperItems) window.__paperItems = [{ id: 'p1', title: '纸态', sourceTitle: 'S', publishedAt: 1758902400, contentHead: '' }];
      er.present();
      clearTimeout(er._autoTimer);
      return true;
    } }; true;`);
    await win.webContents.executeJavaScript(`window.__paperEr.open()`);
    await sleep(300);
    const paperSeq = await win.webContents.executeJavaScript(`(async () => {
      const seq = [];
      const btn = document.querySelector('.er-paper');
      const ov = document.querySelector('.er-overlay');
      if (!btn || !ov) return seq;
      seq.push(ov.dataset.paper);
      for (let i = 0; i < 3; i++) { btn.click(); await new Promise(r => setTimeout(r, 30)); seq.push(ov.dataset.paper); }
      return seq;
    })()`);
    const paperStored = await win.webContents.executeJavaScript(`localStorage.getItem('robinread.magPaper')`);
    ok(JSON.stringify(paperSeq) === JSON.stringify(['paper', 'white', 'book', 'paper']) && paperStored === 'paper', `P13 纸张三态循环 ${JSON.stringify(paperSeq)} + 持久化=${paperStored}`);
    await win.webContents.executeJavaScript(`(document.querySelector('.er-overlay').__editionReader || {}).dismiss?.(); localStorage.setItem('robinread.magPaper', 'paper'); 1`);
    try {
      await win.webContents.executeJavaScript(`(document.querySelector('.er-overlay').__editionReader || {}).dismiss?.(); 1`);
    } catch (e) { console.error('DISMISS ERR', String(e && e.message || e)); }
    win.destroy();
    if (failed) { console.error(`${failed} 项失败`); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (error) {
    console.error('FAIL', error?.message || error);
    app.exit(1);
  }
});
