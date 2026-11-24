import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectSyncCandidates, readJsonSafe, resolvePaths } from '../../compat/platform.mjs';
import { LocalUsageCollector, toLocalDateKey } from './collector.mjs';
import {
  SLOT_MS,
  WINDOW_5H_MS,
  WINDOW_7D_MS,
  classifyModelFamily,
  mergeCalibrationMaps,
  normalizeStoredCycles,
} from './forecast.mjs';
import { WebDavSyncClient, normalizeWebDavConfig, redactWebDavConfig } from './webdav.mjs';

export const SNAPSHOT_SCHEMA_VERSION = 1;
export const USAGE_PERIODS = ['5h', 'today', '7d', 'all'];
export const VALID_SYNC_MODES = ['folder', 'webdav', 'both', 'local-only'];
export const SUPPORTED_LANGUAGES = ['zh-CN', 'en', 'ja'];
const DEFAULT_SYNC_INTERVAL_MS = 30_000;

export function normalizeLanguage(lang) {
  return SUPPORTED_LANGUAGES.includes(lang) ? lang : 'zh-CN';
}

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
    language: normalizeLanguage(config.language),
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

function addScaledBucket(target, source, ratio = 1) {
  if (!source || ratio <= 0) return;
  if (ratio >= 0.999999) {
    addBucket(target, source);
    return;
  }
  target.inputTokens += Math.round(Number(source.inputTokens || 0) * ratio);
  target.outputTokens += Math.round(Number(source.outputTokens || 0) * ratio);
  target.cacheReadTokens += Math.round(Number(source.cacheReadTokens || 0) * ratio);
  target.cacheWriteTokens += Math.round(Number(source.cacheWriteTokens || 0) * ratio);
  target.thinkingTokens += Math.round(Number(source.thinkingTokens || 0) * ratio);
  target.totalTokens += Math.round(Number(source.totalTokens || 0) * ratio);
  target.generations += Math.round(Number(source.generations || 0) * ratio);
}

function computeCacheHitRate(bucket) {
  const denom = Number(bucket?.inputTokens || 0) + Number(bucket?.cacheReadTokens || 0);
  return denom > 0 ? Number((Number(bucket?.cacheReadTokens || 0) / denom).toFixed(4)) : 0;
}

function emptyPeriodBuckets() {
  return {
    '5h': emptyBucket(),
    today: emptyBucket(),
    '7d': emptyBucket(),
    all: emptyBucket(),
  };
}

function finalizePeriodBucket(bucket, periodTotalTokens) {
  const b = bucket || emptyBucket();
  const totalTokens = Number(b.totalTokens || 0);
  return {
    ...b,
    cacheHitRate: computeCacheHitRate(b),
    shareRatio: periodTotalTokens > 0 ? Number((totalTokens / periodTotalTokens).toFixed(4)) : 0,
  };
}

