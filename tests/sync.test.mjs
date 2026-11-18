import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { toLocalDateKey } from '../sidecars/dashboard/collector.mjs';
import { createDashboardService, createStandaloneHttpServer } from '../sidecars/dashboard/main.mjs';
import { normalizeQuotaSummary } from '../sidecars/dashboard/quota.mjs';
import { SNAPSHOT_SCHEMA_VERSION, SyncManager, mergeDeviceSnapshots } from '../sidecars/dashboard/sync.mjs';
import { parsePropfindXml } from '../sidecars/dashboard/webdav.mjs';

test('mergeDeviceSnapshots sums multiple devices additively and computes blended cache rate', () => {
  const now = Date.now();
  const today = toLocalDateKey(now);

  const devA = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    deviceId: 'win-aaa111',
    deviceName: 'Windows PC',
    platform: 'win32',
    updatedAt: now,
    local: {
      collectedAt: now,
      conversationCount: 3,
      totals: {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 3000,
        cacheWriteTokens: 0,
        thinkingTokens: 50,
        totalTokens: 4500,
        generations: 4,
      },
      byDate: {
        [today]: {
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadTokens: 3000,
          cacheWriteTokens: 0,
          thinkingTokens: 50,
          totalTokens: 4500,
          generations: 4,
        },
      },
      byModel: {
        'gemini-4-hydrogen': {
          modelId: 'gemini-4-hydrogen',
          displayName: 'Gemini 4 Flash',
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadTokens: 3000,
          cacheWriteTokens: 0,
          thinkingTokens: 50,
          totalTokens: 4500,
          generations: 4,
        },
      },
      recentConversations: [{ conversationId: 'c1', title: 'Task A', totalTokens: 4500, generations: 4, lastModifiedMs: now }],
    },
  };

  const devB = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    deviceId: 'mac-bbb222',
    deviceName: 'MacBook Pro',
    platform: 'darwin',
    updatedAt: now - 10_000,
    local: {
      collectedAt: now - 10_000,
      conversationCount: 2,
      totals: {
        inputTokens: 2000,
        outputTokens: 1000,
        cacheReadTokens: 7000,
        cacheWriteTokens: 0,
        thinkingTokens: 100,
        totalTokens: 10000,
        generations: 6,
      },
      byDate: {
        [today]: {
          inputTokens: 2000,
          outputTokens: 1000,
          cacheReadTokens: 7000,
          cacheWriteTokens: 0,
          thinkingTokens: 100,
          totalTokens: 10000,
          generations: 6,
        },
      },
      byModel: {
        'gemini-4-hydrogen': {
          modelId: 'gemini-4-hydrogen',
          displayName: 'Gemini 4 Flash',
          inputTokens: 2000,
          outputTokens: 1000,
          cacheReadTokens: 7000,
          cacheWriteTokens: 0,
          thinkingTokens: 100,
          totalTokens: 10000,
          generations: 6,
        },
      },
      recentConversations: [{ conversationId: 'c2', title: 'Task B', totalTokens: 10000, generations: 6, lastModifiedMs: now - 10_000 }],
    },
  };

  const merged = mergeDeviceSnapshots([devA, devB], 'win-aaa111', now);
  assert.equal(merged.deviceCount, 2);
  assert.equal(merged.conversationCount, 5);
  assert.equal(merged.totals.totalTokens, 14500);
  assert.equal(merged.today.totalTokens, 14500);
  // Blended cache hit = (3000 + 7000) / (1000 + 2000 + 3000 + 7000) = 10000 / 13000
  assert.ok(Math.abs(merged.totals.cacheHitRate - 10000 / 13000) < 0.001);
  assert.equal(merged.devices[0].deviceId, 'win-aaa111');
  assert.equal(merged.devices[0].isCurrent, true);
  assert.equal(merged.models.length, 1);
  assert.equal(merged.models[0].totalTokens, 14500);
});

