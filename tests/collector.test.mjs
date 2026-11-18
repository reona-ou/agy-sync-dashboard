import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  LocalUsageCollector,
  parseGenMetadataBlob,
  parseStepMetadata,
  toLocalDateKey,
} from '../sidecars/dashboard/collector.mjs';

function encodeVarint(num) {
  let v = BigInt(num);
  const bytes = [];
  while (v >= 0x80n) {
    bytes.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  bytes.push(Number(v));
  return Buffer.from(bytes);
}

function encodeFieldVarint(fieldNo, value) {
  return Buffer.concat([encodeVarint((fieldNo << 3) | 0), encodeVarint(value)]);
}

function encodeFieldBytes(fieldNo, buf) {
  return Buffer.concat([encodeVarint((fieldNo << 3) | 2), encodeVarint(buf.length), buf]);
}

function encodeFieldString(fieldNo, str) {
  return encodeFieldBytes(fieldNo, Buffer.from(str, 'utf8'));
}

function makeTimestampBlob(ms) {
  const sec = Math.floor(ms / 1000);
  const nanos = (ms % 1000) * 1_000_000;
  return Buffer.concat([encodeFieldVarint(1, sec), encodeFieldVarint(2, nanos)]);
}

function makeDurationBlob(ms) {
  const sec = Math.floor(ms / 1000);
  const nanos = (ms % 1000) * 1_000_000;
  return Buffer.concat([encodeFieldVarint(1, sec), encodeFieldVarint(2, nanos)]);
}

function makeGenBlob({
  stepIndices = [0],
  modelEnum = 1001,
  modelId = 'gemini-4-hydrogen',
  displayName = 'Gemini 4 Flash',
  inputTokens = 1000,
  outputTokens = 300,
  cacheWriteTokens = 0,
  cacheReadTokens = 4000,
  thinkingTokens = 50,
  responseTokens = 250,
  messageId = 'bot-1',
  responseId = 'resp-1',
  ttftMs = 250,
  streamingMs = 1250,
}) {
  const usage = Buffer.concat([
    encodeFieldVarint(2, inputTokens),
    encodeFieldVarint(3, outputTokens),
    ...(cacheWriteTokens ? [encodeFieldVarint(4, cacheWriteTokens)] : []),
    encodeFieldVarint(5, cacheReadTokens),
    encodeFieldVarint(6, 1),
    encodeFieldString(7, messageId),
    encodeFieldVarint(9, thinkingTokens),
    encodeFieldVarint(10, responseTokens),
    encodeFieldString(11, responseId),
  ]);

  const g1 = Buffer.concat([
    encodeFieldVarint(3, modelEnum),
    encodeFieldBytes(4, usage),
    encodeFieldBytes(11, makeDurationBlob(ttftMs)),
    encodeFieldBytes(12, makeDurationBlob(streamingMs)),
    encodeFieldString(19, modelId),
    encodeFieldString(21, displayName),
  ]);

  const packedSteps = Buffer.concat(stepIndices.map((idx) => encodeVarint(idx)));
  return Buffer.concat([encodeFieldBytes(1, g1), encodeFieldBytes(2, packedSteps)]);
}

function createConvDb(dbPath, title, entries) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, metadata BLOB);
    CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB, size INTEGER);
  `);

  const insStep = db.prepare('INSERT INTO steps (idx, step_type, metadata) VALUES (?, ?, ?)');
  const insGen = db.prepare('INSERT INTO gen_metadata (idx, data, size) VALUES (?, ?, ?)');

  entries.forEach((entry, i) => {
    const stepMeta = Buffer.concat([
      encodeFieldBytes(1, makeTimestampBlob(entry.timestampMs)),
      encodeFieldBytes(6, makeTimestampBlob(entry.timestampMs + 100)),
      encodeFieldBytes(7, makeTimestampBlob(entry.timestampMs + 1100)),
    ]);
    insStep.run(i, 15, stepMeta);
    const blob = makeGenBlob({ ...entry, stepIndices: [i] });
    insGen.run(i, blob, blob.length);
  });
  db.close();
}

test('parseGenMetadataBlob and parseStepMetadata decode protobuf usage accurately', () => {
  const ts = Date.UTC(2026, 10, 18, 8, 30, 0);
  const stepBlob = Buffer.concat([
    encodeFieldBytes(1, makeTimestampBlob(ts)),
    encodeFieldBytes(7, makeTimestampBlob(ts + 2500)),
  ]);
  const parsedStep = parseStepMetadata(stepBlob);
  assert.equal(parsedStep.createdAtMs, ts);
  assert.equal(parsedStep.completedAtMs, ts + 2500);

  const blob = makeGenBlob({
    inputTokens: 500,
    outputTokens: 395,
    cacheReadTokens: 2000,
    thinkingTokens: 47,
    responseTokens: 348,
    responseId: 'resp-abc',
  });
  const parsed = parseGenMetadataBlob(blob);
  assert.ok(parsed);
  assert.equal(parsed.inputTokens, 500);
  assert.equal(parsed.outputTokens, 395);
  assert.equal(parsed.cacheReadTokens, 2000);
  // Must not double-count thinkingTokens when outputTokens (field 3) is already present.
  assert.equal(parsed.totalTokens, 500 + 2000 + 395);
  assert.equal(parsed.modelId, 'gemini-4-hydrogen');
  assert.equal(parsed.responseId, 'resp-abc');
});

test('LocalUsageCollector scans SQLite DBs and deduplicates shared responseId across conversations', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-coll-'));
  try {
    const convDir = path.join(tmpRoot, 'conversations');
    const summariesDb = path.join(tmpRoot, 'conversation_summaries.db');
    await fs.mkdir(convDir, { recursive: true });

    const ts1 = Date.now() - 120_000;
    const ts2 = Date.now() - 60_000;

    const sumDb = new DatabaseSync(summariesDb);
    sumDb.exec(`
      CREATE TABLE conversation_summaries (
        conversation_id TEXT PRIMARY KEY,
        title TEXT,
        step_count INTEGER,
        last_modified_time TEXT
      );
    `);
    sumDb
      .prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?, ?)')
      .run('conv-a', 'Main Session', 2, new Date(ts1).toISOString());
    sumDb
      .prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?, ?)')
      .run('conv-b', 'Subagent Duplicate Check', 1, new Date(ts2).toISOString());
    sumDb.close();

    createConvDb(path.join(convDir, 'conv-a.db'), 'Main Session', [
      {
        timestampMs: ts1,
        modelId: 'gemini-4-hydrogen',
        displayName: 'Gemini 4 Flash',
        inputTokens: 1000,
        outputTokens: 400,
        cacheReadTokens: 4000,
        responseId: 'shared-resp-1',
        messageId: 'bot-a1',
        ttftMs: 200,
        streamingMs: 2200,
      },
      {
        timestampMs: ts1 + 5000,
        modelId: 'claude-sonnet-4-6',
        displayName: 'Claude Sonnet 4.6',
        inputTokens: 500,
        outputTokens: 200,
        cacheReadTokens: 1500,
        responseId: 'unique-resp-2',
        messageId: 'bot-a2',
      },
    ]);

    // Same responseId appearing in a second DB must be deduplicated cleanly.
    createConvDb(path.join(convDir, 'conv-b.db'), 'Dup Check', [
      {
        timestampMs: ts2,
        modelId: 'gemini-4-hydrogen',
        displayName: 'Gemini 4 Flash',
        inputTokens: 1000,
        outputTokens: 400,
        cacheReadTokens: 4000,
        responseId: 'shared-resp-1',
        messageId: 'bot-a1',
      },
    ]);

    const collector = new LocalUsageCollector({ conversationsDir: convDir, summariesDb });
    const snap = await collector.collect();

    assert.equal(snap.totals.generations, 2);
    assert.equal(snap.totals.inputTokens, 1500);
    assert.equal(snap.totals.cacheReadTokens, 5500);
    assert.equal(snap.totals.outputTokens, 600);
    assert.equal(snap.totals.totalTokens, 7600);
    assert.equal(Object.keys(snap.byModel).length, 2);

    const todayKey = toLocalDateKey(ts1);
    assert.equal(snap.byDate[todayKey].totalTokens, 7600);

    // Second pass hits incremental file cache cleanly.
    const snap2 = await collector.collect();
    assert.equal(snap2.totals.totalTokens, 7600);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});
