'use strict';
/**
 * RobinRead（知更）— Electron 主进程入口
 *
 * 职责：窗口生命周期、原生主题、启动刷新、菜单栏命令（快捷键）、系统托盘、
 * 首次启动时从旧数据目录迁移用户数据、备份导入后的启动恢复。
 */
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, Menu, Tray, nativeTheme, shell, dialog, ipcMain } = require('electron');
const { i18n } = require('./I18N');
const ArticleExtractor = require('./ArticleExtractor');
const { AppStore } = require('./AppStore');
const { registerIPCHandlers, createMainWindow } = require('./ipc');

/**
 * 探针隔离开关：diag 探针（scripts/diag-*.js）require 本模块只为复用纯函数
 * （applyPendingRestore），启动前置 ROBINREAD_PROBE=1 即可跳过整套应用生命周期，
 * 避免探针进程里重复建窗口 / 双份 AppStore。
 */
const IS_PROBE = process.env.ROBINREAD_PROBE === '1';

/** 历史数据目录（按新→旧排序），迁移时取第一个含 library.db 的。 */
const LEGACY_DATA_DIRS = ['NanJuPaper', 'PaperRss'];

/**
 * 旧版数据目录（Roaming/NanJuPaper 或 Roaming/PaperRss）一次性迁移到新目录（Roaming/RobinRead）。
 * 仅当新目录尚无 library.db 且旧目录存在时整体复制，绝不覆盖新数据。
 */
function migrateLegacyUserData() {
  try {
    const next = app.getPath('userData');
    if (fs.existsSync(path.join(next, 'library.db'))) return;
    const parent = path.dirname(next);
    for (const name of LEGACY_DATA_DIRS) {
      const legacy = path.join(parent, name);
      if (!fs.existsSync(path.join(legacy, 'library.db'))) continue;
      fs.cpSync(legacy, next, { recursive: true, force: false, errorOnExist: false });
      console.log('[RobinRead] 已从旧数据目录迁移用户数据：', legacy, '→', next);
      return;
    }
  } catch (err) {
    console.warn('[RobinRead] 旧数据目录迁移失败（将按全新数据启动）：', err.message);
  }
}

/**
 * 密钥表修复：凭据文件用旧目录 Local State 的 os_crypt 密钥加密；
 * 若新目录的 Local State 是 Chromium 新生成的（密钥不一致），safeStorage 将解不开旧凭据。
 * 检测到密钥不一致时用旧 Local State 覆盖。必须在模块顶层（Chromium 读取密钥前）执行。
 */
function repairLegacyKeyState() {
  try {
    const next = app.getPath('userData');
    const parent = path.dirname(next);
    const readKey = (file) => {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'))?.os_crypt?.encrypted_key || null;
      } catch (_) { return null; }
    };
    const nextLS = path.join(next, 'Local State');
    if (!fs.existsSync(path.join(next, 'credentials', 'ai-api-key.bin'))) return;
    const nextKey = readKey(nextLS);
    for (const name of LEGACY_DATA_DIRS) {
      const legacyLS = path.join(parent, name, 'Local State');
      if (!fs.existsSync(legacyLS)) continue;
      const legacyKey = readKey(legacyLS);
      if (legacyKey && nextKey !== legacyKey) {
        fs.copyFileSync(legacyLS, nextLS);
        console.log('[RobinRead] 已用旧目录密钥表修复 Local State（凭据可解密）');
        return;
      }
    }
  } catch (err) {
    console.warn('[RobinRead] 密钥表修复失败：', err.message);
  }
}

// MARK: 备份恢复（启动时序的核心一环）
/**
 * 「待恢复」检测与替换（纯函数，可在任意 Electron 进程里直调）。
 *
 * 备份导入（ipc.js backup:import）并不直接覆盖正在使用中的 library.db，而是写入
 * userData 三件套：restore-pending.db / restore-pending.preferences.json /
 * restore-pending.json（{done:false} 标记）；重启后本函数在 AppStore 打开数据库
 * 之前执行：用 pending 库整体替换 library.db（连同删除旧 -wal/-shm，避免旧 WAL
 * 被错误回放进恢复后的库）、pending 偏好覆盖 preferences.json，最后清理三件套。
 *
 * @returns {boolean} 是否执行了恢复（无标记文件时返回 false，零副作用）
 */
