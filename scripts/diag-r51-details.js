'use strict';
/**
 * diag-r51-details.js — R51 细节三连探针（列表，run-all OFFLINE 集）
 * ① 行 hover 时间戳变主题色（规则在册）
 * ② 收藏星标 pop 回弹动画在册（插入即播）
 * ③ 已收藏行左侧书签色条在册
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r51-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 120 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };
const ROOT = path.join(__dirname, '..');

app.whenReady().then(async () => {
  try {
    const cssSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'styles', 'robin.css'), 'utf8');
    ok(/\.entry-row:hover \.entry-time\s*\{\s*color:\s*var\(--accent\);/.test(cssSrc), 'CSS：行 hover 时间戳变主题色在册');
    ok(cssSrc.includes('@keyframes star-pop') && /\/\* R51 细节三连（列表） \*\/[\s\S]*?\.entry-row \.star-mini \{ animation: star-pop/.test(cssSrc), 'CSS：星标 pop 回弹动画在册');
    ok(/\.entry-row\.starred::before[\s\S]{0,200}background:\s*var\(--warm-accent\)/.test(cssSrc), 'CSS：已收藏行书签色左条在册');

    const win = new BrowserWindow({
      show: false, width: 1280, height: 860,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(ROOT, 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
    await sleep(900);
    const a = await win.webContents.executeJavaScript(`(() => {
      // 真实结构验证：造一行 starred 行，断言 ::before 生效（getComputedStyle content 非 none）与星标动画名
      const row = document.createElement('div');
      row.className = 'entry-row starred';
      row.style.cssText = 'position:relative;';
      row.innerHTML = '<span class="entry-meta"><span class="star-mini" title="已收藏">★</span><span class="entry-time">12:30</span></span>';
      document.body.appendChild(row);
      const before = getComputedStyle(row, '::before');
      const starAnim = getComputedStyle(row.querySelector('.star-mini')).animationName;
      const timeColor = getComputedStyle(row.querySelector('.entry-time')).transitionProperty;
      row.remove();
      return { beforeContent: before.content, beforeBg: before.backgroundColor, starAnim, timeTransition: timeTransitionFix(timeColor) };
      function timeTransitionFix(t) { return t; }
    })()`);
    ok(a.beforeContent !== 'none' && a.beforeBg !== 'rgba(0, 0, 0, 0)', `starred 行 ::before 书签条生效（bg ${a.beforeBg}）`);
    ok(a.starAnim === 'star-pop', `星标入场动画 star-pop（${a.starAnim}）`);
    ok(String(a.timeTransition).includes('color'), '时间戳颜色有过渡');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
