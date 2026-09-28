'use strict';
/** R3 划词工具条验收截图：文章划选胶囊 / AI 解释弹层（stub 返回）/ 版面卡划选 → .tmp-shots/r3-*.png */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, ipcMain, clipboard } = require('electron');

const OUT = path.join(__dirname, '..', '.tmp-shots');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r3-shot-'));
app.setPath('userData', userData);
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 180 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    ipcMain.handle('app:copyText', (_e, text) => { clipboard.writeText(String(text ?? '')); return true; });
    ipcMain.handle('ai:explain', () => ({
      ok: true,
      data: '「纸感阅读」指以纸张的物理质感为参照来组织屏幕阅读界面：暖色纸底、衬线正字、对称页边与克制的装饰，让长时间阅读的疲劳感接近纸书。\n\n这一段落的要点：\n· 版心与页边距决定「呼吸感」，左右对称是纸书的基本秩序；\n· 行距是节奏的主要来源，密排适合检索、疏排适合沉浸；\n· 首字下沉源自中世纪抄本，用于标记章节起点，现在更多是审美符号。',
    }));
    ipcMain.handle('ai:translateSelection', () => ({
      ok: true,
      data: 'Paper-feel reading is not about imitating old paper: warm paper tones, serif body text, symmetric margins and restrained decoration bring the fatigue of long sessions close to reading a real book.',
    }));
    // 真窗口截图：隐藏窗合成器不绘制胶囊/弹层这一层级（R1/R2 元素不受影响的离屏怪癖）
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
      win.webContents.invalidate(); // 隐藏窗合成器可能不重绘新增 fixed 层，强制全帧重绘
      await sleep(150);
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(OUT, name), img.toPNG());
      console.log(`shot ${name}`);
    };
    await win.webContents.executeJavaScript(`(async () => {
      const mod = await import('./views/edition-reader.js');
      const ARTICLE = Array.from({ length: 8 }, (_, i) => '<h2>第' + (i + 1) + '节</h2><p>纸感阅读的关键不在于仿旧，而在于把注意力还给文字本身：版心、行距、页边与留白共同构成节奏，让长文在屏幕上也保有翻阅的呼吸感。第' + (i + 1) + '节继续展开这一观点，混排 Mixed English 与数字 2026 亦不例外，安静是最重要的排版变量。</p>').join('');
      const mk = (i) => ({ id: 'fx-' + i, title: '条目 ' + i, summaryPreview: '摘要文本用于卡片划词验证，长度足以占据两行版面空间，用来验证胶囊定位。' + i, sourceTitle: '潮流周刊', publishedAt: 1758902400 - i * 86400, contentHead: '' });
      const er = new mod.EditionReader({ items: Array.from({ length: 28 }, (_, i) => mk(i)), fetchArticle: async () => ARTICLE });
      window.__er = er;
      er.present();
      clearTimeout(er._autoTimer);
      er._doOpen();
      await new Promise(r => setTimeout(r, 900));
      await er._openArticle(er.items[0]);
      await new Promise(r => setTimeout(r, 900));
      const p = document.querySelector('.er-article p');
      const range = document.createRange();
      range.setStart(p.firstChild, 0);
      range.setEnd(p.firstChild, 26);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      await new Promise(r => setTimeout(r, 600));
      const bar = document.querySelector('.er-selbar');
      const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const c = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!c && (el === c || el.contains(c)); };
      return { barDom: !!bar, barVisible: vis(bar) };
    })()`);
    await shot('r3-1-selbar.png');
    // 点解释 → stub 即回 → 内容弹层
    const pop = await win.webContents.executeJavaScript(`(async () => {
      const bar = document.querySelector('.er-selbar');
      const aiBtn = [...bar.querySelectorAll('.er-sel-btn.ai')].find((b) => b.textContent === '解释');
      aiBtn.click();
      await new Promise(r => setTimeout(r, 700));
      const pop = document.querySelector('.er-sel-popover');
      const r = pop?.getBoundingClientRect();
      const c = pop ? document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(30, r.height / 2)) : null;
      return { open: !!pop, popVisible: !!c && (pop === c || pop.contains(c)), body: (pop?.querySelector('.er-sel-body')?.textContent || '').slice(0, 30) };
    })()`);
    console.log('pop ' + JSON.stringify(pop));
    await sleep(300);
    await shot('r3-2-explain-popover.png');
    // 关弹层 → 回版面 → 划选卡片摘要
    await win.webContents.executeJavaScript(`(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 600));
      const sum = document.querySelector('.er-story .er-sum');
      const range = document.createRange();
      range.setStart(sum.firstChild, 0);
      range.setEnd(sum.firstChild, 16);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      await new Promise(r => setTimeout(r, 600));
      const bar = document.querySelector('.er-selbar');
      const r = bar?.getBoundingClientRect();
      const c = bar ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null;
      return { barDom: !!bar, barVisible: !!c && (bar === c || bar.contains(c)) };
    })()`);
    await sleep(200);
    await shot('r3-3-card-selbar.png');
    console.log('DONE');
    app.exit(0);
  } catch (e) {
    console.error('SHOT-FAIL', e && e.stack || e);
    app.exit(1);
  }
});
