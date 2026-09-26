'use strict';
/**
 * typography-presets.js — 版式主题预设包单一数据源（R7 抽取）
 * app.js（命令面板/应用）与 dialogs.js（设置 UI）共用，避免双份漂移。
 */

const TYPOGRAPHY_PRESETS = {
  default: {
    label: '知更纸刊（默认）',
    patch: {
      fontFamily: 'serif', lineHeight: 'standard', pageWidth: 'standard',
      paraStyle: 'spacing', textAlign: 'left', microTypography: 'on', dropCap: 'off',
    },
  },
  evening: {
    label: '新闻晚报',
    patch: {
      fontFamily: 'serif', lineHeight: 'compact', pageWidth: 'narrow',
      paraStyle: 'indent', textAlign: 'justify', microTypography: 'on', dropCap: 'off',
    },
  },
  minimal: {
    label: '极简留白',
    patch: {
      fontFamily: 'sans', lineHeight: 'loose', pageWidth: 'wide',
      paraStyle: 'spacing', textAlign: 'left', microTypography: 'off', dropCap: 'off',
    },
  },
  eink: {
    label: '墨水屏',
    patch: {
      fontFamily: 'serif', lineHeight: 'loose', pageWidth: 'narrow',
      paraStyle: 'indent', textAlign: 'left', microTypography: 'on', dropCap: 'on',
    },
  },
};



export { TYPOGRAPHY_PRESETS };
