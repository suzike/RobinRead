'use strict';
/**
 * RobinRead（知更）— 凭据存储
 *
 * Windows 上使用 Electron safeStorage（DPAPI）加密后落盘，
 * API Key 与 FreshRSS 密码只保存在本机，不参与任何云同步。
 */
const fs = require('node:fs');
const path = require('node:path');
const { safeStorage, app } = require('electron');

class CredentialStore {
  constructor() {
    this.directory = path.join(app.getPath('userData'), 'credentials');
    fs.mkdirSync(this.directory, { recursive: true });
  }

  _filePath(key) {
    const safe = String(key).replace(/[^a-zA-Z0-9_.-]/g, '_');
    return path.join(this.directory, `${safe}.bin`);
  }

  _write(key, plaintext) {
    const target = this._filePath(key);
    if (plaintext == null || plaintext === '') {
      try { fs.unlinkSync(target); } catch (_) { /* 不存在即可 */ }
      return;
    }
    const encrypted = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(String(plaintext))
      : Buffer.from(String(plaintext), 'utf8'); // 兜底（极少数旧系统无 DPAPI）
    fs.writeFileSync(target, encrypted);
  }

  _read(key) {
    try {
      const target = this._filePath(key);
      if (!fs.existsSync(target)) return null;
      const data = fs.readFileSync(target);
      if (!data.length) return null;
      if (safeStorage.isEncryptionAvailable()) {
        try {
          return safeStorage.decryptString(data);
        } catch (_) {
          // 首次写入可能是明文（尚未加密），回退读取
          return data.toString('utf8');
        }
      }
      return data.toString('utf8');
    } catch (_) {
      return null;
    }
  }

  aiAPIKey() {
    return this._read('ai-api-key') || '';
  }

  setAIAPIKey(value) {
    this._write('ai-api-key', value);
  }

  freshRSSPassword(accountID) {
    return this._read(`freshrss-password-${accountID}`);
  }

  setFreshRSSPassword(accountID, password) {
    this._write(`freshrss-password-${accountID}`, password);
  }

  deleteFreshRSSPassword(accountID) {
    this._write(`freshrss-password-${accountID}`, null);
  }

  /** 账号登录 JWT（会员服务），同样只存本机。 */
  authToken() {
    return this._read('auth-token') || '';
  }

  setAuthToken(value) {
    this._write('auth-token', value);
  }
}

module.exports = { CredentialStore };