function resolveTodayStartMs(todayKey, nowMs) {
  const parsed = Date.parse(`${todayKey}T00:00:00`);
  if (Number.isFinite(parsed)) return parsed;
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function computeSlotOverlapRatio(slotIdx, winStartMs, nowMs) {
  if (!Number.isFinite(slotIdx)) return 0;
  const slotStart = slotIdx * SLOT_MS;
  const slotEnd = slotStart + SLOT_MS;
  if (slotEnd <= winStartMs || slotStart >= nowMs) return 0;
  // Events in the current active slot occurred at or before nowMs, not in the future.
  const overlapStart = Math.max(winStartMs, slotStart);
  const overlap = slotEnd - overlapStart;
  return overlap > 0 ? Math.min(1, overlap / SLOT_MS) : 0;
}

function buildModelWeightList(byModel) {
  const entries = Object.entries(byModel || {});
  const total = entries.reduce((sum, [, mb]) => sum + Number(mb?.totalTokens || 0), 0);
  if (total <= 0) return [];
  return entries
    .map(([modelId, mb]) => [modelId, Number(mb?.totalTokens || 0) / total])
    .filter(([, w]) => w > 0);
}

function computeDevicePeriodData(loc, nowMs, todayKey, todayStartMs) {
  const devPeriods = emptyPeriodBuckets();
  const modelPeriods = new Map();
  const ensureModel = (modelId) => {
    if (!modelPeriods.has(modelId)) modelPeriods.set(modelId, emptyPeriodBuckets());
    return modelPeriods.get(modelId);
  };

  addBucket(devPeriods.all, loc.totals);
  for (const [modelId, mBucket] of Object.entries(loc.byModel || {})) {
    addBucket(ensureModel(modelId).all, mBucket);
  }

  const windowStarts = {
    '5h': nowMs - WINDOW_5H_MS,
    today: todayStartMs,
    '7d': nowMs - WINDOW_7D_MS,
  };

  if (loc.bySlotModel && typeof loc.bySlotModel === 'object') {
    for (const [slotKey, modelMap] of Object.entries(loc.bySlotModel)) {
      const slotIdx = Number(slotKey);
      if (!Number.isFinite(slotIdx)) continue;
      for (const pKey of ['5h', 'today', '7d']) {
        const ratio = computeSlotOverlapRatio(slotIdx, windowStarts[pKey], nowMs);
        if (ratio <= 0) continue;
        for (const [modelId, mSlot] of Object.entries(modelMap || {})) {
          addScaledBucket(devPeriods[pKey], mSlot, ratio);
          addScaledBucket(ensureModel(modelId)[pKey], mSlot, ratio);
        }
      }
    }
    return { devPeriods, modelPeriods };
  }

  const allWeights = buildModelWeightList(loc.byModel);

  if (loc.bySlot && typeof loc.bySlot === 'object' && Object.keys(loc.bySlot).length > 0) {
    const inTok = Number(loc.totals?.inputTokens || 0);
    const outTok = Number(loc.totals?.outputTokens || 0);
    const inOutSum = inTok + outTok;
    const inShare = inOutSum > 0 ? inTok / inOutSum : 1;

    const famWeights = Object.create(null);
    const famSums = Object.create(null);
    for (const [modelId, mb] of Object.entries(loc.byModel || {})) {
      const fam = classifyModelFamily(modelId, mb?.displayName);
      const tok = Number(mb?.totalTokens || 0);
      if (tok <= 0) continue;
      if (!famWeights[fam]) famWeights[fam] = [];
      famWeights[fam].push([modelId, tok]);
      famSums[fam] = (famSums[fam] || 0) + tok;
    }

    const toFullBucket = (sb) => {
      const tot = Number(sb?.totalTokens || 0);
      const nonCache = Number(sb?.nonCacheTokens || 0);
      const inputTokens = Math.round(nonCache * inShare);
      const outputTokens = Math.max(0, nonCache - inputTokens);
      return {
        inputTokens,
        outputTokens,
        cacheReadTokens: Math.max(0, tot - nonCache),
        cacheWriteTokens: 0,
        thinkingTokens: 0,
        totalTokens: tot,
        generations: Number(sb?.generations || 0),
      };
    };

    const hasTodayDate = Boolean(loc.byDate && Object.hasOwn(loc.byDate, todayKey));
    if (hasTodayDate) {
      addBucket(devPeriods.today, loc.byDate[todayKey]);
      for (const [modelId, w] of allWeights) {
        addScaledBucket(ensureModel(modelId).today, loc.byDate[todayKey], w);
      }
    }

    const pKeys = hasTodayDate ? ['5h', '7d'] : ['5h', 'today', '7d'];
    for (const [slotKey, famMap] of Object.entries(loc.bySlot)) {
      const slotIdx = Number(slotKey);
      if (!Number.isFinite(slotIdx)) continue;
      for (const pKey of pKeys) {
        const ratio = computeSlotOverlapRatio(slotIdx, windowStarts[pKey], nowMs);
        if (ratio <= 0) continue;
        for (const [fam, sb] of Object.entries(famMap || {})) {
          const full = toFullBucket(sb);
          addScaledBucket(devPeriods[pKey], full, ratio);
          const fList = famWeights[fam];
          const fSum = famSums[fam] || 0;
          if (fList && fSum > 0) {
            for (const [modelId, mTok] of fList) {
              addScaledBucket(ensureModel(modelId)[pKey], full, ratio * (mTok / fSum));
            }
          }
        }
      }
    }
    return { devPeriods, modelPeriods };
  }

  // Fallback for legacy daily-only snapshots (no bySlotModel or bySlot)
  if (loc.byDate?.[todayKey]) {
    addBucket(devPeriods.today, loc.byDate[todayKey]);
    for (const [modelId, w] of allWeights) {
      addScaledBucket(ensureModel(modelId).today, loc.byDate[todayKey], w);
    }
  }

  for (const [dateKey, dBucket] of Object.entries(loc.byDate || {})) {
    const dayStart = Date.parse(`${dateKey}T00:00:00`);
    if (!Number.isFinite(dayStart)) continue;
    const dayEnd = dayStart + 24 * 3600_000;
    for (const pKey of ['5h', '7d']) {
      const winStart = windowStarts[pKey];
      if (dayEnd <= winStart || dayStart >= nowMs) continue;
      let ratio;
      if (dayStart <= nowMs && nowMs < dayEnd) {
        const elapsed = Math.max(1, nowMs - dayStart);
        const overlap = Math.max(0, nowMs - Math.max(winStart, dayStart));
        ratio = Math.min(1, overlap / elapsed);
      } else {
        const overlap = Math.max(0, dayEnd - Math.max(winStart, dayStart));
        ratio = Math.min(1, overlap / (24 * 3600_000));
      }
      if (ratio <= 0) continue;
      addScaledBucket(devPeriods[pKey], dBucket, ratio);
      for (const [modelId, w] of allWeights) {
        addScaledBucket(ensureModel(modelId)[pKey], dBucket, ratio * w);
      }
    }
  }

  return { devPeriods, modelPeriods };
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

function pickDisplayName(current, candidate, modelId) {
  if (!candidate) return current || modelId;
  if (!current || current === modelId) return candidate;
  if (candidate === modelId) return current;
  return candidate.length > current.length ? candidate : current;
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
  const todayStartMs = resolveTodayStartMs(todayKey, nowMs);
  const mergedTotals = emptyBucket();
  const mergedPeriods = emptyPeriodBuckets();
  let conversationCount = 0;

  const byDateMap = new Map();
  const byModelMap = new Map();
  const devPeriodsMap = new WeakMap();
  const devModelPeriodsMap = new WeakMap();
  const bySlot = Object.create(null);
  const byMinute = Object.create(null);
  const fallbackBySlot = Object.create(null);
  const legacyByDate = Object.create(null);
  const calMaps = [];
  const allRecent = [];

  const mergeTimelineBuckets = (target, source) => {
    for (const [key, famMap] of Object.entries(source || {})) {
      if (!target[key]) target[key] = Object.create(null);
      for (const [fam, bucket] of Object.entries(famMap || {})) {
        if (!target[key][fam]) {
          target[key][fam] = { totalTokens: 0, nonCacheTokens: 0, inputTokens: 0, cacheReadTokens: 0, generations: 0 };
        }
        const dst = target[key][fam];
        dst.totalTokens += Number(bucket?.totalTokens || 0);
        dst.nonCacheTokens += Number(bucket?.nonCacheTokens || 0);
        dst.inputTokens += Number(bucket?.inputTokens || 0);
        dst.cacheReadTokens += Number(bucket?.cacheReadTokens || 0);
        dst.generations += Number(bucket?.generations || 0);
      }
    }
  };

  for (const snap of valid) {
    const loc = snap.local;
    if (snap.quotaCalibration && typeof snap.quotaCalibration === 'object') {
      calMaps.push(snap.quotaCalibration);
    }
    addBucket(mergedTotals, loc.totals);
    conversationCount += Number(loc.conversationCount || 0);

    const { devPeriods, modelPeriods } = computeDevicePeriodData(loc, nowMs, todayKey, todayStartMs);
    devPeriodsMap.set(snap, devPeriods);
    devModelPeriodsMap.set(snap, modelPeriods);
    for (const pKey of USAGE_PERIODS) {
      addBucket(mergedPeriods[pKey], devPeriods[pKey]);
    }

    for (const [dateKey, bucket] of Object.entries(loc.byDate || {})) {
      if (!byDateMap.has(dateKey)) byDateMap.set(dateKey, emptyBucket());
      addBucket(byDateMap.get(dateKey), bucket);
    }

    if (loc.bySlot && typeof loc.bySlot === 'object' && Object.keys(loc.bySlot).length > 0) {
      mergeTimelineBuckets(bySlot, loc.bySlot);
    }

    if (loc.byMinute && typeof loc.byMinute === 'object') {
      mergeTimelineBuckets(byMinute, loc.byMinute);
    } else if (loc.bySlot && typeof loc.bySlot === 'object' && Object.keys(loc.bySlot).length > 0) {
      mergeTimelineBuckets(fallbackBySlot, loc.bySlot);
    } else if (loc.byDate) {
      const famTotals = Object.create(null);
      let famSum = 0;
      for (const [mId, mBucket] of Object.entries(loc.byModel || {})) {
        const fam = classifyModelFamily(mId, mBucket?.displayName);
        const tok = Number(mBucket?.totalTokens || 0);
        famTotals[fam] = (famTotals[fam] || 0) + tok;
        famSum += tok;
      }
      const shares = famSum > 0
        ? Object.entries(famTotals).map(([fam, tok]) => [fam, tok / famSum])
        : [['gemini', 1]];
      for (const [dateKey, bucket] of Object.entries(loc.byDate || {})) {
        if (!legacyByDate[dateKey]) legacyByDate[dateKey] = Object.create(null);
        const tot = Number(bucket?.totalTokens || 0);
        const inp = Number(bucket?.inputTokens || 0);
        const cr = Number(bucket?.cacheReadTokens || 0);
        const nonCache = inp + Number(bucket?.outputTokens || 0);
        const gens = Number(bucket?.generations || 0);
        for (const [fam, ratio] of shares) {
          if (!legacyByDate[dateKey][fam]) {
            legacyByDate[dateKey][fam] = { totalTokens: 0, nonCacheTokens: 0, inputTokens: 0, cacheReadTokens: 0, generations: 0 };
          }
          const dst = legacyByDate[dateKey][fam];
          dst.totalTokens += Math.round(tot * ratio);
          dst.nonCacheTokens += Math.round(nonCache * ratio);
          dst.inputTokens += Math.round(inp * ratio);
          dst.cacheReadTokens += Math.round(cr * ratio);
          dst.generations += Math.round(gens * ratio);
        }
      }
    }

    const modelIds = new Set([
      ...Object.keys(loc.byModel || {}),
      ...modelPeriods.keys(),
    ]);
    for (const modelId of modelIds) {
      const mBucket = loc.byModel?.[modelId];
      if (!byModelMap.has(modelId)) {
        byModelMap.set(modelId, {
          modelId,
          displayName: mBucket?.displayName || modelId,
          ...emptyBucket(),
          periods: emptyPeriodBuckets(),
        });
      }
      const dst = byModelMap.get(modelId);
      dst.displayName = pickDisplayName(dst.displayName, mBucket?.displayName, modelId);
      if (mBucket) addBucket(dst, mBucket);
      const mp = modelPeriods.get(modelId);
      if (mp) {
        for (const pKey of USAGE_PERIODS) {
          addBucket(dst.periods[pKey], mp[pKey]);
        }
      }
    }

    for (const conv of loc.recentConversations || []) {
      allRecent.push({
        ...conv,
        deviceId: snap.deviceId,
        deviceName: snap.deviceName || snap.hostname || snap.deviceId,
      });
    }
  }

  const cacheHitRate = computeCacheHitRate(mergedTotals);

  const byDate = Object.create(null);
  const sortedDates = Array.from(byDateMap.keys()).sort();
  for (const dk of sortedDates) {
    byDate[dk] = byDateMap.get(dk);
  }

  const todayBucket = byDate[todayKey] || emptyBucket();

  const finalMergedPeriods = Object.create(null);
  for (const pKey of USAGE_PERIODS) {
    finalMergedPeriods[pKey] = finalizePeriodBucket(mergedPeriods[pKey], mergedPeriods[pKey].totalTokens);
  }

  const models = Array.from(byModelMap.values())
    .map((m) => {
      const finalizedPeriods = Object.create(null);
      for (const pKey of USAGE_PERIODS) {
        finalizedPeriods[pKey] = finalizePeriodBucket(m.periods[pKey], mergedPeriods[pKey].totalTokens);
      }
      return {
        ...m,
        periods: finalizedPeriods,
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens);
  const totalMergedTokens = mergedTotals.totalTokens;

  const devices = valid
    .map((snap) => {
      const devTotal = Number(snap.local.totals.totalTokens || 0);
      const devToday = Number(snap.local.byDate?.[todayKey]?.totalTokens || 0);
      const cRate = computeCacheHitRate(snap.local.totals);
      const rawPeriods = devPeriodsMap.get(snap) || emptyPeriodBuckets();
      const finalizedPeriods = Object.create(null);
      for (const pKey of USAGE_PERIODS) {
        finalizedPeriods[pKey] = finalizePeriodBucket(rawPeriods[pKey], mergedPeriods[pKey].totalTokens);
      }
      const rawModelPeriods = devModelPeriodsMap.get(snap);
      const devModels = Object.create(null);
      if (rawModelPeriods) {
        for (const [modelId, mp] of rawModelPeriods.entries()) {
          const mPeriods = Object.create(null);
          for (const pKey of USAGE_PERIODS) {
            mPeriods[pKey] = finalizePeriodBucket(mp[pKey], rawPeriods[pKey].totalTokens);
          }
          const displayName = pickDisplayName(
            byModelMap.get(modelId)?.displayName,
            snap.local.byModel?.[modelId]?.displayName,
            modelId
          );
          devModels[modelId] = {
            modelId,
            displayName,
            periods: mPeriods,
          };
        }
      }
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
        periods: finalizedPeriods,
        models: devModels,
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

  const quotaCalibration = mergeCalibrationMaps(...calMaps);

  return {
    todayKey,
    deviceCount: devices.length,
    conversationCount,
    totals: {
      ...mergedTotals,
      cacheHitRate,
    },
    today: todayBucket,
    periods: finalMergedPeriods,
    byDate,
    bySlot,
    byMinute,
    fallbackBySlot,
    legacyByDate,
    quotaCalibration,
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
    this.calibrationFile = path.join(this.dataDir, 'quota-calibration.json');
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
    if (SUPPORTED_LANGUAGES.includes(patch.language)) {
      nextConfig.language = patch.language;
    }
    if (typeof patch.syncIntervalMs === 'number' && Number.isFinite(patch.syncIntervalMs)) {
      nextConfig.syncIntervalMs = Math.min(86_400_000, Math.max(3000, Math.floor(patch.syncIntervalMs)));
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

    const candidates = [];
    let config = readJsonSafe(this.configFile, null);
    let dirty = false;

    if (!config) {
      const defaultDir = process.env.AGY_SYNC_DIR || '';
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
      if (!config.syncDir && process.env.AGY_SYNC_DIR) {
        config.syncDir = process.env.AGY_SYNC_DIR;
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

  readLocalCalibration() {
    const raw = readJsonSafe(this.calibrationFile, null);
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    for (const [key, entry] of Object.entries(raw)) {
      if (!entry || typeof entry !== 'object') continue;
      const cycles = normalizeStoredCycles(entry.cycles);
      const cap = Number(entry.capacityTokens || 0);
      const upd = Number(entry.updatedAt || 0);
      if (cycles.length === 0 && !(cap > 0)) continue;
      out[key] = {
        ...(cap > 0 ? { capacityTokens: cap } : {}),
        ...(upd > 0 ? { updatedAt: upd } : {}),
        ...(cycles.length > 0 ? { cycles } : {}),
      };
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  async syncOnce() {
    const { device, config, candidates } = await this.ensureIdentityAndConfig();
    const localSnapshot = await this.collector.collect();
    const localCal = this.readLocalCalibration();

    const mySnapshot = {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      deviceId: device.deviceId,
      deviceName: config.deviceName || device.deviceName,
      hostname: device.hostname || os.hostname(),
      platform: device.platform || process.platform,
      arch: device.arch || process.arch,
      updatedAt: Date.now(),
      local: localSnapshot,
      ...(localCal ? { quotaCalibration: localCal } : {}),
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
