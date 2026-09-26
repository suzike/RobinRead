'use strict';
/**
 * NeuralTTSService.js — 高品质朗读引擎（调研报告方向 18 · 知更电台）
 *
 * 双后端统一合成接口，返回 mp3 Buffer：
 *  - edge  ：微软 Edge 神经语音（Azure 同款 Neural 音色，免费免 key，需联网）——晓晓/云希等，自然度远超本地 SAPI
 *  - custom：自定义 TTS 服务（OpenAI 兼容 /v1/audio/speech 或任意 POST 文本→音频 的局域网服务，
 *            如 CosyVoice / GPT-SoVITS / ElevenLabs 网关）——给「情感定制 / 克隆音色」留的插座位
 *
 * 磁盘缓存：userData/neural-tts/<sha1>.mp3（键 = 引擎+音色+语速+文本），同段二次朗读零请求。
 */
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const CACHE_DIR_NAME = 'neural-tts';
const SYNTH_TIMEOUT_MS = 30_000;

/** 神经音色清单（Edge 通道实测可用；label 面向用户）。 */
const NEURAL_VOICES = [
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 女声 · 温暖自然' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊 · 女声 · 清亮活泼' },
  { id: 'zh-CN-YunxiNeural', label: '云希 · 男声 · 阳光少年' },
  { id: 'zh-CN-YunjianNeural', label: '云健 · 男声 · 沉稳磁性' },
  { id: 'zh-CN-YunyangNeural', label: '云扬 · 男声 · 新闻播报' },
  { id: 'zh-CN-liaoning-XiaobeiNeural', label: '晓北 · 女声 · 东北味' },
  { id: 'zh-TW-HsiaoChenNeural', label: '曉臻 · 女声 · 台灣國語' },
  { id: 'zh-HK-HiuMaanNeural', label: '曉曼 · 女聲 · 粵語' },
];

/** 本地语速倍率 → Edge 百分比语速（'+0%' 形态）。 */
function rateToPercent(rate) {
  const pct = Math.round((Number(rate) || 1) * 100) - 100;
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

class NeuralTTSService {
  constructor(userDataDir) {
    this.cacheDir = path.join(userDataDir, CACHE_DIR_NAME);
  }

  /** 合成入口：engine = 'edge' | 'custom'。返回 mp3 Buffer。 */
  async synthesize({ engine = 'edge', text, voice, rate = 1, custom = null }) {
    const content = String(text || '').trim();
    if (!content) throw new Error('empty text');
    const key = crypto.createHash('sha1').update(`${engine}|${voice}|${rate}|${content}`).digest('hex');
    const cached = this._cacheRead(key);
    if (cached) return cached;
    const buffer = engine === 'custom'
      ? await this._synthCustom(content, rate, custom)
      : await this._synthEdge(content, voice || 'zh-CN-XiaoxiaoNeural', rate);
    if (!buffer || buffer.length < 512) throw new Error('tts: empty audio');
    this._cacheWrite(key, buffer);
    return buffer;
  }

  _cachePath(key) {
    return path.join(this.cacheDir, `${key}.mp3`);
  }

  _cacheRead(key) {
    try {
      const buf = fs.readFileSync(this._cachePath(key));
      return buf.length > 512 ? buf : null;
    } catch (_) {
      return null;
    }
  }

  _cacheWrite(key, buffer) {
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      fs.writeFileSync(this._cachePath(key), buffer);
      this._pruneCache();
    } catch (_) { /* 缓存失败不影响朗读 */ }
  }

  /** 缓存封顶 300MB，超限删最旧一半。 */
  _pruneCache() {
    try {
      const files = fs.readdirSync(this.cacheDir)
        .map((name) => {
          const stat = fs.statSync(path.join(this.cacheDir, name));
          return { name, mtime: stat.mtimeMs, size: stat.size };
        })
        .sort((a, b) => a.mtime - b.mtime);
      const total = files.reduce((sum, f) => sum + f.size, 0);
      if (total <= 300 * 1024 * 1024) return;
      let acc = 0;
      for (const f of files) {
        if (acc > total / 2) break;
        fs.unlinkSync(path.join(this.cacheDir, f.name));
        acc += f.size;
      }
    } catch (_) { /* 忽略 */ }
  }

  /** Edge 神经语音：msedge-tts WebSocket 通道。 */
  async _synthEdge(text, voice, rate) {
    let mod;
    try {
      mod = require('msedge-tts');
    } catch (_) {
      throw new Error('neural tts module missing');
    }
    const { MsEdgeTTS, OUTPUT_FORMAT } = mod;
    const tts = new MsEdgeTTS();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SYNTH_TIMEOUT_MS);
    try {
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const { audioStream } = await tts.toStream(text, { rate: rateToPercent(rate) });
      const chunks = [];
      await new Promise((resolve, reject) => {
        audioStream.on('data', (chunk) => chunks.push(chunk));
        audioStream.on('end', resolve);
        audioStream.on('error', reject);
        controller.signal.addEventListener('abort', () => reject(new Error('tts: timeout')));
      });
      return Buffer.concat(chunks);
    } finally {
      clearTimeout(timer);
      try { tts.close(); } catch (_) { /* 忽略 */ }
    }
  }

  /** 自定义 TTS：OpenAI 兼容 POST {model,voice,input} → audio bytes；响应兼容 mp3/wav。 */
  async _synthCustom(text, rate, custom) {
    const endpoint = String(custom?.endpoint || '').trim();
    if (!endpoint) throw new Error('custom tts: no endpoint');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SYNTH_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(custom?.apiKey ? { Authorization: `Bearer ${custom.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: custom?.model || 'tts-1',
          voice: custom?.voice || 'alloy',
          input: text,
          speed: Number(rate) || 1,
          response_format: 'mp3',
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`custom tts: HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      return buffer;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { NeuralTTSService, NEURAL_VOICES, rateToPercent };
