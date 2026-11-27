import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readHostTheme } from '../../compat/host-theme.mjs';
import { readJsonSafe, resolvePaths } from '../../compat/platform.mjs';
import { loadSidecarSdk } from '../../compat/sdk.mjs';
import { buildQuotaForecasts, mergeCalibrationMaps } from './forecast.mjs';
import { QuotaClient } from './quota.mjs';
import { SyncManager, sanitizeSettingsForClient } from './sync.mjs';

function execFilePromise(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 60_000, windowsHide: false, ...options }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

const FOLDER_PICKER_PROMPTS = {
  'zh-CN': '选择跨设备同步文件夹',
  en: 'Select Antigravity Sync Folder',
  ja: 'マルチデバイス同期フォルダを選択',
};

export async function pickNativeFolder(initialDir = '', lang = 'zh-CN', options = {}) {
  const safeInit = initialDir && fs.existsSync(initialDir) ? path.resolve(initialDir) : '';
  const promptText = FOLDER_PICKER_PROMPTS[lang] || FOLDER_PICKER_PROMPTS.en;
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  if (platform === 'win32') {
    const psScript = [
      'Add-Type -AssemblyName System.Windows.Forms;',
      '$f = New-Object System.Windows.Forms.Form;',
      '$f.TopMost = $true;',
      '$d = New-Object System.Windows.Forms.FolderBrowserDialog;',
      '$d.Description = if ($env:AGY_PICKER_PROMPT) { $env:AGY_PICKER_PROMPT } else { "Select Antigravity Sync Folder" };',
      '$d.ShowNewFolderButton = $true;',
      'if ($env:AGY_INIT_DIR -and (Test-Path $env:AGY_INIT_DIR)) { $d.SelectedPath = $env:AGY_INIT_DIR };',
      'if ($d.ShowDialog($f) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }',
    ].join(' ');
    try {
      const { stdout } = await execFilePromise(
        'powershell.exe',
        ['-NoProfile', '-Sta', '-NonInteractive', '-Command', psScript],
        { env: { ...env, AGY_INIT_DIR: safeInit, AGY_PICKER_PROMPT: promptText }, windowsHide: true }
      );
      const selected = String(stdout || '').trim();
      return selected ? { cancelled: false, path: selected } : { cancelled: true, path: '' };
    } catch (err) {
      return {
        cancelled: true,
        path: '',
        unsupported: true,
        error: err?.message || 'Folder dialog unavailable',
      };
    }
  }

  if (platform === 'darwin') {
    try {
      const { stdout } = await execFilePromise('osascript', [
        '-e',
        `POSIX path of (choose folder with prompt "${promptText.replace(/"/g, '\\"')}")`,
      ]);
      const selected = String(stdout || '').trim().replace(/\/+$/, '');
      return selected ? { cancelled: false, path: selected } : { cancelled: true, path: '' };
    } catch (err) {
      const msg = String(err?.stderr || err?.message || '');
      if (/user canceled|-128/i.test(msg)) {
        return { cancelled: true, path: '' };
      }
      return {
        cancelled: true,
        path: '',
        unsupported: true,
        error: err?.message || 'Folder dialog unavailable',
      };
    }
  }

  const hasDisplay = Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
  if (hasDisplay) {
    for (const [bin, args] of [
      ['zenity', ['--file-selection', '--directory', `--title=${promptText}`]],
      ['kdialog', ['--getexistingdirectory', safeInit || env.HOME || '.']],
    ]) {
      try {
        const { stdout } = await execFilePromise(bin, args);
        const selected = String(stdout || '').trim();
        if (selected) return { cancelled: false, path: selected };
        return { cancelled: true, path: '' };
      } catch (err) {
        const stderr = String(err?.stderr || '');
        const displayError = /cannot open display|could not connect|no display|unable to open display|failed to open display/i.test(
          stderr
        );
        if ((err?.code === 1 || err?.code === 5) && !displayError) {
          return { cancelled: true, path: '' };
        }
      }
    }
  }
  return {
    cancelled: true,
    path: '',
    unsupported: true,
    error: 'No native folder picker (zenity/kdialog) available',
  };
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

function readDashboardVersion() {
  for (const rel of ['../../plugin.json', '../../package.json', '../../../package.json']) {
    const meta = readJsonSafe(path.resolve(HERE, rel), null);
    if (meta?.version) return String(meta.version);
  }
  return '';
}

const DASHBOARD_VERSION = readDashboardVersion();

function readStatic(file) {
  return fs.readFileSync(path.join(HERE, file), 'utf8');
}

function buildThemeCss(theme) {
  const mode = theme?.mode === 'light' ? 'light' : 'dark';
  const palette = mode === 'light' ? theme.light : theme.dark;
  const accent = palette?.primary || '#7c5cff';
  const bg = palette?.background || (mode === 'light' ? '#f7f8fb' : '#121318');
  const fg = palette?.foreground || (mode === 'light' ? '#171923' : '#f0f2f8');
  const surface = mode === 'light' ? '#ffffff' : '#191b23';
  const surface2 = mode === 'light' ? '#eff2f7' : '#212430';
  const border = mode === 'light' ? 'rgba(20, 25, 38, 0.12)' : 'rgba(255, 255, 255, 0.11)';
  const muted = mode === 'light' ? '#5c6475' : '#a4acc0';
  const font = theme?.fontFamily ? `"${theme.fontFamily}", ` : '';
  const mono = theme?.monoFontFamily ? `"${theme.monoFontFamily}", ` : '';

  return `:root {
  color-scheme: ${mode};
  --theme-mode: ${mode};
  --theme-bg: ${bg};
  --theme-surface: ${surface};
  --theme-surface-2: ${surface2};
  --theme-fg: ${fg};
  --theme-muted: ${muted};
  --theme-border: ${border};
  --theme-accent: ${accent};
  --theme-font-sans: ${font}system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif;
  --theme-font-mono: ${mono}ui-monospace, "Cascadia Mono", Consolas, monospace;
}
`;
}

export async function createDashboardService(options = {}) {
  const paths = options.paths || resolvePaths();
  fs.mkdirSync(paths.pluginDataDir, { recursive: true });

  const syncManager = options.syncManager || new SyncManager({ paths });
  const quotaClient = options.quotaClient || new QuotaClient(paths);
  const settingsListeners = new Set();

  let revision = 0;
  let lastDataFingerprint = '';
  let inFlightSync = null;

  const updateFingerprint = (synced) => {
    const fp = JSON.stringify([
      synced?.merged?.totals?.totalTokens || 0,
      synced?.merged?.totals?.generations || 0,
      synced?.merged?.deviceCount || 0,
      synced?.syncStatus?.lastSyncAt || 0,
      synced?.syncStatus?.error || '',
    ]);
    if (fp !== lastDataFingerprint) {
      lastDataFingerprint = fp;
      revision += 1;
    }
  };

  const runSync = (syncOpts = { forceWebDav: false }) => {
    if (!inFlightSync) {
      inFlightSync = syncManager
        .syncOnce({ forceWebDav: Boolean(syncOpts?.forceWebDav), ignoreWebDavCooldown: Boolean(syncOpts?.ignoreWebDavCooldown) })
        .then((res) => {
          updateFingerprint(res);
          return res;
        })
        .finally(() => {
          inFlightSync = null;
        });
    }
    return inFlightSync;
  };

  const calibrationFile = path.join(paths.pluginDataDir, 'quota-calibration.json');
  const activeSessionFile = path.join(paths.pluginDataDir, 'active-session.json');
  let calibration = readJsonSafe(calibrationFile, {});
  if (!calibration || typeof calibration !== 'object') calibration = {};
  let lastHookSession = readJsonSafe(activeSessionFile, null);
  const idleProbes = new Map();
  const runningOrderMap = new Map();
  let runningOrderSeq = 0;

  function recordActiveSession(meta) {
    if (!meta?.conversationId) return;
    lastHookSession = {
      conversationId: String(meta.conversationId),
      modelName: String(meta.modelName || ''),
      updatedAt: Number(meta.updatedAt || Date.now()),
    };
  }

  function getLatestHookSession() {
    const onDisk = readJsonSafe(activeSessionFile, null);
    if (onDisk?.conversationId && Number(onDisk.updatedAt || 0) > Number(lastHookSession?.updatedAt || 0)) {
      lastHookSession = onDisk;
    }
    return lastHookSession;
  }

  function applyForecastAndStrip(synced, quota) {
    const effectiveCalibration = mergeCalibrationMaps(synced?.merged?.quotaCalibration, calibration);
    const { quota: enrichedQuota, calibrationUpdates } = buildQuotaForecasts({
      quota,
      merged: synced?.merged,
      calibration: effectiveCalibration,
      idleProbes,
      nowMs: Date.now(),
    });
    if (calibrationUpdates && Object.keys(calibrationUpdates).length > 0) {
      calibration = mergeCalibrationMaps(effectiveCalibration, calibrationUpdates);
      void fsp
        .writeFile(calibrationFile, JSON.stringify(calibration, null, 2) + '\n', 'utf8')
        .catch(() => {});
    }
    const cleanSynced = synced ? { ...synced } : synced;
    if (cleanSynced?.merged) {
      const {
        bySlot: _bs,
        bySlotModel: _bsm,
        byMinute: _bm,
        fallbackBySlot: _fbs,
        legacyByDate: _lbd,
        quotaCalibration: _qc,
        ...restMerged
      } = cleanSynced.merged;
      cleanSynced.merged = restMerged;
    }
    if (cleanSynced?.device?.local) {
      const { bySlot: _lbs, bySlotModel: _lbsm, byMinute: _lbm, ...restLocal } = cleanSynced.device.local;
      cleanSynced.device = { ...cleanSynced.device, local: restLocal };
    }
    return { quota: enrichedQuota, cleanSynced };
  }

  async function observeQuota({ forceQuota = false, synced = null } = {}) {
    if (typeof quotaClient?.fetch !== 'function') return null;
    const data = synced || syncManager.lastMerged || (await runSync());
    const rawQuota = await quotaClient.fetch(forceQuota).catch(() => null);
    if (!rawQuota || !rawQuota.connected) return rawQuota;
    applyForecastAndStrip(data, rawQuota);
    return rawQuota;
  }

  async function buildSessionContext(
    requestedConvId = 'auto',
    { forceTrajectories = false, includeList = true } = {}
  ) {
    const collector = syncManager.collector;
    const localList =
      includeList && typeof collector?.listConversationContexts === 'function'
        ? collector.listConversationContexts(20)
        : [];
    const localMap = new Map(localList.map((c) => [c.conversationId, c]));

    let trajectories = [];
    if (typeof quotaClient?.fetchTrajectories === 'function') {
      try {
        const trajRes = await quotaClient.fetchTrajectories(forceTrajectories);
        trajectories = Array.isArray(trajRes?.trajectories) ? trajRes.trajectories : [];
      } catch {
        trajectories = [];
      }
    }
    const trajMap = new Map(trajectories.map((tr) => [tr.conversationId, tr]));
    const hookSession = getLatestHookSession();

    const rootTrajs = trajectories.filter(
      (tr) => !tr.rootConversationId || tr.rootConversationId === tr.conversationId
    );
    const candidates = rootTrajs.length ? rootTrajs : trajectories;

    // Lock relative order while conversations run concurrently so cards do not jump.
    const runningTrajsRaw = candidates.filter((tr) => tr.isRunning);
    const runningIdSet = new Set(runningTrajsRaw.map((tr) => tr.conversationId));
    for (const id of runningOrderMap.keys()) {
      if (!runningIdSet.has(id)) runningOrderMap.delete(id);
    }
    const newlyRunning = runningTrajsRaw
      .filter((tr) => !runningOrderMap.has(tr.conversationId))
      .sort((a, b) => {
        const viewDiff = (b.lastUserViewMs || 0) - (a.lastUserViewMs || 0);
        if (viewDiff !== 0) return viewDiff;
        const modDiff = (b.lastModifiedMs || 0) - (a.lastModifiedMs || 0);
        if (modDiff !== 0) return modDiff;
        return String(a.conversationId).localeCompare(String(b.conversationId));
      });
    for (const tr of newlyRunning) {
      runningOrderMap.set(tr.conversationId, ++runningOrderSeq);
    }
    const runningTrajs = [...runningTrajsRaw].sort(
      (a, b) => (runningOrderMap.get(a.conversationId) || 0) - (runningOrderMap.get(b.conversationId) || 0)
    );

    const cleanReq = typeof requestedConvId === 'string' && requestedConvId.trim()
      ? requestedConvId.trim()
      : 'auto';
    const isManual = cleanReq !== 'auto';

    let activeConvId = null;
    let detectionSource = 'none';

    if (isManual) {
      activeConvId = cleanReq;
      detectionSource = 'manual';
    } else if (runningTrajs.length > 0) {
      const topTraj = runningTrajs[0];
      activeConvId = topTraj.conversationId;
      detectionSource = topTraj.lastUserViewMs > 0 ? 'live-view' : 'live-recent';
    } else {
      const sortedTrajs = [...candidates].sort((a, b) => {
        const aView = a.lastUserViewMs || 0;
        const bView = b.lastUserViewMs || 0;
        if (aView !== bView) return bView - aView;
        return (b.lastModifiedMs || 0) - (a.lastModifiedMs || 0);
      });

      const topTraj = sortedTrajs[0] || null;
      if (topTraj) {
        activeConvId = topTraj.conversationId;
        detectionSource = topTraj.lastUserViewMs > 0 ? 'live-view' : 'live-recent';
      } else if (hookSession?.conversationId) {
        activeConvId = hookSession.conversationId;
        detectionSource = 'hook';
      } else {
        const fallbackList = localList.length
          ? localList
          : typeof collector?.listConversationContexts === 'function'
            ? collector.listConversationContexts(1)
            : [];
        if (fallbackList.length > 0) {
          activeConvId = fallbackList[0].conversationId;
          detectionSource = 'recent-db';
        }
      }
    }

    const resolveDetail = async (convId) => {
      if (!convId) return null;
      let localEntry = typeof collector?.getConversationContext === 'function'
        ? await collector.getConversationContext(convId)
        : localMap.get(convId) || null;
      const traj = trajMap.get(convId) || null;
      let ctx = localEntry?.contextInfo || null;

      if ((!ctx || ctx.maxContextTokens === 0) && typeof quotaClient?.fetchTrajectoryContext === 'function') {
        const rpcCtx = await quotaClient.fetchTrajectoryContext(convId).catch(() => null);
        if (rpcCtx && (rpcCtx.maxContextTokens > 0 || rpcCtx.usedTokens > 0)) {
          ctx = rpcCtx;
        }
      }

      const maxContextTokens = Number(ctx?.maxContextTokens || 0);
      const usedTokens = Number(ctx?.usedTokens || 0);
      const remainingTokens = maxContextTokens > 0 ? Math.max(0, maxContextTokens - usedTokens) : 0;
      const usageRatio = maxContextTokens > 0 ? usedTokens / maxContextTokens : 0;

      const inputTokens = Number(ctx?.inputTokens || 0);
      const cacheReadTokens = Number(ctx?.cacheReadTokens || 0);
      const cacheDenom = inputTokens + cacheReadTokens;
      const cacheHitRate =
        typeof ctx?.cacheHitRate === 'number'
          ? ctx.cacheHitRate
          : cacheDenom > 0
            ? Number((cacheReadTokens / cacheDenom).toFixed(4))
            : 0;
      const sessionInputTokens = Number(ctx?.sessionInputTokens || 0);
      const sessionCacheReadTokens = Number(ctx?.sessionCacheReadTokens || 0);
      const sessionCacheDenom = sessionInputTokens + sessionCacheReadTokens;
      const sessionCacheHitRate =
        typeof ctx?.sessionCacheHitRate === 'number'
          ? ctx.sessionCacheHitRate
          : sessionCacheDenom > 0
            ? Number((sessionCacheReadTokens / sessionCacheDenom).toFixed(4))
            : 0;

      return {
        conversationId: convId,
        title: traj?.title || localEntry?.title || convId.slice(0, 8),
        modelId: ctx?.modelId || '',
        displayName: ctx?.displayName || (hookSession?.conversationId === convId ? hookSession.modelName : '') || '',
        usedTokens,
        maxContextTokens,
        remainingTokens,
        usageRatio,
        promptTokens: Number(ctx?.promptTokens || 0),
        inputTokens,
        cacheReadTokens,
        cacheWriteTokens: Number(ctx?.cacheWriteTokens || 0),
        outputTokens: Number(ctx?.outputTokens || 0),
        responseTokens: Number(ctx?.responseTokens || 0),
        estimatedTokensUsed: Number(ctx?.estimatedTokensUsed || 0),
        cacheHitRate,
        sessionInputTokens,
        sessionCacheReadTokens,
        sessionCacheHitRate,
        sessionGenerations: Number(ctx?.sessionGenerations || 0),
        source: ctx?.source || 'empty',
        latestGeneration: ctx?.latestGeneration || null,
        isRunning: Boolean(traj?.isRunning),
        lastModifiedMs: Math.max(Number(localEntry?.lastModifiedMs || 0), Number(traj?.lastModifiedMs || 0)),
        lastUserViewMs: Number(traj?.lastUserViewMs || 0),
      };
    };

    const activeConvIds = [];
    const activeIdSet = new Set();
    const pushActiveId = (id) => {
      if (!id || activeIdSet.has(id)) return;
      activeIdSet.add(id);
      activeConvIds.push(id);
    };
    if (isManual) pushActiveId(activeConvId);
    for (const tr of runningTrajs) pushActiveId(tr.conversationId);
    if (!activeConvIds.length && activeConvId) pushActiveId(activeConvId);

    const activeConversations = (await Promise.all(activeConvIds.map((id) => resolveDetail(id)))).filter(Boolean);
    const current = activeConversations.find((c) => c.conversationId === activeConvId) || activeConversations[0] || null;
    const activeConvMap = new Map(activeConversations.map((c) => [c.conversationId, c]));

    if (!includeList) {
      return {
        selectionMode: isManual ? 'manual' : 'auto',
        activeConversationId: activeConvId,
        activeConversationIds: activeConversations.map((c) => c.conversationId),
        runningCount: runningTrajs.length,
        detectionSource,
        current,
        activeConversations,
        conversations: [],
      };
    }

    // Build compact selector list combining live trajectories and recent local conversations.
    const seenIds = new Set();
    const mergedEntries = [];
    for (const tr of trajectories) {
      if (tr.rootConversationId && tr.rootConversationId !== tr.conversationId) continue;
      seenIds.add(tr.conversationId);
      const localEntry = localMap.get(tr.conversationId);
      const ctx = localEntry?.contextInfo || activeConvMap.get(tr.conversationId) || null;
      const maxContextTokens = Number(ctx?.maxContextTokens || 0);
      const usedTokens = Number(ctx?.usedTokens || 0);
      mergedEntries.push({
        conversationId: tr.conversationId,
        title: tr.title || localEntry?.title || tr.conversationId.slice(0, 8),
        modelId: ctx?.modelId || '',
        displayName: ctx?.displayName || '',
        usedTokens,
        maxContextTokens,
        usageRatio: maxContextTokens > 0 ? usedTokens / maxContextTokens : 0,
        isRunning: Boolean(tr.isRunning),
        lastModifiedMs: Math.max(Number(tr.lastModifiedMs || 0), Number(localEntry?.lastModifiedMs || 0)),
        lastUserViewMs: Number(tr.lastUserViewMs || 0),
      });
    }
    for (const loc of localList) {
      if (seenIds.has(loc.conversationId)) continue;
      seenIds.add(loc.conversationId);
      const ctx = loc.contextInfo;
      const maxContextTokens = Number(ctx?.maxContextTokens || 0);
      const usedTokens = Number(ctx?.usedTokens || 0);
      mergedEntries.push({
        conversationId: loc.conversationId,
        title: loc.title || loc.conversationId.slice(0, 8),
        modelId: ctx?.modelId || '',
        displayName: ctx?.displayName || '',
        usedTokens,
        maxContextTokens,
        usageRatio: maxContextTokens > 0 ? usedTokens / maxContextTokens : 0,
        isRunning: false,
        lastModifiedMs: Number(loc.lastModifiedMs || 0),
        lastUserViewMs: 0,
      });
    }

    for (const activeItem of activeConversations) {
      if (seenIds.has(activeItem.conversationId)) continue;
      seenIds.add(activeItem.conversationId);
      mergedEntries.unshift({
        conversationId: activeItem.conversationId,
        title: activeItem.title,
        modelId: activeItem.modelId,
        displayName: activeItem.displayName,
        usedTokens: activeItem.usedTokens,
        maxContextTokens: activeItem.maxContextTokens,
        usageRatio: activeItem.usageRatio,
        isRunning: activeItem.isRunning,
        lastModifiedMs: activeItem.lastModifiedMs,
        lastUserViewMs: activeItem.lastUserViewMs,
      });
    }

    mergedEntries.sort((a, b) => {
      if (a.isRunning !== b.isRunning) return a.isRunning ? -1 : 1;
      const aOrder = runningOrderMap.get(a.conversationId) || 0;
      const bOrder = runningOrderMap.get(b.conversationId) || 0;
      if (aOrder && bOrder && aOrder !== bOrder) return aOrder - bOrder;
      const aScore = Math.max(a.lastUserViewMs || 0, a.lastModifiedMs || 0);
      const bScore = Math.max(b.lastUserViewMs || 0, b.lastModifiedMs || 0);
      return bScore - aScore;
    });

    return {
      selectionMode: isManual ? 'manual' : 'auto',
      activeConversationId: activeConvId,
      activeConversationIds: activeConversations.map((c) => c.conversationId),
      runningCount: runningTrajs.length,
      detectionSource,
      current,
      activeConversations,
      conversations: mergedEntries.slice(0, 15),
    };
  }

  async function getDashboard({ forceSync = false, forceQuota = false, forceWebDav = false, convId = 'auto' } = {}) {
    const configuredIntervalMs = Number(syncManager.lastMerged?.settings?.syncIntervalMs || 30_000);
    const staleMs = Math.max(15_000, configuredIntervalMs);
    const stale = !syncManager.lastMerged || Date.now() - syncManager.lastSyncAt > staleMs;
    const synced = forceSync || stale ? await runSync({ forceWebDav: Boolean(forceWebDav) }) : syncManager.lastMerged;
    const [rawQuota, hostTheme, sessionContext] = await Promise.all([
      quotaClient.fetch(forceQuota).catch((err) => ({
        connected: false,
        groups: [],
        fetchedAt: Date.now(),
        error: err?.message || String(err),
      })),
      readHostTheme(paths.pluginConfig),
      buildSessionContext(convId, { forceTrajectories: forceQuota }),
    ]);
    const { quota, cleanSynced } = applyForecastAndStrip(synced, rawQuota);

    return {
      revision,
      appVersion: DASHBOARD_VERSION,
      nodeVersion: process.version,
      hostTheme,
      quota,
      sessionContext,
      ...cleanSynced,
    };
  }

  async function getSessionContext({ convId = 'auto', forceTrajectories = false } = {}) {
    const sessionContext = await buildSessionContext(convId, { forceTrajectories, includeList: true });
    return {
      revision,
      sessionContext,
    };
  }

  async function getVersion(convId = 'auto') {
    const merged = syncManager.lastMerged;
    const ctxSnap = await buildSessionContext(convId, { forceTrajectories: false, includeList: false }).catch(() => null);
    const activeSessions = (ctxSnap?.activeConversations || []).map((c) => ({
      conversationId: c.conversationId,
      usedTokens: c.usedTokens || 0,
      maxContextTokens: c.maxContextTokens || 0,
      isRunning: Boolean(c.isRunning),
    }));
    return {
      revision,
      appVersion: DASHBOARD_VERSION,
      nodeVersion: process.version,
      lastSyncAt: merged?.syncStatus?.lastSyncAt || syncManager.lastSyncAt || 0,
      totalTokens: merged?.merged?.totals?.totalTokens || 0,
      generations: merged?.merged?.totals?.generations || 0,
      deviceCount: merged?.merged?.deviceCount || 0,
      activeConvId: ctxSnap?.current?.conversationId || null,
      activeUsedTokens: ctxSnap?.current?.usedTokens || 0,
      activeMaxContextTokens: ctxSnap?.current?.maxContextTokens || 0,
      activeIsRunning: Boolean(ctxSnap?.current?.isRunning),
      runningCount: ctxSnap?.runningCount || 0,
      activeSessions,
    };
  }

  async function updateSettings(payload) {
    const updated = await syncManager.updateSettings(payload || {});
    updateFingerprint(updated.synced);
    for (const cb of settingsListeners) {
      try {
        cb(updated.settings);
      } catch {}
    }
    const [rawQuota, hostTheme, sessionContext] = await Promise.all([
      quotaClient.fetch(false).catch(() => ({ connected: false, groups: [], fetchedAt: Date.now() })),
      readHostTheme(paths.pluginConfig),
      buildSessionContext('auto', { forceTrajectories: false }),
    ]);
    const { quota, cleanSynced } = applyForecastAndStrip(updated.synced, rawQuota);
    return {
      settings: updated.settings,
      candidates: updated.candidates,
      dashboard: {
        revision,
        appVersion: DASHBOARD_VERSION,
        nodeVersion: process.version,
        hostTheme,
        quota,
        sessionContext,
        ...cleanSynced,
      },
    };
  }

  async function getSettings() {
    const { config, candidates, device } = await syncManager.ensureIdentityAndConfig();
    return { settings: sanitizeSettingsForClient(config), candidates, device };
  }

  async function testSettings(payload) {
    return syncManager.testConnection(payload || {});
  }

  async function getThemeCss() {
    const theme = await readHostTheme(paths.pluginConfig);
    return buildThemeCss(theme);
  }

  return {
    paths,
    syncManager,
    quotaClient,
    runSync,
    observeQuota,
    recordActiveSession,
    getDashboard,
    getSessionContext,
    getVersion,
    updateSettings,
    getSettings,
    testSettings,
    getThemeCss,
    onSettingsUpdated(cb) {
      settingsListeners.add(cb);
      return () => settingsListeners.delete(cb);
    },
  };
}

async function readJsonBody(req, maxBytes = 32 * 1024) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > maxBytes) {
      const err = new Error('Payload too large');
      err.statusCode = 413;
      throw err;
    }
  }
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

