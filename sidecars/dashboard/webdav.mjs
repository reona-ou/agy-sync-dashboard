import crypto from 'node:crypto';

export const DEFAULT_WEBDAV_REMOTE_PATH = '/agy-sync-dashboard';
const REQUEST_TIMEOUT_MS = 12_000;
const DEFAULT_UPLOAD_KEEPALIVE_MS = 15 * 60_000;

export function isRateLimitedStatus(status) {
  return status === 429 || status === 503;
}

export function parseRetryAfterMs(headers) {
  const raw = headers && typeof headers.get === 'function' ? headers.get('retry-after') : null;
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (/^\d+$/.test(trimmed)) {
    const secs = Number(trimmed);
    return Number.isFinite(secs) && secs >= 0 ? Math.min(600_000, secs * 1000) : null;
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, Math.min(600_000, dateMs - Date.now()));
  }
  return null;
}

export function computeSnapshotContentHash(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return '';
  const stable = {
    ...snapshot,
    updatedAt: 0,
    local: snapshot.local && typeof snapshot.local === 'object' ? { ...snapshot.local, collectedAt: 0 } : snapshot.local,
  };
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

/**
 * Decode common XML entities returned inside WebDAV PROPFIND responses.
 */
function decodeXmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Normalize WebDAV configuration fields without altering credential characters.
 */
export function normalizeWebDavConfig(raw = {}) {
  const url = String(raw?.url || '').trim().replace(/\/+$/, '');
  let remotePath = String(raw?.remotePath || DEFAULT_WEBDAV_REMOTE_PATH).trim();
  if (!remotePath) remotePath = DEFAULT_WEBDAV_REMOTE_PATH;
  remotePath = '/' + remotePath.replace(/^\/+/, '').replace(/\/+$/, '');
  if (remotePath === '/') remotePath = DEFAULT_WEBDAV_REMOTE_PATH;

  const username = String(raw?.username || '').trim();
  const password = typeof raw?.password === 'string' ? raw.password : '';

  return {
    url,
    remotePath,
    username,
    password,
  };
}

/**
 * Return a client-safe view of WebDAV settings without exposing the password.
 */
export function redactWebDavConfig(raw = {}) {
  const norm = normalizeWebDavConfig(raw);
  return {
    url: norm.url,
    remotePath: norm.remotePath,
    username: norm.username,
    hasPassword: norm.password.length > 0,
  };
}

/**
 * Build remote collection URLs from WebDAV base URL and remotePath.
 */
export function buildWebDavUrls(rawConfig) {
  const cfg = normalizeWebDavConfig(rawConfig);
  if (!cfg.url) {
    throw new Error('WebDAV server URL is required');
  }
  const parsed = new URL(cfg.url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('WebDAV URL must use http:// or https://');
  }

  const basePath = parsed.pathname.replace(/\/+$/, '');
  const segments = cfg.remotePath
    .split('/')
    .filter(Boolean)
    .map((s) => encodeURIComponent(s));

  const rootUrl = `${parsed.origin}${basePath}`;
  const appSegments = [...segments];
  const devicesSegments = [...segments, 'devices'];

  return {
    cfg,
    origin: parsed.origin,
    basePath,
    segmentUrls: [
      ...appSegments.map((_, idx) => `${rootUrl}/${appSegments.slice(0, idx + 1).join('/')}/`),
      `${rootUrl}/${devicesSegments.join('/')}/`,
    ],
    devicesDirUrl: `${rootUrl}/${devicesSegments.join('/')}/`,
    snapshotUrl: (deviceId) => `${rootUrl}/${devicesSegments.join('/')}/${encodeURIComponent(deviceId)}.json`,
    fileUrl: (fileName) => `${rootUrl}/${devicesSegments.join('/')}/${encodeURIComponent(fileName)}`,
  };
}

/**
 * Parse WebDAV PROPFIND XML (namespace-agnostic) into file metadata entries.
 */
export function parsePropfindXml(xmlText) {
  const responses = [];
  const blockRegex = /<(?:[a-zA-Z0-9_-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?response>/gi;
  let match;

  while ((match = blockRegex.exec(String(xmlText || ''))) !== null) {
    const block = match[1];
    const hrefMatch = block.match(/<(?:[a-zA-Z0-9_-]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?href>/i);
    if (!hrefMatch) continue;

    const rawHref = decodeXmlEntities(hrefMatch[1].trim());
    const isCollection = /<(?:[a-zA-Z0-9_-]+:)?collection\b[^>]*\/?>/i.test(block);
    if (isCollection || rawHref.endsWith('/')) continue;

    const cleanHref = rawHref.split('?')[0].split('#')[0];
    const rawName = cleanHref.split('/').filter(Boolean).pop() || '';
    let name = rawName;
    try {
      name = decodeURIComponent(rawName);
    } catch {
      // Keep raw segment if server already unescaped invalid sequences.
    }

    if (!name || name.startsWith('.') || name.endsWith('.tmp')) continue;
    if (!name.toLowerCase().endsWith('.json')) continue;

    const etagMatch = block.match(/<(?:[a-zA-Z0-9_-]+:)?getetag\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?getetag>/i);
    const modMatch = block.match(/<(?:[a-zA-Z0-9_-]+:)?getlastmodified\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?getlastmodified>/i);

    responses.push({
      name,
      href: rawHref,
      etag: etagMatch ? decodeXmlEntities(etagMatch[1].trim()) : '',
      lastModified: modMatch ? decodeXmlEntities(modMatch[1].trim()) : '',
      isConflict: name.toLowerCase().includes('sync-conflict'),
    });
  }

  return responses;
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:resourcetype/>
    <d:getetag/>
    <d:getlastmodified/>
  </d:prop>
</d:propfind>`;

/**
 * Dependency-free WebDAV sync client built on Node's built-in fetch().
 */
export class WebDavSyncClient {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.ensuredKey = null;
    this.peerCache = new Map();
    this.lastUploadByTarget = new Map();
  }

  buildAuthHeader(cfg) {
    if (!cfg.username && !cfg.password) return {};
    const token = Buffer.from(`${cfg.username}:${cfg.password}`, 'utf8').toString('base64');
    return { Authorization: `Basic ${token}` };
  }

  async send(url, { method = 'GET', headers = {}, body = undefined } = {}, cfg) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await this.fetchImpl(url, {
        method,
        headers: {
          ...this.buildAuthHeader(cfg),
          ...headers,
        },
        body,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  formatHttpError(status, stage) {
    if (status === 401 || status === 403) {
      return `WebDAV ${stage} rejected (HTTP ${status}): check username/app password or permissions`;
    }
    if (isRateLimitedStatus(status)) {
      return `WebDAV ${stage} rate-limited (HTTP ${status})`;
    }
    return `WebDAV ${stage} failed (HTTP ${status})`;
  }

  createHttpError(res, stage) {
    const err = new Error(this.formatHttpError(res.status, stage));
    err.status = res.status;
    if (isRateLimitedStatus(res.status)) {
      err.isRateLimit = true;
      err.retryAfterMs = parseRetryAfterMs(res.headers);
    }
    return err;
  }

  async ensureDevicesDir(rawConfig, force = false) {
    const urls = buildWebDavUrls(rawConfig);
    const cacheKey = `${urls.cfg.url}|${urls.cfg.remotePath}|${urls.cfg.username}`;
    if (!force && this.ensuredKey === cacheKey) return urls;

    // Fast path: check if target devices/ collection already exists before creating parents.
    const probe = await this.send(
      urls.devicesDirUrl,
      {
        method: 'PROPFIND',
        headers: {
          Depth: '0',
          'Content-Type': 'application/xml; charset=utf-8',
        },
        body: PROPFIND_BODY,
      },
      urls.cfg
    );

    if (probe.status === 207 || probe.status === 200) {
      this.ensuredKey = cacheKey;
      return urls;
    }
    if (probe.status === 401 || probe.status === 403 || isRateLimitedStatus(probe.status) || probe.status >= 500) {
      throw this.createHttpError(probe, probe.status === 401 || probe.status === 403 ? 'auth' : 'PROPFIND');
    }

    for (const segUrl of urls.segmentUrls) {
      const res = await this.send(segUrl, { method: 'MKCOL' }, urls.cfg);
      if (res.status === 201 || res.status === 200 || res.status === 204 || res.status === 405 || res.status === 301) {
        continue;
      }
      if (res.status === 401 || res.status === 403 || isRateLimitedStatus(res.status) || res.status >= 500) {
        throw this.createHttpError(res, 'MKCOL');
      }
      // Some servers return 403/409/500 on existing collections; confirm with PROPFIND Depth 0.
      const check = await this.send(
        segUrl,
        {
          method: 'PROPFIND',
          headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
          body: PROPFIND_BODY,
        },
        urls.cfg
      );
      if (isRateLimitedStatus(check.status) || check.status >= 500) {
        throw this.createHttpError(check, 'PROPFIND');
      }
      if (check.status !== 207 && check.status !== 200) {
        throw this.createHttpError(res, 'MKCOL');
      }
    }

    this.ensuredKey = cacheKey;
    return urls;
  }

  async listRemoteDeviceFiles(rawConfig) {
    const urls = await this.ensureDevicesDir(rawConfig);
    const res = await this.send(
      urls.devicesDirUrl,
      {
        method: 'PROPFIND',
        headers: {
          Depth: '1',
          'Content-Type': 'application/xml; charset=utf-8',
        },
        body: PROPFIND_BODY,
      },
      urls.cfg
    );

    if (res.status !== 207 && res.status !== 200) {
      throw this.createHttpError(res, 'PROPFIND');
    }

    const xml = await res.text();
    const entries = parsePropfindXml(xml);
    const conflictFiles = entries.filter((e) => e.isConflict).map((e) => e.name);
    const files = entries.filter((e) => !e.isConflict);
    return { urls, files, conflictFiles };
  }

  async uploadSnapshot(rawConfig, snapshot, options = {}) {
    const urls = await this.ensureDevicesDir(rawConfig);
    const targetUrl = urls.snapshotUrl(snapshot.deviceId);
    const contentHash = computeSnapshotContentHash(snapshot);
    const prev = this.lastUploadByTarget.get(targetUrl);
    const lastHash = options.lastUploadHash || prev?.hash || '';
    const lastUploadedAt = Number(options.lastUploadAt || prev?.uploadedAt || 0);
    const keepaliveMs = Number(options.keepaliveMs || DEFAULT_UPLOAD_KEEPALIVE_MS);
    if (
      !options.forceUpload &&
      contentHash &&
      lastHash === contentHash &&
      lastUploadedAt > 0 &&
      Date.now() - lastUploadedAt < keepaliveMs
    ) {
      return { url: targetUrl, hash: contentHash, skipped: true };
    }

    const payload = JSON.stringify(snapshot, null, 2) + '\n';

    let res = await this.send(
      targetUrl,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: payload,
      },
      urls.cfg
    );

    if (res.status === 404 || res.status === 409) {
      this.ensuredKey = null;
      await this.ensureDevicesDir(rawConfig, true);
      res = await this.send(
        targetUrl,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: payload,
        },
        urls.cfg
      );
    }

    if (!res.ok && res.status !== 201 && res.status !== 204) {
      throw this.createHttpError(res, 'PUT');
    }

    this.lastUploadByTarget.set(targetUrl, { hash: contentHash, uploadedAt: Date.now() });
    return { url: targetUrl, hash: contentHash, skipped: false };
  }

  async fetchPeerSnapshots(rawConfig, currentDeviceId) {
    const { urls, files, conflictFiles } = await this.listRemoteDeviceFiles(rawConfig);
    const selfFile = `${currentDeviceId}.json`;
    const peerEntries = files.filter((f) => f.name !== selfFile);

    const peerSnapshots = [];
    const concurrency = 4;
    for (let i = 0; i < peerEntries.length; i += concurrency) {
      const batch = peerEntries.slice(i, i + concurrency);
      const loaded = await Promise.all(
        batch.map(async (entry) => {
          const fileUrl = urls.fileUrl(entry.name);
          const versionTag = entry.etag || entry.lastModified || '';
          const cached = this.peerCache.get(fileUrl);
          if (cached && versionTag && cached.versionTag === versionTag) {
            return cached.snapshot;
          }

          const res = await this.send(fileUrl, { method: 'GET' }, urls.cfg);
          if (!res.ok) return null;
          try {
            const parsed = await res.json();
            if (parsed && parsed.schemaVersion === 1 && typeof parsed.deviceId === 'string' && parsed.local?.totals) {
              if (versionTag) {
                this.peerCache.set(fileUrl, { versionTag, snapshot: parsed });
              }
              return parsed;
            }
          } catch {
            // Skip unreadable JSON without failing other peers.
          }
          return null;
        })
      );

      for (const snap of loaded) {
        if (snap) peerSnapshots.push(snap);
      }
    }

    return { peerSnapshots, conflictFiles, remoteDirUrl: urls.devicesDirUrl };
  }

  async testConnection(rawConfig) {
    const start = Date.now();
    const { urls, files, conflictFiles } = await this.listRemoteDeviceFiles(rawConfig);
    return {
      ok: true,
      latencyMs: Date.now() - start,
      remoteDirUrl: urls.devicesDirUrl,
      deviceFiles: files.map((f) => f.name),
      conflictFiles,
    };
  }
}
