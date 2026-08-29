'use strict';
/**
 * RobinRead（知更）— SVG 图标集
 * 轻量线条图标集。
 */
const i = (body, vb = '0 0 16 16', w = 15, h = 15) =>
  `<svg viewBox="${vb}" width="${w}" height="${h}" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const icons = {
  refresh: i('<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.7 1.8v2.7h-2.7"/>'),
  highlight: i('<path d="M3.2 12.8l.7-2.5 6.6-6.6c.5-.5 1.3-.5 1.8 0l.6.6c.5.5.5 1.3 0 1.8l-6.6 6.6-3.1.7z"/><path d="M9.2 4.4l2 2"/>'),
  marker: i('<path d="M9.8 1.9c.4-.4 1.1-.4 1.5 0l2.8 2.8c.4.4.4 1.1 0 1.5L6 14.3l-4.3 1 1-4.3 7.1-9.1z"/><path d="M8.7 4.1l3.2 3.2"/>', '0 0 16 16', 14, 14),
  noteSticky: i('<path d="M2.4 3.4c0-.6.4-1 1-1h9.2c.6 0 1 .4 1 1v6.8l-4.2 4.2H3.4c-.6 0-1-.4-1-1V3.4z"/><path d="M13.6 10.2h-3.2c-.6 0-1 .4-1 1v3.2"/><path d="M5 5.6h6M5 7.8h4"/>', '0 0 16 16', 15, 15),
  plus: i('<path d="M8 3.2v9.6M3.2 8h9.6"/>'),
  sidebarLeft: i('<rect x="1.6" y="2.6" width="12.8" height="10.8" rx="1.6"/><path d="M5.8 2.6v10.8"/>'),
  folder: i('<path d="M1.8 4.2c0-.7.6-1.3 1.3-1.3h2.9l1.4 1.7h5.5c.7 0 1.3.6 1.3 1.3v6.6c0 .7-.6 1.3-1.3 1.3H3.1c-.7 0-1.3-.6-1.3-1.3V4.2z"/>'),
  folderPlus: i('<path d="M1.8 4.2c0-.7.6-1.3 1.3-1.3h2.9l1.4 1.7h5.5c.7 0 1.3.6 1.3 1.3v6.6c0 .7-.6 1.3-1.3 1.3H3.1c-.7 0-1.3-.6-1.3-1.3V4.2z"/><path d="M8 7.2v3.4M6.3 8.9h3.4"/>'),
  import: i('<path d="M8 1.8v8.4M5 7.4l3 2.8 3-2.8"/><path d="M2.2 12v1.4c0 .6.4 1 1 1h9.6c.6 0 1-.4 1-1V12"/>'),
  export: i('<path d="M8 10.2V1.8M5 4.6l3-2.8 3 2.8"/><path d="M2.2 12v1.4c0 .6.4 1 1 1h9.6c.6 0 1-.4 1-1V12"/>'),
  gear: i('<circle cx="8" cy="8" r="2.2"/><path d="M8 1.6l.9 1.7 1.9-.4.4 1.9 1.7.9-.9 1.7.9 1.7-1.7.9-.4 1.9-1.9-.4L8 14.4l-.9-1.7-1.9.4-.4-1.9-1.7-.9.9-1.7-.9-1.7 1.7-.9.4-1.9 1.9.4L8 1.6z"/>', '0 0 16 16', 15, 15),
  sun: i('<circle cx="8" cy="8" r="3"/><path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1"/>', '0 0 16 16', 15, 15),
  circle: i('<circle cx="8" cy="8" r="5.5"/>', '0 0 16 16', 15, 15),
  starFilled: `<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4l-3.8 2-.7-4.3-3.1-3 4.3-.6L8 1.6z"/></svg>`,
  star: i('<path d="M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4l-3.8 2-.7-4.3-3.1-3 4.3-.6L8 1.6z"/>', '0 0 16 16', 13, 13),
  checkAll: i('<circle cx="8" cy="8" r="6.4"/><path d="M5.2 8.2l1.9 1.9 3.7-4"/>'),
  envelopeOpen: i('<path d="M2 6.4l5-3.7c.6-.4 1.4-.4 2 0l5 3.7v6c0 .9-.7 1.6-1.6 1.6H3.6c-.9 0-1.6-.7-1.6-1.6v-6z"/><path d="M2.2 6.6L8 10.6l5.8-4"/>'),
  envelopeClosed: i('<rect x="2" y="3.6" width="12" height="8.8" rx="1.4"/><path d="M2.4 4.4L8 8.8l5.6-4.4"/>'),
  copy: i('<rect x="5.2" y="5.2" width="8" height="8" rx="1.4"/><path d="M10.8 5.2V3.9c0-.8-.6-1.4-1.4-1.4H4c-.8 0-1.4.6-1.4 1.4v5.4c0 .8.6 1.4 1.4 1.4h1.2"/>'),
  trash: i('<path d="M2.6 4.2h10.8M6.4 4.2V3c0-.5.4-.9.9-.9h1.4c.5 0 .9.4.9.9v1.2M4 4.2l.5 8.4c0 .7.6 1.3 1.3 1.3h4.4c.7 0 1.3-.6 1.3-1.3l.5-8.4"/><path d="M6.6 6.8v4.4M9.4 6.8v4.4"/>'),
  pencil: i('<path d="M11.3 2.3l2.4 2.4-8.3 8.3-3.1.7.7-3.1 8.3-8.3z"/>'),
  newspaper: i('<rect x="1.8" y="3" width="9.4" height="10.4" rx="1"/><path d="M11.2 5.6h2.4c.4 0 .6.3.6.6v6.4c0 .6-.5 1-1 1h-2V5.6z"/><path d="M3.8 5.6h4.6M3.8 8h4.6M3.8 10.4h4.6"/>', '0 0 16 16', 34, 34),
  radioDot: i('<path d="M4.2 6.2a4.9 4.9 0 0 1 7.6 0M2.2 3.9a7.7 7.7 0 0 1 11.6 0"/><circle cx="8" cy="11" r="1.4" fill="currentColor" stroke="none"/>', '0 0 16 16', 34, 34),
  flame: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`,
  person: i('<circle cx="8" cy="5.4" r="2.6"/><path d="M2.8 13.6c.7-2.5 2.8-3.8 5.2-3.8s4.5 1.3 5.2 3.8"/>'),
  personX: i('<circle cx="7" cy="5.4" r="2.6"/><path d="M1.8 13.6c.7-2.5 2.8-3.8 5.2-3.8"/><path d="M11 9.8l3.6 3.6M14.6 9.8L11 13.4"/>'),
  ai: i('<path d="M8 1.4l1.5 3.1 3.4.5-2.5 2.4.6 3.4L8 9.2l-3 1.6.6-3.4L3.1 5l3.4-.5L8 1.4z"/><path d="M5.6 13.6h4.8"/>'),
  chevronRight: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`,
  chevronDown: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`,
  translate: i('<path d="M2 3.4h6M4.8 2v1.4c0 2.8-1.2 5.3-3 6.9"/><path d="M3 6.6c1.3 2.1 3.2 3.4 5.4 3.9"/><path d="M9 14l2.9-7.6L14.8 14M10 11.4h3.9"/>', '0 0 16 16', 14, 14),
  spark: i('<path d="M8 1.8l1.4 3 3 1.4-3 1.4L8 10.6 6.6 7.6l-3-1.4 3-1.4L8 1.8z"/><path d="M12.2 10.2l.7 1.4 1.4.7-1.4.7-.7 1.4-.7-1.4-1.4-.7 1.4-.7.7-1.4z"/>', '0 0 16 16', 14, 14),
  question: i('<circle cx="8" cy="8" r="6.3"/><path d="M6.2 6.2c.2-.9 1-1.5 1.8-1.5 1 0 1.8.8 1.8 1.8 0 1.2-1.8 1.5-1.8 2.7"/><circle cx="8" cy="11" r="0.7" fill="currentColor" stroke="none"/>'),
  close: i('<path d="M3.6 3.6l8.8 8.8M12.4 3.6l-8.8 8.8"/>'),
  questionCircle: i('<circle cx="8" cy="8" r="6.4"/><path d="M6.3 6.3c.15-.85.95-1.4 1.7-1.4.95 0 1.7.75 1.7 1.7 0 1.15-1.7 1.4-1.7 2.55"/><circle cx="8" cy="11.1" r="0.65" fill="currentColor" stroke="none"/>'),
  checkCircle: i('<circle cx="8" cy="8" r="6.4"/><path d="M5.2 8.2l1.9 1.9 3.7-4"/>'),
  expand: i('<path d="M9.4 2.2h4.4v4.4M6.6 13.8H2.2V9.4M13.8 2.2L9 7M2.2 13.8L7 9"/>', '0 0 16 16', 13, 13),
  collapse: i('<path d="M13.8 6.6H9.4V2.2M2.2 9.4h4.4v4.4M9.4 6.6l4.4-4.4M6.6 9.4l-4.4 4.4"/>', '0 0 16 16', 13, 13),
  keyboard: i('<rect x="1.4" y="4" width="13.2" height="8.4" rx="1.4"/><path d="M4 6.6h.01M6.4 6.6h.01M8.8 6.6h.01M11.2 6.6h.01M4 9.4h.01M6.4 9.4h.01M8.8 9.4h.01M11.2 9.4h.01M5 11h6" stroke-width="1.4"/>'),
  cloud: i('<path d="M4.6 12.6h7a2.8 2.8 0 0 0 .5-5.6 4.2 4.2 0 0 0-8.1-.9 2.9 2.9 0 0 0 .6 6.5z"/>'),
  globe: i('<circle cx="8" cy="8" r="6.3"/><path d="M1.7 8h12.6M8 1.7c-2.2 2.2-3.2 4-3.2 6.3s1 4.1 3.2 6.3c2.2-2.2 3.2-4 3.2-6.3S10.2 3.9 8 1.7z"/>'),
  appearance: i('<path d="M8 1.8a6.2 6.2 0 1 0 0 12.4V1.8z" fill="currentColor" stroke="none" opacity="0.85"/><path d="M8 1.8a6.2 6.2 0 1 0 0 12.4V1.8z"/><circle cx="8" cy="8" r="6.2"/>'),
  general: i('<circle cx="8" cy="8" r="2.2"/><path d="M8 1.4v2M8 12.6v2M1.4 8h2M12.6 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4"/>'),
  heart: i('<path d="M8 13.4C4.6 11 2 8.8 2 6.1 2 4.4 3.3 3 5 3c1.2 0 2.3.7 3 1.7C8.7 3.7 9.8 3 11 3c1.7 0 3 1.4 3 3.1 0 2.7-2.6 4.9-6 7.3z"/>'),
  bubble: i('<path d="M2.4 4c0-.9.7-1.6 1.6-1.6h8c.9 0 1.6.7 1.6 1.6v5.4c0 .9-.7 1.6-1.6 1.6H5.6L3 13.6V4z"/><path d="M5 6.4h6M5 8.6h4"/>'),
  eye: i('<path d="M1.6 8s2.2-4 6.4-4 6.4 4 6.4 4-2.2 4-6.4 4S1.6 8 1.6 8z"/><circle cx="8" cy="8" r="1.9"/>'),
  server: i('<rect x="1.8" y="2.4" width="12.4" height="4.6" rx="1.2"/><rect x="1.8" y="9" width="12.4" height="4.6" rx="1.2"/><path d="M4.2 4.7h.01M4.2 11.3h.01" stroke-width="2"/>'),
  macDevices: i('<rect x="1.4" y="2.6" width="9" height="6.4" rx="1.2"/><path d="M3.6 10.6h4.6"/><rect x="10" y="5" width="4.6" height="8.4" rx="1.2"/>'),
  info: i('<circle cx="8" cy="8" r="6.3"/><path d="M8 7.2v4"/><circle cx="8" cy="5" r="0.65" fill="currentColor" stroke="none"/>'),
  wand: i('<path d="M10.6 2l.8 1.8 1.8.8-1.8.8-.8 1.8-.8-1.8L8 4.6l1.8-.8L10.6 2z"/><path d="M2 14l7.4-7.4"/><path d="M13 9.6l.5 1.1 1.1.5-1.1.5-.5 1.1-.5-1.1-1.1-.5 1.1-.5.5-1.1z"/>'),
  clock: i('<circle cx="8" cy="8" r="6.3"/><path d="M8 4.6V8l2.4 1.6"/>'),
  bookOpen: i('<path d="M8 3.6C6.7 2.6 5 2.3 2.2 2.3v9.5c2.8 0 4.5.3 5.8 1.3 1.3-1 3-1.3 5.8-1.3V2.3C11 2.3 9.3 2.6 8 3.6z"/><path d="M8 3.6v9.5"/>'),
  docText: i('<path d="M3.4 1.9h5.9l3.1 3.1v9.1c0 .6-.4 1-1 1H3.4c-.6 0-1-.4-1-1V2.9c0-.6.4-1 1-1z"/><path d="M9.2 1.9v3.1h3.1"/><path d="M4.7 7.5h6M4.7 9.7h6M4.7 11.9h4"/>'),
  textSmaller: i('<path d="M2.4 5.5h5M4.4 3v5" /><path d="M9 11h4.6"/>'),
  textLarger: i('<path d="M2.4 5.5h5M4.9 3v5"/><path d="M8.6 11h5M11.1 8.5v5"/>'),
  chevronMenuRight: `<svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 1.8L7.2 6 3 10.2"/></svg>`,
  winMinimize: `<svg viewBox="0 0 10 10" width="10" height="10" stroke="currentColor" stroke-width="1"><line x1="0.5" y1="5" x2="9.5" y2="5"/></svg>`,
  winMaximize: `<svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1"><rect x="0.5" y="0.5" width="9" height="9"/></svg>`,
  winRestore: `<svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1"><rect x="0.5" y="2.5" width="7" height="7"/><polyline points="2.5,2.5 2.5,0.5 9.5,0.5 9.5,7.5 7.5,7.5"/></svg>`,
  lock: i('<rect x="3" y="6.6" width="10" height="7.4" rx="1.4"/><path d="M5.2 6.6V4.8a2.8 2.8 0 0 1 5.6 0v1.8"/>'),
  store: i('<path d="M2.2 6.2h11.6v8c0 .5-.4.9-.9.9H3.1c-.5 0-.9-.4-.9-.9v-8z"/><path d="M2.4 6.2L3.6 2.9h8.8l1.2 3.3"/><path d="M6 9.4h4"/><path d="M5.8 6.2V4.6a2.2 2.2 0 0 1 4.4 0v1.6"/>'),
  search: i('<circle cx="7" cy="7" r="4.6"/><path d="M10.4 10.4L14 14"/>'),
  winClose: `<svg viewBox="0 0 10 10" width="10" height="10" stroke="currentColor" stroke-width="1.1"><line x1="0.8" y1="0.8" x2="9.2" y2="9.2"/><line x1="9.2" y1="0.8" x2="0.8" y2="9.2"/></svg>`,
};

export function icon(name, extraClass = '') {
  const svg = icons[name] || '';
  return svg;
}
