import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { installedAgentExecutable, resolvePaths } from './platform.mjs';

const sdkCache = new Map();

/**
 * Load Antigravity Sidecar SDK via native resolution or bundled binary fallback.
 */
export async function loadSidecarSdk() {
  try {
    return await import('sidecar_sdk');
  } catch (err) {
    if (err.code !== 'ERR_MODULE_NOT_FOUND') throw err;
    try {
      const resolved = createRequire(import.meta.url).resolve('sidecar_sdk');
      return await import(pathToFileURL(resolved).href);
    } catch (resolveErr) {
      if (resolveErr.code !== 'MODULE_NOT_FOUND') throw resolveErr;
      return loadBundledSdk();
    }
  }
}

async function atomicWrite(file, content) {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, content, { flag: 'wx', mode: 0o600 });
    await rename(tmp, file);
  } finally {
    await rm(tmp, { force: true });
  }
}

function extractBundledSdk(binary) {
  if (!Buffer.isBuffer(binary)) throw new Error('Incompatible language_server binary for SDK fallback');
  const marker = binary.indexOf('export class SidecarApp');
  const start = binary.lastIndexOf("import { execFileSync } from 'node:child_process';", marker);
  const tail = 'return provided === this.#token;\n  }\n}\n';
  const tailIndex = binary.indexOf(tail, marker);
  const preloadMarker = binary.indexOf('window.sidecar =');
  const preloadStart = binary.lastIndexOf('(function() {', preloadMarker);
  const preloadTail = '\n})();';
  const preloadEnd = binary.indexOf(preloadTail, preloadMarker);
  if (marker < 0 || start < 0 || tailIndex < marker || preloadStart < 0 || preloadEnd < preloadMarker) {
    throw new Error('Bundled Sidecar SDK not found in language_server binary');
  }
  const sdk = binary.subarray(start, tailIndex + Buffer.byteLength(tail)).toString('utf8');
  const preload = binary.subarray(preloadStart, preloadEnd + Buffer.byteLength(preloadTail)).toString('utf8');
  if (!sdk.includes('127.0.0.1')) throw new Error('Extracted SDK does not bind exclusively to loopback');
  return { sdk, preload };
}

async function loadBundledSdk() {
  const exe = installedAgentExecutable();
  if (!exe) throw new Error('sidecar_sdk unavailable and bundled language_server not found');
  const cacheDir = join(resolvePaths().pluginDataDir, 'sdk-cache');
  if (sdkCache.has(exe)) return sdkCache.get(exe);

  const pending = (async () => {
    const info = await stat(exe);
    const stamp = `${exe}:${info.size}:${info.mtimeMs}`;
    const key = createHash('sha256').update(stamp).digest('hex');
    const root = join(cacheDir, key);

    let loaded = false;
    try {
      const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
      if (manifest.stamp === stamp) loaded = true;
    } catch {
      loaded = false;
    }

    if (!loaded) {
      const { sdk, preload } = extractBundledSdk(await readFile(exe));
      await mkdir(root, { recursive: true });
      await atomicWrite(join(root, 'index.mjs'), sdk);
      await atomicWrite(join(root, 'preload.js'), preload);
      await atomicWrite(join(root, 'manifest.json'), JSON.stringify({ stamp }) + '\n');
    }

    return import(`${pathToFileURL(join(root, 'index.mjs')).href}?v=${key}`);
  })();

  sdkCache.set(exe, pending);
  try {
    return await pending;
  } catch (err) {
    sdkCache.delete(exe);
    throw err;
  }
}