export function createStandaloneHttpServer(service, options = {}) {
  const controlToken = options.controlToken || crypto.randomBytes(16).toString('hex');

  const server = http.createServer(async (req, res) => {
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
      res.writeHead(403);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${host}`);
    const origin = req.headers.origin;
    const sameOrigin = !origin || origin === `http://${host}`;
    if (!sameOrigin) {
      res.writeHead(403);
      res.end();
      return;
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const sendJson = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };

    try {
      if (url.pathname === '/api/version' && req.method === 'GET') {
        const convId = url.searchParams.get('convId') || 'auto';
        sendJson(200, await service.getVersion(convId));
        return;
      }

      if (url.pathname === '/api/session-context' && req.method === 'GET') {
        const convId = url.searchParams.get('convId') || 'auto';
        const forceTrajectories = url.searchParams.get('force') === '1';
        sendJson(200, await service.getSessionContext({ convId, forceTrajectories }));
        return;
      }

      if (url.pathname === '/api/dashboard' && req.method === 'GET') {
        const force = url.searchParams.get('force') === '1' || url.searchParams.get('force') === 'true';
        const quotaRefresh = url.searchParams.get('quotaRefresh') === '1' || force;
        const convId = url.searchParams.get('convId') || 'auto';
        sendJson(200, await service.getDashboard({ forceSync: force, forceQuota: quotaRefresh, convId }));
        return;
      }

      if (url.pathname === '/api/sync' && req.method === 'POST') {
        const tokenHeader = req.headers['x-agy-sync-token'];
        // Allow same-origin UI requests or CLI/hook requests presenting our local runtime token.
        if (!origin && tokenHeader && tokenHeader !== controlToken) {
          sendJson(403, { error: 'Invalid sync token' });
          return;
        }
        const parsed = await readJsonBody(req).catch(() => ({}));
        if (parsed?.conversationId) {
          service.recordActiveSession?.(parsed);
        }
        const convId = parsed?.convId || url.searchParams.get('convId') || 'auto';
        sendJson(200, await service.getDashboard({ forceSync: true, forceQuota: true, forceWebDav: true, convId }));
        return;
      }

      if (url.pathname === '/api/settings' && req.method === 'GET') {
        sendJson(200, await service.getSettings());
        return;
      }

      if (url.pathname === '/api/settings' && req.method === 'POST') {
        const parsed = await readJsonBody(req);
        sendJson(200, await service.updateSettings(parsed));
        return;
      }

      if (url.pathname === '/api/settings/test' && req.method === 'POST') {
        const parsed = await readJsonBody(req);
        sendJson(200, await service.testSettings(parsed));
        return;
      }

      if (url.pathname === '/api/settings/pick-folder' && req.method === 'POST') {
        const parsed = await readJsonBody(req, 4096).catch(() => ({}));
        sendJson(200, await pickNativeFolder(parsed.initialDir || '', parsed.language || 'zh-CN'));
        return;
      }

      if (req.method !== 'GET') {
        res.writeHead(405);
        res.end();
        return;
      }

      if (url.pathname === '/theme.css') {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        res.end(await service.getThemeCss());
        return;
      }

      if (url.pathname === '/styles.css') {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        res.end(readStatic('styles.css'));
        return;
      }

      if (url.pathname === '/app.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end(readStatic('app.js'));
        return;
      }

      if (url.pathname === '/preload.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end('// Standalone HTTP preview mode: window.sidecar omitted.');
        return;
      }

      if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/settings') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(readStatic('index.html'));
        return;
      }

      res.writeHead(404);
      res.end();
    } catch (err) {
      sendJson(err?.statusCode || 500, { error: err?.message || 'Internal error' });
    }
  });

  return server;
}

