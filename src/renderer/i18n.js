'use strict';
/**
 * RobinRead Windows — 渲染进程 i18n
 *
 * 与主进程 I18N.js 相同的键语义：键为中文原文。
 * 字符串表在启动时由主进程一次性下发（app:state）。
 */
let STRINGS = {};
let language = 'zh';

export function configure({ strings, lang }) {
  if (strings) STRINGS = strings;
  if (lang) language = lang;
}

export function t(key, englishFallback) {
  const entry = STRINGS[key];
  if (!entry) {
    return language === 'en' && typeof englishFallback === 'string' ? englishFallback : key;
  }
  return language === 'en' ? entry.en : entry.zh;
}

export function tf(key, ...args) {
  let template = t(key);
  let index = 0;
  return template.replace(/%lld|%@|%d/g, () => {
    const value = args[index];
    index += 1;
    return value === undefined ? '' : String(value);
  });
}

export function currentLanguage() {
  return language;
}
