import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SLOT_MS, TIMELINE_RETENTION_MS, classifyModelFamily } from './forecast.mjs';

/**
 * Known model enum fallbacks when proto field g1[19] (modelId) is omitted.
 */
const MODEL_ENUM_FALLBACK = {
  1000: 'gemini-3-pro',
  1001: 'gemini-3-flash',
  1002: 'gemini-2.5-pro',
  1003: 'gemini-2.5-flash',
  1010: 'claude-sonnet-4.5',
  1011: 'claude-sonnet-4.6',
  1012: 'claude-opus-4.5',
  1013: 'claude-opus-4.6',
  1020: 'gpt-oss-120b',
};

/**
 * Read an unsigned varint from a Buffer starting at offset.
 * @returns {{ value: bigint, next: number } | null}
 */
export function readVarint(buf, offset) {
  let result = 0n;
  let shift = 0n;
  let pos = offset;
  while (pos < buf.length && pos - offset < 10) {
    const byte = buf[pos++];
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value: result, next: pos };
    }
    shift += 7n;
  }
  return null;
}

/**
 * Safely clamp a BigInt into a non-negative JS Number.
 */
function toSafeInt(val) {
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  if (typeof val !== 'bigint') return 0;
  if (val < 0n) return 0;
  if (val > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
  return Number(val);
}

/**
 * Decode a raw protobuf message buffer into a map of fieldNumber -> Array<{ wire, value }>.
 * @param {Uint8Array | Buffer} input
 * @returns {Map<number, Array<{ wire: number, value: bigint | Buffer }>>}
 */
export function decodeProtobufFields(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const fields = new Map();
  let offset = 0;

  while (offset < buf.length) {
    const keyRes = readVarint(buf, offset);
    if (!keyRes) break;
    offset = keyRes.next;
    const tag = Number(keyRes.value);
    const fieldNo = tag >>> 3;
    const wire = tag & 0x07;
    if (fieldNo <= 0) break;

    let value;
    if (wire === 0) {
      const vRes = readVarint(buf, offset);
      if (!vRes) break;
      value = vRes.value;
      offset = vRes.next;
    } else if (wire === 1) {
      if (offset + 8 > buf.length) break;
      value = buf.subarray(offset, offset + 8);
      offset += 8;
    } else if (wire === 2) {
      const lRes = readVarint(buf, offset);
      if (!lRes) break;
      const len = toSafeInt(lRes.value);
      offset = lRes.next;
      if (len < 0 || offset + len > buf.length) break;
      value = buf.subarray(offset, offset + len);
      offset += len;
    } else if (wire === 5) {
      if (offset + 4 > buf.length) break;
      value = buf.subarray(offset, offset + 4);
      offset += 4;
    } else {
      // Unsupported legacy/invalid wire types stop parsing safely.
      break;
    }

    if (!fields.has(fieldNo)) fields.set(fieldNo, []);
    fields.get(fieldNo).push({ wire, value });
  }

  return fields;
}

function getFirstVarint(fields, fieldNo, fallback = 0) {
  const entries = fields.get(fieldNo);
  if (!entries?.length) return fallback;
  const hit = entries.find((e) => e.wire === 0);
  return hit ? toSafeInt(hit.value) : fallback;
}

function getFirstBytes(fields, fieldNo) {
  const entries = fields.get(fieldNo);
  if (!entries?.length) return null;
  const hit = entries.find((e) => e.wire === 2);
  return hit ? hit.value : null;
}

function getFirstString(fields, fieldNo) {
  const raw = getFirstBytes(fields, fieldNo);
  if (!raw || !raw.length) return '';
  return raw.toString('utf8');
}

function decodePackedVarints(entries) {
  if (!entries?.length) return [];
  const out = [];
  for (const item of entries) {
    if (item.wire === 0) {
      out.push(toSafeInt(item.value));
    } else if (item.wire === 2) {
      const buf = item.value;
      let offset = 0;
      while (offset < buf.length) {
        const res = readVarint(buf, offset);
        if (!res) break;
        out.push(toSafeInt(res.value));
        offset = res.next;
      }
    }
  }
  return out;
}

function decodeTimestampMs(raw) {
  if (!raw?.length) return 0;
  const f = decodeProtobufFields(raw);
  const sec = getFirstVarint(f, 1, 0);
  const nanos = getFirstVarint(f, 2, 0);
  if (sec <= 0) return 0;
  return sec * 1000 + Math.floor(nanos / 1e6);
}

function decodeDurationMs(raw) {
  if (!raw?.length) return 0;
  const f = decodeProtobufFields(raw);
  const sec = getFirstVarint(f, 1, 0);
  const nanos = getFirstVarint(f, 2, 0);
  return sec * 1000 + Math.floor(nanos / 1e6);
}

/**
 * Decode a single `steps.metadata` protobuf buffer for timestamps.
 */
export function parseStepMetadata(blob) {
  if (!blob?.length) return { createdAtMs: 0, firstChunkAtMs: 0, completedAtMs: 0 };
  const fields = decodeProtobufFields(blob);
  return {
    createdAtMs: decodeTimestampMs(getFirstBytes(fields, 1)),
    firstChunkAtMs: decodeTimestampMs(getFirstBytes(fields, 6)),
    completedAtMs: decodeTimestampMs(getFirstBytes(fields, 7)),
  };
}

/**
 * Normalize model display name and identifier.
 */
export function resolveModelMeta(modelId, displayName, modelEnum) {
  const cleanId = (modelId || '').trim();
  const cleanDisplay = (displayName || '').trim();
  if (cleanId && cleanDisplay) return { modelId: cleanId, displayName: cleanDisplay };
  if (cleanId) return { modelId: cleanId, displayName: cleanId };
  if (cleanDisplay) return { modelId: cleanDisplay.toLowerCase().replace(/\s+/g, '-'), displayName: cleanDisplay };
  const mapped = MODEL_ENUM_FALLBACK[modelEnum];
  if (mapped) return { modelId: mapped, displayName: mapped };
  if (modelEnum > 0) return { modelId: `model-${modelEnum}`, displayName: `Model #${modelEnum}` };
  return { modelId: 'unknown', displayName: 'Unknown' };
}

/**
 * Decode `chatStartMetadata.contextWindowMetadata` (g1[9][10]) for context usage & limit.
 */
export function parseContextWindowMetadata(g1Fields) {
  const chatStartRaw = getFirstBytes(g1Fields, 9);
  if (!chatStartRaw) return { estimatedTokensUsed: 0, maxContextTokens: 0 };
  const chatStart = decodeProtobufFields(chatStartRaw);
  const ctxWinRaw = getFirstBytes(chatStart, 10);
  if (!ctxWinRaw) return { estimatedTokensUsed: 0, maxContextTokens: 0 };
  const ctxWin = decodeProtobufFields(ctxWinRaw);
  return {
    estimatedTokensUsed: getFirstVarint(ctxWin, 1, 0),
    maxContextTokens: getFirstVarint(ctxWin, 4, 0),
  };
}

/**
 * Decode context-window state from a `gen_metadata.data` blob (works even if usage is not yet populated).
 * @returns {object | null}
 */
export function parseGenContextSnapshot(blob) {
  if (!blob?.length) return null;
  const top = decodeProtobufFields(blob);
  const g1Raw = getFirstBytes(top, 1);
  if (!g1Raw) return null;

  const g1 = decodeProtobufFields(g1Raw);
  const stepIndices = decodePackedVarints(top.get(2));
  const modelEnum = getFirstVarint(g1, 3, 0);
  const { modelId, displayName } = resolveModelMeta(
    getFirstString(g1, 19),
    getFirstString(g1, 21),
    modelEnum
  );
  const { estimatedTokensUsed, maxContextTokens } = parseContextWindowMetadata(g1);

  const usageRaw = getFirstBytes(g1, 4);
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheWriteTokens = 0;
  let cacheReadTokens = 0;
  let thinkingTokens = 0;
  let responseTokens = 0;

  if (usageRaw) {
    const usage = decodeProtobufFields(usageRaw);
    inputTokens = getFirstVarint(usage, 2, 0);
    const rawOutputTokens = getFirstVarint(usage, 3, 0);
    cacheWriteTokens = getFirstVarint(usage, 4, 0);
    cacheReadTokens = getFirstVarint(usage, 5, 0);
    thinkingTokens = getFirstVarint(usage, 9, 0);
    responseTokens = getFirstVarint(usage, 10, 0);
    outputTokens =
      rawOutputTokens > 0
        ? rawOutputTokens
        : responseTokens + thinkingTokens;
  }

  const promptTokens = inputTokens + cacheReadTokens + cacheWriteTokens;
  const nonThinkingOutput = responseTokens > 0 ? responseTokens : Math.max(0, outputTokens - thinkingTokens);

  return {
    stepIndices,
    modelEnum,
    modelId,
    displayName,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    thinkingTokens,
    responseTokens,
    promptTokens,
    nonThinkingOutput,
    estimatedTokensUsed,
    maxContextTokens,
  };
}

/**
 * Decode a single `gen_metadata.data` protobuf blob.
 * @returns {object | null}
 */
export function parseGenMetadataBlob(blob) {
  if (!blob?.length) return null;
  const top = decodeProtobufFields(blob);
  const g1Raw = getFirstBytes(top, 1);
  if (!g1Raw) return null;

  const g1 = decodeProtobufFields(g1Raw);
  const stepIndices = decodePackedVarints(top.get(2));
  const modelEnum = getFirstVarint(g1, 3, 0);
  const usageRaw = getFirstBytes(g1, 4);
  if (!usageRaw) return null;

  const usage = decodeProtobufFields(usageRaw);
  const inputTokens = getFirstVarint(usage, 2, 0);
  const rawOutputTokens = getFirstVarint(usage, 3, 0);
  const cacheWriteTokens = getFirstVarint(usage, 4, 0);
  const cacheReadTokens = getFirstVarint(usage, 5, 0);
  const apiProvider = getFirstVarint(usage, 6, 0);
  const messageId = getFirstString(usage, 7);
  const thinkingTokens = getFirstVarint(usage, 9, 0);
  const responseTokens = getFirstVarint(usage, 10, 0);
  const responseId = getFirstString(usage, 11);

  const outputTokens =
    rawOutputTokens > 0
      ? rawOutputTokens
      : responseTokens + thinkingTokens;

  const totalTokens = inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens;
  const ttftMs = decodeDurationMs(getFirstBytes(g1, 11));
  const streamingMs = decodeDurationMs(getFirstBytes(g1, 12));
  const { modelId, displayName } = resolveModelMeta(
    getFirstString(g1, 19),
    getFirstString(g1, 21),
    modelEnum
  );
  const { estimatedTokensUsed, maxContextTokens } = parseContextWindowMetadata(g1);

  return {
    stepIndices,
    modelEnum,
    modelId,
    displayName,
    apiProvider,
    messageId,
    responseId,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    thinkingTokens,
    responseTokens,
    totalTokens,
    estimatedTokensUsed,
    maxContextTokens,
    ttftMs,
    streamingMs,
  };
}

/**
 * Format a timestamp in local YYYY-MM-DD calendar day.
 */
export function toLocalDateKey(ms) {
  const date = new Date(ms || Date.now());
  if (Number.isNaN(date.getTime())) return 'unknown';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function emptyBucket() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
    generations: 0,
  };
}

