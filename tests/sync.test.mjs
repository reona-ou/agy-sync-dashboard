import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { toLocalDateKey } from '../sidecars/dashboard/collector.mjs';
import { discoverLanguageServer } from '../sidecars/dashboard/discovery.mjs';
import {
  SLOT_MS,
  WINDOW_5H_MS,
  WINDOW_7D_MS,
  buildQuotaForecasts,
  classifyModelFamily,
} from '../sidecars/dashboard/forecast.mjs';
import { createDashboardService, createStandaloneHttpServer } from '../sidecars/dashboard/main.mjs';
import {
  normalizeQuotaSummary,
  normalizeTrajectorySummaries,
  parseRpcGeneratorContext,
} from '../sidecars/dashboard/quota.mjs';
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
  const expectedAuth = 'Basic ' + Buffer.from('demo:secret-pass', 'utf8').toString('base64');
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
          webdav: { url: `http://127.0.0.1:${davPort}/dav`, remotePath: '/agy-sync-dashboard', username: 'demo', password: 'wrong' },
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
          webdav: { url: `http://127.0.0.1:${davPort}/dav`, remotePath: '/agy-sync-dashboard', username: 'demo', password: 'secret-pass' },
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
          webdav: { url: `http://127.0.0.1:${davPort}/dav`, remotePath: '/agy-sync-dashboard', username: 'demo' },
          deviceName: 'WinBox-Renamed',
          syncIntervalMs: 5000,
        }),
      })
    ).json();
    assert.equal(savedAgain.settings.webdav.hasPassword, true);
    assert.equal(savedAgain.settings.syncIntervalMs, 5000);
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
    // Verify language persistence for zh-CN / en / ja and fallback for invalid value
    const jaRes = await (
      await fetch(`${base}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'ja' }),
      })
    ).json();
    assert.equal(jaRes.settings.language, 'ja');

    const invalidLangRes = await (
      await fetch(`${base}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'fr' }),
      })
    ).json();
    assert.equal(invalidLangRes.settings.language, 'ja');

    // Verify HTML & frontend bundle expose trilingual options (zh-CN / en / ja)
    const htmlBody = await (await fetch(`${base}/`)).text();
    assert.match(htmlBody, /value="zh-CN"/);
    assert.match(htmlBody, /value="en"/);
    assert.match(htmlBody, /value="ja"/);
    const appJsBody = await (await fetch(`${base}/app.js`)).text();
    assert.match(appJsBody, /\bja:\s*\{/);

    // Verify fresh SyncManager keeps all sync configs blank (local-only) by default
    const freshDataDir = path.join(tmpRoot, 'fresh-data');
    const freshMgr = new SyncManager({
      dataDir: freshDataDir,
      paths: {
        conversationsDir: path.join(tmpRoot, 'empty-convs'),
        summariesDb: path.join(tmpRoot, 'missing.db'),
        pluginDataDir: freshDataDir,
        pluginConfig: path.join(tmpRoot, 'missing-cfg.json'),
      },
    });
    const freshInit = await freshMgr.ensureIdentityAndConfig();
    assert.equal(freshInit.config.syncMode, 'local-only');
    assert.equal(freshInit.config.syncDir, '');
    assert.equal(freshInit.config.webdav.url, '');
    assert.equal(freshInit.config.webdav.username, '');
    assert.equal(freshInit.config.webdav.password, '');
  } finally {
    if (dashServer) await new Promise((r) => dashServer.close(r));
    await new Promise((r) => davServer.close(r));
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('buildQuotaForecasts computes current/previous cycle tokens, remaining estimate, and combined runway', () => {
  assert.equal(classifyModelFamily('gemini-4-hydrogen', 'Gemini 4 Hydrogen'), 'gemini');
  assert.equal(classifyModelFamily('claude-sonnet-4.6', ''), 'claude_gpt');
  assert.equal(classifyModelFamily('gpt-oss-120b', ''), 'claude_gpt');
  assert.equal(classifyModelFamily('gemini-4-argon', ''), 'argon');

  // Align cleanly on 15-minute slot boundary
  const nowMs = Math.floor(Date.now() / SLOT_MS) * SLOT_MS;
  const reset5hMs = nowMs + 3 * 3600_000; // elapsed = 2h, left = 3h
  const start5hMs = reset5hMs - WINDOW_5H_MS;
  const prev5hSlot = String(Math.floor((start5hMs - 3600_000) / SLOT_MS));
  const curr5hSlot = String(Math.floor((nowMs - 3600_000) / SLOT_MS));

  const dev1 = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    deviceId: 'dev-1',
    deviceName: 'PC',
    updatedAt: nowMs,
    local: {
      collectedAt: nowMs,
      conversationCount: 1,
      totals: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 8800, cacheWriteTokens: 0, thinkingTokens: 0, totalTokens: 10000, generations: 5 },
      byDate: {},
      byModel: {},
      bySlot: {
        [prev5hSlot]: { gemini: { totalTokens: 100_000, nonCacheTokens: 10_000, generations: 2 } },
        [curr5hSlot]: { gemini: { totalTokens: 60_000, nonCacheTokens: 6_000, generations: 3 } },
      },
      recentConversations: [],
    },
  };

  const merged = mergeDeviceSnapshots([dev1], 'dev-1', nowMs);
  const quota = {
    connected: true,
    accountHash: 'acc-1',
    groups: [
      {
        id: 'gemini',
        family: 'gemini',
        title: 'Gemini Models',
        windows: [
          {
            kind: '5h',
            windowId: 'gemini-5h',
            remainingFraction: 0.7, // 30% used => implied capacity = 60k / 0.3 = 200k => remaining = 140k
            resetTime: new Date(reset5hMs).toISOString(),
            disabled: false,
          },
        ],
      },
      {
        id: 'claude_gpt',
        family: 'claude_gpt',
        title: 'Claude and GPT models',
        windows: [
          {
            kind: 'weekly',
            windowId: '3p-weekly',
            remainingFraction: 1, // 100%, uses calibration fallback
            resetTime: new Date(nowMs + WINDOW_7D_MS - 3600_000).toISOString(),
            disabled: false,
          },
        ],
      },
    ],
  };

  const calibration = {
    'acc-1:claude_gpt:weekly': { capacityTokens: 500_000, updatedAt: nowMs - 86400_000 },
  };

  const { quota: enriched, calibrationUpdates } = buildQuotaForecasts({
    quota,
    merged,
    calibration,
    nowMs,
  });

  const fc5h = enriched.groups[0].windows[0].forecast;
  assert.equal(fc5h.currUsedTokens, 60_000);
  assert.equal(fc5h.prevUsedTokens, 100_000);
  assert.equal(fc5h.estimatedCapacityTokens, 200_000);
  assert.equal(fc5h.estimatedRemainingTokens, 140_000);
  assert.equal(fc5h.rateSource, 'curr+prev');
  // Combined rate = (60k + 100k) / (2h + 5h) = 160k / 7h ~= 22857 tok/h
  assert.equal(fc5h.burnRatePerHour, Math.round(160_000 / 7));
  // Runway = 140k / (160k / 7h) = 6.125h > 3h left => lasts until reset
  assert.equal(fc5h.willLastUntilReset, true);
  assert.equal(fc5h.status, 'ok');
  assert.equal(calibrationUpdates['acc-1:gemini:5h'].capacityTokens, 200_000);

  const fc7d = enriched.groups[1].windows[0].forecast;
  assert.equal(fc7d.estimatedRemainingTokens, 500_000);
  assert.equal(fc7d.capacitySource, 'calibrated');
});

