import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectSyncCandidates, readJsonSafe, resolvePaths } from '../../compat/platform.mjs';
import { LocalUsageCollector, toLocalDateKey } from './collector.mjs';
import { WebDavSyncClient, normalizeWebDavConfig, redactWebDavConfig } from './webdav.mjs';

export const SNAPSHOT_SCHEMA_VERSION = 1;
export const VALID_SYNC_MODES = ['folder', 'webdav', 'both', 'local-only'];
const DEFAULT_SYNC_INTERVAL_MS = 30_000;

async function writeConfigJsonSecure(file, obj) {
  await fsp.writeFile(file, JSON.stringify(obj, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  if (process.platform !== 'win32') {
    await fsp.chmod(file, 0o600).catch(() => {});
  }
}

export function sanitizeSettingsForClient(config = {}) {
  return {
    syncMode: VALID_SYNC_MODES.includes(config.syncMode)
      ? config.syncMode
      : config.syncDir
        ? 'folder'
        : 'local-only',
    syncDir: config.syncDir || '',
    webdav: redactWebDavConfig(config.webdav || {}),
    deviceName: config.deviceName || '',
    language: config.language === 'en' ? 'en' : 'zh-CN',
    syncIntervalMs: Number(config.syncIntervalMs || DEFAULT_SYNC_INTERVAL_MS),
    updatedAt: Number(config.updatedAt || 0),
  };
}

function sanitizeSlug(raw) {
  return String(raw || 'device')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28) || 'device';
}

function emptyBucket() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
    generations: 0,
  };
}

function addBucket(target, source) {
  if (!source) return;
  target.inputTokens += Number(source.inputTokens || 0);
  target.outputTokens += Number(source.outputTokens || 0);
  target.cacheReadTokens += Number(source.cacheReadTokens || 0);
  target.cacheWriteTokens += Number(source.cacheWriteTokens || 0);
  target.thinkingTokens += Number(source.thinkingTokens || 0);
  target.totalTokens += Number(source.totalTokens || 0);
  target.generations += Number(source.generations || 0);
}

