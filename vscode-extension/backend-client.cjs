'use strict';

const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function hasBuiltinSqlite() {
  try {
    require('node:sqlite');
    return true;
  } catch {
    return false;
  }
}

function isModernNodeVersion(verStr) {
  const m = String(verStr || '').trim().match(/^v?(\d+)\.(\d+)/);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return major > 22 || (major === 22 && minor >= 5);
}

function probeNodeBinary(binPath) {
  if (!binPath || !fs.existsSync(binPath)) return false;
  try {
    const isCmd = process.platform === 'win32' && /\.(cmd|bat)$/i.test(binPath);
    const out = execFileSync(binPath, ['--version'], {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
      shell: isCmd,
    });
    return isModernNodeVersion(out);
  } catch {
    return false;
  }
}

function findExternalModernNode(configuredPath = '') {
  const candidates = [];
  if (configuredPath && typeof configuredPath === 'string' && configuredPath.trim()) {
    candidates.push(configuredPath.trim());
  }

  const home = os.homedir();
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    candidates.push(
      path.join(appData, 'Antigravity', 'bin', 'agy-node.cmd'),
      path.join(localAppData, 'Programs', 'antigravity', 'resources', 'app', 'node.exe'),
      path.join(localAppData, 'Programs', 'Antigravity', 'resources', 'app', 'node.exe')
    );
    try {
      const whichOut = execFileSync('where.exe', ['node'], { encoding: 'utf8', timeout: 2500, windowsHide: true });
      for (const line of whichOut.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) candidates.push(trimmed);
      }
    } catch {}
  } else {
    candidates.push(
      path.join(home, '.antigravity', 'bin', 'agy-node'),
      '/Applications/Antigravity.app/Contents/Resources/app/node',
      '/usr/local/bin/node',
      '/opt/homebrew/bin/node',
      '/usr/bin/node'
    );
    try {
      const whichOut = execFileSync('which', ['-a', 'node'], { encoding: 'utf8', timeout: 2500 });
      for (const line of whichOut.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) candidates.push(trimmed);
      }
    } catch {}
  }

  const seen = new Set();
  for (const cand of candidates) {
    if (!cand || seen.has(cand)) continue;
    seen.add(cand);
    if (probeNodeBinary(cand)) return cand;
  }
  return null;
}

function httpJsonRequest(port, method, urlPath, bodyText = '') {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (bodyText) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(bodyText);
    }
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path: urlPath,
        headers,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode || 200,
            ok: (res.statusCode || 500) >= 200 && (res.statusCode || 500) < 300,
            bodyText: raw,
          });
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('Worker HTTP timeout')));
    if (bodyText) req.write(bodyText);
    req.end();
  });
}

function resolveRuntimeRoot(extensionDir) {
  const bundled = path.join(extensionDir, 'runtime');
  if (fs.existsSync(path.join(bundled, 'sidecars', 'dashboard', 'main.mjs'))) {
    return bundled;
  }
  const repoParent = path.resolve(extensionDir, '..');
  if (fs.existsSync(path.join(repoParent, 'sidecars', 'dashboard', 'main.mjs'))) {
    return repoParent;
  }
  throw new Error('AGY Sync Dashboard runtime files not found');
}