test('SyncManager writes atomic device snapshots, ignores Syncthing conflict/temp files, and keeps persistent deviceId', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-sync-'));
  try {
    const dataDir = path.join(tmpRoot, 'data');
    const syncDir = path.join(tmpRoot, 'sync');
    const devicesDir = path.join(syncDir, 'devices');
    await fs.mkdir(devicesDir, { recursive: true });

    const now = Date.now();
    const today = toLocalDateKey(now);

    const fakeCollector = {
      async collect() {
        return {
          collectedAt: now,
          conversationCount: 1,
          totals: {
            inputTokens: 200,
            outputTokens: 100,
            cacheReadTokens: 700,
            cacheWriteTokens: 0,
            thinkingTokens: 20,
            totalTokens: 1000,
            generations: 2,
            cacheHitRate: 700 / 900,
          },
          latestGeneration: null,
          byDate: {
            [today]: { inputTokens: 200, outputTokens: 100, cacheReadTokens: 700, cacheWriteTokens: 0, thinkingTokens: 20, totalTokens: 1000, generations: 2 },
          },
          byModel: {},
          recentConversations: [],
        };
      },
    };

    const manager = new SyncManager({
      paths: { pluginDataDir: dataDir, conversationsDir: path.join(tmpRoot, 'convs'), summariesDb: path.join(tmpRoot, 's.db') },
      collector: fakeCollector,
      dataDir,
    });

    await manager.updateSettings({ syncDir, deviceName: 'Office Win' });
    const firstId = manager.lastMerged.device.deviceId;

    // Seed peer device + Syncthing junk files
    await fs.writeFile(
      path.join(devicesDir, 'linux-box-999999.json'),
      JSON.stringify({
        schemaVersion: 1,
        deviceId: 'linux-box-999999',
        deviceName: 'Linux Dev',
        platform: 'linux',
        updatedAt: now - 5000,
        local: {
          collectedAt: now - 5000,
          conversationCount: 4,
          totals: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 350, cacheWriteTokens: 0, thinkingTokens: 0, totalTokens: 500, generations: 1 },
          byDate: {},
          byModel: {},
          recentConversations: [],
        },
      }),
      'utf8'
    );
    await fs.writeFile(path.join(devicesDir, '.syncthing.linux-box-999999.tmp'), '{}', 'utf8');
    await fs.writeFile(path.join(devicesDir, 'linux-box-999999.sync-conflict-20261118.json'), '{}', 'utf8');
    await fs.writeFile(path.join(devicesDir, 'corrupt.json'), '{not json', 'utf8');

    await manager.updateSettings({ deviceName: 'Office Win Renamed' });
    const secondId = manager.lastMerged.device.deviceId;
    assert.equal(secondId, firstId);
    assert.equal(manager.lastMerged.merged.deviceCount, 2);
    assert.equal(manager.lastMerged.merged.totals.totalTokens, 1500);
    assert.deepEqual(manager.lastMerged.syncStatus.conflictFiles, ['linux-box-999999.sync-conflict-20261118.json']);

    // Also verify standalone HTTP endpoints work cleanly
    const service = await createDashboardService({
      paths: { pluginDataDir: dataDir, pluginConfig: path.join(tmpRoot, 'cfg.json'), conversationsDir: path.join(tmpRoot, 'convs'), summariesDb: path.join(tmpRoot, 's.db') },
      syncManager: manager,
      quotaClient: { async fetch() { return { connected: false, groups: [], fetchedAt: Date.now() }; } },
    });

    const server = createStandaloneHttpServer(service, { controlToken: 'tok123' });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      const { port } = server.address();
      const dashRes = await fetch(`http://127.0.0.1:${port}/api/dashboard`);
      assert.equal(dashRes.status, 200);
      const dash = await dashRes.json();
      assert.equal(dash.merged.totals.totalTokens, 1500);

      const htmlRes = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(htmlRes.status, 200);
      const html = await htmlRes.text();
      assert.match(html, /role="tablist"/);
    } finally {
      await new Promise((r) => server.close(r));
    }
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('normalizeQuotaSummary parses RetrieveUserQuotaSummary response.groups.buckets', () => {
  const sample = {
    response: {
      groups: [
        {
          displayName: 'Gemini Models',
          buckets: [
            { bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0.89, resetTime: '2026-11-25T03:25:25Z' },
            { bucketId: 'gemini-5h', window: '5h', remainingFraction: 0.92, resetTime: '2026-11-18T13:25:25Z' },
          ],
        },
        {
          displayName: 'Claude and GPT models',
          buckets: [
            { bucketId: '3p-weekly', window: 'weekly', remainingFraction: 1, resetTime: '2026-11-25T09:05:35Z' },
            { bucketId: '3p-5h', window: '5h', remainingFraction: 1, resetTime: '2026-11-18T14:05:35Z' },
          ],
        },
      ],
    },
  };

  const groups = normalizeQuotaSummary(sample);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].family, 'gemini');
  assert.equal(groups[0].windows[0].kind, '5h');
  assert.equal(groups[0].windows[1].kind, 'weekly');
  assert.equal(groups[1].family, 'claude_gpt');
});

