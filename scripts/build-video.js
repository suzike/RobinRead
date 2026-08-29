'use strict';
/* 开发工具：把 shots/video/cards/card-01..09.png 组装成「极简高设计感」产品短片。
 * 每张卡做 Ken Burns 缓慢推近，卡与卡之间用交叉溶解过渡，首尾淡入淡出。
 * 用法：node scripts/build-video.js
 * 输出：shots/video/RobinRead-promo-1920x1080.mp4 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const CARD_DIR = path.join(ROOT, 'shots', 'video', 'cards');
const OUT_DIR = path.join(ROOT, 'shots', 'video');
const OUT = path.join(OUT_DIR, 'RobinRead-promo-1920x1080.mp4');

const W = 1920, H = 1080, FPS = 30;
const DUR = 3.5;                 // 每卡时长（秒）
const XFADE = 0.7;               // 交叉溶解时长（秒）
const FADE_IN = 0.6;             // 首卡淡入
const FADE_OUT = 0.8;            // 尾卡淡出

const N = 9;                     // 卡数量
const D_FRAMES = Math.round(DUR * FPS);      // 105 帧
const ZOOMS = [1.035, 1.07, 1.07, 1.07, 1.07, 1.07, 1.07, 1.07, 1.035]; // 首尾轻微、中间略深

const inputs = [];
for (let i = 0; i < N; i++) inputs.push(path.join(CARD_DIR, `card-${String(i + 1).padStart(2, '0')}.png`));
for (const f of inputs) if (!fs.existsSync(f)) { console.error('缺卡:', f); process.exit(1); }

const parts = [];
inputs.forEach((f, i) => {
  const zMax = ZOOMS[i];
  const step = (zMax - 1) / (D_FRAMES - 1);
  // 缓慢推近（居中），zoom 表达式用 on（输出帧号）保证确定性
  const zp = `zoompan=z='min(1+${step.toFixed(6)}*on,${zMax})':d=${D_FRAMES}` +
    `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS}`;
  parts.push(`[${i}:v]${zp}[v${i}]`);
});

// 首卡淡入
parts.push(`[v0]fade=t=in:st=0:d=${FADE_IN}[v0]`);

// 依次交叉溶解
let prev = 'v0';
for (let i = 1; i < N; i++) {
  const offset = +(i * (DUR - XFADE)).toFixed(3);      // i*2.8
  const out = i === N - 1 ? 'vout' : `x${i}`;
  parts.push(`[${prev}][v${i}]xfade=transition=fade:duration=${XFADE}:offset=${offset}[${out}]`);
  prev = out;
}

const totalDur = +(N * DUR - (N - 1) * XFADE).toFixed(3);   // 25.9s
// 尾卡淡出（在最终画面时间轴上）
parts.push(`[vout]fade=t=out:st=${(totalDur - FADE_OUT).toFixed(3)}:d=${FADE_OUT},format=yuv420p[vfinal]`);

const filterScript = parts.join(';\n') + '\n';
const filterFile = path.join(OUT_DIR, 'filter_complex.txt');
fs.writeFileSync(filterFile, filterScript);

const args = ['-y', '-hide_banner'];
inputs.forEach((f) => args.push('-i', f));
args.push(
  '-filter_complex_script', filterFile,
  '-map', '[vfinal]',
  '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  OUT,
);

fs.mkdirSync(OUT_DIR, { recursive: true });
console.log('[build-video] 总时长 ≈', totalDur, 's');
execFileSync('ffmpeg', args, { stdio: 'inherit', cwd: ROOT });
console.log('[build-video] 输出 →', OUT);
