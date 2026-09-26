'use strict';
/**
 * diag-phase11-neural-tts.js — 神经语音在线合成探针（run-all ONLINE 集）
 *
 * 真实调用 Edge 神经语音通道合成一条中文（默认音色「晓晓」）：
 *  - IPC 链路：preload → tts:synthesize → NeuralTTSService → msedge-tts WebSocket
 *  - 断言：返回 base64 可解码、长度合理（>2KB）、音频头合法（ID3 或 MPEG frame sync）
 * 失败常见原因：断网 / 微软接口变动 / msedge-tts 包缺失 —— 明确报错而非崩溃。
 * 需要真实网络，故不入 --ci 离线集。退出码 0=PASS。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'robinread-neural-tts-'));
app.setPath('userData', userData);
setTimeout(() => { console.error('WATCHDOG'); app.exit(3); }, 90 * 1000).unref();

app.whenReady().then(async () => {
  try {
    const { registerIPCHandlers } = require('../src/main/ipc');
    const store = require('../src/main/AppStore');
    const win = new BrowserWindow({
      show: false, width: 800, height: 600,
      webPreferences: { preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'), contextIsolation: true, backgroundThrottling: false },
    });
    const appStore = new store.AppStore(userData);
    registerIPCHandlers(appStore, win);
    await win.loadURL('data:text/html,<html></html>');
    const run = (js) => win.webContents.executeJavaScript(`(async () => { try { ${js} } catch (e) { return { error: String(e.message || e) }; } })()`);

    const voices = await run(`return await window.robin.ttsNeuralVoices();`);
    if (!Array.isArray(voices) || voices.length < 4) throw new Error(`音色清单异常: ${JSON.stringify(voices)?.slice(0, 80)}`);
    console.log(`PASS 音色清单 ${voices.length} 条（含 ${voices[0].id}）`);

    const result = await run(`
      return await window.robin.ttsSynthesize({
        engine: 'edge',
        text: '知更阅读，纸感与智能并存。这是一条神经语音合成探针。',
        voice: 'zh-CN-XiaoxiaoNeural',
        rate: 1,
      });
    `);
    if (typeof result !== 'string' || result.length < 2048) throw new Error(`合成结果异常: ${JSON.stringify(result)?.slice(0, 120)}`);
    const head = Buffer.from(result.slice(0, 32), 'base64');
    const isMp3 = (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
    if (!isMp3) throw new Error(`音频头非 MP3: ${head.toString('hex').slice(0, 16)}`);
    console.log(`PASS 神经语音真实合成成功（${Math.round(result.length * 3 / 4 / 1024)}KB，MP3 头合法）`);

    const cfg = await run(`return await window.robin.ttsSetConfig({ engine: 'edge', neuralVoice: 'zh-CN-XiaoxiaoNeural' });`);
    if (!cfg || cfg.engine !== 'edge') throw new Error(`配置存取异常: ${JSON.stringify(cfg)}`);
    console.log('PASS 朗读引擎配置存取正常');
    app.exit(0);
  } catch (error) {
    console.error('FAIL', error?.message || error);
    app.exit(1);
  }
});
