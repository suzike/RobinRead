/**
 * paper-pref.js — 纸张质感偏好（R2）：四态 paper/white/book/kraft。
 * 夜间独立记忆：暗色写 robinread.magPaperDark，日间写 robinread.magPaper；
 * 暗色未设置时回退日间选择，首次改动后即分道。
 */
const KEY = 'robinread.magPaper';
const KEY_DARK = 'robinread.magPaperDark';

export const PAPERS = ['paper', 'white', 'book', 'kraft'];

export const isDarkNow = () => document.body.classList.contains('dark');

/** 当前主题下的纸感偏好（暗色未设置时回退日间值）。 */
export const paperPref = () =>
  localStorage.getItem(isDarkNow() ? KEY_DARK : KEY) || localStorage.getItem(KEY) || 'paper';

/** 写入当前主题的纸感偏好。 */
export const setPaperPref = (v) => localStorage.setItem(isDarkNow() ? KEY_DARK : KEY, v);

/** 纸感中文名。 */
export const paperLabel = (id) => ({ paper: '纸感', white: '素白', book: '书卷', kraft: '牛皮' })[id] || '纸感';
