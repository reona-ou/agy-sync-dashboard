import fsp from 'node:fs/promises';
import path from 'node:path';
import { readJsonSafe, resolvePaths } from '../compat/platform.mjs';

const MIN_INTERVAL_MS = 2500;

async function readHookStdinBriefly() {
  if (process.stdin.isTTY) return null;
  return new Promise((resolve) => {
    let raw = '';
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.pause();
      try {
        process.stdin.unref();
      } catch {}
      try {
        const trimmed = raw.trim();
        resolve(trimmed ? JSON.parse(trimmed) : null);
      } catch {
        resolve(null);
      }
    };
    const timer = setTimeout(done, 80);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      if (raw.length < 65536) raw += chunk;
      if (raw.length >= 65536) done();
    });
    process.stdin.once('end', done);
    process.stdin.once('error', done);
    process.stdin.resume();
  });
}

async function pingRunningSidecar(runtimeFile, sessionMeta = null) {
  const runtime = readJsonSafe(runtimeFile, null);
  const port = Number(runtime?.port || 0);
  if (!port || port <= 0) return false;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/sync`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(runtime?.token ? { 'x-agy-sync-token': runtime.token } : {}),
      },
      body: JSON.stringify({
        source: 'hook',
        ...(sessionMeta?.conversationId ? { conversationId: sessionMeta.conversationId } : {}),
        ...(sessionMeta?.modelName ? { modelName: sessionMeta.modelName } : {}),
      }),
      signal: ctrl.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const hookInput = await readHookStdinBriefly();

  const paths = resolvePaths();
  await fsp.mkdir(paths.pluginDataDir, { recursive: true });

  const sessionMeta = hookInput?.conversationId
    ? {
        conversationId: String(hookInput.conversationId),
        modelName: String(hookInput.modelName || ''),
        hookEventName: String(hookInput.hookEventName || 'Stop'),
        updatedAt: Date.now(),
      }
    : null;

  if (sessionMeta) {
    const activeSessionFile = path.join(paths.pluginDataDir, 'active-session.json');
    await fsp.writeFile(activeSessionFile, JSON.stringify(sessionMeta) + '\n', 'utf8').catch(() => {});
  }

  const stampFile = path.join(paths.pluginDataDir, 'hook-last-run.json');
  const lastRun = readJsonSafe(stampFile, null);
  if (lastRun?.at && Date.now() - Number(lastRun.at) < MIN_INTERVAL_MS) {
    return;
  }

  await fsp.writeFile(stampFile, JSON.stringify({ at: Date.now() }) + '\n', 'utf8');

  const runtimeFile = path.join(paths.pluginDataDir, 'sidecar-runtime.json');
  const pinged = await pingRunningSidecar(runtimeFile, sessionMeta);
  if (pinged) return;

  // Fallback when sidecar UI has not been launched yet: run direct snapshot sync + quota observation.
  const [{ SyncManager }, { QuotaClient }, { buildQuotaForecasts, mergeCalibrationMaps }] = await Promise.all([
    import('../sidecars/dashboard/sync.mjs'),
    import('../sidecars/dashboard/quota.mjs'),
    import('../sidecars/dashboard/forecast.mjs'),
  ]);
  const manager = new SyncManager({ paths });
  const quotaClient = new QuotaClient(paths);
  const fetchQuotaBounded = () =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 2000);
      timer.unref?.();
      quotaClient
        .fetch(true)
        .then((q) => {
          clearTimeout(timer);
          resolve(q);
        })
        .catch(() => {
          clearTimeout(timer);
          resolve(null);
        });
    });

  const [synced, rawQuota] = await Promise.all([manager.syncOnce(), fetchQuotaBounded()]);
  if (rawQuota?.connected) {
    const calibrationFile = path.join(paths.pluginDataDir, 'quota-calibration.json');
    const localCal = readJsonSafe(calibrationFile, {});
    const effectiveCal = mergeCalibrationMaps(synced?.merged?.quotaCalibration, localCal);
    const { calibrationUpdates } = buildQuotaForecasts({
      quota: rawQuota,
      merged: synced?.merged,
      calibration: effectiveCal,
      nowMs: Date.now(),
    });
    if (calibrationUpdates && Object.keys(calibrationUpdates).length > 0) {
      const nextCal = mergeCalibrationMaps(effectiveCal, calibrationUpdates);
      await fsp.writeFile(calibrationFile, JSON.stringify(nextCal, null, 2) + '\n', 'utf8').catch(() => {});
    }
  }
}

main()
  .catch(() => {
    // Hooks must never fail or block the host turn lifecycle.
  })
  .finally(() => {
    try {
      process.stdout.write('{}');
    } catch {}
    process.exit(0);
  });
