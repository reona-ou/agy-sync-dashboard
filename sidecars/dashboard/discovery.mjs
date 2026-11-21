import { execFile } from 'node:child_process';
import { createConnection } from 'node:net';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { resolvePaths } from '../../compat/platform.mjs';

const exec = promisify(execFile);
const LS_BIN_RE = /(?:^|[\/\\])language_server(?:_(?:linux|macos|darwin)(?:_(?:x64|arm64|arm))?)?(?:\.exe)?(?:\s|$)/i;

const validPid = (v) => Number.isSafeInteger(v) && v > 0 && v <= 0xffffffff;
const validPort = (v) => Number.isInteger(v) && v > 0 && v <= 65535;
const cleanAddr = (v) => (typeof v === 'string' ? v.toLowerCase().replace(/^\[|\]$/g, '') : '');
const isLoopbackOrAny = (v) => ['127.0.0.1', '0.0.0.0', '::1', '::', '0:0:0:0:0:0:0:1', '0:0:0:0:0:0:0:0', 'localhost'].includes(cleanAddr(v));
const isUnspecified = (v) => ['0.0.0.0', '::', '0:0:0:0:0:0:0:0', '*'].includes(cleanAddr(v));

function parseEndpoint(text) {
  const m = String(text).match(/^(\[[^\]]+\]|[^:\s]+):(\d+|\*)$/);
  return m ? { address: m[1], port: m[2] } : null;
}

export function extractLogHttpPorts(logText) {
  const ports = new Set();
  for (const m of String(logText || '').matchAll(/listening on random port at (\d+) for HTTP(?:\s|$)/g)) {
    const port = Number(m[1]);
    if (!validPort(port)) continue;
    ports.delete(port);
    ports.add(port);
  }
  return [...ports].reverse();
}

export function parseNetstat(text) {
  const ports = new Map();
  const rejected = new Set();
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\s*TCP\s+(\S+)\s+(\S+)\s+(?:LISTENING|LISTEN|侦听|监听)\s+(\d+)\s*$/i);
    if (!m) continue;
    const local = parseEndpoint(m[1]);
    const remote = parseEndpoint(m[2]);
    const pid = Number(m[3]);
    if (!validPid(pid)) continue;
    const port = Number(local?.port);
    if (
      !local || !remote || !isLoopbackOrAny(local.address) || !validPort(port)
      || !isUnspecified(remote.address) || !(remote.port === '0' || (remote.address === '*' && remote.port === '*'))
    ) {
      rejected.add(pid);
      continue;
    }
    if (!ports.has(pid)) ports.set(pid, new Set());
    ports.get(pid).add(port);
  }
  return {
    ports: new Map([...ports].map(([pid, set]) => [pid, [...set]])),
    rejected,
  };
}

function probePort(port, timeoutMs = 400) {
  if (!validPort(port)) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    let socket;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket?.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    try {
      socket = createConnection({ host: '127.0.0.1', port, family: 4 });
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
      socket.once('close', () => done(false));
      socket.unref?.();
    } catch {
      done(false);
    }
  });
}

async function discoverWindowsPorts(pids, expectedPorts) {
  const wanted = new Set(pids.filter(validPid));
  if (!wanted.size) return new Map();

  const { stdout } = await exec('netstat.exe', ['-ano', '-p', 'tcp'], {
    windowsHide: true,
    timeout: 4000,
    maxBuffer: 4 * 1024 * 1024,
  }).catch(() => ({ stdout: '' }));

  const snap = parseNetstat(stdout);
  const ports = new Map([...snap.ports].filter(([pid]) => wanted.has(pid)));
  const missing = [...wanted].filter((pid) => {
    const found = ports.get(pid) || [];
    const expected = (expectedPorts.get(pid) || []).find(validPort);
    if (expected !== undefined) return !found.includes(expected);
    return !found.length || snap.rejected.has(pid);
  });

  if (!missing.length) return ports;

  const ps = `$p = @(${missing.join(',')}); Get-NetTCPConnection -OwningProcess $p -ErrorAction SilentlyContinue | Select-Object OwningProcess,LocalAddress,LocalPort,RemoteAddress,RemotePort,State | ConvertTo-Json -Compress`;
  try {
    const res = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      windowsHide: true,
      timeout: 8000,
      maxBuffer: 1024 * 1024,
    });
    const raw = res.stdout.replace(/^\uFEFF/, '').trim();
    const list = raw ? JSON.parse(raw) : [];
    for (const row of Array.isArray(list) ? list : [list]) {
      const pid = Number(row?.OwningProcess);
      const port = Number(row?.LocalPort);
      const state = row?.State;
      const isListen = state === 2 || state === '2' || (typeof state === 'string' && /^listen$/i.test(state));
      const isTunZero = state === 0 || state === '0';
      if (
        !wanted.has(pid) || !validPort(port)
        || !isLoopbackOrAny(row?.LocalAddress)
        || !isUnspecified(row?.RemoteAddress)
        || Number(row?.RemotePort) !== 0
      ) continue;
      if (isListen || isTunZero) {
        const listForPid = ports.get(pid) || [];
        if (!listForPid.includes(port)) listForPid.push(port);
        ports.set(pid, listForPid);
      } else if ((state === null || state === '') && (expectedPorts.get(pid) || [])[0] === port) {
        if (await probePort(port)) {
          const listForPid = ports.get(pid) || [];
          if (!listForPid.includes(port)) listForPid.push(port);
          ports.set(pid, listForPid);
        }
      }
    }
  } catch {
    // ignore PowerShell fallback error
  }
  return ports;
}

