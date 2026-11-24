import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createDashboardService, createStandaloneHttpServer } from './runtime/sidecars/dashboard/main.mjs';
import { resolvePaths } from './runtime/compat/platform.mjs';

async function main() {
  const paths = resolvePaths();
  fs.mkdirSync(paths.pluginDataDir, { recursive: true });

  const service = await createDashboardService({ paths });
  await service.runSync().catch(() => {});

  const controlToken = crypto.randomBytes(16).toString('hex');
  const server = createStandaloneHttpServer(service, { controlToken });

  let bgTimer = null;
  let convWatcher = null;
  let watchDebounce = null;

  const scheduleWatchSync = () => {
    if (watchDebounce) clearTimeout(watchDebounce);
    watchDebounce = setTimeout(() => {
      watchDebounce = null;
      void service.runSync().catch(() => {});
    }, 1000);
    watchDebounce.unref?.();
  };

  try {
    if (fs.existsSync(paths.conversationsDir)) {
      convWatcher = fs.watch(paths.conversationsDir, (_ev, filename) => {
        const name = String(filename || '');
        if (/\.(db|sqlite|db-wal|db-shm)$/i.test(name) || !name) {
          scheduleWatchSync();
        }
      });
      convWatcher.on('error', () => {});
    }
  } catch {}

  const configureTimer = async (overrideSettings = null) => {
    const settings = overrideSettings || (await service.getSettings()).settings;
    const intervalMs = Math.max(3_000, Number(settings?.syncIntervalMs || 30_000));
    if (bgTimer) clearInterval(bgTimer);
    bgTimer = setInterval(() => {
      void service.runSync().catch(() => {});
    }, intervalMs);
    bgTimer.unref?.();
  };

  await configureTimer();
  service.onSettingsUpdated((nextSettings) => {
    void configureTimer(nextSettings).catch(() => {});
  });

  const cleanup = async () => {
    if (bgTimer) clearInterval(bgTimer);
    if (watchDebounce) clearTimeout(watchDebounce);
    if (convWatcher) {
      try {
        convWatcher.close();
      } catch {}
    }
    await new Promise((resolve) => server.close(() => resolve()));
    process.exit(0);
  };

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, () => {
      void cleanup();
    });
  }
  process.stdin.resume();
  process.stdin.on('end', () => {
    void cleanup();
  });

  server.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    const port = addr && typeof addr === 'object' ? addr.port : 0;
    process.stdout.write(JSON.stringify({ port, token: controlToken }) + '\n');
  });
}

main().catch((err) => {
  process.stderr.write((err?.stack || err?.message || String(err)) + '\n');
  process.exit(1);
});
