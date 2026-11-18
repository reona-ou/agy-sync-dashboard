export const SLOT_MS = 15 * 60 * 1000;
export const TIMELINE_RETENTION_MS = 21 * 24 * 60 * 60 * 1000;
export const WINDOW_5H_MS = 5 * 60 * 60 * 1000;
export const WINDOW_7D_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Map a model ID or display name onto Antigravity quota pool families.
 */
export function classifyModelFamily(modelId = '', displayName = '') {
  const s = `${modelId} ${displayName}`.toLowerCase();
  if (s.includes('argon')) return 'argon';
  if (
    s.includes('claude') ||
    s.includes('opus') ||
    s.includes('sonnet') ||
    s.includes('haiku') ||
    s.includes('gpt') ||
    s.includes('openai') ||
    /\bo[134](?:-|$|\s)/.test(s)
  ) {
    return 'claude_gpt';
  }
  return 'gemini';
}

function addInto(acc, bucket, ratio = 1) {
  if (!bucket || ratio <= 0) return;
  acc.totalTokens += Math.round(Number(bucket.totalTokens || 0) * ratio);
  acc.nonCacheTokens += Math.round(Number(bucket.nonCacheTokens || 0) * ratio);
  acc.generations += ratio >= 0.5 ? Number(bucket.generations || 0) : 0;
}

function sumWindowFromTimeline(bySlot, legacyByDate, family, winStartMs, winEndMs) {
  const acc = { totalTokens: 0, nonCacheTokens: 0, generations: 0 };
  if (winEndMs <= winStartMs) return acc;

  for (const [slotKey, famMap] of Object.entries(bySlot || {})) {
    const slotIdx = Number(slotKey);
    if (!Number.isFinite(slotIdx)) continue;
    const slotStart = slotIdx * SLOT_MS;
    const slotEnd = slotStart + SLOT_MS;
    if (slotEnd <= winStartMs || slotStart >= winEndMs) continue;

    const bucket = famMap?.[family];
    if (!bucket) continue;
    const overlap = Math.min(winEndMs, slotEnd) - Math.max(winStartMs, slotStart);
    const ratio = overlap / SLOT_MS;
    addInto(acc, bucket, ratio);
  }

  // Fallback for older peer device snapshots that only provide daily buckets (no bySlot)
  for (const [dateKey, famMap] of Object.entries(legacyByDate || {})) {
    const dayStart = Date.parse(`${dateKey}T00:00:00`);
    if (!Number.isFinite(dayStart)) continue;
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    if (dayEnd <= winStartMs || dayStart >= winEndMs) continue;

    const bucket = famMap?.[family];
    if (!bucket) continue;
    const overlap = Math.min(winEndMs, dayEnd) - Math.max(winStartMs, dayStart);
    const ratio = overlap / (24 * 60 * 60 * 1000);
    addInto(acc, bucket, ratio);
  }

  return acc;
}

/**
 * Compute per-window token usage, remaining capacity estimates, and combined
 * (current + previous cycle) burn rate & runway forecasts.
 */
