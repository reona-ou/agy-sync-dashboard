import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildVsix } from '../vscode-extension/scripts/build.mjs';

const require = createRequire(import.meta.url);

test('vscode-extension backend-client helpers and in-process API handle dashboard & settings', async () => {
  const { createBackendClient, isModernNodeVersion, resolveRuntimeRoot } = require('../vscode-extension/backend-client.cjs');

  assert.equal(isModernNodeVersion('v22.5.0'), true);
  assert.equal(isModernNodeVersion('v24.1.0'), true);
  assert.equal(isModernNodeVersion('v20.18.1'), false);
  assert.equal(isModernNodeVersion('v22.4.9'), false);

  const extDir = path.resolve('vscode-extension');
  const runtimeRoot = resolveRuntimeRoot(extDir);
  assert.ok(runtimeRoot);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-vscode-test-'));
  const prevDataDir = process.env.AG_SYNC_DATA_DIR;
  process.env.AG_SYNC_DATA_DIR = tmpDir;
  let client;
  try {
    client = await createBackendClient(extDir);
    assert.equal(client.mode, 'in-process');

    const verRes = await client.handleApi('/api/version', 'GET', '');
    assert.equal(verRes.status, 200);
    const ver = JSON.parse(verRes.bodyText);
    assert.equal(typeof ver.revision, 'number');

    const dashRes = await client.handleApi('/api/dashboard', 'GET', '');
    assert.equal(dashRes.status, 200);
    const dash = JSON.parse(dashRes.bodyText);
    assert.ok(dash.merged);
    assert.ok(dash.settings);

    const setRes = await client.handleApi('/api/settings', 'GET', '');
    assert.equal(setRes.status, 200);
    const setObj = JSON.parse(setRes.bodyText);
    assert.ok(setObj.device?.deviceId);
  } finally {
    if (client) await client.dispose();
    if (prevDataDir === undefined) delete process.env.AG_SYNC_DATA_DIR;
    else process.env.AG_SYNC_DATA_DIR = prevDataDir;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('vscode-extension formatStatusBarCapsule renders context, quota, cache, speed, and warn levels', () => {
  const origLoad = Module._load;
  class FakeMarkdownString {
    constructor() {
      this.value = '';
    }
    appendMarkdown(s) {
      this.value += s;
    }
  }
  Module._load = function (request, parent, isMain) {
    if (request === 'vscode') {
      return {
        MarkdownString: FakeMarkdownString,
        StatusBarAlignment: { Right: 2 },
        ThemeColor: class {
          constructor(id) {
            this.id = id;
          }
        },
        ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
      };
    }
    return origLoad.call(this, request, parent, isMain);
  };

  try {
    const extPath = require.resolve('../vscode-extension/extension.cjs');
    delete require.cache[extPath];
    const { formatStatusBarCapsule } = require('../vscode-extension/extension.cjs');

    const normal = formatStatusBarCapsule({
      sessionContext: {
        current: {
          title: 'Refactor UI',
          displayName: 'Gemini 4 Hydrogen (High)',
          usedTokens: 150000,
          maxContextTokens: 500000,
          remainingTokens: 350000,
          usageRatio: 0.3,
          inputTokens: 1000,
          cacheReadTokens: 148000,
          cacheWriteTokens: 0,
          responseTokens: 1000,
          cacheHitRate: 0.993,
          sessionInputTokens: 2000,
          sessionCacheReadTokens: 200000,
          sessionCacheHitRate: 0.99,
          isRunning: false,
          latestGeneration: { tps: 42.3, ttftMs: 410, totalTokens: 150000, timestampMs: Date.now() - 30000 },
        },
      },
      quota: {
        connected: true,
        maskedEmail: 'te***t@example.com',
        groups: [
          {
            title: 'Gemini',
            family: 'gemini',
            windows: [{ kind: '5h', remainingFraction: 0.85, resetTime: new Date(Date.now() + 3600_000).toISOString() }],
          },
          {
            title: 'Claude',
            family: 'claude_gpt',
            windows: [{ kind: '5h', remainingFraction: 0.92, resetTime: new Date(Date.now() + 3600_000).toISOString() }],
          },
        ],
      },
    });

    assert.equal(normal.warnLevel, 0);
    assert.ok(normal.text.includes('30% (150.0K/500.0K)'));
    assert.ok(normal.text.includes('G 85% C 92%'));
    assert.ok(normal.text.includes('⚡99%'));
    assert.ok(normal.text.includes('42.3 t/s'));
    assert.ok(normal.tooltip.value.includes('Refactor UI'));
    assert.ok(normal.tooltip.value.includes('Gemini 4 Hydrogen (High)'));

    const critical = formatStatusBarCapsule({
      sessionContext: {
        current: {
          usedTokens: 470000,
          maxContextTokens: 500000,
          remainingTokens: 30000,
          usageRatio: 0.94,
          isRunning: true,
        },
      },
      quota: { connected: false, groups: [] },
    });
    assert.equal(critical.warnLevel, 2);
    assert.ok(critical.text.includes('$(loading~spin)'));
    assert.ok(critical.text.includes('gen…'));
  } finally {
    Module._load = origLoad;
  }
});

test('vscode-extension buildVsix packages a valid VSIX archive with runtime and manifest', async () => {
  const extPkg = JSON.parse(await fs.readFile(path.resolve('vscode-extension', 'package.json'), 'utf8'));
  const res = await buildVsix();
  assert.equal(res.version, extPkg.version);
  assert.ok(res.fileCount > 10);

  const buf = await fs.readFile(res.vsixPath);
  assert.equal(buf[0], 0x50); // 'P'
  assert.equal(buf[1], 0x4b); // 'K'
  const latin = buf.toString('latin1');
  assert.ok(latin.includes('[Content_Types].xml'));
  assert.ok(latin.includes('extension.vsixmanifest'));
  assert.ok(latin.includes('extension/package.json'));
  assert.ok(latin.includes('extension/extension.cjs'));
  assert.ok(latin.includes('extension/LICENSE.txt'));
  assert.ok(latin.includes('extension/runtime/sidecars/dashboard/main.mjs'));
  assert.ok(latin.includes('extension/assets/icon.png'));
});
