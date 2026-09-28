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
      // 正文数据经 fetchArticle 注入（contextBridge 不可覆写，依赖注入是官方通路）
      const ARTICLE_HTML = Array.from({ length: 48 }, (_, i) => '<h2>第' + (i + 1) + '节</h2><p>这是一段用于正文分页器装箱测试的较长段落，讲述了一年之间阅读介质从纸页到屏幕的四次更替，以及读的人在每一次更替里寻找同一种安静的尝试与反复。段落里混有中文标点、数字 2026 与英文词 reading，用于验证换行与行高。第' + (i + 1) + '段完。</p><p>补充段落：排版引擎按块级装箱推进，两叶一对开，页眉显示标题与页码，叶底自然收口。</p>').join('');
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
      const folioL = ov.querySelector('.er-cover-back .er-folio.l')?.textContent || '';
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
      const pageNo = ov.querySelector('.er-sheet[data-role="a"] .er-folio.r')?.textContent;
      // P8 纸声
      const soundOk = /^data:audio\\/wav;base64,/.test(er._sound.src || '');
      // P9 确定性
      const countBefore = er.pages.length;
      er._relayout(false);
      const countAfter = er.pages.length;
      // P7 窄窗淡入（轮询等待 relayout，负载下 resize 事件可能晚到）
      window.resizeTo(600, 800);
      let narrowForm = false;
      for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 250)); narrowForm = er.pages.length > 0 && er.pages.every(p => p.form !== 'spread'); if (narrowForm) break; }
      er._go(er.pages.length > 2 ? 1 : 0);
      await new Promise(r => setTimeout(r, 120));
      const fadeNoLeaf = ov.querySelector('.er-leaf').hidden;
      const bFadein = ov.querySelector('.er-sheet[data-role="b"]').classList.contains('er-fadein');
      await new Promise(r => setTimeout(r, 700));
      // 还原宽窗再测文章模式（同样轮询等回对开）
      window.resizeTo(1600, 1000);
      for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 250)); if (er.pages.every(p => p.form === 'spread')) break; }
      await new Promise(r => setTimeout(r, 200));
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
      const artSpread = er.pages.every(p => p.form === 'spread');
      // 正文内翻页（轮询等待落页，重负载下动画+settle 可能显著超过常规时长）
      er._go(1);
      let artPage2 = false;
      for (let i = 0; i < 30 && !artPage2; i++) { await new Promise(r => setTimeout(r, 200)); artPage2 = er.index === 1; }
      // Esc 返回版面且恢复落点
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      const backEdition = er.mode === 'edition' && er.index === editionIndexBefore;
      er.dismiss();
      return { pages1, spreadForms, paperW, inBounds, headTitle, folioL, coverVisible, leafW, stacks, sheetsHidden,
        coverGone, sheetShown, storyCount, leafShown, turningFwd, clipped, settled, clipGone, tickCount, expectTicks,
        onTick, backcover, pageNo, soundOk, countBefore, countAfter, narrowForm, fadeNoLeaf, bFadein,
        artMode, artPages, artFirstIsArticle, artHeadBack, artTitleInHead, artSpread, artPage2, backEdition,
        forms: pages1.map(p => p.form + ':' + p.tpl + ':' + p.n).join(','),
        stackCount: document.querySelectorAll('.er-cover-face .er-stack').length,
        coverHiddenAttr: ov.querySelector('.er-cover').hidden,
        sheetOpacity: getComputedStyle(ov.querySelector('.er-sheet[data-role="a"]')).opacity,
        pageCount: er.pages.length, opened: window.__erOpened || null };
    `);
    if (res.__err) throw new Error(res.__err);
    console.log(`INFO forms=${res.forms} stack=${res.stackCount} coverHidden=${res.coverHiddenAttr} sheetOpacity=${res.sheetOpacity}`);
    ok(res.spreadForms === res.pages1.length && res.pages1.length > 1, `P1 对开形态：${res.spreadForms}/${res.pages1.length} 页全部 spread（paperW=${res.paperW}）`);
    ok(res.inBounds, 'P1 全部 placements 落在版心内且高度>0');
    ok(res.headTitle === '潮流周刊' && res.folioL === '01', `P2 页眉「${res.headTitle}」+ 左叶页码「${res.folioL}」`);
    ok(res.coverVisible && res.stacks === 3 && res.sheetsHidden, 'P3 封面可见 + 三层纸叠 + sheets 隐藏');
    ok(Math.abs(parseFloat(res.leafW) - parseFloat(res.paperW) / 2) <= 1, `P3 封面叶宽 = 半纸宽（${res.leafW} / ${res.paperW}）`);
    ok(res.coverGone && res.sheetShown && res.storyCount > 0, `P3 开书后封面隐藏、纸页显现（${res.storyCount} 张稿件卡）`);
    ok(res.leafShown && res.turningFwd && res.clipped, 'P4 折页：翻页叶展开 + fwd 方向 + 当前页 clip');
    ok(res.settled && res.clipGone, 'P4 落页：index 前进、翻页叶收起、clip 移除');
    ok(res.tickCount === res.expectTicks, `P5 滑轨刻度 ${res.tickCount} = min(页数, railW/7)=${res.expectTicks}`);
    ok(res.onTick, 'P5 当前页刻度高亮');
    ok(res.backcover || res.pageNo === String(res.pageCount * 2).padStart(2, '0'), `P6 末页背封页/右叶页码（${res.pageNo}，backcover=${res.backcover}）`);
    ok(res.soundOk, 'P8 纸声 data:audio/wav 内联');
    ok(res.countBefore === res.countAfter, `P9 排版确定性：两次 relayout 页数一致（${res.countAfter}）`);
    ok(res.narrowForm && res.fadeNoLeaf && res.bFadein, 'P7 窄窗 600px：非对开 + 淡入翻页（无折页叶）');
    ok(res.artMode && res.artPages > 1 && res.artFirstIsArticle, `P10 文章模式：点击卡片进入正文翻页（${res.artPages} 页，首页 article 模板）`);
    ok(res.artHeadBack && res.artTitleInHead, `P10 文章页眉：返回按钮 + 标题「${(res.artTitleInHead || '').slice(0, 18)}」`);
    ok(res.artSpread, 'P10 正文页全部对开形态');
    ok(res.artPage2, 'P10 正文内折页翻页正常');
    ok(res.backEdition, 'P10 Esc 返回版面且落点恢复');
    win.destroy();
    if (failed) { console.error(`${failed} 项失败`); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (error) {
    console.error('FAIL', error?.message || error);
    app.exit(1);
  }
});
