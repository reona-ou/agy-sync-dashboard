import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

export const GITHUB_REPO = 'reona-ou/agy-sync-dashboard';
export const GITHUB_RELEASES_LATEST_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
export const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;
export const RUNTIME_ITEMS = ['plugin.json', 'hooks.json', 'package.json', 'assets', 'compat', 'hooks', 'sidecars'];

/**
 * Parse a semver-like version string into [major, minor, patch].
 */
export function parseSemver(version) {
  const clean = String(version || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[+-]/)[0];
  if (!clean) return [0, 0, 0];
  const parts = clean.split('.').slice(0, 3).map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  while (parts.length < 3) parts.push(0);
  return parts;
}

/**
 * Compare two semver strings: returns 1 if a > b, -1 if a < b, 0 if equal.
 */
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function readTarString(buf, start, length) {
  const slice = buf.subarray(start, start + length);
  const zeroIdx = slice.indexOf(0);
  const end = zeroIdx >= 0 ? zeroIdx : slice.length;
  return slice.subarray(0, end).toString('utf8').trim();
}

function readTarOctal(buf, start, length) {
  const raw = readTarString(buf, start, length).replace(/\0/g, '').trim();
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 8);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function parsePaxRecords(dataBuf) {
  const records = {};
  const text = dataBuf.toString('utf8');
  let pos = 0;
  while (pos < text.length) {
    const spaceIdx = text.indexOf(' ', pos);
    if (spaceIdx < 0) break;
    const len = Number.parseInt(text.slice(pos, spaceIdx), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const record = text.slice(spaceIdx + 1, pos + len);
    const eqIdx = record.indexOf('=');
    if (eqIdx > 0) {
      const key = record.slice(0, eqIdx);
      const val = record.slice(eqIdx + 1).replace(/\n$/, '');
      records[key] = val;
    }
    pos += len;
  }
  return records;
}

/**
 * Extract a .tar.gz buffer into destDir in pure Node.js (supports ustar, PAX, and GNU long names).
 */
export async function extractTarGzBuffer(gzBuffer, destDir, options = {}) {
  const stripComponents = Number.isInteger(options.stripComponents) ? options.stripComponents : 1;
  const tarBuf = zlib.gunzipSync(gzBuffer);
  const resolvedDest = path.resolve(destDir);
  await fsp.mkdir(resolvedDest, { recursive: true });

  let offset = 0;
  let paxPath = '';
  let gnuLongName = '';

  while (offset + 512 <= tarBuf.length) {
    const header = tarBuf.subarray(offset, offset + 512);
    offset += 512;

    let isZeroBlock = true;
    for (let i = 0; i < 512; i++) {
      if (header[i] !== 0) {
        isZeroBlock = false;
        break;
      }
    }
    if (isZeroBlock) break;

    const size = readTarOctal(header, 124, 12);
    const typeFlag = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
    const dataBlocks = Math.ceil(size / 512) * 512;
    const dataEnd = Math.min(tarBuf.length, offset + size);
    const dataBuf = tarBuf.subarray(offset, dataEnd);
    offset += dataBlocks;

    if (typeFlag === 'x') {
      const records = parsePaxRecords(dataBuf);
      if (records.path) paxPath = records.path;
      continue;
    }
    if (typeFlag === 'g') {
      continue;
    }
    if (typeFlag === 'L') {
      gnuLongName = dataBuf.toString('utf8').replace(/\0+$/, '');
      continue;
    }

    const namePart = readTarString(header, 0, 100);
    const prefixPart = readTarString(header, 345, 155);
    const headerPath = prefixPart ? `${prefixPart}/${namePart}` : namePart;
    const rawPath = paxPath || gnuLongName || headerPath;
    paxPath = '';
    gnuLongName = '';

    if (!rawPath) continue;
    const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const parts = normalized.split('/').filter(Boolean);
    const stripped = parts.slice(stripComponents);
    if (stripped.length === 0) continue;
    if (stripped.some((seg) => seg === '..' || seg === '.')) continue;

    const targetPath = path.resolve(resolvedDest, ...stripped);
    if (targetPath !== resolvedDest && !targetPath.startsWith(resolvedDest + path.sep)) {
      throw new Error(`Unsafe tar entry path: ${rawPath}`);
    }

    if (typeFlag === '5') {
      await fsp.mkdir(targetPath, { recursive: true });
    } else if (typeFlag === '0') {
      await fsp.mkdir(path.dirname(targetPath), { recursive: true });
      await fsp.writeFile(targetPath, dataBuf);
    }
  }
}

export function isDevRepository(pluginRoot) {
  if (!pluginRoot) return false;
  return fs.existsSync(path.join(pluginRoot, '.git'));
}

export async function checkForUpdates({ currentVersion = '0.0.0', pluginRoot = '', fetchImpl = fetch } = {}) {
  const res = await fetchImpl(GITHUB_RELEASES_LATEST_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'agy-sync-dashboard',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`GitHub API HTTP ${res.status}`);
  }
  const data = await res.json();
  const tagName = String(data?.tag_name || '').trim();
  const latestVersion = tagName.replace(/^v/i, '');
  if (!latestVersion) {
    throw new Error('Latest release tag missing');
  }
  const assets = Array.isArray(data?.assets) ? data.assets : [];
  const vsix = assets.find((a) => typeof a?.name === 'string' && a.name.toLowerCase().endsWith('.vsix')) || null;
  const isDevRepo = isDevRepository(pluginRoot);

  return {
    ok: true,
    currentVersion: String(currentVersion || '0.0.0'),
    latestVersion,
    tagName,
    hasUpdate: compareSemver(latestVersion, currentVersion) > 0,
    releaseUrl: String(data?.html_url || GITHUB_RELEASES_URL),
    publishedAt: String(data?.published_at || ''),
    notes: String(data?.body || '').trim(),
    tarballUrl: String(
      data?.tarball_url || `https://codeload.github.com/${GITHUB_REPO}/tar.gz/refs/tags/${encodeURIComponent(tagName)}`
    ),
    vsixAsset: vsix
      ? {
          name: vsix.name,
          url: vsix.browser_download_url,
          size: Number(vsix.size || 0),
        }
      : null,
    isDevRepo,
    canSelfUpdate: !isDevRepo,
  };
}