function applyPendingRestore(userDataDir) {
  const markerPath = path.join(userDataDir, 'restore-pending.json');
  if (!fs.existsSync(markerPath)) return false;
  const pendingDB = path.join(userDataDir, 'restore-pending.db');
  const pendingPrefs = path.join(userDataDir, 'restore-pending.preferences.json');
  const dbPath = path.join(userDataDir, 'library.db');
  if (fs.existsSync(pendingDB)) {
    // 旧库的 WAL/SHM 必须一并移除：WAL 里可能是旧数据，留着会在下次打开时回放污染恢复结果
    for (const suffix of ['-wal', '-shm']) {
      try { fs.rmSync(dbPath + suffix, { force: true }); } catch (_) { /* 尽力而为 */ }
    }
    fs.copyFileSync(pendingDB, dbPath);
  }
  if (fs.existsSync(pendingPrefs)) {
    fs.copyFileSync(pendingPrefs, path.join(userDataDir, 'preferences.json'));
  }
  for (const file of [markerPath, pendingDB, pendingPrefs]) {
    try { fs.rmSync(file, { force: true }); } catch (_) { /* 尽力而为 */ }
  }
  console.log('[RobinRead] 已应用待恢复备份：本次启动使用导入的数据');
  return true;
}

// 供 diag 探针直调（主入口模式下 module.exports 同样生效）
module.exports = { applyPendingRestore };