function addToBucket(bucket, item) {
  bucket.inputTokens += item.inputTokens;
  bucket.outputTokens += item.outputTokens;
  bucket.cacheReadTokens += item.cacheReadTokens;
  bucket.cacheWriteTokens += item.cacheWriteTokens;
  bucket.thinkingTokens += item.thinkingTokens;
  bucket.totalTokens += item.totalTokens;
  bucket.generations += 1;
}

function resolveStepTimestamp(stepIndices, stepTimeMap, fallbackMs) {
  let timestampMs = 0;
  let streamWallMs = 0;
  for (const stepIdx of stepIndices || []) {
    const meta = stepTimeMap.get(stepIdx);
    if (meta) {
      timestampMs = meta.completedAtMs || meta.createdAtMs || meta.firstChunkAtMs || timestampMs;
      if (meta.completedAtMs > 0 && meta.completedAtMs > meta.firstChunkAtMs) {
        streamWallMs = meta.completedAtMs - meta.firstChunkAtMs;
      }
      if (timestampMs > 0) break;
    }
  }
  return { timestampMs: timestampMs || fallbackMs, streamWallMs };
}

function formatLatestGeneration(gen) {
  if (!gen) return null;
  const tps =
    gen.genDurationMs >= 100
      ? Number(((gen.outputTokens * 1000) / gen.genDurationMs).toFixed(1))
      : 0;
  return {
    timestampMs: gen.timestampMs,
    modelId: gen.modelId,
    displayName: gen.displayName,
    inputTokens: gen.inputTokens,
    outputTokens: gen.outputTokens,
    cacheReadTokens: gen.cacheReadTokens,
    totalTokens: gen.totalTokens,
    tps,
    ttftMs: gen.ttftMs,
  };
}

