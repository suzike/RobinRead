'use strict';
/**
 * diag-phase13-backup.js — 自动备份行为探针（run-all --ci 集）
 *
 * 真实启动（临时 userData + registerIPCHandlers）：等启动首查（20s）后断言——
 *  1. backups 目录产出 RobinRead-auto-backup-YYYYMMDD.json（VACUUM 快照 + 偏好）
 *  2. backup:getConfig 默认 enabled/keep=7/目录存在
 *  3. backup:setConfig 关闭 → autoNow 受 force 参数仍可手动备份
 * 退出码 0=PASS。
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-backup-probe-'));
app.setPath('userData', userData);
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 120 * 1000).unref();

app.whenReady().then(async () => {
  try {
    const { AppStore } = require('../src/main/AppStore');
    const store = new AppStore(userData);
    const win = new BrowserWindow({
      show: false, width: 900, height: 600,
      webPreferences: { preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'), contextIsolation: true, backgroundThrottling: false },
    });
    const { registerIPCHandlers } = require('../src/main/ipc');
    registerIPCHandlers(store, win);
    await win.loadURL('data:text/html,<html></html>');
    const run = (js) => win.webContents.executeJavaScript(`(async () => { try { ${js} } catch (e) { return { error: String(e.message || e) }; } })()`);

    // 等启动首查（ipc 注册时 20s 延迟）
    await new Promise((r) => setTimeout(r, 22_000));
    const backupDir = path.join(userData, 'backups');
    const backups = fs.existsSync(backupDir)
      ? fs.readdirSync(backupDir).filter((f) => f.startsWith('RobinRead-auto-backup-'))
      : [];
    assert.ok(backups.length === 1, `自动备份应产出 1 份快照，实际 ${JSON.stringify(backups)}`);
    const snapshot = JSON.parse(fs.readFileSync(path.join(backupDir, backups[0]), 'utf8'));
    assert.ok(snapshot.dbBase64?.length > 100 && snapshot.preferences, '快照应含数据库与偏好');
    console.log('PASS 自动备份首查产出快照：' + backups[0]);

    const cfg = await run(`return await window.robin.backupGetConfig();`);
    assert.ok(cfg && cfg.enabled === true && cfg.keep === 7 && cfg.dir.endsWith('backups'), `配置通道异常: ${JSON.stringify(cfg)}`);
    console.log('PASS 备份配置通道（enabled/keep/dir）');

    const setRes = await run(`return await window.robin.backupSetConfig({ enabled: false, keep: 3 });`);
    assert.ok(setRes && setRes.enabled === false && setRes.keep === 3, `setConfig 异常: ${JSON.stringify(setRes)}`);
    const nowRes = await run(`return await window.robin.backupAutoNow();`);
    assert.ok(nowRes && typeof nowRes === 'string' && nowRes.includes('RobinRead-auto-backup'), `强制立即备份应返回路径: ${JSON.stringify(nowRes)?.slice(0, 120)}`);
    console.log('PASS 关闭开关 + 强制备份路径返回');

    app.exit(0);
  } catch (error) {
    console.error('FAIL', error?.message || error);
    app.exit(1);
  }
});
