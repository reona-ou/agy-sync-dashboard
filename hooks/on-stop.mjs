import fsp from 'node:fs/promises';
import path from 'node:path';
import { readJsonSafe, resolvePaths } from '../compat/platform.mjs';

const MIN_INTERVAL_MS = 2500;

async function drainStdinBriefly() {
  if (process.stdin.isTTY) return;
  await new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      process.stdin.pause();
      try {
        process.stdin.unref();
      } catch {}
      resolve();
    };
    const timer = setTimeout(done, 80);
    process.stdin.resume();
    process.stdin.once('end', done);
    process.stdin.once('error', done);
  });
}

async function pingRunningSidecar(runtimeFile) {
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
      body: JSON.stringify({ source: 'hook' }),
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
  await drainStdinBriefly();

  const paths = resolvePaths();
  await fsp.mkdir(paths.pluginDataDir, { recursive: true });

  const stampFile = path.join(paths.pluginDataDir, 'hook-last-run.json');
  const lastRun = readJsonSafe(stampFile, null);
  if (lastRun?.at && Date.now() - Number(lastRun.at) < MIN_INTERVAL_MS) {
    return;
  }

  await fsp.writeFile(stampFile, JSON.stringify({ at: Date.now() }) + '\n', 'utf8');

  const runtimeFile = path.join(paths.pluginDataDir, 'sidecar-runtime.json');
  const pinged = await pingRunningSidecar(runtimeFile);
  if (pinged) return;

  // Fallback when sidecar UI has not been launched yet: run direct snapshot sync.
  const { SyncManager } = await import('../sidecars/dashboard/sync.mjs');
  const manager = new SyncManager({ paths });
  await manager.syncOnce();
}

main().catch(() => {
  // Hooks must never fail or block the host turn lifecycle.
  process.exit(0);
});