function buildContextFromRows(genRows, stepTimeMap, fallbackMs) {
  if (!genRows?.length) return null;

  let latestParsed = null;
  let latestUsageParsed = null;
  let fallbackMaxContext = 0;

  for (let i = genRows.length - 1; i >= 0; i--) {
    const ctx = parseGenContextSnapshot(genRows[i].data);
    if (!ctx) continue;
    if (!latestParsed) latestParsed = ctx;
    if (!fallbackMaxContext && ctx.maxContextTokens > 0) {
      fallbackMaxContext = ctx.maxContextTokens;
    }
    if (!latestUsageParsed && ctx.promptTokens > 0) {
      latestUsageParsed = ctx;
    }
    if (latestParsed && latestUsageParsed && fallbackMaxContext > 0) break;
  }

  const chosen = latestParsed?.promptTokens > 0
    ? latestParsed
    : latestParsed?.estimatedTokensUsed > 0
      ? latestParsed
      : latestUsageParsed || latestParsed;
  if (!chosen) return null;

  const maxContextTokens = chosen.maxContextTokens || fallbackMaxContext || 0;
  const { timestampMs } = resolveStepTimestamp(chosen.stepIndices, stepTimeMap, fallbackMs);

  let usedTokens = 0;
  let source = 'empty';
  if (chosen.promptTokens > 0) {
    usedTokens = chosen.promptTokens + chosen.nonThinkingOutput;
    source = 'usage';
  } else if (chosen.estimatedTokensUsed > 0) {
    usedTokens = chosen.estimatedTokensUsed;
    source = 'estimate';
  }

  return {
    modelId: chosen.modelId,
    displayName: chosen.displayName,
    usedTokens,
    maxContextTokens,
    promptTokens: chosen.promptTokens,
    inputTokens: chosen.inputTokens,
    cacheReadTokens: chosen.cacheReadTokens,
    cacheWriteTokens: chosen.cacheWriteTokens,
    outputTokens: chosen.outputTokens,
    responseTokens: chosen.nonThinkingOutput,
    estimatedTokensUsed: chosen.estimatedTokensUsed,
    source,
    timestampMs,
  };
}

