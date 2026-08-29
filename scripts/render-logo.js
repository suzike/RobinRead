'use strict';
/* 开发工具：把 brand-proposal/<name>/logo.svg 渲染为 icon-1024.png + 多尺寸 icon.ico
 * 用法：npx electron scripts/render-logo.js [brand-proposal/robinread] */
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

const targetDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', 'brand-proposal', 'robinread');
const svg = fs.readFileSync(path.join(targetDir, 'logo.svg'), 'utf8');
const RASTER_SIZES = [16, 24, 32, 48, 64, 128, 256, 1024];

function packIco(pngs, sizes) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  const entries = Buffer.alloc(16 * sizes.length);
  let offset = 6 + 16 * sizes.length;
  sizes.forEach((s, i) => {
    const buf = pngs.get(s);
    entries.writeUInt8(s >= 256 ? 0 : s, i * 16 + 0);
    entries.writeUInt8(s >= 256 ? 0 : s, i * 16 + 1);
    entries.writeUInt8(0, i * 16 + 2);
    entries.writeUInt8(0, i * 16 + 3);
    entries.writeUInt16LE(1, i * 16 + 4);
    entries.writeUInt16LE(32, i * 16 + 6);
    entries.writeUInt32LE(buf.length, i * 16 + 8);
    entries.writeUInt32LE(offset, i * 16 + 12);
    offset += buf.length;
  });
  return Buffer.concat([header, entries, ...sizes.map((s) => pngs.get(s))]);
}

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false, width: 320, height: 320 });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><body style="margin:0"></body>'));
    const dataUrls = await win.webContents.executeJavaScript(`(async () => {
      const svg = ${JSON.stringify(svg)};
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('svg load fail')); });
      const sizes = ${JSON.stringify(RASTER_SIZES)};
      const out = {};
      for (const s of sizes) {
        const c = document.createElement('canvas'); c.width = s; c.height = s;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, s, s);
        out[s] = c.toDataURL('image/png');
      }
      return out;
    })()`);
    const pngs = new Map();
    for (const [size, du] of Object.entries(dataUrls)) {
      pngs.set(Number(size), Buffer.from(du.slice(du.indexOf(',') + 1), 'base64'));
    }
    fs.writeFileSync(path.join(targetDir, 'icon-1024.png'), pngs.get(1024));
    fs.writeFileSync(path.join(targetDir, 'icon.ico'), packIco(pngs, [16, 24, 32, 48, 64, 128, 256]));
    console.log('[logo] 已生成 →', targetDir);
  } catch (e) {
    console.error('ERR', e);
    process.exitCode = 1;
  }
  app.exit(0);
});
