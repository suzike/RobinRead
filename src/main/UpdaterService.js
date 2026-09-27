'use strict';
/**
 * UpdaterService.js — 应用内在线更新（下载安装包 → 静默安装 → 重启）
 *
 * 流程：检查更新（UpdateCheckService 双源）→ 拿 GitHub release 的 setup.exe 资产直链
 *      → net.fetch 流式下载到 userData/updates/（进度经 onProgress 回调推送渲染层）
 *      → 渲染层确认后 install()：以 /S 静默重装到当前安装目录 → 应用退出，安装器接管。
 * 仅 Windows NSIS 安装版；便携版降级为打开 Release 页。
 */
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const UPDATE_DIR_NAME = 'updates';

class UpdaterService {
  constructor(userDataDir) {
    this.updateDir = path.join(userDataDir, UPDATE_DIR_NAME);
    this.downloading = false;
    this.file = null;
    this.cancelled = false;
  }

  /** 从 release 信息里解析 Windows 安装包直链（GitHub assets；官网源无 assets → null）。 */
  resolveSetupAssetURL(release) {
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    const setup = assets.find((a) => /-setup\.exe$/i.test(a.name || '')) || null;
    return setup ? (setup.browser_download_url || setup.url || null) : null;
  }

  /**
   * 下载安装包。onProgress({ received, total, percent }) 节流回调；返回 { file, bytes }。
   * fetchImpl 由 main.js 注入（net.fetch 走系统代理）。
   */
  async download(assetURL, expectedName, onProgress, fetchImpl) {
    if (this.downloading) throw new Error('已有下载任务进行中');
    this.downloading = true;
    this.cancelled = false;
    try {
      const doFetch = fetchImpl || fetch;
      const response = await doFetch(assetURL, { headers: { 'User-Agent': 'RobinRead' } });
      if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
      const total = Number(response.headers.get('content-length')) || 0;
      fs.mkdirSync(this.updateDir, { recursive: true });
      const safeName = String(expectedName || 'update').replace(/[^\w.-]/g, '_');
      this.file = path.join(this.updateDir, safeName);
      const out = fs.createWriteStream(this.file);
      let received = 0;
      let lastEmit = 0;
      const emit = () => {
        const now = Date.now();
        if (now - lastEmit < 300 && !(total && received >= total)) return;
        lastEmit = now;
        try { onProgress?.({ received, total, percent: total ? Math.min(100, Math.round((received / total) * 100)) : 0 }); } catch (_) { /* 忽略 */ }
      };
      const write = (buf) => { out.write(buf); received += buf.length; emit(); };
      const pump = response.body.pipe ? response.body : null;
      await new Promise((resolve, reject) => {
        if (pump) {
          pump.on('data', write);
          pump.on('error', reject);
          out.on('error', reject);
          pump.on('end', resolve);
        } else {
          // Web 流回退（fetch polyfill）
          (async () => {
            const reader = response.body.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              write(Buffer.from(value));
            }
            resolve();
          })().catch(reject);
        }
      });
      await new Promise((resolve) => out.end(resolve));
      if (this.cancelled) throw new Error('下载已取消');
      return { file: this.file, bytes: received };
    } finally {
      this.downloading = false;
    }
  }

  /** 静默安装：NSIS /S 重装到当前安装目录后退出应用。 */
  install() {
    if (!this.file || !fs.existsSync(this.file)) throw new Error('安装包不存在，请先下载');
    const installDir = path.dirname(process.execPath); // 安装版 exe 所在目录
    const child = spawn(this.file, ['/S', `/D=${installDir}`], { detached: true, stdio: 'ignore' });
    child.unref();
    setTimeout(() => { try { require('electron').app.quit(); } catch (_) { process.exit(0); } }, 1200);
    return { launched: true, installDir };
  }
}

module.exports = { UpdaterService };
