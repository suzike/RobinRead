'use strict';
/**
 * RobinRead（知更）— Feed 图标存储（内存 → 磁盘 → 网络 三级缓存）
 *
 * 背景：侧栏/列表此前直接热链 www.google.com/s2/favicons——无缓存、大陆网络不可达，
 * 图标反复请求失败只落字母徽章。渲染层现在把图标地址统一指向 robin-icon:// 协议，
 * 主进程在此按 key 提供图标：内存命中 → 磁盘命中 → 网络抓取（候选依次尝试）。
 * 失败记 5 天冷却，期间直接 404（渲染层回落首字母徽标），不再空转打网络。
 */
const fs = require('node:fs');
const path = require('node:path');
const { stableDigest } = require('./Models');

const FETCH_TIMEOUT_MS = 8000;
const MAX_ICON_BYTES = 512 * 1024;
const FAILURE_RETRY_MS = 5 * 24 * 3600 * 1000;
const MEMORY_LIMIT = 600;
const MAX_CONCURRENT_FETCHES = 4;
// 磁盘/失败表上限：恶意源轮换唯一图标 URL 可无限新增 key（每 key 一个文件）
const DISK_FILE_LIMIT = 300;
const FAILURE_LIMIT = 2000;

class FeedIconStore {
  constructor(cacheDir) {
    this.cacheDir = cacheDir;
    this.memory = new Map();   // key -> dataURL（Map 迭代序 = 插入序，用于淘汰最早）
    this.failures = new Map(); // key -> 冷却截止时间戳
    this.inflight = new Map(); // key -> Promise（并发去重）
    this._active = 0;
    this._queue = [];
    try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (_) { /* 目录建不了则磁盘层失效 */ }
  }

  _key(params) {
    return stableDigest(
      `${params.storedIconURL || ''}|${params.siteURL || ''}|${params.feedURL || ''}|${params.host || ''}`
    );
  }

  /** 返回 data URL；不可得（失败冷却中）返回 null。 */
  async load(params) {
    const key = this._key(params);
    const hit = this.memory.get(key);
    if (hit) return hit;

    const retryAfter = this.failures.get(key);
    if (retryAfter && Date.now() < retryAfter) return null;

    const disk = this._readDisk(key);
    if (disk) {
      this.memory.set(key, disk);
      this._trimMemory();
      return disk;
    }

    if (this.inflight.has(key)) return this.inflight.get(key);
    const promise = this._runLimited(() => this._fetchAndStore(key, params))
      .catch(() => null)
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  async _fetchAndStore(key, params) {
    const candidates = [];
    if (params.storedIconURL && /^https?:/i.test(params.storedIconURL)) {
      candidates.push(params.storedIconURL);
    }
    for (const base of [params.siteURL, params.feedURL]) {
      if (!base) continue;
      try {
        const u = new URL(base);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
        candidates.push(`${u.protocol}//${u.host}/favicon.ico`);
      } catch (_) { /* 非法地址跳过 */ }
    }
    if (params.host) {
      // 兜底：Google s2（大陆网络下通常不可达，前面候选成功则不会走到这里）
      candidates.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(params.host)}&sz=64`);
    }

    for (const url of candidates) {
      const icon = await this._fetchOne(url);
      if (icon) {
        const dataURL = `data:${icon.mime};base64,${icon.body.toString('base64')}`;
        this.memory.set(key, dataURL);
        this._trimMemory();
        this._writeDisk(key, dataURL);
        return dataURL;
      }
    }
    this.failures.set(key, Date.now() + FAILURE_RETRY_MS);
    if (this.failures.size > FAILURE_LIMIT) {
      const oldest = this.failures.keys().next().value;
      this.failures.delete(oldest);
    }
    return null;
  }

  async _fetchOne(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 RobinRead', Accept: 'image/*' },
      });
      if (!res.ok) return null;
      const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > MAX_ICON_BYTES) return null;
      if (!type.startsWith('image/') && type !== 'application/octet-stream') return null;
      return { body: buf, mime: type.startsWith('image/') ? type : 'image/x-icon' };
    } catch (_) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  _trimMemory() {
    while (this.memory.size > MEMORY_LIMIT) {
      const oldest = this.memory.keys().next().value;
      this.memory.delete(oldest);
    }
  }

  _diskPath(key) { return path.join(this.cacheDir, `${key}.txt`); }

  _readDisk(key) {
    try {
      const text = fs.readFileSync(this._diskPath(key), 'utf8');
      return text.startsWith('data:image/') ? text : null;
    } catch (_) {
      return null;
    }
  }

  _writeDisk(key, dataURL) {
    try {
      fs.writeFileSync(this._diskPath(key), dataURL, 'utf8');
      this._pruneDisk();
    } catch (_) { /* 磁盘失败不影响内存层 */ }
  }

  /** 磁盘配额：超出上限按 mtime LRU 清最旧（防恶意源轮换 URL 撑爆磁盘）。 */
  _pruneDisk() {
    let names;
    try {
      names = fs.readdirSync(this.cacheDir).filter((f) => f.endsWith('.txt'));
    } catch (_) { return; }
    const overflow = names.length - DISK_FILE_LIMIT;
    if (overflow <= 0) return;
    const stats = names.map((f) => {
      try { return { f, m: fs.statSync(path.join(this.cacheDir, f)).mtimeMs }; }
      catch (_) { return { f, m: 0 }; }
    }).sort((a, b) => a.m - b.m);
    for (let i = 0; i < overflow; i += 1) {
      try {
        fs.unlinkSync(path.join(this.cacheDir, stats[i].f));
        this.failures.delete(stats[i].f.replace(/\.txt$/, ''));
      } catch (_) { /* 跳过 */ }
    }
  }

  _runLimited(fn) {
    return new Promise((resolve, reject) => {
      const run = () => {
        this._active += 1;
        fn().then(resolve, reject).finally(() => {
          this._active -= 1;
          const next = this._queue.shift();
          if (next) next();
        });
      };
      if (this._active < MAX_CONCURRENT_FETCHES) run();
      else this._queue.push(run);
    });
  }
}

module.exports = { FeedIconStore };