test('sessionContext tracks active conversation via live trajectories, hook updates, and manual selection', async () => {
  const nowMs = Date.now();
  const trajectories = [
    {
      conversationId: 'conv-1',
      title: 'Older Viewed Session',
      status: 'CASCADE_RUN_STATUS_IDLE',
      isRunning: false,
      stepCount: 10,
      lastModifiedMs: nowMs - 20_000,
      lastUserViewMs: nowMs - 15_000,
      rootConversationId: 'conv-1',
    },
    {
      conversationId: 'conv-2',
      title: 'Active Focused Session',
      status: 'CASCADE_RUN_STATUS_RUNNING',
      isRunning: true,
      stepCount: 24,
      lastModifiedMs: nowMs - 30_000,
      lastUserViewMs: nowMs - 2_000,
      rootConversationId: 'conv-2',
    },
  ];

  const normalizedTrajs = normalizeTrajectorySummaries({
    trajectorySummaries: {
      'conv-2': {
        summary: 'Active Focused Session',
        status: 'CASCADE_RUN_STATUS_RUNNING',
        stepCount: 24,
        lastModifiedTime: new Date(nowMs - 30_000).toISOString(),
        annotations: { lastUserViewTime: new Date(nowMs - 2_000).toISOString() },
      },
    },
  });
  assert.equal(normalizedTrajs.length, 1);
  assert.equal(normalizedTrajs[0].isRunning, true);

  const rpcCtx = parseRpcGeneratorContext({
    generatorMetadata: [
      {
        chatModel: {
          responseModel: 'gemini-4-hydrogen',
          modelDisplayName: 'Gemini 4 Hydrogen (High)',
          usage: {
            inputTokens: '4000',
            cacheReadTokens: '120000',
            outputTokens: '900',
            thinkingOutputTokens: '300',
            responseOutputTokens: '600',
          },
          chatStartMetadata: {
            contextWindowMetadata: {
              estimatedTokensUsed: 118000,
              maxContextTokens: 512000,
            },
          },
        },
      },
    ],
  });
  assert.equal(rpcCtx.usedTokens, 124600);
  assert.equal(rpcCtx.maxContextTokens, 512000);

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-ctx-srv-'));
  let server;
  try {
    const dataDir = path.join(tmpRoot, 'data');
    const contextMap = new Map([
      [
        'conv-1',
        {
          conversationId: 'conv-1',
          title: 'Older Viewed Session',
          lastModifiedMs: nowMs - 20_000,
          contextInfo: {
            modelId: 'gemini-3.8-flash-n',
            displayName: 'Gemini 3.8 Flash (High)',
            usedTokens: 64000,
            maxContextTokens: 256000,
            promptTokens: 63500,
            responseTokens: 500,
            estimatedTokensUsed: 62000,
            source: 'usage',
            timestampMs: nowMs - 20_000,
          },
        },
      ],
      [
        'conv-2',
        {
          conversationId: 'conv-2',
          title: 'Active Focused Session',
          lastModifiedMs: nowMs - 30_000,
          contextInfo: {
            modelId: 'gemini-4-hydrogen',
            displayName: 'Gemini 4 Hydrogen (High)',
            usedTokens: 204800,
            maxContextTokens: 512000,
            promptTokens: 204000,
            responseTokens: 800,
            estimatedTokensUsed: 195000,
            source: 'usage',
            timestampMs: nowMs - 30_000,
          },
        },
      ],
    ]);

    const fakeCollector = {
      async collect() {
        return {
          collectedAt: nowMs,
          conversationCount: 2,
          totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, thinkingTokens: 0, totalTokens: 0, generations: 0, cacheHitRate: 0 },
          latestGeneration: null,
          byDate: {},
          byModel: {},
          recentConversations: [],
        };
      },
      listConversationContexts() {
        return Array.from(contextMap.values());
      },
      async getConversationContext(id) {
        return contextMap.get(id) || null;
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
      quotaClient: {
        async fetch() {
          return { connected: false, groups: [], fetchedAt: nowMs };
        },
        async fetchTrajectories() {
          return { connected: true, trajectories, fetchedAt: nowMs };
        },
      },
    });

    server = createStandaloneHttpServer(service, { controlToken: 'tok-ctx' });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    // Auto mode selects conv-2 (most recent lastUserViewMs)
    const dashAuto = await (await fetch(`${base}/api/dashboard`)).json();
    assert.equal(dashAuto.sessionContext.selectionMode, 'auto');
    assert.equal(dashAuto.sessionContext.detectionSource, 'live-view');
    assert.equal(dashAuto.sessionContext.current.conversationId, 'conv-2');
    assert.equal(dashAuto.sessionContext.current.usedTokens, 204800);
    assert.equal(dashAuto.sessionContext.current.maxContextTokens, 512000);
    assert.equal(dashAuto.sessionContext.current.remainingTokens, 307200);
    assert.ok(Math.abs(dashAuto.sessionContext.current.usageRatio - 0.4) < 0.001);

    // /api/version exposes active conversation & context tokens
    const ver = await (await fetch(`${base}/api/version`)).json();
    assert.equal(ver.activeConvId, 'conv-2');
    assert.equal(ver.activeUsedTokens, 204800);
    assert.equal(ver.activeMaxContextTokens, 512000);

    // Manual convId selection switches to conv-1
    const dashManual = await (await fetch(`${base}/api/dashboard?convId=conv-1`)).json();
    assert.equal(dashManual.sessionContext.selectionMode, 'manual');
    assert.equal(dashManual.sessionContext.current.conversationId, 'conv-1');
    assert.equal(dashManual.sessionContext.current.usedTokens, 64000);
    assert.equal(dashManual.sessionContext.current.maxContextTokens, 256000);

    // Hook notification newer than lastUserViewMs promotes conv-1 in auto mode
    await fetch(`${base}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-agy-sync-token': 'tok-ctx' },
      body: JSON.stringify({ source: 'hook', conversationId: 'conv-1', updatedAt: nowMs + 5000 }),
    });
    const dashHook = await (await fetch(`${base}/api/dashboard`)).json();
    assert.equal(dashHook.sessionContext.detectionSource, 'hook');
    assert.equal(dashHook.sessionContext.current.conversationId, 'conv-1');
  } finally {
    if (server) await new Promise((r) => server.close(r));
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('mergeDeviceSnapshots computes 5h/today/7d/all periods per device and per model (including legacy fallback and active slot)', async () => {
  // Choose nowMs 3 minutes into a 15-minute slot at local 14:03 so 5h, today (00:00..14:03), 7d, and >7d are distinct.
  const baseDay = new Date(2026, 10, 21, 14, 3, 0, 0);
  const nowMs = baseDay.getTime();
  const slotNow = String(Math.floor(nowMs / SLOT_MS)); // active partial slot [14:00, 14:15)
  const slot2hAgo = String(Math.floor((nowMs - 2 * 3600_000) / SLOT_MS)); // 12:00 (inside 5h, today, 7d)
  const slot10hAgo = String(Math.floor((nowMs - 10 * 3600_000) / SLOT_MS)); // 04:00 (outside 5h, inside today & 7d)
  const slot3dAgo = String(Math.floor((nowMs - 3 * 86400_000) / SLOT_MS)); // 3d ago (inside 7d, outside today & 5h)
  const slot10dAgo = String(Math.floor((nowMs - 10 * 86400_000) / SLOT_MS)); // 10d ago (outside 7d, inside all)

  const todayKey = toLocalDateKey(nowMs);
  const day3dAgo = toLocalDateKey(nowMs - 3 * 86400_000);
  const day10dAgo = toLocalDateKey(nowMs - 10 * 86400_000);

  const devModern = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    deviceId: 'dev-modern',
    deviceName: 'Modern Desktop',
    updatedAt: nowMs,
    local: {
      collectedAt: nowMs,
      conversationCount: 3,
      totals: {
        inputTokens: 4000,
        outputTokens: 1000,
        cacheReadTokens: 15000,
        cacheWriteTokens: 0,
        thinkingTokens: 0,
        totalTokens: 20000,
        generations: 8,
      },
      byDate: {
        [todayKey]: { inputTokens: 1500, outputTokens: 500, cacheReadTokens: 6000, cacheWriteTokens: 0, thinkingTokens: 0, totalTokens: 8000, generations: 4 },
        [day3dAgo]: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 3800, cacheWriteTokens: 0, thinkingTokens: 0, totalTokens: 5000, generations: 2 },
        [day10dAgo]: { inputTokens: 1500, outputTokens: 300, cacheReadTokens: 5200, cacheWriteTokens: 0, thinkingTokens: 0, totalTokens: 7000, generations: 2 },
      },
      byModel: {
        'gemini-4-hydrogen': {
          modelId: 'gemini-4-hydrogen',
          displayName: 'Gemini 4 Hydrogen',
          inputTokens: 2500,
          outputTokens: 700,
          cacheReadTokens: 9800,
          cacheWriteTokens: 0,
          thinkingTokens: 0,
          totalTokens: 13000,
          generations: 5,
        },
        'claude-sonnet-4-6': {
          modelId: 'claude-sonnet-4-6',
          displayName: 'Claude Sonnet 4.6',
          inputTokens: 1500,
          outputTokens: 300,
          cacheReadTokens: 5200,
          cacheWriteTokens: 0,
          thinkingTokens: 0,
          totalTokens: 7000,
          generations: 3,
        },
      },
      bySlot: {
        [slotNow]: { gemini: { totalTokens: 3000, nonCacheTokens: 800, generations: 1 } },
        [slot2hAgo]: { claude_gpt: { totalTokens: 2000, nonCacheTokens: 500, generations: 1 } },
        [slot10hAgo]: { gemini: { totalTokens: 3000, nonCacheTokens: 700, generations: 2 } },
        [slot3dAgo]: { claude_gpt: { totalTokens: 5000, nonCacheTokens: 1200, generations: 2 } },
        [slot10dAgo]: { gemini: { totalTokens: 7000, nonCacheTokens: 1800, generations: 2 } },
      },
      bySlotModel: {
        [slotNow]: {
          'gemini-4-hydrogen': { inputTokens: 600, outputTokens: 200, cacheReadTokens: 2200, cacheWriteTokens: 0, thinkingTokens: 0, totalTokens: 3000, generations: 1 },
        },
        [slot2hAgo]: {
          'claude-sonnet-4-6': { inputTokens: 400, outputTokens: 100, cacheReadTokens: 1500, cacheWriteTokens: 0, thinkingTokens: 0, totalTokens: 2000, generations: 1 },
        },
        [slot10hAgo]: {
          'gemini-4-hydrogen': { inputTokens: 500, outputTokens: 200, cacheReadTokens: 2300, cacheWriteTokens: 0, thinkingTokens: 0, totalTokens: 3000, generations: 2 },
        },
        [slot3dAgo]: {
          'claude-sonnet-4-6': { inputTokens: 1100, outputTokens: 200, cacheReadTokens: 3700, cacheWriteTokens: 0, thinkingTokens: 0, totalTokens: 5000, generations: 2 },
        },
        [slot10dAgo]: {
          'gemini-4-hydrogen': { inputTokens: 1400, outputTokens: 300, cacheReadTokens: 5300, cacheWriteTokens: 0, thinkingTokens: 0, totalTokens: 7000, generations: 2 },
        },
      },
      recentConversations: [],
    },
  };

  // Legacy v1.3.2 peer snapshot (has bySlot without bySlotModel)
  const devLegacySlots = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    deviceId: 'dev-legacy',
    deviceName: 'Legacy Laptop',
    updatedAt: nowMs - 60_000,
    local: {
      collectedAt: nowMs - 60_000,
      conversationCount: 1,
      totals: { inputTokens: 800, outputTokens: 200, cacheReadTokens: 3000, cacheWriteTokens: 0, thinkingTokens: 0, totalTokens: 4000, generations: 2 },
      byDate: {
        [todayKey]: { inputTokens: 800, outputTokens: 200, cacheReadTokens: 3000, cacheWriteTokens: 0, thinkingTokens: 0, totalTokens: 4000, generations: 2 },
      },
      byModel: {
        'gemini-4-hydrogen': {
          modelId: 'gemini-4-hydrogen',
          displayName: 'Gemini 4 Hydrogen',
          inputTokens: 800,
          outputTokens: 200,
          cacheReadTokens: 3000,
          cacheWriteTokens: 0,
          thinkingTokens: 0,
          totalTokens: 4000,
          generations: 2,
        },
      },
      bySlot: {
        [slot2hAgo]: { gemini: { totalTokens: 4000, nonCacheTokens: 1000, generations: 2 } },
      },
      recentConversations: [],
    },
  };

  const merged = mergeDeviceSnapshots([devModern, devLegacySlots], 'dev-modern', nowMs);

  // Active current partial slot (slotNow at 14:00 when nowMs is 14:03) must count 100% (3000), not 3/15.
  const dMod = merged.devices.find((d) => d.deviceId === 'dev-modern');
  const dLeg = merged.devices.find((d) => d.deviceId === 'dev-legacy');
  assert.equal(dMod.periods['5h'].totalTokens, 5000); // slotNow (3000) + slot2hAgo (2000)
  assert.equal(dMod.periods.today.totalTokens, 8000); // + slot10hAgo (3000)
  assert.equal(dMod.periods['7d'].totalTokens, 13000); // + slot3dAgo (5000)
  assert.equal(dMod.periods.all.totalTokens, 20000); // + slot10dAgo (7000)

  assert.equal(dLeg.periods['5h'].totalTokens, 4000);
  assert.equal(dLeg.periods.today.totalTokens, 4000);
  assert.equal(dLeg.periods['7d'].totalTokens, 4000);
  assert.equal(dLeg.periods.all.totalTokens, 4000);

  assert.equal(merged.periods['5h'].totalTokens, 9000);
  assert.equal(merged.periods.today.totalTokens, 12000);
  assert.equal(merged.periods['7d'].totalTokens, 17000);
  assert.equal(merged.periods.all.totalTokens, 24000);

  assert.ok(Math.abs(dMod.periods['5h'].shareRatio - 5000 / 9000) < 0.001);
  assert.ok(Math.abs(dLeg.periods['5h'].shareRatio - 4000 / 9000) < 0.001);

  const gem = merged.models.find((m) => m.modelId === 'gemini-4-hydrogen');
  const claude = merged.models.find((m) => m.modelId === 'claude-sonnet-4-6');
  assert.equal(gem.periods['5h'].totalTokens, 7000); // 3000 (modern) + 4000 (legacy)
  assert.equal(gem.periods.today.totalTokens, 10000); // + 3000 (10h ago)
  assert.equal(gem.periods['7d'].totalTokens, 10000);
  assert.equal(gem.periods.all.totalTokens, 17000); // + 7000 (10d ago)

  assert.equal(claude.periods['5h'].totalTokens, 2000);
  assert.equal(claude.periods.today.totalTokens, 2000);
  assert.equal(claude.periods['7d'].totalTokens, 7000);
  assert.equal(claude.periods.all.totalTokens, 7000);

  // Per-device per-model period breakdown for cross-filtering
  assert.equal(dMod.models['gemini-4-hydrogen'].periods['5h'].totalTokens, 3000);
  assert.equal(dMod.models['gemini-4-hydrogen'].periods.today.totalTokens, 6000);
  assert.equal(dMod.models['gemini-4-hydrogen'].periods.all.totalTokens, 13000);
  assert.equal(dMod.models['claude-sonnet-4-6'].periods['5h'].totalTokens, 2000);
  assert.equal(dMod.models['claude-sonnet-4-6'].periods['7d'].totalTokens, 7000);
  assert.equal(dLeg.models['gemini-4-hydrogen'].periods['5h'].totalTokens, 4000);

  // Verify createDashboardService strips raw bySlotModel while exposing periods to frontend
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-periods-srv-'));
  try {
    const liveNow = Date.now();
    const liveSlot = String(Math.floor((liveNow - 60_000) / SLOT_MS));
    const liveToday = toLocalDateKey(liveNow);
    const liveLocal = {
      ...devModern.local,
      collectedAt: liveNow,
      byDate: {
        [liveToday]: { inputTokens: 600, outputTokens: 200, cacheReadTokens: 2200, cacheWriteTokens: 0, thinkingTokens: 0, totalTokens: 3000, generations: 1 },
      },
      bySlot: {
        [liveSlot]: { gemini: { totalTokens: 3000, nonCacheTokens: 800, generations: 1 } },
      },
      bySlotModel: {
        [liveSlot]: {
          'gemini-4-hydrogen': { inputTokens: 600, outputTokens: 200, cacheReadTokens: 2200, cacheWriteTokens: 0, thinkingTokens: 0, totalTokens: 3000, generations: 1 },
        },
      },
    };
    const dataDir = path.join(tmpRoot, 'data');
    const manager = new SyncManager({
      paths: { pluginDataDir: dataDir, conversationsDir: path.join(tmpRoot, 'c'), summariesDb: path.join(tmpRoot, 's.db') },
      collector: {
        async collect() {
          return liveLocal;
        },
      },
      dataDir,
    });
    const service = await createDashboardService({
      paths: { pluginDataDir: dataDir, pluginConfig: path.join(tmpRoot, 'cfg.json'), conversationsDir: path.join(tmpRoot, 'c'), summariesDb: path.join(tmpRoot, 's.db') },
      syncManager: manager,
      quotaClient: { async fetch() { return { connected: false, groups: [], fetchedAt: liveNow }; } },
    });
    const dash = await service.getDashboard({ forceSync: true });
    assert.equal(dash.device.local.bySlotModel, undefined);
    assert.equal(dash.device.local.bySlot, undefined);
    assert.equal(dash.merged.periods['5h'].totalTokens, 3000);
    assert.equal(dash.merged.devices[0].periods['7d'].totalTokens, 3000);
    assert.equal(dash.merged.devices[0].models['gemini-4-hydrogen'].periods['5h'].totalTokens, 3000);
    assert.equal(dash.merged.models[0].periods['5h'].totalTokens, 3000);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('discoverLanguageServer supports daemon hub_*.json files (v2.34+ without --csrf_token), env fallback, and legacy CLI flags', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-disc-'));
  try {
    const daemonDir = path.join(tmpRoot, 'daemon');
    const logFile = path.join(tmpRoot, 'language_server.log');
    await fs.mkdir(daemonDir, { recursive: true });
    await fs.writeFile(logFile, 'Language server listening on random port at 1874 for HTTP\n', 'utf8');

    // Stale hub file from dead PID should be skipped even if newer or older
    await fs.writeFile(
      path.join(daemonDir, 'hub_9968.json'),
      JSON.stringify({ pid: 99991, httpPort: 9968, httpsPort: 9967, csrfToken: 'stale-tok' }),
      'utf8'
    );
    await fs.writeFile(
      path.join(daemonDir, 'hub_1874.json'),
      JSON.stringify({ pid: 48168, httpPort: 1874, httpsPort: 1873, csrfToken: 'hub-live-tok' }),
      'utf8'
    );

    const paths = {
      antigravityData: tmpRoot,
      daemonDir,
      logCandidates: [logFile],
    };

    // 1) Process without --csrf_token on commandLine discovers via daemon/hub_1874.json
    const epHub = await discoverLanguageServer(paths, {
      env: {},
      listProcesses: async () => [
        { pid: 48168, commandLine: 'language_server.exe --standalone --read_host_bridge_token_from_stdin', ports: [1873, 1874] },
      ],
      probePort: async () => false,
    });
    assert.deepEqual(epHub, { pid: 48168, port: 1874, csrf: 'hub-live-tok' });

    // 2) Reachable env ANTIGRAVITY_LS_ADDRESS + ANTIGRAVITY_CSRF_TOKEN short-circuits cleanly
    const epEnv = await discoverLanguageServer(paths, {
      env: { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:2888', ANTIGRAVITY_CSRF_TOKEN: 'env-tok' },
      listProcesses: async () => {
        throw new Error('should not enumerate processes when env endpoint is reachable');
      },
      probePort: async (port) => port === 2888,
    });
    assert.deepEqual(epEnv, { pid: null, port: 2888, csrf: 'env-tok' });

    // 3) Unreachable env falls back to hub discovery
    const epEnvFallback = await discoverLanguageServer(paths, {
      env: { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:2999', ANTIGRAVITY_CSRF_TOKEN: 'dead-env-tok' },
      listProcesses: async () => [
        { pid: 48168, commandLine: 'language_server.exe --standalone --read_host_bridge_token_from_stdin', ports: [1874] },
      ],
      probePort: async () => false,
    });
    assert.deepEqual(epEnvFallback, { pid: 48168, port: 1874, csrf: 'hub-live-tok' });

    // 4) Legacy Antigravity without daemon hub files falls back to CLI --csrf_token
    const emptyDaemon = path.join(tmpRoot, 'empty-daemon');
    await fs.mkdir(emptyDaemon, { recursive: true });
    const epLegacy = await discoverLanguageServer(
      { antigravityData: tmpRoot, daemonDir: emptyDaemon, logCandidates: [logFile] },
      {
        env: {},
        listProcesses: async () => [
          { pid: 1234, commandLine: 'language_server.exe --standalone --csrf_token=legacy-cli-tok', ports: [1874] },
        ],
        probePort: async () => false,
      }
    );
    assert.deepEqual(epLegacy, { pid: 1234, port: 1874, csrf: 'legacy-cli-tok' });
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('parseRpcGeneratorContext and mergeDeviceSnapshots distinguish High vs XHigh and prefer readable displayName', () => {
  const ctxXHigh = parseRpcGeneratorContext({
    generatorMetadata: [
      {
        chatModel: {
          responseModel: 'gemini-4-hydrogen',
          model: 'MODEL_PLACEHOLDER_M528',
          modelDisplayName: 'Gemini 4 Hydrogen (XHigh)',
          usage: { inputTokens: '1200', cacheReadTokens: '20000', outputTokens: '400', thinkingOutputTokens: '100', responseOutputTokens: '300' },
        },
      },
    ],
  });
  assert.equal(ctxXHigh.modelId, 'gemini-4-hydrogen-xhigh');
  assert.equal(ctxXHigh.displayName, 'Gemini 4 Hydrogen (XHigh)');

  const ctxPlaceholderOnly = parseRpcGeneratorContext({
    generatorMetadata: [
      {
        chatModel: {
          model: 'MODEL_PLACEHOLDER_M528',
          usage: { inputTokens: '500', cacheReadTokens: '1000', outputTokens: '100' },
        },
      },
    ],
  });
  assert.equal(ctxPlaceholderOnly.modelId, 'gemini-4-hydrogen-xhigh');
  assert.equal(ctxPlaceholderOnly.displayName, 'Gemini 4 Hydrogen (XHigh)');

  const nowMs = Date.now();
  const merged = mergeDeviceSnapshots([
    {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      deviceId: 'dev-a',
      deviceName: 'Dev A',
      updatedAt: nowMs,
      local: {
        collectedAt: nowMs,
        conversationCount: 1,
        totals: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 850, cacheWriteTokens: 0, thinkingTokens: 0, totalTokens: 1000, generations: 1 },
        byDate: {},
        byModel: {
          'gemini-3.8-flash-n-high': {
            modelId: 'gemini-3.8-flash-n-high',
            displayName: 'gemini-3.8-flash-n-high',
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 850,
            cacheWriteTokens: 0,
            thinkingTokens: 0,
            totalTokens: 1000,
            generations: 1,
          },
        },
        recentConversations: [],
      },
    },
    {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      deviceId: 'dev-b',
      deviceName: 'Dev B',
      updatedAt: nowMs,
      local: {
        collectedAt: nowMs,
        conversationCount: 1,
        totals: { inputTokens: 200, outputTokens: 100, cacheReadTokens: 1700, cacheWriteTokens: 0, thinkingTokens: 0, totalTokens: 2000, generations: 2 },
        byDate: {},
        byModel: {
          'gemini-3.8-flash-n-high': {
            modelId: 'gemini-3.8-flash-n-high',
            displayName: 'Gemini 3.8 Flash (High)',
            inputTokens: 200,
            outputTokens: 100,
            cacheReadTokens: 1700,
            cacheWriteTokens: 0,
            thinkingTokens: 0,
            totalTokens: 2000,
            generations: 2,
          },
        },
        recentConversations: [],
      },
    },
  ], 'dev-b', nowMs);

  const flash = merged.models.find((m) => m.modelId === 'gemini-3.8-flash-n-high');
  assert.ok(flash);
  assert.equal(flash.displayName, 'Gemini 3.8 Flash (High)');
  assert.equal(flash.totalTokens, 3000);
});
