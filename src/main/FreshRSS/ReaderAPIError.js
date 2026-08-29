'use strict';
/**
 * RobinRead Windows — FreshRSS API 错误
 * 1:1 移植自 ReaderAPIError.swift。
 */
const { i18n } = require('../I18N');

class ReaderAPIError extends Error {
  constructor(kind, code, detail) {
    const messages = {
      invalidEndpointURL: 'FreshRSS 端点地址无效。',
      networkError: '网络请求失败，请检查网络连接。',
      invalidCredentials: 'FreshRSS 用户名或应用专用密码无效。',
      writeTokenUnavailable: '无法获取 FreshRSS 写入令牌。',
      decodingError: 'FreshRSS 返回的数据无法解析。',
      httpError: 'FreshRSS 接口返回错误。',
    };
    super(messages[kind] || kind);
    this.kind = kind;
    this.code = code;
    this.detail = detail;
  }

  get displayMessage() {
    if (this.kind === 'httpError') {
      return i18n.localizedFormat('模型接口返回 HTTP %lld：%@', this.code, this.detail || '');
    }
    if (this.kind === 'invalidEndpointURL' && this.detail) {
      return `${this.message} (${this.detail})`;
    }
    if (this.kind === 'networkError' && this.detail) {
      return `${this.message} ${this.detail}`;
    }
    return this.message;
  }
}

module.exports = { ReaderAPIError };