async function discoverMacPorts(pids) {
  const out = new Map();
  try {
    const { stdout } = await exec('lsof', ['-nP', '-a', '-p', pids.join(','), '-iTCP', '-sTCP:LISTEN', '-Fpn'], {
      timeout: 4000,
      maxBuffer: 2 * 1024 * 1024,
    });
    let currentPid = null;
    for (const line of stdout.split(/\r?\n/)) {
      if (line.startsWith('p')) {
        currentPid = Number(line.slice(1));
        if (!out.has(currentPid)) out.set(currentPid, []);
      } else if (line.startsWith('n') && currentPid) {
        const m = line.match(/:(\d+)(?:\s|$)/);
        if (m && validPort(Number(m[1]))) out.get(currentPid).push(Number(m[1]));
      }
    }
  } catch {
    // ignore
  }
  return out;
}

async function discoverLinuxPorts(pids) {
  const inodesByPid = new Map();
  const wantedInodes = new Map();
  for (const pid of pids) {
    try {
      const fds = await readdir(`/proc/${pid}/fd`);
      for (const fd of fds) {
        try {
          const link = await readFile(`/proc/${pid}/fdinfo/${fd}`, 'utf8').catch(() => '');
          void link;
        } catch {}
      }
    } catch {}
  }
  // Parse /proc/<pid>/fd symlinks via readlink-like fs or ss fallback
  try {
    const { stdout } = await exec('ss', ['-tlnp'], { timeout: 3000, maxBuffer: 2 * 1024 * 1024 });
    const out = new Map();
    for (const line of stdout.split(/\r?\n/)) {
      const portMatch = line.match(/(?:127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\[::\]):(\d+)\s/);
      if (!portMatch) continue;
      const port = Number(portMatch[1]);
      for (const pidMatch of line.matchAll(/pid=(\d+)/g)) {
        const pid = Number(pidMatch[1]);
        if (!pids.includes(pid)) continue;
        const list = out.get(pid) || [];
        if (!list.includes(port)) list.push(port);
        out.set(pid, list);
      }
    }
    return out;
  } catch {
    void inodesByPid;
    void wantedInodes;
    return new Map();
  }
}

async function listStandaloneLanguageServers(expectedHints) {
  if (process.platform === 'win32') {
    const ps = "Get-CimInstance Win32_Process -Filter \"Name='language_server.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    const raw = stdout.replace(/^\uFEFF/, '').trim();
    const list = raw ? JSON.parse(raw) : [];
    const rows = (Array.isArray(list) ? list : [list]).filter((r) => LS_BIN_RE.test(r?.CommandLine || '') && /--standalone\b/.test(r?.CommandLine || ''));
    const pids = rows.map((r) => Number(r.ProcessId)).filter(validPid);
    const expectedMap = new Map(pids.map((pid) => [pid, expectedHints]));
    const ports = await discoverWindowsPorts(pids, expectedMap);
    return rows.map((r) => ({
      pid: Number(r.ProcessId),
      commandLine: String(r.CommandLine || ''),
      ports: ports.get(Number(r.ProcessId)) || [],
    }));
  }

  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const { stdout } = await exec('ps', ['-axo', 'pid=,uid=,args='], { timeout: 4000, maxBuffer: 2 * 1024 * 1024 });
  const rows = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    if (uid !== null && Number(m[2]) !== uid) continue;
    if (!LS_BIN_RE.test(m[3]) || !/--standalone\b/.test(m[3])) continue;
    rows.push({ pid: Number(m[1]), commandLine: m[3] });
  }
  const pids = rows.map((r) => r.pid);
  const ports = process.platform === 'darwin' ? await discoverMacPorts(pids) : await discoverLinuxPorts(pids);
  return rows.map((r) => ({ ...r, ports: ports.get(r.pid) || [] }));
}

