'use strict';
/**
 * RobinRead（知更）— Electron 主进程入口
 *
 * 职责：窗口生命周期、原生主题、启动刷新、菜单栏命令（快捷键）、
 * 首次启动时从旧数据目录迁移用户数据。
 */
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, Menu, nativeTheme, shell, dialog, ipcMain } = require('electron');
const { AppStore } = require('./AppStore');
const { i18n } = require('./I18N');
const { registerIPCHandlers, createMainWindow } = require('./ipc');

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

// 必须在 app ready（Chromium 初始化密钥表）之前完成迁移与密钥修复
migrateLegacyUserData();
repairLegacyKeyState();

// 单实例锁（避免多开导致 SQLite 写竞争）
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length) {
      const win = windows[0];
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

let store = null;
let mainWindow = null;

app.whenReady().then(() => {
  store = new AppStore(app.getPath('userData'));

  // 图片防盗链治理在 ipc.js 的 registerNetworkInterceptors() 中统一安装。

  // 主题跟随偏好
  const theme = store.preferences.get('RobinRead.appTheme', 'system');
  nativeTheme.themeSource = ['light', 'dark'].includes(theme) ? theme : 'system';

  mainWindow = createMainWindow(store);
  registerIPCHandlers(store, mainWindow);

  // 启动时自动刷新（默认开启）
  const refreshOnLaunch = store.preferences.get('RobinRead.refreshOnLaunch', true);
  if (refreshOnLaunch) {
    setTimeout(() => {
      store.refresh('launch').catch(() => { /* 状态已在内部记录 */ });
    }, 800);
  }

  buildMenu();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow(store);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

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
