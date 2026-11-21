import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

/**
 * Resolve cross-platform Antigravity data, log, and plugin paths.
 */
export function resolvePaths({ platform = process.platform, home = homedir(), env = process.env } = {}) {
  const config = platform === 'win32'
    ? (env.APPDATA || join(home, 'AppData', 'Roaming'))
    : platform === 'darwin'
      ? join(home, 'Library', 'Application Support')
      : (env.XDG_CONFIG_HOME || join(home, '.config'));

  const local = platform === 'win32'
    ? (env.LOCALAPPDATA || join(home, 'AppData', 'Local'))
    : platform === 'darwin'
      ? join(home, 'Library', 'Application Support')
      : (env.XDG_DATA_HOME || join(home, '.local', 'share'));

  let antigravityData = join(home, '.gemini', 'antigravity');
  const execData = env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
  if (execData) {
    for (let dir = execData; dir !== dirname(dir); dir = dirname(dir)) {
      if (basename(dir) === 'sidecar_data') {
        const parent = dirname(dir);
        if (existsSync(join(parent, 'conversations'))) {
          antigravityData = parent;
          break;
        }
      }
    }
  }

  const pluginDataDir = env.AG_SYNC_DATA_DIR || join(antigravityData, 'sidecar_data', 'agy-sync-dashboard', 'dashboard', 'data');
  const profile = env.AG_SYNC_PROFILE || join(config, 'Antigravity');
  const profileLog = join(profile, 'logs', 'language_server.log');
  const macLog = join(home, 'Library', 'Logs', 'Antigravity', 'language_server.log');
  const defaultLog = platform === 'darwin' ? macLog : profileLog;
  const logCandidates = env.AG_SYNC_LOG
    ? [env.AG_SYNC_LOG]
    : [...new Set([
        defaultLog,
        profileLog,
        ...(platform === 'win32' ? [join(home, '.gemini', 'antigravity', 'logs', 'language_server.log')] : []),
      ])];

  return {
    platform,
    home,
    config,
    local,
    antigravityData,
    conversationsDir: join(antigravityData, 'conversations'),
    summariesDb: join(antigravityData, 'conversation_summaries.db'),
    daemonDir: join(antigravityData, 'daemon'),
    pluginConfig: join(home, '.gemini', 'config', 'config.json'),
    pluginDataDir,
    profile,
    logCandidates,
  };
}

/**
 * Candidate root directories commonly synced by Syncthing / cloud drives.
 */
export function detectSyncCandidates({ platform = process.platform, home = homedir(), env = process.env } = {}) {
  const candidates = [];
  if (platform === 'win32') {
    candidates.push(
      'D:\\Sync',
      'C:\\Sync',
      join(home, 'Sync'),
      join(home, 'Syncthing'),
      ...(env.OneDrive ? [env.OneDrive] : []),
      'D:\\OneDrive',
      join(home, 'OneDrive'),
      'D:\\GoogleDrive',
      join(home, 'GoogleDrive'),
    );
  } else if (platform === 'darwin') {
    candidates.push(
      join(home, 'Sync'),
      join(home, 'Syncthing'),
      join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'),
      join(home, 'Library', 'CloudStorage'),
    );
  } else {
    candidates.push(
      join(home, 'Sync'),
      join(home, 'Syncthing'),
      join(home, 'sync'),
    );
  }

  const found = [];
  const seen = new Set();
  for (const root of candidates) {
    if (!root || seen.has(root)) continue;
    seen.add(root);
    try {
      if (existsSync(root)) found.push(join(root, 'agy-sync-dashboard'));
    } catch {
      // ignore inaccessible roots
    }
  }
  return found;
}

/**
 * Find the bundled Antigravity language_server binary for fallback SDK loading.
 */
export function installedAgentExecutable({ platform = process.platform, home = homedir(), env = process.env, arch = process.arch } = {}) {
  if (env.ANTIGRAVITY_AGENTAPI_EXE && existsSync(env.ANTIGRAVITY_AGENTAPI_EXE)) {
    return env.ANTIGRAVITY_AGENTAPI_EXE;
  }
  const roots = platform === 'win32'
    ? [join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Programs', 'antigravity', 'resources')]
    : platform === 'darwin'
      ? ['/Applications/Antigravity.app/Contents/Resources', join(home, 'Applications', 'Antigravity.app', 'Contents', 'Resources')]
      : ['/opt/Antigravity/resources', '/opt/antigravity/resources', '/usr/share/antigravity/resources'];

  if (env.AG_SYNC_APP_RESOURCES) roots.unshift(env.AG_SYNC_APP_RESOURCES);

  const names = platform === 'win32'
    ? ['language_server.exe']
    : [`language_server_${platform === 'darwin' ? 'macos' : 'linux'}_${arch === 'arm64' ? 'arm' : 'x'}64`, `language_server_${platform === 'darwin' ? 'macos' : 'linux'}`, 'language_server'];

  for (const root of roots) {
    for (const name of names) {
      const candidate = join(root, 'bin', name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export function readJsonSafe(file, fallback = null) {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}