async function readHubDiscoveryFiles(daemonDir) {
  if (!daemonDir) return [];
  let entries;
  try {
    entries = await readdir(daemonDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const hubs = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const full = join(daemonDir, entry.name);
    try {
      const [info, raw] = await Promise.all([stat(full).catch(() => null), readFile(full, 'utf8')]);
      const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
      const pid = Number(parsed?.pid);
      const port = Number(parsed?.httpPort);
      const csrf = typeof parsed?.csrfToken === 'string' ? parsed.csrfToken.trim() : '';
      if (!validPid(pid) || !validPort(port) || !csrf) continue;
      hubs.push({ pid, port, csrf, mtimeMs: info?.mtimeMs ?? 0 });
    } catch {
      // ignore corrupt/unreadable discovery files
    }
  }
  hubs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return hubs;
}

async function resolveEnvEndpoint(env, probeFn) {
  const rawAddr = String(env?.ANTIGRAVITY_LS_ADDRESS || '').trim().replace(/^https?:\/\//i, '');
  const csrf = String(env?.ANTIGRAVITY_CSRF_TOKEN || '').trim();
  if (!rawAddr || !csrf) return null;
  const ep = parseEndpoint(rawAddr);
  const port = Number(ep?.port);
  if (!ep || !isLoopbackOrAny(ep.address) || !validPort(port)) return null;
  if (!(await probeFn(port))) return null;
  return { pid: null, port, csrf };
}

/**
 * Discover the active standalone Antigravity language_server endpoint and CSRF token.
 */
export async function discoverLanguageServer(paths = resolvePaths(), options = {}) {
  const probeFn = options.probePort || probePort;
  const listProcs = options.listProcesses || listStandaloneLanguageServers;
  const defaultPaths = options.env !== undefined ? null : resolvePaths();
  const useProcessEnv =
    options.env === undefined &&
    (!paths || !paths.antigravityData || paths.antigravityData === defaultPaths?.antigravityData);
  const envToCheck = options.env !== undefined ? options.env : useProcessEnv ? process.env : null;

  if (envToCheck) {
    const envEndpoint = await resolveEnvEndpoint(envToCheck, probeFn);
    if (envEndpoint) return envEndpoint;
  }

  const logs = [];
  for (const file of paths.logCandidates || []) {
    try {
      const [info, content] = await Promise.all([stat(file).catch(() => null), readFile(file, 'utf8')]);
      logs.push({
        ports: extractLogHttpPorts(content),
        mtimeMs: info?.mtimeMs ?? 0,
      });
    } catch {
      // ignore missing logs
    }
  }
  logs.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const daemonDir = paths.daemonDir || (paths.antigravityData ? join(paths.antigravityData, 'daemon') : '');
  const hubs = await readHubDiscoveryFiles(daemonDir);
  const hints = [...new Set([...logs.flatMap((l) => l.ports), ...hubs.map((h) => h.port)])];
  const processes = await listProcs(hints);
  if (!processes.length) {
    throw new Error('未检测到运行中的 Antigravity 语言服务');
  }

  for (const hub of hubs) {
    const proc = processes.find((p) => p.pid === hub.pid);
    if (!proc) continue;
    if (proc.ports.includes(hub.port) || (await probeFn(hub.port))) {
      return { pid: proc.pid, port: hub.port, csrf: hub.csrf };
    }
  }

  for (const entry of logs) {
    for (const proc of processes) {
      const port = entry.ports.find((p) => proc.ports.includes(p));
      if (!port) continue;
      const csrf = proc.commandLine.match(/--csrf_token(?:=|\s+)"?([^\s"]+)/)?.[1];
      if (!csrf) continue;
      return { pid: proc.pid, port, csrf };
    }
  }

  // Fallback: match the only running standalone process's port directly if log hints are stale
  if (processes.length === 1 && processes[0].ports.length > 0) {
    const proc = processes[0];
    const csrf = proc.commandLine.match(/--csrf_token(?:=|\s+)"?([^\s"]+)/)?.[1];
    if (csrf) {
      return { pid: proc.pid, port: proc.ports[0], csrf };
    }
  }

  throw new Error('等待 Antigravity 本地接口就绪');
}
