'use strict';
/**
 * RobinRead（知更）— 国际化模块
 *
 * - 界面语言可跟随系统或强制 中文/English
 * - AI 输出语言与界面语言互不绑定（见 LLMConfiguration.targetLanguage）
 */
const { STRINGS } = require('./I18NStrings');

class I18N {
  constructor() {
    this.language = 'zh';
    this._listeners = new Set();
  }

  static get shared() {
    if (!I18N._instance) I18N._instance = new I18N();
    return I18N._instance;
  }

  setLanguage(language) {
    if (language !== 'zh' && language !== 'en') return;
    if (this.language === language) return;
    this.language = language;
    for (const listener of this._listeners) {
      try { listener(language); } catch (_) { /* listener 不影响主流程 */ }
    }
  }

  onChange(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /** 键即中文缺省值。 */
  localized(key, englishFallback) {
    const entry = STRINGS[key];
    if (!entry) {
      if (this.language === 'en' && typeof englishFallback === 'string') return englishFallback;
      return key;
    }
    return this.language === 'en' ? entry.en : entry.zh;
  }

  localizedFormat(key, ...args) {
    let template = this.localized(key);
    // 与 NSString 格式一致：%lld / %@ 占位
    let index = 0;
    template = template.replace(/%lld|%@|%d/g, () => {
      const value = args[index];
      index += 1;
      return value === undefined ? '' : String(value);
    });
    return template;
  }
}

module.exports = { I18N, i18n: I18N.shared };
