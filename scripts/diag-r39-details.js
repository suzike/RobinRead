'use strict';
/**
 * diag-r39-details.js — R39 细节三连探针（run-all OFFLINE 集）
 * 验证：列表行时间悬停显示完整日期时间 / 来源名悬停全名（截断补偿）/
 *       杂志卡来源同样带全名 / 聚簇行时间提示 / 搜索清除键命中区 24px
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-r39-')));
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 150 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { if (c) console.log('PASS ' + l); else { failed += 1; console.error('FAIL ' + l); } };

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false, width: 1440, height: 900,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, '..', 'src', 'main', 'preload.js') },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await sleep(900);
    const run = (tag, js) => {
      console.log('PHASE ' + tag);
      return win.webContents.executeJavaScript(`(async () => { try { ${js} } catch (e) { return { __err: String(e && e.stack || e) }; } })()`);
    };
    const a = await run('details', `
      const { ListView } = await import('./views/list.js');
      const host = document.createElement('div');
      host.className = 'list-scroll';
      document.body.appendChild(host);
      const lv = new ListView(host, { onSelect: () => {}, onContext: () => {}, onLoadMore: () => {}, onSearch: () => {} });
      window.__lv = lv;
      const TS = 1758902460; // 固定时间戳
      const titles = ['量子计算商用化进展观察', '深海火山口的生态系统', '城市地铁新线通车运营', '手冲咖啡的水温与粉水比'];
      const mk = (i, over = {}) => ({ id: 'd-' + i, title: titles[i], summaryPreview: '摘要用于细节探针', sourceTitle: 'InfoQ - 促进软件开发领域知识与创新的传播', publishedAt: TS + i * 60, contentHead: '', ...over });
      lv.setViewMode('list');
      lv.render([mk(0), mk(1)], { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 250));
      // ① 时间悬停全量
      const timeTitle = document.querySelector('.entry-time')?.title || '';
      // ② 来源全名提示
      const srcTitle = document.querySelector('.entry-source')?.title || '';
      // ③ 清除键命中区
      lv.searchInput.value = '量子';
      lv.searchHost.classList.add('has-value');
      await new Promise(r => setTimeout(r, 60));
      const clearBox = document.querySelector('.list-search .clear').getBoundingClientRect();
      // ④ 聚簇行时间提示（两相似条目聚簇）
      lv.render([mk(2, { title: '手冲咖啡的水温与粉水比（补充）' }), mk(3)], { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 200));
      const clusterTimeTitle = document.querySelector('.cluster-row .entry-time')?.title || '';
      // ⑤ 杂志卡来源全名
      lv.setViewMode('magazine');
      lv.render([mk(0)], { kind: 'all' }, null, true);
      await new Promise(r => setTimeout(r, 200));
      const magFeedTitle = document.querySelector('.mag-feed')?.title || '';
      const expect = new Date(TS * 1000).toLocaleString((window.__robinLanguage || 'zh') === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit' });
      return { timeTitle, srcTitle, clearW: Math.round(clearBox.width), clusterTimeTitle: clusterTimeTitle.slice(0, 30), magFeedTitle, expect: expect.slice(0, 30) };
    `);
    if (a.__err) throw new Error('details: ' + a.__err);
    ok(a.timeTitle.includes('2025') && a.timeTitle.includes('星期') && a.timeTitle.includes(':'), '时间悬停显示完整日期时间（' + a.timeTitle + '）');
    ok(a.timeTitle.startsWith(a.expect.slice(0, 12)), '悬停格式与本地化一致');
    ok(a.srcTitle.includes('InfoQ - 促进软件开发领域知识与创新的传播'), '来源悬停全名（截断补偿）');
    ok(a.clearW >= 22, '搜索清除键命中区 ≥22px（' + a.clearW + '）');
    ok(a.clusterTimeTitle.length > 0, '聚簇行时间同样带悬停提示');
    ok(a.magFeedTitle.includes('InfoQ'), '杂志卡来源悬停全名');
    if (failed) { console.error(failed + ' 项失败'); app.exit(1); }
    else { console.log('ALL PASSED'); app.exit(0); }
  } catch (e) {
    console.error('ERR', String(e && e.stack || e).slice(0, 900));
    app.exit(1);
  }
});