/**
 * Scan one Antigravity conversation SQLite file using read-only mode.
 * Returns raw generation events plus conversation aggregate counters and context state.
 */
export function scanConversationDb(dbPath, summaryMeta = null) {
  const convId = path.basename(dbPath, '.db');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r) => r.name)
    );
    let fallbackMs = summaryMeta?.lastModifiedMs || 0;
    if (!fallbackMs) {
      try {
        fallbackMs = Math.floor(fs.statSync(dbPath).mtimeMs);
      } catch {
        fallbackMs = Date.now();
      }
    }
    if (!tables.has('gen_metadata')) {
      return {
        convId,
        title: summaryMeta?.title || convId.slice(0, 8),
        lastModifiedMs: fallbackMs,
        generations: [],
        contextInfo: null,
      };
    }

    const stepTimeMap = new Map();
    if (tables.has('steps')) {
      const stepRows = db
        .prepare('SELECT idx, step_type, metadata FROM steps WHERE metadata IS NOT NULL')
        .all();
      for (const row of stepRows) {
        const meta = parseStepMetadata(row.metadata);
        const ts = meta.completedAtMs || meta.createdAtMs || meta.firstChunkAtMs;
        if (ts > 0 || meta.completedAtMs > 0) {
          stepTimeMap.set(row.idx, meta);
        }
      }
    }

    const genRows = db
      .prepare('SELECT idx, data FROM gen_metadata ORDER BY idx ASC')
      .all();

    const generations = [];
    for (const row of genRows) {
      const parsed = parseGenMetadataBlob(row.data);
      if (!parsed || parsed.totalTokens <= 0) continue;

      const { timestampMs, streamWallMs } = resolveStepTimestamp(parsed.stepIndices, stepTimeMap, fallbackMs);

      const genDurationMs =
        parsed.streamingMs > parsed.ttftMs && parsed.streamingMs > 0
          ? parsed.streamingMs - parsed.ttftMs
          : parsed.streamingMs > 0
            ? parsed.streamingMs
            : streamWallMs;

      const dedupeKey =
        parsed.responseId ||
        parsed.messageId ||
        `${convId}:${row.idx}`;

      generations.push({
        dedupeKey,
        convId,
        genIdx: row.idx,
        timestampMs,
        dateKey: toLocalDateKey(timestampMs),
        modelId: parsed.modelId,
        displayName: parsed.displayName,
        inputTokens: parsed.inputTokens,
        outputTokens: parsed.outputTokens,
        cacheReadTokens: parsed.cacheReadTokens,
        cacheWriteTokens: parsed.cacheWriteTokens,
        thinkingTokens: parsed.thinkingTokens,
        totalTokens: parsed.totalTokens,
        ttftMs: parsed.ttftMs,
        genDurationMs,
      });
    }

    const contextInfo = buildContextFromRows(genRows, stepTimeMap, fallbackMs);
    if (contextInfo) {
      contextInfo.latestGeneration = generations.length
        ? formatLatestGeneration(generations[generations.length - 1])
        : null;
    }

    return {
      convId,
      title: summaryMeta?.title || convId.slice(0, 8),
      lastModifiedMs: contextInfo?.timestampMs && contextInfo.timestampMs > fallbackMs ? contextInfo.timestampMs : fallbackMs,
      generations,
      contextInfo,
    };
  } finally {
    db.close();
  }
}