test('parsePropfindXml extracts json entries and ignores directories, hidden files, and conflicts', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
  <D:multistatus xmlns:D="DAV:">
    <D:response>
      <D:href>/dav/agy-sync-dashboard/devices/</D:href>
      <D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat>
    </D:response>
    <D:response>
      <D:href>/dav/agy-sync-dashboard/devices/macbook%20pro-123.json</D:href>
      <D:propstat><D:prop><D:getetag>"abc"</D:getetag></D:prop></D:propstat>
    </D:response>
    <D:response>
      <D:href>/dav/agy-sync-dashboard/devices/.hidden.json</D:href>
      <D:propstat><D:prop><D:getetag>"h"</D:getetag></D:prop></D:propstat>
    </D:response>
    <D:response>
      <D:href>/dav/agy-sync-dashboard/devices/pc.sync-conflict-20261118.json</D:href>
      <D:propstat><D:prop><D:getetag>"c"</D:getetag></D:prop></D:propstat>
    </D:response>
  </D:multistatus>`;

  const entries = parsePropfindXml(xml);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, 'macbook pro-123.json');
  assert.equal(entries[0].isConflict, false);
  assert.equal(entries[1].name, 'pc.sync-conflict-20261118.json');
  assert.equal(entries[1].isConflict, true);
});

test('WebDAV sync and settings endpoints handle MKCOL/PROPFIND/PUT/GET, testConnection, and password redaction', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-dav-'));
  const expectedAuth = 'Basic ' + Buffer.from('reona:secret-pass', 'utf8').toString('base64');
  const collections = new Set(['/dav', '/dav/']);
  const files = new Map();

  const now = Date.now();
  const today = toLocalDateKey(now);
  files.set(
    '/dav/agy-sync-dashboard/devices/mac-studio-888888.json',
    JSON.stringify({
      schemaVersion: 1,
      deviceId: 'mac-studio-888888',
      deviceName: 'Mac Studio',
      platform: 'darwin',
      updatedAt: now - 2000,
      local: {
        collectedAt: now - 2000,
        conversationCount: 2,
        totals: { inputTokens: 400, outputTokens: 200, cacheReadTokens: 1400, cacheWriteTokens: 0, thinkingTokens: 0, totalTokens: 2000, generations: 3 },
        byDate: { [today]: { inputTokens: 400, outputTokens: 200, cacheReadTokens: 1400, cacheWriteTokens: 0, thinkingTokens: 0, totalTokens: 2000, generations: 3 } },
        byModel: {},
        recentConversations: [],
      },
    })
  );

  const davServer = http.createServer(async (req, res) => {
    if (req.headers.authorization !== expectedAuth) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="dav"' });
      res.end();
      return;
    }

    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const p = reqUrl.pathname;

    if (req.method === 'MKCOL') {
      const normalized = p.endsWith('/') ? p : `${p}/`;
      if (collections.has(normalized)) {
        res.writeHead(405);
        res.end();
        return;
      }
      collections.add(normalized);
      collections.add(normalized.slice(0, -1));
      res.writeHead(201);
      res.end();
      return;
    }

    if (req.method === 'PROPFIND') {
      const normalized = p.endsWith('/') ? p : `${p}/`;
      if (!collections.has(normalized) && normalized !== '/dav/agy-sync-dashboard/devices/') {
        res.writeHead(404);
        res.end();
        return;
      }
      if (normalized === '/dav/agy-sync-dashboard/devices/' && !collections.has(normalized)) {
        res.writeHead(404);
        res.end();
        return;
      }
      const depth = req.headers.depth || '1';
      let itemsXml = `<D:response><D:href>${normalized}</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>`;
      if (depth !== '0') {
        for (const [fpath] of files.entries()) {
          if (fpath.startsWith(normalized)) {
            itemsXml += `<D:response><D:href>${fpath}</D:href><D:propstat><D:prop><D:getetag>"v1-${files.get(fpath).length}"</D:getetag></D:prop></D:propstat></D:response>`;
          }
        }
      }
      res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
      res.end(`<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${itemsXml}</D:multistatus>`);
      return;
    }

    if (req.method === 'PUT') {
      let body = '';
      for await (const chunk of req) body += chunk;
      files.set(p, body);
      res.writeHead(201);
      res.end();
      return;
    }

    if (req.method === 'GET') {
      if (!files.has(p)) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(files.get(p));
      return;
    }

    res.writeHead(405);
    res.end();
  });

  await new Promise((r) => davServer.listen(0, '127.0.0.1', r));
  const davPort = davServer.address().port;

  let dashServer;
  try {
    const dataDir = path.join(tmpRoot, 'data');
    const fakeCollector = {
      async collect() {
        return {
          collectedAt: now,
          conversationCount: 1,
          totals: { inputTokens: 300, outputTokens: 100, cacheReadTokens: 600, cacheWriteTokens: 0, thinkingTokens: 0, totalTokens: 1000, generations: 1, cacheHitRate: 600 / 900 },
          latestGeneration: null,
          byDate: { [today]: { inputTokens: 300, outputTokens: 100, cacheReadTokens: 600, cacheWriteTokens: 0, thinkingTokens: 0, totalTokens: 1000, generations: 1 } },
          byModel: {},
          recentConversations: [],
        };
      },
    };

    const manager = new SyncManager({
      paths: { pluginDataDir: dataDir, conversationsDir: path.join(tmpRoot, 'c'), summariesDb: path.join(tmpRoot, 's.db') },
      collector: fakeCollector,
      dataDir,
    });
    const service = await createDashboardService({
      paths: { pluginDataDir: dataDir, pluginConfig: path.join(tmpRoot, 'cfg.json'), conversationsDir: path.join(tmpRoot, 'c'), summariesDb: path.join(tmpRoot, 's.db') },
      syncManager: manager,
      quotaClient: { async fetch() { return { connected: false, groups: [], fetchedAt: now }; } },
    });

    dashServer = createStandaloneHttpServer(service, { controlToken: 'davtok' });
    await new Promise((r) => dashServer.listen(0, '127.0.0.1', r));
    const dashPort = dashServer.address().port;
    const base = `http://127.0.0.1:${dashPort}`;

    // Test bad credentials first
    const badTest = await (
      await fetch(`${base}/api/settings/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          syncMode: 'webdav',
          webdav: { url: `http://127.0.0.1:${davPort}/dav`, remotePath: '/agy-sync-dashboard', username: 'reona', password: 'wrong' },
        }),
      })
    ).json();
    assert.equal(badTest.ok, false);
    assert.match(badTest.webdav.error, /401/);

    // Save valid WebDAV config
    const saved = await (
      await fetch(`${base}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          syncMode: 'webdav',
          webdav: { url: `http://127.0.0.1:${davPort}/dav`, remotePath: '/agy-sync-dashboard', username: 'reona', password: 'secret-pass' },
          deviceName: 'WinBox',
        }),
      })
    ).json();

    assert.equal(saved.settings.webdav.hasPassword, true);
    assert.equal(saved.settings.webdav.password, undefined);
    assert.equal(saved.dashboard.syncStatus.mode, 'webdav');
    assert.equal(saved.dashboard.merged.deviceCount, 2);
    assert.equal(saved.dashboard.merged.totals.totalTokens, 3000);

    // Omitting password in subsequent save keeps saved password working
    const savedAgain = await (
      await fetch(`${base}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          syncMode: 'webdav',
          webdav: { url: `http://127.0.0.1:${davPort}/dav`, remotePath: '/agy-sync-dashboard', username: 'reona' },
          deviceName: 'WinBox-Renamed',
        }),
      })
    ).json();
    assert.equal(savedAgain.settings.webdav.hasPassword, true);
    assert.equal(savedAgain.dashboard.merged.totals.totalTokens, 3000);

    // Standalone /settings configuration page route works
    const settingsPage = await fetch(`${base}/settings`);
    assert.equal(settingsPage.status, 200);
    assert.match(await settingsPage.text(), /id="panel-settings"/);

    // Lightweight /api/version endpoint tracks revision and merged counters
    const ver1 = await (await fetch(`${base}/api/version`)).json();
    assert.equal(ver1.deviceCount, 2);
    assert.equal(ver1.totalTokens, 3000);
    assert.ok(ver1.revision >= 1);

    await fetch(`${base}/api/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const ver2 = await (await fetch(`${base}/api/version`)).json();
    assert.ok(ver2.revision >= ver1.revision);
  } finally {
    if (dashServer) await new Promise((r) => dashServer.close(r));
    await new Promise((r) => davServer.close(r));
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});