async function renameWithRetry(src, dest, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    try {
      await fsp.rename(src, dest);
      return;
    } catch (err) {
      if ((err?.code === 'EPERM' || err?.code === 'EBUSY') && i < retries) {
        await new Promise((r) => setTimeout(r, 50 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Pure aggregation across multiple valid device snapshots.
 * Sums metrics across devices without overwriting peer data.
 */
export function mergeDeviceSnapshots(snapshots, currentDeviceId, nowMs = Date.now()) {
  const valid = (snapshots || []).filter(
    (s) => s && s.schemaVersion === SNAPSHOT_SCHEMA_VERSION && s.deviceId && s.local?.totals
  );

  const todayKey = toLocalDateKey(nowMs);
  const mergedTotals = emptyBucket();
  let conversationCount = 0;

  const byDateMap = new Map();
  const byModelMap = new Map();
  const allRecent = [];

  for (const snap of valid) {
    const loc = snap.local;
    addBucket(mergedTotals, loc.totals);
    conversationCount += Number(loc.conversationCount || 0);

    for (const [dateKey, bucket] of Object.entries(loc.byDate || {})) {
      if (!byDateMap.has(dateKey)) byDateMap.set(dateKey, emptyBucket());
      addBucket(byDateMap.get(dateKey), bucket);
    }

    for (const [modelId, mBucket] of Object.entries(loc.byModel || {})) {
      if (!byModelMap.has(modelId)) {
        byModelMap.set(modelId, {
          modelId,
          displayName: mBucket.displayName || modelId,
          ...emptyBucket(),
        });
      }
      const dst = byModelMap.get(modelId);
      if (mBucket.displayName && mBucket.displayName.length > dst.displayName.length) {
        dst.displayName = mBucket.displayName;
      }
      addBucket(dst, mBucket);
    }

    for (const conv of loc.recentConversations || []) {
      allRecent.push({
        ...conv,
        deviceId: snap.deviceId,
        deviceName: snap.deviceName || snap.hostname || snap.deviceId,
      });
    }
  }

  const cacheDenom = mergedTotals.inputTokens + mergedTotals.cacheReadTokens;
  const cacheHitRate = cacheDenom > 0 ? Number((mergedTotals.cacheReadTokens / cacheDenom).toFixed(4)) : 0;

  const byDate = Object.create(null);
  const sortedDates = Array.from(byDateMap.keys()).sort();
  for (const dk of sortedDates) {
    byDate[dk] = byDateMap.get(dk);
  }

  const todayBucket = byDate[todayKey] || emptyBucket();

  const models = Array.from(byModelMap.values()).sort((a, b) => b.totalTokens - a.totalTokens);
  const totalMergedTokens = mergedTotals.totalTokens;

  const devices = valid
    .map((snap) => {
      const devTotal = Number(snap.local.totals.totalTokens || 0);
      const devToday = Number(snap.local.byDate?.[todayKey]?.totalTokens || 0);
      const cDenom = Number(snap.local.totals.inputTokens || 0) + Number(snap.local.totals.cacheReadTokens || 0);
      const cRate = cDenom > 0 ? Number((Number(snap.local.totals.cacheReadTokens || 0) / cDenom).toFixed(4)) : 0;
      return {
        deviceId: snap.deviceId,
        deviceName: snap.deviceName || snap.hostname || snap.deviceId,
        hostname: snap.hostname || '',
        platform: snap.platform || '',
        arch: snap.arch || '',
        updatedAt: Number(snap.updatedAt || snap.local.collectedAt || 0),
        isCurrent: snap.deviceId === currentDeviceId,
        conversationCount: Number(snap.local.conversationCount || 0),
        totals: { ...snap.local.totals, cacheHitRate: cRate },
        todayTokens: devToday,
        latestGeneration: snap.local.latestGeneration || null,
        shareRatio: totalMergedTokens > 0 ? Number((devTotal / totalMergedTokens).toFixed(4)) : 0,
      };
    })
    .sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
      return b.totals.totalTokens - a.totals.totalTokens;
    });

  const recentConversations = allRecent
    .sort((a, b) => Number(b.lastModifiedMs || 0) - Number(a.lastModifiedMs || 0))
    .slice(0, 15);

  return {
    todayKey,
    deviceCount: devices.length,
    conversationCount,
    totals: {
      ...mergedTotals,
      cacheHitRate,
    },
    today: todayBucket,
    byDate,
    models,
    devices,
    recentConversations,
  };
}

/**
 * Manages device identity, config.json, atomic Syncthing-safe snapshot writes,
 * and additive multi-device aggregation.
 */
export class SyncManager {
  constructor(options = {}) {
    this.paths = options.paths || resolvePaths();
    this.collector = options.collector || new LocalUsageCollector(this.paths);
    this.webdavClient = options.webdavClient || new WebDavSyncClient(options.webdavOptions);
    this.dataDir = options.dataDir || this.paths.pluginDataDir;
    this.configFile = path.join(this.dataDir, 'config.json');
    this.deviceFile = path.join(this.dataDir, 'device.json');
    this.lastMerged = null;
    this.lastSyncAt = 0;
    this.lastSyncStatus = { ok: false, mode: 'local-only', error: null, conflictFiles: [] };
  }

  mergeConfigDraft(baseConfig, patch = {}) {
    const nextConfig = {
      ...baseConfig,
      webdav: normalizeWebDavConfig(baseConfig.webdav || {}),
    };

    if (typeof patch.syncMode === 'string' && VALID_SYNC_MODES.includes(patch.syncMode)) {
      nextConfig.syncMode = patch.syncMode;
    }
    if (typeof patch.syncDir === 'string') {
      nextConfig.syncDir = patch.syncDir.trim();
      if (!patch.syncMode && patch.syncDir.trim() && nextConfig.syncMode === 'local-only') {
        nextConfig.syncMode = 'folder';
      }
    }
    if (patch.webdav && typeof patch.webdav === 'object') {
      const incoming = patch.webdav;
      const prevPass = nextConfig.webdav.password || '';
      const mergedPass =
        incoming.clearPassword === true
          ? ''
          : typeof incoming.password === 'string' && incoming.password.length > 0
            ? incoming.password
            : prevPass;
      nextConfig.webdav = normalizeWebDavConfig({
        url: typeof incoming.url === 'string' ? incoming.url : nextConfig.webdav.url,
        remotePath: typeof incoming.remotePath === 'string' ? incoming.remotePath : nextConfig.webdav.remotePath,
        username: typeof incoming.username === 'string' ? incoming.username : nextConfig.webdav.username,
        password: mergedPass,
      });
    }
    if (typeof patch.deviceName === 'string' && patch.deviceName.trim()) {
      nextConfig.deviceName = patch.deviceName.trim();
    }
    if (patch.language === 'zh-CN' || patch.language === 'en') {
      nextConfig.language = patch.language;
    }
    if (typeof patch.syncIntervalMs === 'number' && patch.syncIntervalMs >= 5000) {
      nextConfig.syncIntervalMs = Math.floor(patch.syncIntervalMs);
    }

    return nextConfig;
  }

  async ensureIdentityAndConfig() {
    await fsp.mkdir(this.dataDir, { recursive: true });

    let device = readJsonSafe(this.deviceFile, null);
    if (!device?.deviceId) {
      const hostname = os.hostname() || 'host';
      const suffix = crypto.randomBytes(3).toString('hex');
      device = {
        deviceId: `${sanitizeSlug(hostname)}-${suffix}`,
        deviceName: hostname,
        hostname,
        platform: process.platform,
        arch: process.arch,
        createdAt: Date.now(),
      };
      await fsp.writeFile(this.deviceFile, JSON.stringify(device, null, 2) + '\n', 'utf8');
    }

    const candidates = detectSyncCandidates(this.paths);
    let config = readJsonSafe(this.configFile, null);
    let dirty = false;

    if (!config) {
      const defaultDir = process.env.AGY_SYNC_DIR || candidates[0] || '';
      config = {
        syncMode: defaultDir ? 'folder' : 'local-only',
        syncDir: defaultDir,
        webdav: normalizeWebDavConfig({}),
        deviceName: device.deviceName || os.hostname(),
        language: 'zh-CN',
        syncIntervalMs: DEFAULT_SYNC_INTERVAL_MS,
        updatedAt: Date.now(),
      };
      dirty = true;
    } else {
      if (!config.syncDir && (process.env.AGY_SYNC_DIR || candidates[0])) {
        config.syncDir = process.env.AGY_SYNC_DIR || candidates[0] || '';
        dirty = true;
      }
      if (!VALID_SYNC_MODES.includes(config.syncMode)) {
        config.syncMode = config.syncDir ? 'folder' : 'local-only';
        dirty = true;
      }
      const normDav = normalizeWebDavConfig(config.webdav || {});
      if (!config.webdav || JSON.stringify(normDav) !== JSON.stringify(config.webdav)) {
        config.webdav = normDav;
        dirty = true;
      }
      if (!config.deviceName) {
        config.deviceName = device.deviceName || os.hostname();
        dirty = true;
      }
      if (!config.language) {
        config.language = 'zh-CN';
        dirty = true;
      }
      if (!config.syncIntervalMs) {
        config.syncIntervalMs = DEFAULT_SYNC_INTERVAL_MS;
        dirty = true;
      }
    }

    if (dirty) {
      await writeConfigJsonSecure(this.configFile, config);
    }

    return { device, config, candidates };
  }

  async updateSettings(patch = {}) {
    const { device, config, candidates } = await this.ensureIdentityAndConfig();
    const nextConfig = this.mergeConfigDraft(config, patch);

    if (nextConfig.deviceName !== device.deviceName) {
      device.deviceName = nextConfig.deviceName;
      await fsp.writeFile(this.deviceFile, JSON.stringify(device, null, 2) + '\n', 'utf8');
    }

    nextConfig.updatedAt = Date.now();
    await writeConfigJsonSecure(this.configFile, nextConfig);

    const synced = await this.syncOnce();
    return {
      settings: sanitizeSettingsForClient(nextConfig),
      candidates,
      synced,
    };
  }

  async testConnection(patch = {}) {
    const { config } = await this.ensureIdentityAndConfig();
    const draft = this.mergeConfigDraft(config, patch);
    const target = patch.target || draft.syncMode;
    const result = { ok: true, target, folder: null, webdav: null };

    if (target === 'folder' || target === 'both') {
      const dir = (draft.syncDir || '').trim();
      if (!dir) {
        result.folder = { ok: false, error: 'Sync folder path is empty' };
        result.ok = false;
      } else {
        try {
          const devicesDir = path.join(dir, 'devices');
          await fsp.mkdir(devicesDir, { recursive: true });
          const probeFile = path.join(devicesDir, `.probe-${process.pid}.tmp`);
          await fsp.writeFile(probeFile, 'ok', 'utf8');
          await fsp.unlink(probeFile);
          const { peerSnapshots, conflictFiles } = await this.readAllPeerSnapshots(dir);
          result.folder = {
            ok: true,
            syncDir: dir,
            deviceFiles: peerSnapshots.map((p) => `${p.deviceId}.json`),
            conflictFiles,
          };
        } catch (err) {
          result.folder = { ok: false, syncDir: dir, error: err?.message || String(err) };
          result.ok = false;
        }
      }
    }

    if (target === 'webdav' || target === 'both') {
      try {
        result.webdav = await this.webdavClient.testConnection(draft.webdav);
      } catch (err) {
        result.webdav = { ok: false, error: err?.message || String(err) };
        result.ok = false;
      }
    }

    return result;
  }

  async writeDeviceSnapshot(syncDir, snapshot) {
    const devicesDir = path.join(syncDir, 'devices');
    await fsp.mkdir(devicesDir, { recursive: true });
    const targetPath = path.join(devicesDir, `${snapshot.deviceId}.json`);
    // Prefix with `.syncthing.` so Syncthing treats this file as an ignored temporary artifact during write.
    const tmpPath = path.join(devicesDir, `.syncthing.${snapshot.deviceId}.${process.pid}.tmp`);
    await fsp.writeFile(tmpPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
    try {
      await renameWithRetry(tmpPath, targetPath);
    } catch (err) {
      await fsp.unlink(tmpPath).catch(() => {});
      throw err;
    }
    return targetPath;
  }

  async readAllPeerSnapshots(syncDir) {
    const devicesDir = path.join(syncDir, 'devices');
    const conflictFiles = [];
    const peerSnapshots = [];

    if (!fs.existsSync(devicesDir)) {
      return { peerSnapshots, conflictFiles };
    }

    const entries = await fsp.readdir(devicesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      if (name.startsWith('.') || name.endsWith('.tmp')) continue;
      if (name.toLowerCase().includes('sync-conflict')) {
        conflictFiles.push(name);
        continue;
      }
      if (!name.endsWith('.json')) continue;

      const fullPath = path.join(devicesDir, name);
      const parsed = readJsonSafe(fullPath, null);
      if (
        parsed &&
        parsed.schemaVersion === SNAPSHOT_SCHEMA_VERSION &&
        typeof parsed.deviceId === 'string' &&
        parsed.local?.totals
      ) {
        peerSnapshots.push(parsed);
      }
    }

    return { peerSnapshots, conflictFiles };
  }

  async syncOnce() {
    const { device, config, candidates } = await this.ensureIdentityAndConfig();
    const localSnapshot = await this.collector.collect();

    const mySnapshot = {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      deviceId: device.deviceId,
      deviceName: config.deviceName || device.deviceName,
      hostname: device.hostname || os.hostname(),
      platform: device.platform || process.platform,
      arch: device.arch || process.arch,
      updatedAt: Date.now(),
      local: localSnapshot,
    };

    const configuredMode = VALID_SYNC_MODES.includes(config.syncMode)
      ? config.syncMode
      : config.syncDir
        ? 'folder'
        : 'local-only';
    const syncDir = (config.syncDir || '').trim();
    const useFolder = (configuredMode === 'folder' || configuredMode === 'both') && Boolean(syncDir);
    const useWebDav = (configuredMode === 'webdav' || configuredMode === 'both') && Boolean(config.webdav?.url);

    const byId = new Map();
    const conflictFiles = [];
    const errors = [];
    let snapshotPath = null;
    let remoteSnapshotUrl = null;
    let folderOk = false;
    let webdavOk = false;

    const addPeer = (peer) => {
      if (!peer?.deviceId) return;
      const existing = byId.get(peer.deviceId);
      if (!existing || Number(peer.updatedAt || 0) >= Number(existing.updatedAt || 0)) {
        byId.set(peer.deviceId, peer);
      }
    };

    if (useFolder) {
      try {
        snapshotPath = await this.writeDeviceSnapshot(syncDir, mySnapshot);
        const res = await this.readAllPeerSnapshots(syncDir);
        res.peerSnapshots.forEach(addPeer);
        conflictFiles.push(...res.conflictFiles);
        folderOk = true;
      } catch (err) {
        errors.push(`Folder: ${err?.message || String(err)}`);
      }
    }

    if (useWebDav) {
      try {
        remoteSnapshotUrl = await this.webdavClient.uploadSnapshot(config.webdav, mySnapshot);
        const res = await this.webdavClient.fetchPeerSnapshots(config.webdav, mySnapshot.deviceId);
        res.peerSnapshots.forEach(addPeer);
        conflictFiles.push(...res.conflictFiles);
        webdavOk = true;
      } catch (err) {
        errors.push(`WebDAV: ${err?.message || String(err)}`);
      }
    }

    // Replace/inject current device using authoritative in-memory snapshot.
    byId.set(mySnapshot.deviceId, mySnapshot);

    let syncMode = 'local-only';
    if (errors.length > 0 && !folderOk && !webdavOk) {
      syncMode = 'sync-error';
    } else if (folderOk && webdavOk) {
      syncMode = 'both';
    } else if (webdavOk) {
      syncMode = 'webdav';
    } else if (folderOk) {
      syncMode = 'sync-folder';
    } else if (configuredMode === 'webdav' || configuredMode === 'folder' || configuredMode === 'both') {
      // Selected sync mode lacks target URL/path or encountered partial error
      syncMode = errors.length > 0 ? 'sync-error' : 'local-only';
    }

    const syncError = errors.length ? errors.join(' | ') : null;
    const merged = mergeDeviceSnapshots(Array.from(byId.values()), mySnapshot.deviceId);
    this.lastSyncAt = Date.now();
    this.lastSyncStatus = {
      ok: syncMode !== 'sync-error' && !syncError,
      mode: syncMode,
      configuredMode,
      syncDir,
      remoteDirUrl: config.webdav?.url ? `${config.webdav.url.replace(/\/+$/, '')}${config.webdav.remotePath || '/agy-sync-dashboard'}/devices/` : '',
      snapshotPath,
      remoteSnapshotUrl,
      error: syncError,
      conflictFiles: [...new Set(conflictFiles)],
      lastSyncAt: this.lastSyncAt,
    };

    this.lastMerged = {
      device: mySnapshot,
      settings: sanitizeSettingsForClient(config),
      candidates,
      syncStatus: this.lastSyncStatus,
      merged,
    };

    return this.lastMerged;
  }
}