/**
 * Load conversation titles & modification timestamps from conversation_summaries.db.
 */
export function loadConversationSummaries(summariesDbPath) {
  const out = new Map();
  if (!summariesDbPath || !fs.existsSync(summariesDbPath)) return out;
  let db;
  try {
    db = new DatabaseSync(summariesDbPath, { readOnly: true });
    const rows = db
      .prepare(
        'SELECT conversation_id, title, step_count, last_modified_time FROM conversation_summaries'
      )
      .all();
    for (const row of rows) {
      const ms = row.last_modified_time ? Date.parse(row.last_modified_time) : 0;
      out.set(row.conversation_id, {
        title: row.title || row.conversation_id.slice(0, 8),
        stepCount: Number(row.step_count || 0),
        lastModifiedMs: Number.isFinite(ms) ? ms : 0,
      });
    }
  } catch {
    // Graceful fallback if DB schema differs or is temporarily locked.
  } finally {
    try {
      db?.close();
    } catch {}
  }
  return out;
}

/**
 * Local collector with incremental file signature caching (mtime + size + WAL mtime).
 */
export class LocalUsageCollector {
  constructor(paths) {
    this.paths = paths;
    this.fileCache = new Map();
    this.conversationContexts = new Map();
    this.lastSnapshot = null;
  }