async function createInProcessClient(runtimeRoot) {
  const mainUrl = pathToFileURL(path.join(runtimeRoot, 'sidecars', 'dashboard', 'main.mjs')).href;
  const platUrl = pathToFileURL(path.join(runtimeRoot, 'compat', 'platform.mjs')).href;
  const [{ createDashboardService }, { resolvePaths }] = await Promise.all([
    import(mainUrl),
    import(platUrl),
  ]);

  const paths = resolvePaths();
  fs.mkdirSync(paths.pluginDataDir, { recursive: true });
  const service = await createDashboardService({ paths });
  await service.runSync().catch(() => {});

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
  const unsubSettings = service.onSettingsUpdated((nextSettings) => {
    void configureTimer(nextSettings).catch(() => {});
  });

  async function handleApi(urlStr, method = 'GET', bodyText = '') {
    const parsedUrl = new URL(urlStr || '/', 'http://127.0.0.1');
    const pathname = parsedUrl.pathname;
    const upperMethod = String(method || 'GET').toUpperCase();
    const bodyObj = bodyText && bodyText.trim() ? JSON.parse(bodyText) : {};

    const jsonRes = (status, data) => ({
      status,
      ok: status >= 200 && status < 300,
      bodyText: JSON.stringify(data),
    });

    try {
      if (pathname === '/api/version' && upperMethod === 'GET') {
        const convId = parsedUrl.searchParams.get('convId') || 'auto';
        return jsonRes(200, await service.getVersion(convId));
      }
      if (pathname === '/api/session-context' && upperMethod === 'GET') {
        const convId = parsedUrl.searchParams.get('convId') || 'auto';
        const forceTrajectories = parsedUrl.searchParams.get('force') === '1';
        return jsonRes(200, await service.getSessionContext({ convId, forceTrajectories }));
      }
      if (pathname === '/api/dashboard' && upperMethod === 'GET') {
        const force = parsedUrl.searchParams.get('force') === '1' || parsedUrl.searchParams.get('force') === 'true';
        const quotaRefresh = parsedUrl.searchParams.get('quotaRefresh') === '1' || force;
        const convId = parsedUrl.searchParams.get('convId') || 'auto';
        return jsonRes(200, await service.getDashboard({ forceSync: force, forceQuota: quotaRefresh, convId }));
      }
      if (pathname === '/api/sync' && upperMethod === 'POST') {
        const convId = bodyObj?.convId || parsedUrl.searchParams.get('convId') || 'auto';
        return jsonRes(200, await service.getDashboard({ forceSync: true, forceQuota: true, convId }));
      }
      if (pathname === '/api/settings' && upperMethod === 'GET') {
        return jsonRes(200, await service.getSettings());
      }
      if (pathname === '/api/settings' && upperMethod === 'POST') {
        return jsonRes(200, await service.updateSettings(bodyObj));
      }
      if (pathname === '/api/settings/test' && upperMethod === 'POST') {
        return jsonRes(200, await service.testSettings(bodyObj));
      }
      return jsonRes(404, { error: `Unknown endpoint: ${pathname}` });
    } catch (err) {
      return jsonRes(err?.statusCode || 400, { error: err?.message || 'Internal error' });
    }
  }

  return {
    mode: 'in-process',
    runtimeRoot,
    handleApi,
    async dispose() {
      unsubSettings?.();
      if (bgTimer) clearInterval(bgTimer);
      if (watchDebounce) clearTimeout(watchDebounce);
      if (convWatcher) {
        try {
          convWatcher.close();
        } catch {}
      }
    },
  };
}

async function createWorkerClient(extensionDir, runtimeRoot, configuredNodePath) {
  const nodeBin = findExternalModernNode(configuredNodePath);
  if (!nodeBin) {
    throw new Error(
      'Current VS Code extension host lacks node:sqlite (requires Node >= 22.5) and no external Node >= 22.5 / agy-node was found. Set agySyncDashboard.nodePath in settings.'
    );
  }

  const workerScript = path.join(extensionDir, 'worker.mjs');
  const isCmd = process.platform === 'win32' && /\.(cmd|bat)$/i.test(nodeBin);
  const child = spawn(nodeBin, ['--no-warnings', workerScript], {
    cwd: extensionDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: isCmd,
  });

  const info = await new Promise((resolve, reject) => {
    let stdoutBuf = '';
    let stderrBuf = '';
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      reject(new Error(`Worker startup timeout: ${stderrBuf || 'no output'}`));
    }, 15000);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk;
      const nl = stdoutBuf.indexOf('\n');
      if (nl >= 0) {
        const line = stdoutBuf.slice(0, nl).trim();
        try {
          const parsed = JSON.parse(line);
          if (parsed?.port > 0) {
            clearTimeout(timer);
            resolve(parsed);
          }
        } catch {}
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      if (stderrBuf.length < 4096) stderrBuf += chunk;
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Worker exited early (${code}): ${stderrBuf}`));
    });
  });

  return {
    mode: 'worker',
    runtimeRoot,
    nodeBin,
    async handleApi(urlStr, method = 'GET', bodyText = '') {
      return httpJsonRequest(info.port, String(method || 'GET').toUpperCase(), urlStr || '/', bodyText);
    },
    async dispose() {
      try {
        child.stdin.end();
      } catch {}
      try {
        child.kill();
      } catch {}
    },
  };
}

async function createBackendClient(extensionDir, options = {}) {
  const runtimeRoot = resolveRuntimeRoot(extensionDir);
  if (hasBuiltinSqlite()) {
    return createInProcessClient(runtimeRoot);
  }
  return createWorkerClient(extensionDir, runtimeRoot, options.nodePath || '');
}

module.exports = {
  createBackendClient,
  findExternalModernNode,
  hasBuiltinSqlite,
  isModernNodeVersion,
  resolveRuntimeRoot,
};
