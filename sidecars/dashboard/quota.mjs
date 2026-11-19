import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { discoverLanguageServer } from './discovery.mjs';

const RPC_SERVICE = '/exa.language_server_pb.LanguageServerService/';

function callLocalRpc(endpoint, method, body = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = request(
      {
        hostname: '127.0.0.1',
        port: endpoint.port,
        method: 'POST',
        path: `${RPC_SERVICE}${method}`,
        headers: {
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
          'x-codeium-csrf-token': endpoint.csrf,
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
          if (Buffer.byteLength(raw) > 8 * 1024 * 1024) {
            req.destroy(new Error('RPC response exceeded size limit'));
          }
        });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            const err = new Error(`RPC ${method} returned HTTP ${res.statusCode}`);
            err.status = res.statusCode;
            return reject(err);
          }
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error(`Invalid JSON from ${method}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error(`RPC ${method} timeout`)));
    req.end(payload);
  });
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return '';
  const [name, domain] = email.split('@');
  if (name.length <= 2) return `${name[0] || '*'}*@${domain}`;
  return `${name.slice(0, 2)}***${name.slice(-1)}@${domain}`;
}

function normalizeFraction(raw) {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

function classifyBucketFamily(bucket) {
  const id = String(bucket.groupId || bucket.id || bucket.bucketId || bucket.displayName || bucket.name || '').toLowerCase();
  if (id.includes('argon') || id === 'gemini-argon-wtu-weekly') return 'argon';
  if (id.includes('claude') || id.includes('gpt') || id.includes('anthropic') || id.startsWith('3p')) return 'claude_gpt';
  return 'gemini';
}

export function normalizeQuotaSummary(response) {
  const payload = response?.response || response?.quotaSummary || response || {};
  const rawGroups = payload?.groups || payload?.quotaGroups || [];
  const groups = [];
  for (const g of rawGroups) {
    const id = String(g.groupId || g.id || g.displayName || g.name || '');
    const title = String(g.displayName || g.groupName || g.name || id || 'Quota');
    const rawWindows = g.buckets || g.quotaWindows || g.windows || [];
    const windows = [];

    if (Array.isArray(rawWindows) && rawWindows.length > 0) {
      for (const w of rawWindows) {
        const wid = String(w.bucketId || w.windowId || w.id || '').toLowerCase();
        const winHint = String(w.window || w.windowName || w.name || '').toLowerCase();
        const isWeekly = winHint === 'weekly' || wid.includes('week') || winHint.includes('week') || w.windowMinutes === 10080;
        const remaining = normalizeFraction(w.remainingFraction ?? w.remaining?.remainingFraction);
        windows.push({
          kind: isWeekly ? 'weekly' : '5h',
          windowId: String(w.bucketId || w.windowId || w.id || (isWeekly ? 'weekly' : '5h')),
          remainingFraction: remaining,
          resetTime: w.resetTime || null,
          disabled: Boolean(w.disabled || w.isDisabled),
        });
      }
      windows.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === '5h' ? -1 : 1));
    } else {
      const remaining = normalizeFraction(g.remainingFraction ?? g.remaining?.remainingFraction);
      const isWeekly = id.toLowerCase().includes('weekly') || id.toLowerCase().includes('argon');
      windows.push({
        kind: isWeekly ? 'weekly' : '5h',
        windowId: id || (isWeekly ? 'weekly' : '5h'),
        remainingFraction: remaining,
        resetTime: g.resetTime || null,
        disabled: Boolean(g.disabled),
      });
    }

    groups.push({
      id: id || classifyBucketFamily(g),
      family: classifyBucketFamily(g),
      title,
      windows,
    });
  }

  // Fallback for legacy flat bucket list responses
  if (!groups.length && Array.isArray(payload?.buckets)) {
    const grouped = new Map();
    for (const b of payload.buckets) {
      const fam = classifyBucketFamily(b);
      if (!grouped.has(fam)) {
        grouped.set(fam, {
          id: fam,
          family: fam,
          title: fam === 'argon' ? 'Gemini 4 Argon' : fam === 'claude_gpt' ? 'Claude / GPT' : 'Gemini',
          windows: [],
        });
      }
      const isWeekly = String(b.window || b.bucketId || b.id || '').toLowerCase().includes('week');
      grouped.get(fam).windows.push({
        kind: isWeekly ? 'weekly' : '5h',
        windowId: String(b.bucketId || b.id || ''),
        remainingFraction: normalizeFraction(b.remainingFraction ?? b.remaining?.remainingFraction),
        resetTime: b.resetTime || null,
        disabled: Boolean(b.disabled),
      });
    }
    groups.push(...grouped.values());
  }

  return groups;
}

function parseIsoMs(val) {
  if (!val) return 0;
  const ms = Date.parse(val);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Normalize `GetAllCascadeTrajectories` RPC payload into a flat summary list.
 */
export function normalizeTrajectorySummaries(response) {
  const summaries = response?.trajectorySummaries;
  if (!summaries || typeof summaries !== 'object') return [];
  const out = [];
  for (const [conversationId, item] of Object.entries(summaries)) {
    if (!item || typeof item !== 'object') continue;
    const status = String(item.status || '');
    const lastModifiedMs = parseIsoMs(item.lastModifiedTime);
    const lastUserViewMs = parseIsoMs(item.annotations?.lastUserViewTime);
    const rootConversationId = String(item.trajectoryMetadata?.rootConversationId || conversationId);
    out.push({
      conversationId,
      title: String(item.annotations?.title || item.summary || conversationId.slice(0, 8)),
      status,
      isRunning: status === 'CASCADE_RUN_STATUS_RUNNING',
      stepCount: Number(item.stepCount || 0),
      lastModifiedMs,
      lastUserViewMs,
      rootConversationId,
    });
  }
  return out;
}

/**
 * Extract latest context-window usage & max limit from `GetCascadeTrajectoryGeneratorMetadata` RPC JSON.
 */
export function parseRpcGeneratorContext(response) {
  const list = response?.generatorMetadata;
  if (!Array.isArray(list) || !list.length) return null;

  let latestEntry = null;
  let latestUsageEntry = null;
  let fallbackMaxContext = 0;

  const readEntry = (gm) => {
    const cm = gm?.chatModel;
    if (!cm || typeof cm !== 'object') return null;
    const usage = cm.usage || {};
    const inputTokens = Number(usage.inputTokens || 0);
    const cacheReadTokens = Number(usage.cacheReadTokens || 0);
    const cacheWriteTokens = Number(usage.cacheWriteTokens || 0);
    const thinkingTokens = Number(usage.thinkingOutputTokens || 0);
    const responseTokens = Number(usage.responseOutputTokens || 0);
    const rawOutputTokens = Number(usage.outputTokens || 0);
    const outputTokens = rawOutputTokens > 0 ? rawOutputTokens : responseTokens + thinkingTokens;
    const promptTokens = inputTokens + cacheReadTokens + cacheWriteTokens;
    const nonThinkingOutput = responseTokens > 0 ? responseTokens : Math.max(0, outputTokens - thinkingTokens);
    const ctxWin = cm.chatStartMetadata?.contextWindowMetadata || {};
    const estimatedTokensUsed = Number(ctxWin.estimatedTokensUsed || 0);
    const maxContextTokens = Number(ctxWin.maxContextTokens || 0);
    const modelId = String(cm.responseModel || cm.model || '').trim() || 'unknown';
    const displayName = String(cm.modelDisplayName || modelId);
    return {
      modelId,
      displayName,
      inputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      outputTokens,
      promptTokens,
      nonThinkingOutput,
      estimatedTokensUsed,
      maxContextTokens,
    };
  };

  for (let i = list.length - 1; i >= 0; i--) {
    const parsed = readEntry(list[i]);
    if (!parsed) continue;
    if (!latestEntry) latestEntry = parsed;
    if (!fallbackMaxContext && parsed.maxContextTokens > 0) {
      fallbackMaxContext = parsed.maxContextTokens;
    }
    if (!latestUsageEntry && parsed.promptTokens > 0) {
      latestUsageEntry = parsed;
    }
    if (latestEntry && latestUsageEntry && fallbackMaxContext > 0) break;
  }

  const chosen = latestEntry?.promptTokens > 0
    ? latestEntry
    : latestEntry?.estimatedTokensUsed > 0
      ? latestEntry
      : latestUsageEntry || latestEntry;
  if (!chosen) return null;

  const maxContextTokens = chosen.maxContextTokens || fallbackMaxContext || 0;
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
    timestampMs: Date.now(),
  };
}

/**
 * Fetch current account identity (hashed + masked), real-time quota pools,
 * and active cascade trajectories via local RPC.
 */
export class QuotaClient {
  constructor(paths = null) {
    this.paths = paths;
    this.endpoint = null;
    this.lastResult = null;
    this.lastFetchedAt = 0;
    this.lastTrajectories = null;
    this.lastTrajectoriesAt = 0;
  }

  async callWithEndpointRetry(method, body = {}) {
    if (!this.endpoint) {
      this.endpoint = await discoverLanguageServer(this.paths || undefined);
    }
    try {
      return await callLocalRpc(this.endpoint, method, body);
    } catch {
      this.endpoint = await discoverLanguageServer(this.paths || undefined);
      return await callLocalRpc(this.endpoint, method, body);
    }
  }

  async fetch(force = false) {
    if (!force && this.lastResult && Date.now() - this.lastFetchedAt < 15_000) {
      return this.lastResult;
    }

    try {
      const userResp = await this.callWithEndpointRetry('GetUserStatus', {});

      const email = String(userResp?.userStatus?.email || '').trim().toLowerCase();
      const accountHash = email
        ? createHash('sha256').update(email).digest('hex').slice(0, 16)
        : '';
      const planName = String(
        userResp?.userStatus?.planStatus?.planInfo?.planName
        || userResp?.userStatus?.userTier?.name
        || ''
      ).trim();

      const quotaResp = await callLocalRpc(
        this.endpoint,
        'RetrieveUserQuotaSummary',
        force ? { forceRefresh: true } : {},
      );

      this.lastResult = {
        connected: true,
        accountHash,
        maskedEmail: maskEmail(email),
        planName,
        groups: normalizeQuotaSummary(quotaResp),
        fetchedAt: new Date().toISOString(),
        error: null,
      };
      this.lastFetchedAt = Date.now();
      return this.lastResult;
    } catch (err) {
      this.endpoint = null;
      return {
        connected: false,
        accountHash: this.lastResult?.accountHash || '',
        maskedEmail: this.lastResult?.maskedEmail || '',
        planName: this.lastResult?.planName || '',
        groups: this.lastResult?.groups || [],
        fetchedAt: this.lastResult?.fetchedAt || null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async fetchTrajectories(force = false) {
    if (!force && this.lastTrajectories && Date.now() - this.lastTrajectoriesAt < 2_500) {
      return this.lastTrajectories;
    }
    try {
      const resp = await this.callWithEndpointRetry('GetAllCascadeTrajectories', {});
      this.lastTrajectories = {
        connected: true,
        trajectories: normalizeTrajectorySummaries(resp),
        fetchedAt: Date.now(),
        error: null,
      };
      this.lastTrajectoriesAt = Date.now();
      return this.lastTrajectories;
    } catch (err) {
      return {
        connected: false,
        trajectories: this.lastTrajectories?.trajectories || [],
        fetchedAt: this.lastTrajectories?.fetchedAt || 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async fetchTrajectoryContext(cascadeId) {
    if (!cascadeId) return null;
    try {
      const resp = await this.callWithEndpointRetry('GetCascadeTrajectoryGeneratorMetadata', { cascadeId });
      return parseRpcGeneratorContext(resp);
    } catch {
      return null;
    }
  }
}