  async fileSignature(dbPath) {
    const st = await fsp.stat(dbPath);
    let walSig = '0:0';
    try {
      const wst = await fsp.stat(`${dbPath}-wal`);
      walSig = `${Math.floor(wst.mtimeMs)}:${wst.size}`;
    } catch {}
    return `${Math.floor(st.mtimeMs)}:${st.size}|${walSig}`;
  }

  async getConversationContext(convId) {
    if (!convId || typeof convId !== 'string') return null;
    const cleanId = path.basename(convId.trim());
    if (!cleanId || cleanId !== convId.trim() || cleanId.includes('..')) return null;

    const convDir = this.paths.conversationsDir;
    if (convDir) {
      const dbPath = path.join(convDir, `${cleanId}.db`);
      if (fs.existsSync(dbPath)) {
        try {
          const sig = await this.fileSignature(dbPath);
          const cached = this.fileCache.get(dbPath);
          if (
            cached &&
            cached.sig === sig &&
            'contextInfo' in cached.data &&
            (!cached.data.contextInfo || 'latestGeneration' in cached.data.contextInfo)
          ) {
            const entry = {
              conversationId: cached.data.convId,
              title: cached.data.title,
              lastModifiedMs: cached.data.lastModifiedMs,
              contextInfo: cached.data.contextInfo || null,
            };
            this.conversationContexts.set(cleanId, entry);
            return entry;
          }
          const summaries = loadConversationSummaries(this.paths.summariesDb);
          const summaryMeta = summaries.get(cleanId) || null;
          const scanned = scanConversationDb(dbPath, summaryMeta);
          this.fileCache.set(dbPath, {
            sig,
            title: scanned.title,
            data: scanned,
          });
          const entry = {
            conversationId: scanned.convId,
            title: scanned.title,
            lastModifiedMs: scanned.lastModifiedMs,
            contextInfo: scanned.contextInfo || null,
          };
          this.conversationContexts.set(cleanId, entry);
          return entry;
        } catch {
          // Fall back to previously cached context entry if DB is transiently locked.
        }
      }
    }

    return this.conversationContexts.get(cleanId) || null;
  }

  listConversationContexts(limit = 15) {
    return Array.from(this.conversationContexts.values())
      .sort((a, b) => Number(b.lastModifiedMs || 0) - Number(a.lastModifiedMs || 0))
      .slice(0, limit);
  }

