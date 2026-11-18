import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readHostTheme } from '../../compat/host-theme.mjs';
import { resolvePaths } from '../../compat/platform.mjs';
import { loadSidecarSdk } from '../../compat/sdk.mjs';
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

export async function pickNativeFolder(initialDir = '') {
  const safeInit = initialDir && fs.existsSync(initialDir) ? path.resolve(initialDir) : '';
  if (process.platform === 'win32') {
    const psScript = [
      'Add-Type -AssemblyName System.Windows.Forms;',
      '$f = New-Object System.Windows.Forms.Form;',
      '$f.TopMost = $true;',
      '$d = New-Object System.Windows.Forms.FolderBrowserDialog;',
      '$d.Description = "选择跨设备同步文件夹 (如 D:\\Sync\\agy-sync-dashboard)";',
      '$d.ShowNewFolderButton = $true;',
      'if ($env:AGY_INIT_DIR -and (Test-Path $env:AGY_INIT_DIR)) { $d.SelectedPath = $env:AGY_INIT_DIR };',
      'if ($d.ShowDialog($f) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }',
    ].join(' ');
    try {
      const { stdout } = await execFilePromise(
        'powershell.exe',
        ['-NoProfile', '-Sta', '-NonInteractive', '-Command', psScript],
        { env: { ...process.env, AGY_INIT_DIR: safeInit }, windowsHide: true }
      );
      const selected = String(stdout || '').trim();
      return selected ? { cancelled: false, path: selected } : { cancelled: true, path: '' };
    } catch (err) {
      return { cancelled: true, path: '', error: err?.message || 'Folder dialog unavailable' };
    }
  }

  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFilePromise('osascript', [
        '-e',
        'POSIX path of (choose folder with prompt "Select Antigravity Sync Folder")',
      ]);
      const selected = String(stdout || '').trim().replace(/\/+$/, '');
      return selected ? { cancelled: false, path: selected } : { cancelled: true, path: '' };
    } catch {
      return { cancelled: true, path: '' };
    }
  }

  for (const [bin, args] of [
    ['zenity', ['--file-selection', '--directory', '--title=Select Sync Folder']],
    ['kdialog', ['--getexistingdirectory', safeInit || process.env.HOME || '.']],
  ]) {
    try {
      const { stdout } = await execFilePromise(bin, args);
      const selected = String(stdout || '').trim();
      if (selected) return { cancelled: false, path: selected };
      return { cancelled: true, path: '' };
    } catch (err) {
      if (err?.code === 1 || err?.code === 5) return { cancelled: true, path: '' };
    }
  }
  return { cancelled: true, path: '', error: 'No native folder picker (zenity/kdialog) available' };
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

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
  --theme-font-sans: ${font}system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  --theme-font-mono: ${mono}ui-monospace, "Cascadia Mono", Consolas, monospace;
}
`;
}

export async function createDashboardService(options = {}) {
  const paths = options.paths || resolvePaths();
  fs.mkdirSync(paths.pluginDataDir, { recursive: true });

  const syncManager = options.syncManager || new SyncManager({ paths });
  const quotaClient = options.quotaClient || new QuotaClient(paths);

  let inFlightSync = null;
  const runSync = () => {
    if (!inFlightSync) {
      inFlightSync = syncManager.syncOnce().finally(() => {
        inFlightSync = null;
      });
    }
    return inFlightSync;
  };

  async function getDashboard({ forceSync = false, forceQuota = false } = {}) {
    const stale = !syncManager.lastMerged || Date.now() - syncManager.lastSyncAt > 12_000;
    const synced = forceSync || stale ? await runSync() : syncManager.lastMerged;
    const [quota, hostTheme] = await Promise.all([
      quotaClient.fetch(forceQuota).catch((err) => ({
        connected: false,
        groups: [],
        fetchedAt: Date.now(),
        error: err?.message || String(err),
      })),
      readHostTheme(paths.pluginConfig),
    ]);

    return {
      hostTheme,
      quota,
      ...synced,
    };
  }

  async function updateSettings(payload) {
    const updated = await syncManager.updateSettings(payload || {});
    const [quota, hostTheme] = await Promise.all([
      quotaClient.fetch(false).catch(() => ({ connected: false, groups: [], fetchedAt: Date.now() })),
      readHostTheme(paths.pluginConfig),
    ]);
    return {
      settings: updated.settings,
      candidates: updated.candidates,
      dashboard: {
        hostTheme,
        quota,
        ...updated.synced,
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
    getDashboard,
    updateSettings,
    getSettings,
    testSettings,
    getThemeCss,
  };
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
      if (url.pathname === '/api/dashboard' && req.method === 'GET') {
        const force = url.searchParams.get('force') === '1' || url.searchParams.get('force') === 'true';
        const quotaRefresh = url.searchParams.get('quotaRefresh') === '1' || force;
        sendJson(200, await service.getDashboard({ forceSync: force, forceQuota: quotaRefresh }));
        return;
      }

      if (url.pathname === '/api/sync' && req.method === 'POST') {
        const tokenHeader = req.headers['x-agy-sync-token'];
        // Allow same-origin UI requests or CLI/hook requests presenting our local runtime token.
        if (!origin && tokenHeader && tokenHeader !== controlToken) {
          sendJson(403, { error: 'Invalid sync token' });
          return;
        }
        sendJson(200, await service.getDashboard({ forceSync: true, forceQuota: true }));
        return;
      }

      if (url.pathname === '/api/settings' && req.method === 'GET') {
        sendJson(200, await service.getSettings());
        return;
      }

      if (url.pathname === '/api/settings' && req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 32 * 1024) {
            sendJson(413, { error: 'Payload too large' });
            return;
          }
        }
        const parsed = raw ? JSON.parse(raw) : {};
        sendJson(200, await service.updateSettings(parsed));
        return;
      }

      if (url.pathname === '/api/settings/test' && req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 32 * 1024) {
            sendJson(413, { error: 'Payload too large' });
            return;
          }
        }
        const parsed = raw ? JSON.parse(raw) : {};
        sendJson(200, await service.testSettings(parsed));
        return;
      }

      if (url.pathname === '/api/settings/pick-folder' && req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 4096) break;
        }
        const parsed = raw ? JSON.parse(raw) : {};
        sendJson(200, await pickNativeFolder(parsed.initialDir || ''));
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
      sendJson(500, { error: err?.message || 'Internal error' });
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
  await service.runSync().catch(() => {});

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

  const startPeriodicSync = async () => {
    const { settings } = await service.getSettings();
    const intervalMs = Math.max(10_000, Number(settings.syncIntervalMs || 30_000));
    bgTimer = setInterval(() => {
      void service.runSync().catch(() => {});
    }, intervalMs);
    bgTimer.unref();
  };

  await startPeriodicSync();

  const cleanup = async () => {
    if (bgTimer) clearInterval(bgTimer);
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
      '/api/dashboard',
      async (data) => {
        const force = data?.force === true || data?.force === '1';
        const quotaRefresh = data?.quotaRefresh === true || data?.quotaRefresh === '1' || force;
        return service.getDashboard({ forceSync: force, forceQuota: quotaRefresh });
      },
      'GET'
    );

    app.api(
      '/api/sync',
      async () => service.getDashboard({ forceSync: true, forceQuota: true }),
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
      async (data) => pickNativeFolder(data?.initialDir || ''),
      'POST'
    );

    await app.run();

    // Ephemeral local loopback control server so hooks can notify the live sidecar immediately.
    controlServer = http.createServer((req, res) => {
      if (req.url === '/api/sync' && req.method === 'POST') {
        if (req.headers['x-agy-sync-token'] !== controlToken) {
          res.writeHead(403);
          res.end();
          return;
        }
        void service
          .runSync()
          .then((r) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, at: r.syncStatus.lastSyncAt }));
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