async function syncDirectoryTree(srcDir, dstDir) {
  await fsp.mkdir(dstDir, { recursive: true });
  const srcEntries = await fsp.readdir(srcDir, { withFileTypes: true });
  const srcNames = new Set(srcEntries.map((e) => e.name));

  const dstEntries = await fsp.readdir(dstDir, { withFileTypes: true }).catch(() => []);
  for (const dstEntry of dstEntries) {
    if (!srcNames.has(dstEntry.name)) {
      await fsp.rm(path.join(dstDir, dstEntry.name), { recursive: true, force: true });
    }
  }

  for (const entry of srcEntries) {
    if (entry.name === '__pycache__' || entry.name === '.DS_Store' || entry.name === 'Thumbs.db') continue;
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      await syncDirectoryTree(srcPath, dstPath);
    } else if (entry.isFile()) {
      await fsp.copyFile(srcPath, dstPath);
    }
  }
}

export function isAllowedGitHubUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''));
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'github.com' ||
      host === 'api.github.com' ||
      host === 'codeload.github.com' ||
      host.endsWith('.githubusercontent.com')
    );
  } catch {
    return false;
  }
}

export async function applySidecarUpdate({
  pluginRoot,
  currentVersion = '0.0.0',
  tarballUrl = '',
  tagName = '',
  fetchImpl = fetch,
} = {}) {
  if (!pluginRoot) {
    throw new Error('Plugin root directory is unknown');
  }
  if (isDevRepository(pluginRoot)) {
    throw new Error('Cannot overwrite a git development repository');
  }

  let resolvedTarball = String(tarballUrl || '').trim();
  let resolvedTag = String(tagName || '').trim();
  if (!resolvedTarball) {
    const info = await checkForUpdates({ currentVersion, pluginRoot, fetchImpl });
    if (!info.hasUpdate) {
      return {
        ok: true,
        updated: false,
        currentVersion,
        version: info.latestVersion,
        releaseUrl: info.releaseUrl,
      };
    }
    resolvedTarball = info.tarballUrl;
    resolvedTag = info.tagName;
  }

  if (fetchImpl === fetch && !isAllowedGitHubUrl(resolvedTarball)) {
    throw new Error('Blocked untrusted update archive URL');
  }

  const res = await fetchImpl(resolvedTarball, {
    headers: { 'User-Agent': 'agy-sync-dashboard' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`Failed to download update archive (HTTP ${res.status})`);
  }
  const gzBuffer = Buffer.from(await res.arrayBuffer());

  const stagingDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'agy-sync-update-'));
  try {
    await extractTarGzBuffer(gzBuffer, stagingDir, { stripComponents: 1 });
    const pkgPath = path.join(stagingDir, 'plugin.json');
    if (!fs.existsSync(pkgPath)) {
      throw new Error('Downloaded archive does not contain plugin.json');
    }
    const nextMeta = JSON.parse(await fsp.readFile(pkgPath, 'utf8'));
    const nextVersion = String(nextMeta?.version || resolvedTag.replace(/^v/i, '') || currentVersion);

    for (const item of RUNTIME_ITEMS) {
      const src = path.join(stagingDir, item);
      if (!fs.existsSync(src)) continue;
      const dst = path.join(pluginRoot, item);
      const st = await fsp.stat(src);
      if (st.isDirectory()) {
        await syncDirectoryTree(src, dst);
      } else {
        await fsp.mkdir(path.dirname(dst), { recursive: true });
        await fsp.copyFile(src, dst);
      }
    }

    return {
      ok: true,
      updated: true,
      previousVersion: String(currentVersion || '0.0.0'),
      version: nextVersion,
      restartRequired: true,
    };
  } finally {
    await fsp.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  }
}