if (!IS_PROBE) {
  /**
   * 必须在 app ready（Chromium 初始化密钥表）之前完成迁移与密钥修复；
   * 备份恢复替换必须发生在 AppStore 实例化（打开 library.db）之前，
   * 因此都放在模块加载期（whenReady 之前）。
   */
  migrateLegacyUserData();
  repairLegacyKeyState();
  try {
    applyPendingRestore(app.getPath('userData'));
  } catch (err) {
    // 恢复失败不阻塞启动：保留 pending 文件，下次启动重试
    console.warn('[RobinRead] 备份恢复应用失败（将在下次启动重试）：', err.message);
  }

  // Windows 系统通知需要 AppUserModelId（与 electron-builder appId 一致）
  app.setAppUserModelId('com.robinread.app');

  // 单实例锁（避免多开导致 SQLite 写竞争）
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      // 关闭到托盘后再次启动：窗口只是隐藏，必须 show 而非只 focus
      const win = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : BrowserWindow.getAllWindows()[0];
      if (win) {
        if (win.isMinimized()) win.restore();
        if (!win.isVisible()) win.show();
        win.focus();
      }
    });
  }

  let store = null;
  let mainWindow = null;
  let tray = null;

  app.whenReady().then(() => {
    store = new AppStore(app.getPath('userData'));

    // 图片防盗链治理在 ipc.js 的 registerNetworkInterceptors() 中统一安装。

    // 主题跟随偏好
    const theme = store.preferences.get('RobinRead.appTheme', 'system');
    nativeTheme.themeSource = ['light', 'dark'].includes(theme) ? theme : 'system';

    mainWindow = createMainWindow(store);
    registerIPCHandlers(store, mainWindow);

    createTray();

    // 启动时自动刷新（默认开启）
    const refreshOnLaunch = store.preferences.get('RobinRead.refreshOnLaunch', true);
    if (refreshOnLaunch) {
      setTimeout(() => {
        store.refresh('launch').catch(() => { /* 状态已在内部记录 */ });
      }, 800);
    }

    // 预热正文提取 worker：消除首次「阅读原文/正文补全」的进程冷启动延迟
    setTimeout(() => { try { ArticleExtractor.prewarm(); } catch (_) { /* 静默 */ } }, 2500);

    buildMenu();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow(store);
      }
    });
  });

  app.on('window-all-closed', () => {
    // 「关闭到托盘」开启时窗口只是 hide 未 close，本事件不触发——应用驻留托盘，
    // 真正退出统一走托盘菜单「退出」（markAppQuitting 后 app.quit()）。
    if (process.platform !== 'darwin') app.quit();
  });

  // 退出前同步落盘：偏好是 150ms 防抖写入，关窗后立即 quit 会丢掉最后 150ms 的修改
  // （窗口位置、主题、语言等）；同时关闭 SQLite（WAL checkpoint）。
  // 挂在 will-quit（窗口 close 之后）而非 before-quit：菜单 quit 路径上 before-quit
  // 先于窗口 close 事件触发，提前 flush 会丢掉 close 时 saveBounds 的最终窗口位置。
  // flushSync 幂等、LibraryDatabase.close 吞错幂等，重复调用安全。
  app.on('will-quit', () => {
    if (!store) return;
    try {
      store.preferences.flushSync();
      store.database.close();
    } catch (_) { /* 退出路径不抛错 */ }
  });

  // MARK: 系统托盘

  /** 显示并聚焦主窗口（托盘单击 / 通知点击 / 二次启动共用）。 */
  function showMainWindow() {
    const win = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
  }

  /** 托盘右键菜单：每次弹出时即时构建，开机自启 checkbox 与系统状态实时同步。 */
  function buildTrayMenu() {
    const { loginItemState, setLoginItemEnabled, markAppQuitting } = require('./ipc');
    const login = loginItemState();
    return Menu.buildFromTemplate([
      { label: i18n.localized('显示主窗口'), click: showMainWindow },
      { label: i18n.localized('刷新所有订阅'), click: () => store.refresh('manual').catch(() => {}) },
      { type: 'separator' },
      {
        label: i18n.localized('开机自启'),
        type: 'checkbox',
        checked: login.enabled,
        // dev 模式（electron .）下 Login Item 不可靠，禁用勾选
        enabled: login.supported,
        click: (item) => { setLoginItemEnabled(item.checked); },
      },
      { type: 'separator' },
      {
        label: i18n.localized('退出'),
        click: () => {
          markAppQuitting(); // 绕过「关闭到托盘」的 close 拦截
          app.quit();
        },
      },
    ]);
  }

  function createTray() {
    try {
      const { resolveIcon } = require('./ipc');
      const iconPath = resolveIcon();
      if (!iconPath) {
        console.warn('[RobinRead] 未找到托盘图标（assets/icon.ico），跳过托盘创建');
        return;
      }
      tray = new Tray(iconPath);
      tray.setToolTip('RobinRead · 知更');
      tray.on('click', showMainWindow);
      tray.on('right-click', () => {
        try { tray.popUpContextMenu(buildTrayMenu()); } catch (_) { /* 菜单失败不影响托盘 */ }
      });
    } catch (err) {
      console.warn('[RobinRead] 托盘创建失败：', err.message);
    }
  }

  function buildMenu() {
    const isMac = process.platform === 'darwin';
    const template = [
      ...(isMac ? [{ role: 'appMenu' }] : []),
      {
        label: i18n.localized('文件'),
        submenu: [
          {
            label: i18n.localized('添加订阅'),
            accelerator: 'CmdOrCtrl+N',
            click: () => mainWindow?.webContents.send('menu:addFeed'),
          },
          { type: 'separator' },
          {
            label: i18n.localized('导入 OPML'),
            click: () => mainWindow?.webContents.send('menu:importOPML'),
          },
          {
            label: i18n.localized('导出 OPML'),
            click: () => mainWindow?.webContents.send('menu:exportOPML'),
          },
          { type: 'separator' },
          isMac ? { role: 'close' } : { role: 'quit' },
        ],
      },
      {
        label: i18n.localized('阅读'),
        submenu: [
          {
            label: i18n.localized('刷新所有订阅'),
            accelerator: 'CmdOrCtrl+Shift+R',
            click: () => store.refresh('manual').catch(() => {}),
          },
          { type: 'separator' },
          {
            label: i18n.localized('放大正文字号'),
            accelerator: 'CmdOrCtrl+Plus',
            click: () => mainWindow?.webContents.send('menu:fontSize', +1),
          },
          {
            label: i18n.localized('缩小正文字号'),
            accelerator: 'CmdOrCtrl+-',
            click: () => mainWindow?.webContents.send('menu:fontSize', -1),
          },
          {
            label: i18n.localized('默认正文字号'),
            accelerator: 'CmdOrCtrl+0',
            click: () => mainWindow?.webContents.send('menu:fontSize', 0),
          },
        ],
      },
      {
        label: i18n.localized('设置'),
        submenu: [
          {
            label: i18n.localized('设置'),
            accelerator: 'CmdOrCtrl+,',
            click: () => mainWindow?.webContents.send('menu:openSettings'),
          },
          {
            label: i18n.localized('键盘快捷键'),
            accelerator: 'CmdOrCtrl+/',
            click: () => mainWindow?.webContents.send('menu:openShortcuts'),
          },
        ],
      },
      {
        label: i18n.localized('视图'),
        submenu: [
          { role: 'reload', label: i18n.localized('重新载入') },
          { role: 'forceReload' },
          { role: 'toggleDevTools', label: i18n.localized('开发者工具') },
          { type: 'separator' },
          { role: 'resetZoom', label: i18n.localized('实际大小') },
          { role: 'zoomIn', label: i18n.localized('放大') },
          { role: 'zoomOut', label: i18n.localized('缩小') },
          { type: 'separator' },
          { role: 'togglefullscreen', label: i18n.localized('全屏') },
        ],
      },
      {
        role: 'help',
        label: i18n.localized('帮助'),
        submenu: [
          {
            label: i18n.localized('键盘快捷键'),
            accelerator: 'CmdOrCtrl+/',
            click: () => mainWindow?.webContents.send('menu:openShortcuts'),
          },
          {
            label: i18n.localized('浏览订阅商店'),
            click: () => mainWindow?.webContents.send('menu:openStore'),
          },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }
}