  async collect() {
    const convDir = this.paths.conversationsDir;
    const summaries = loadConversationSummaries(this.paths.summariesDb);

    let entries = [];
    if (convDir && fs.existsSync(convDir)) {
      entries = (await fsp.readdir(convDir, { withFileTypes: true }))
        .filter((d) => d.isFile() && d.name.endsWith('.db'));
    }

    const activePaths = new Set();
    const convResults = [];

    for (const entry of entries) {
      const fullPath = path.join(convDir, entry.name);
      activePaths.add(fullPath);
      const convId = path.basename(entry.name, '.db');
      const summaryMeta = summaries.get(convId) || null;

      try {
        const sig = await this.fileSignature(fullPath);
        const cached = this.fileCache.get(fullPath);
        if (
          cached &&
          cached.sig === sig &&
          cached.title === (summaryMeta?.title || cached.title) &&
          'contextInfo' in cached.data &&
          (!cached.data.contextInfo || 'latestGeneration' in cached.data.contextInfo)
        ) {
          convResults.push(cached.data);
          continue;
        }
        const scanned = scanConversationDb(fullPath, summaryMeta);
        this.fileCache.set(fullPath, {
          sig,
          title: scanned.title,
          data: scanned,
        });
        convResults.push(scanned);
      } catch {
        // Skip transiently locked/corrupt DB without failing the entire device scan.
      }
    }

    for (const key of this.fileCache.keys()) {
      if (!activePaths.has(key)) this.fileCache.delete(key);
    }

    // Deduplicate across all files on the same device using responseId / messageId / convId:genIdx.
    const seen = new Map();
    const convBuckets = new Map();
    const nextContexts = new Map();

    for (const conv of convResults) {
      convBuckets.set(conv.convId, {
        conversationId: conv.convId,
        title: conv.title,
        lastModifiedMs: conv.lastModifiedMs,
        modelId: conv.contextInfo?.modelId || '',
        displayName: conv.contextInfo?.displayName || '',
        contextUsedTokens: conv.contextInfo?.usedTokens || 0,
        maxContextTokens: conv.contextInfo?.maxContextTokens || 0,
        latestGeneration: conv.contextInfo?.latestGeneration
          ? {
              totalTokens: conv.contextInfo.latestGeneration.totalTokens,
              tps: conv.contextInfo.latestGeneration.tps,
              ttftMs: conv.contextInfo.latestGeneration.ttftMs,
              timestampMs: conv.contextInfo.latestGeneration.timestampMs,
            }
          : null,
        ...emptyBucket(),
      });
      nextContexts.set(conv.convId, {
        conversationId: conv.convId,
        title: conv.title,
        lastModifiedMs: conv.lastModifiedMs,
        contextInfo: conv.contextInfo || null,
      });

      for (const gen of conv.generations) {
        const existing = seen.get(gen.dedupeKey);
        // Keep the record with larger totalTokens if a retry updated the same responseId.
        if (!existing || gen.totalTokens > existing.gen.totalTokens) {
          seen.set(gen.dedupeKey, { gen, convId: conv.convId });
        }
      }
    }
    this.conversationContexts = nextContexts;

    const totals = emptyBucket();
    const byDate = Object.create(null);
    const byModel = Object.create(null);
    const bySlot = Object.create(null);
    const slotCutoffMs = Date.now() - TIMELINE_RETENTION_MS;
    let latestGen = null;

    for (const { gen, convId } of seen.values()) {
      addToBucket(totals, gen);

      if (!byDate[gen.dateKey]) byDate[gen.dateKey] = emptyBucket();
      addToBucket(byDate[gen.dateKey], gen);

      if (gen.timestampMs >= slotCutoffMs) {
        const slotKey = String(Math.floor(gen.timestampMs / SLOT_MS));
        const fam = classifyModelFamily(gen.modelId, gen.displayName);
        if (!bySlot[slotKey]) bySlot[slotKey] = Object.create(null);
        if (!bySlot[slotKey][fam]) {
          bySlot[slotKey][fam] = { totalTokens: 0, nonCacheTokens: 0, generations: 0 };
        }
        const sb = bySlot[slotKey][fam];
        sb.totalTokens += gen.totalTokens;
        sb.nonCacheTokens += gen.inputTokens + gen.outputTokens;
        sb.generations += 1;
      }

      if (!byModel[gen.modelId]) {
        byModel[gen.modelId] = {
          modelId: gen.modelId,
          displayName: gen.displayName,
          ...emptyBucket(),
        };
      }
      addToBucket(byModel[gen.modelId], gen);

      const cb = convBuckets.get(convId);
      if (cb) {
        addToBucket(cb, gen);
        if (gen.timestampMs > cb.lastModifiedMs) cb.lastModifiedMs = gen.timestampMs;
      }

      if (!latestGen || gen.timestampMs >= latestGen.timestampMs) {
        latestGen = gen;
      }
    }

    const recentConversations = Array.from(convBuckets.values())
      .filter((c) => c.totalTokens > 0)
      .sort((a, b) => b.lastModifiedMs - a.lastModifiedMs)
      .slice(0, 12);

    const cacheDenom = totals.inputTokens + totals.cacheReadTokens;
    const cacheHitRate = cacheDenom > 0 ? Number((totals.cacheReadTokens / cacheDenom).toFixed(4)) : 0;

    const snapshot = {
      collectedAt: Date.now(),
      conversationCount: convResults.filter((c) => c.generations.length > 0).length,
      totals: {
        ...totals,
        cacheHitRate,
      },
      latestGeneration: formatLatestGeneration(latestGen),
      byDate,
      byModel,
      bySlot,
      recentConversations,
    };

    this.lastSnapshot = snapshot;
    return snapshot;
  }
}