export function buildQuotaForecasts({ quota, merged, calibration = {}, nowMs = Date.now() }) {
  if (!quota || !Array.isArray(quota.groups) || !quota.groups.length) {
    return { quota, calibrationUpdates: {} };
  }

  const bySlot = merged?.bySlot || {};
  const legacyByDate = merged?.legacyByDate || {};
  const accountHash = quota.accountHash || 'default';
  const calibrationUpdates = {};

  const groups = quota.groups.map((grp) => {
    const family = grp.family || 'gemini';
    const windows = (grp.windows || []).map((win) => {
      const kind = win.kind === 'weekly' ? 'weekly' : '5h';
      const durationMs = kind === 'weekly' ? WINDOW_7D_MS : WINDOW_5H_MS;
      const resetMs = win.resetTime ? Date.parse(win.resetTime) : NaN;
      const hasReset = Number.isFinite(resetMs);

      const cycleEndMs = hasReset ? resetMs : nowMs;
      const cycleStartMs = cycleEndMs - durationMs;
      const currEndMs = Math.min(nowMs, cycleEndMs);
      const elapsedMs = hasReset ? Math.max(0, Math.min(durationMs, nowMs - cycleStartMs)) : durationMs;
      const timeLeftMs = hasReset ? Math.max(0, resetMs - nowMs) : null;

      const prevStartMs = cycleStartMs - durationMs;
      const prevEndMs = cycleStartMs;

      const currUsed = sumWindowFromTimeline(bySlot, legacyByDate, family, cycleStartMs, currEndMs);
      const prevUsed = sumWindowFromTimeline(bySlot, legacyByDate, family, prevStartMs, prevEndMs);

      const remFrac =
        typeof win.remainingFraction === 'number' && Number.isFinite(win.remainingFraction)
          ? Math.max(0, Math.min(1, win.remainingFraction))
          : null;
      const usedFrac = remFrac !== null ? Math.max(0, 1 - remFrac) : null;

      const calKey = `${accountHash}:${family}:${kind}`;
      const calEntry = calibration?.[calKey];

      let estimatedCapacityTokens = null;
      let estimatedRemainingTokens = null;
      let capacitySource = 'none';

      if (remFrac === 0) {
        estimatedRemainingTokens = 0;
        if (currUsed.totalTokens > 0) {
          estimatedCapacityTokens = currUsed.totalTokens;
          calibrationUpdates[calKey] = { capacityTokens: currUsed.totalTokens, updatedAt: nowMs };
        } else if (calEntry?.capacityTokens > 0) {
          estimatedCapacityTokens = calEntry.capacityTokens;
        }
        capacitySource = 'depleted';
      } else if (usedFrac !== null && usedFrac >= 0.01 && currUsed.totalTokens > 0) {
        const rawCapacity = Math.round(currUsed.totalTokens / usedFrac);
        estimatedCapacityTokens = rawCapacity;
        estimatedRemainingTokens = Math.round(rawCapacity * remFrac);
        capacitySource = usedFrac >= 0.03 ? 'live' : 'live-low-sample';
        if (usedFrac >= 0.02) {
          calibrationUpdates[calKey] = { capacityTokens: rawCapacity, updatedAt: nowMs };
        }
      } else if (calEntry?.capacityTokens > 0) {
        estimatedCapacityTokens = Number(calEntry.capacityTokens);
        if (remFrac !== null) {
          const baseRem = Math.round(estimatedCapacityTokens * remFrac);
          estimatedRemainingTokens =
            remFrac === 1 ? Math.max(0, baseRem - currUsed.totalTokens) : baseRem;
        }
        capacitySource = 'calibrated';
      }

      const minElapsedMs = kind === 'weekly' ? 30 * 60_000 : 10 * 60_000;
      const effCurrMs = Math.max(elapsedMs, minElapsedMs);
      const currTokens = currUsed.totalTokens;
      const prevTokens = prevUsed.totalTokens;

      let burnRatePerHour = 0;
      let rateSource = 'none';
      if (currTokens > 0 && prevTokens > 0) {
        burnRatePerHour = (currTokens + prevTokens) / ((effCurrMs + durationMs) / 3600_000);
        rateSource = 'curr+prev';
      } else if (currTokens > 0) {
        burnRatePerHour = currTokens / (effCurrMs / 3600_000);
        rateSource = 'curr';
      } else if (prevTokens > 0) {
        burnRatePerHour = prevTokens / (durationMs / 3600_000);
        rateSource = 'prev';
      }

      let estimatedRunwayMs = null;
      let willLastUntilReset = null;
      let status = 'insufficient-data';

      if (remFrac === 0) {
        estimatedRunwayMs = 0;
        willLastUntilReset = false;
        status = 'depleted';
      } else if (estimatedRemainingTokens !== null && burnRatePerHour > 0) {
        estimatedRunwayMs = Math.round((estimatedRemainingTokens / burnRatePerHour) * 3600_000);
        willLastUntilReset = timeLeftMs !== null ? estimatedRunwayMs >= timeLeftMs : null;
        status = willLastUntilReset === false ? 'at-risk' : 'ok';
      }

      return {
        ...win,
        forecast: {
          kind,
          family,
          windowMs: durationMs,
          cycleStartMs,
          cycleEndMs,
          currUsedTokens: currTokens,
          currNonCacheTokens: currUsed.nonCacheTokens,
          currGenerations: currUsed.generations,
          prevUsedTokens: prevTokens,
          prevNonCacheTokens: prevUsed.nonCacheTokens,
          prevGenerations: prevUsed.generations,
          estimatedCapacityTokens,
          estimatedRemainingTokens,
          capacitySource,
          burnRatePerHour: Math.round(burnRatePerHour),
          rateSource,
          estimatedRunwayMs,
          timeLeftMs,
          willLastUntilReset,
          status,
        },
      };
    });

    return {
      ...grp,
      windows,
    };
  });

  return {
    quota: {
      ...quota,
      groups,
    },
    calibrationUpdates,
  };
}