async function startRuntime() {
  const paths = resolvePaths();
  fs.mkdirSync(paths.pluginDataDir, { recursive: true });
  // Release working directory handle from plugin code dir so Windows uninstall/updates do not EBUSY.
  try {
    process.chdir(paths.pluginDataDir);
  } catch {}

  const service = await createDashboardService({ paths });
  const initialSynced = await service.runSync().catch(() => null);
  if (initialSynced) {
    void service.observeQuota({ forceQuota: false, synced: initialSynced }).catch(() => {});
  }

  const controlToken = crypto.randomBytes(16).toString('hex');
  const runtimeFile = path.join(paths.pluginDataDir, 'sidecar-runtime.json');
  const writeRuntimeFile = async (port) => {
    await fsp
      .writeFile(
        runtimeFile,
        JSON.stringify({ pid: process.pid, port, token: controlToken, startedAt: Date.now() }) + '\n',
        'utf8'
      )
      .catch(() => {});
  };

  let bgTimer = null;
  let controlServer = null;
  let convWatcher = null;
  let syncWatcher = null;
  let watchDebounce = null;
  let watchedDevicesDir = '';

  const scheduleWatchSync = () => {
    if (watchDebounce) clearTimeout(watchDebounce);
    watchDebounce = setTimeout(() => {
      watchDebounce = null;
      void service.runSync().catch(() => {});
    }, 1000);
    if (typeof watchDebounce.unref === 'function') watchDebounce.unref();
  };

  const attachConversationsWatcher = () => {
    try {
      if (!convWatcher && fs.existsSync(paths.conversationsDir)) {
        convWatcher = fs.watch(paths.conversationsDir, (_ev, filename) => {
          const name = String(filename || '');
          if (/\.(db|sqlite|db-wal|db-shm)$/i.test(name) || !name) {
            scheduleWatchSync();
          }
        });
        convWatcher.on('error', () => {});
      }
    } catch {}
  };

  const refreshSyncDirWatcher = async (settings) => {
    const mode = settings?.syncMode || 'local-only';
    const syncDir = String(settings?.syncDir || '').trim();
    const targetDir = (mode === 'folder' || mode === 'both') && syncDir ? path.join(syncDir, 'devices') : '';
    if (targetDir === watchedDevicesDir && syncWatcher) return;
    if (syncWatcher) {
      try {
        syncWatcher.close();
      } catch {}
      syncWatcher = null;
    }
    watchedDevicesDir = targetDir;
    if (!targetDir) return;
    try {
      if (fs.existsSync(targetDir)) {
        const ownId = service.syncManager.lastMerged?.device?.deviceId || '';
        syncWatcher = fs.watch(targetDir, (_ev, filename) => {
          const name = String(filename || '');
          if (!name) return scheduleWatchSync();
          if (name.endsWith('.tmp') || name.startsWith('.')) return;
          if (ownId && name === `${ownId}.json`) return;
          if (name.endsWith('.json')) scheduleWatchSync();
        });
        syncWatcher.on('error', () => {});
      }
    } catch {}
  };

  const BG_QUOTA_INTERVAL_MS = 60_000;
  let lastBgQuotaAt = 0;

  const configureBackgroundJobs = async (overrideSettings = null) => {
    const settings = overrideSettings || (await service.getSettings()).settings;
    const intervalMs = Math.max(3_000, Number(settings?.syncIntervalMs || 30_000));
    if (bgTimer) clearInterval(bgTimer);
    bgTimer = setInterval(() => {
      void service
        .runSync()
        .then((synced) => {
          if (synced && Date.now() - lastBgQuotaAt >= BG_QUOTA_INTERVAL_MS) {
            lastBgQuotaAt = Date.now();
            return service.observeQuota({ forceQuota: false, synced });
          }
          return null;
        })
        .catch(() => {});
    }, intervalMs);
    bgTimer.unref();
    attachConversationsWatcher();
    await refreshSyncDirWatcher(settings);
  };

  await configureBackgroundJobs();
  service.onSettingsUpdated((nextSettings) => {
    void configureBackgroundJobs(nextSettings).catch(() => {});
  });

  const cleanup = async () => {
    if (bgTimer) clearInterval(bgTimer);
    if (watchDebounce) clearTimeout(watchDebounce);
    if (convWatcher) {
      try {
        convWatcher.close();
      } catch {}
    }
    if (syncWatcher) {
      try {
        syncWatcher.close();
      } catch {}
    }
    if (controlServer) {
      await new Promise((resolve) => controlServer.close(() => resolve()));
    }
    await fsp.unlink(runtimeFile).catch(() => {});
    process.exit(0);
  };

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, () => {
      void cleanup();
    });
  }

  if (process.env.ANTIGRAVITY_SIDECAR_WEB_PORT) {
    const { SidecarApp, Response } = await loadSidecarSdk();
    const app = new SidecarApp();

    const serveHtml = () => {
      console.log('[agy-sync] serving index.html');
      return new Response(readStatic('index.html'), {
        contentType: 'text/html; charset=utf-8',
        headers: { 'Cache-Control': 'no-store' },
      });
    };
    app.page('/', serveHtml);
    app.page('/index.html', serveHtml);
    app.page('/settings', serveHtml);

    app.api(
      '/styles.css',
      () =>
        new Response(readStatic('styles.css'), {
          contentType: 'text/css; charset=utf-8',
          headers: { 'Cache-Control': 'no-store' },
        }),
      'GET'
    );
    app.api(
      '/theme.css',
      async () =>
        new Response(await service.getThemeCss(), {
          contentType: 'text/css; charset=utf-8',
          headers: { 'Cache-Control': 'no-store' },
        }),
      'GET'
    );
    app.api(
      '/app.js',
      () =>
        new Response(readStatic('app.js'), {
          contentType: 'application/javascript; charset=utf-8',
          headers: { 'Cache-Control': 'no-store' },
        }),
      'GET'
    );

    app.api(
      '/api/version',
      async (data) => {
        const convId = typeof data?.convId === 'string' && data.convId.trim() ? data.convId.trim() : 'auto';
        return service.getVersion(convId);
      },
      'GET'
    );

    app.api(
      '/api/session-context',
      async (data) => {
        const convId = typeof data?.convId === 'string' && data.convId.trim() ? data.convId.trim() : 'auto';
        const forceTrajectories = data?.force === true || data?.force === '1';
        return service.getSessionContext({ convId, forceTrajectories });
      },
      'GET'
    );

    app.api(
      '/api/dashboard',
      async (data) => {
        const force = data?.force === true || data?.force === '1';
        const quotaRefresh = data?.quotaRefresh === true || data?.quotaRefresh === '1' || force;
        const convId = typeof data?.convId === 'string' && data.convId.trim() ? data.convId.trim() : 'auto';
        return service.getDashboard({ forceSync: force, forceQuota: quotaRefresh, convId });
      },
      'GET'
    );

    app.api(
      '/api/sync',
      async (data) => {
        const convId = typeof data?.convId === 'string' && data.convId.trim() ? data.convId.trim() : 'auto';
        return service.getDashboard({ forceSync: true, forceQuota: true, forceWebDav: true, convId });
      },
      'POST'
    );

    app.api('/api/settings', async () => service.getSettings(), 'GET');
    app.api(
      '/api/settings',
      async (data) => {
        try {
          return await service.updateSettings(data);
        } catch (err) {
          return new Response(JSON.stringify({ error: err?.message || 'Settings update failed' }), {
            status: 400,
            contentType: 'application/json',
          });
        }
      },
      'POST'
    );
    app.api(
      '/api/settings/test',
      async (data) => {
        try {
          return await service.testSettings(data);
        } catch (err) {
          return new Response(JSON.stringify({ ok: false, error: err?.message || 'Test failed' }), {
            status: 400,
            contentType: 'application/json',
          });
        }
      },
      'POST'
    );
    app.api(
      '/api/settings/pick-folder',
      async (data) => pickNativeFolder(data?.initialDir || '', data?.language || 'zh-CN'),
      'POST'
    );

    await app.run();

    // Ephemeral local loopback control server so hooks can notify the live sidecar immediately.
    controlServer = http.createServer(async (req, res) => {
      if (req.url === '/api/sync' && req.method === 'POST') {
        if (req.headers['x-agy-sync-token'] !== controlToken) {
          res.writeHead(403);
          res.end();
          return;
        }
        const parsed = await readJsonBody(req, 16 * 1024).catch(() => ({}));
        if (parsed?.conversationId) {
          service.recordActiveSession?.(parsed);
        }
        void service
          .runSync()
          .then((r) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, at: r.syncStatus.lastSyncAt }));
            void service.observeQuota({ forceQuota: true, synced: r }).catch(() => {});
          })
          .catch(() => {
            res.writeHead(500);
            res.end();
          });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    controlServer.listen(0, '127.0.0.1', () => {
      const addr = controlServer.address();
      if (addr && typeof addr === 'object') {
        void writeRuntimeFile(addr.port);
      }
    });
  } else {
    const port = Number(process.env.AGY_SYNC_PORT || 17920);
    controlServer = createStandaloneHttpServer(service, { controlToken });
    controlServer.listen(port, '127.0.0.1', () => {
      void writeRuntimeFile(port);
      console.log(`Antigravity Sync Dashboard: http://127.0.0.1:${port}`);
    });
  }
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntrypoint) {
  startRuntime().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
