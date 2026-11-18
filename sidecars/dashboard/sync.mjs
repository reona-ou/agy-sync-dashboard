import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectSyncCandidates, readJsonSafe, resolvePaths } from '../../compat/platform.mjs';
import { LocalUsageCollector, toLocalDateKey } from './collector.mjs';

export const SNAPSHOT_SCHEMA_VERSION = 1;
const DEFAULT_SYNC_INTERVAL_MS = 30_000;

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
    this.dataDir = options.dataDir || this.paths.pluginDataDir;
    this.configFile = path.join(this.dataDir, 'config.json');
    this.deviceFile = path.join(this.dataDir, 'device.json');
    this.lastMerged = null;
    this.lastSyncAt = 0;
    this.lastSyncStatus = { ok: false, mode: 'local-only', error: null, conflictFiles: [] };
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
      config = {
        syncDir: process.env.AGY_SYNC_DIR || candidates[0] || '',
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
      await fsp.writeFile(this.configFile, JSON.stringify(config, null, 2) + '\n', 'utf8');
    }

    return { device, config, candidates };
  }

  async updateSettings(patch = {}) {
    const { device, config, candidates } = await this.ensureIdentityAndConfig();

    const nextConfig = { ...config };
    if (typeof patch.syncDir === 'string') {
      nextConfig.syncDir = patch.syncDir.trim();
    }
    if (typeof patch.deviceName === 'string' && patch.deviceName.trim()) {
      nextConfig.deviceName = patch.deviceName.trim();
      device.deviceName = nextConfig.deviceName;
      await fsp.writeFile(this.deviceFile, JSON.stringify(device, null, 2) + '\n', 'utf8');
    }
    if (patch.language === 'zh-CN' || patch.language === 'en') {
      nextConfig.language = patch.language;
    }
    if (typeof patch.syncIntervalMs === 'number' && patch.syncIntervalMs >= 5000) {
      nextConfig.syncIntervalMs = Math.floor(patch.syncIntervalMs);
    }
    nextConfig.updatedAt = Date.now();
    await fsp.writeFile(this.configFile, JSON.stringify(nextConfig, null, 2) + '\n', 'utf8');

    const synced = await this.syncOnce();
    return {
      settings: nextConfig,
      candidates,
      synced,
    };
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

    const syncDir = (config.syncDir || '').trim();
    let peerSnapshots = [];
    let conflictFiles = [];
    let syncMode = 'local-only';
    let syncError = null;
    let snapshotPath = null;

    if (syncDir) {
      try {
        snapshotPath = await this.writeDeviceSnapshot(syncDir, mySnapshot);
        const res = await this.readAllPeerSnapshots(syncDir);
        peerSnapshots = res.peerSnapshots;
        conflictFiles = res.conflictFiles;
        syncMode = 'sync-folder';
      } catch (err) {
        syncError = err?.message || String(err);
        syncMode = 'sync-error';
      }
    }

    // Replace/inject current device using authoritative in-memory snapshot.
    const byId = new Map();
    for (const peer of peerSnapshots) {
      byId.set(peer.deviceId, peer);
    }
    byId.set(mySnapshot.deviceId, mySnapshot);

    const merged = mergeDeviceSnapshots(Array.from(byId.values()), mySnapshot.deviceId);
    this.lastSyncAt = Date.now();
    this.lastSyncStatus = {
      ok: syncMode !== 'sync-error',
      mode: syncMode,
      syncDir,
      snapshotPath,
      error: syncError,
      conflictFiles,
      lastSyncAt: this.lastSyncAt,
    };

    this.lastMerged = {
      device: mySnapshot,
      settings: config,
      candidates,
      syncStatus: this.lastSyncStatus,
      merged,
    };

    return this.lastMerged;
  }
}
