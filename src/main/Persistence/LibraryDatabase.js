'use strict';
/**
 * RobinRead（知更）— 数据库与偏好存储
 *
 * - 文章库：node:sqlite DatabaseSync（WAL），模式由 DatabaseMigrations 管理
 * - 偏好：preferences.json（%APPDATA%/RobinRead），键前缀 RobinRead.*
 */
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations } = require('./DatabaseMigrations');

class LibraryDatabase {
  constructor(filePath) {
    this.filePath = filePath;
    const directory = path.dirname(filePath);
    fs.mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    runMigrations(this.db);
  }

  prepare(sql) {
    return this.db.prepare(sql);
  }

  exec(sql) {
    this.db.exec(sql);
  }

  transaction(fn) {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch (_) { /* 已回滚 */ }
      throw err;
    }
  }

  close() {
    try { this.db.close(); } catch (_) { /* 忽略关闭错误 */ }
  }
}

/** 偏好键。 */
const PreferenceKey = Object.freeze({
  refreshInterval: 'RobinRead.refreshInterval',
  refreshOnLaunch: 'RobinRead.refreshOnLaunch',
  appTheme: 'RobinRead.appTheme',
  articleFontSize: 'RobinRead.articleFontSize',
  ignoredVersion: 'RobinRead.ignoredVersion',
  llmConfiguration: 'RobinRead.llmConfiguration',
  aiAPIKey: 'RobinRead.ai.apiKey',
  appLanguage: 'RobinRead.appLanguage',
  aiOutputLanguage: 'RobinRead.ai.outputLanguage',
  windowBounds: 'RobinRead.windowBounds',
  sidebarWidth: 'RobinRead.sidebarWidth',
  listWidth: 'RobinRead.listWidth',
});

class PreferenceStore {
  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'preferences.json');
    this.values = {};
    try {
      if (fs.existsSync(this.filePath)) {
        this.values = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      }
    } catch (_) {
      this.values = {};
    }
    this._migrateLegacyKeys();
  }

  /** 旧版偏好键（PaperRss.* / NanJuPaper.*）一次性迁移到新键名（RobinRead.*），并清理旧键避免双份残留。 */
  _migrateLegacyKeys() {
    let touched = false;
    for (const legacyPrefix of ['NanJuPaper.', 'PaperRss.']) {
      for (const key of Object.keys(this.values)) {
        if (!key.startsWith(legacyPrefix)) continue;
        const next = `RobinRead.${key.slice(legacyPrefix.length)}`;
        if (!Object.prototype.hasOwnProperty.call(this.values, next)) {
          this.values[next] = this.values[key];
        }
        delete this.values[key];
        touched = true;
      }
    }
    if (touched) this._scheduleSave();
  }

  get(key, fallback = null) {
    return Object.prototype.hasOwnProperty.call(this.values, key) ? this.values[key] : fallback;
  }

  set(key, value) {
    this.values[key] = value;
    this._scheduleSave();
  }

  remove(key) {
    delete this.values[key];
    this._scheduleSave();
  }

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.flushSync();
    }, 150);
  }

  /** 立即落盘（清除防抖定时器）。应用退出（before-quit）时调用，避免最后一次修改丢失。 */
  flushSync() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.values, null, 2), 'utf8');
    } catch (_) { /* 保存失败不阻塞主流程 */ }
  }
}

module.exports = { LibraryDatabase, PreferenceStore, PreferenceKey };
