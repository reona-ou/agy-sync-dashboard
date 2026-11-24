export const MINUTE_MS = 60 * 1000;
export const SLOT_MS = 15 * 60 * 1000;
export const TIMELINE_RETENTION_MS = 28 * 24 * 60 * 60 * 1000;
export const WINDOW_5H_MS = 5 * 60 * 60 * 1000;
export const WINDOW_7D_MS = 7 * 24 * 60 * 60 * 1000;

const CYCLE_JITTER_TOL_MS = 10 * 60_000;
const CYCLE_DRIFT_WRITE_MS = 60_000;
const FLOATING_IDLE_TOL_MS = 5 * 60_000;
const MAX_STORED_CYCLES = 12;

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
  acc.inputTokens += Math.round(Number(bucket.inputTokens || 0) * ratio);
  acc.cacheReadTokens += Math.round(Number(bucket.cacheReadTokens || 0) * ratio);
  acc.generations += ratio >= 0.5 ? Number(bucket.generations || 0) : 0;
}

function sumBucketMap(acc, bucketMap, unitMs, family, winStartMs, winEndMs) {
  for (const [key, famMap] of Object.entries(bucketMap || {})) {
    const idx = Number(key);
    if (!Number.isFinite(idx)) continue;
    const unitStart = idx * unitMs;
    const unitEnd = unitStart + unitMs;
    if (unitEnd <= winStartMs || unitStart >= winEndMs) continue;

    const bucket = famMap?.[family];
    if (!bucket) continue;
    const overlap = Math.min(winEndMs, unitEnd) - Math.max(winStartMs, unitStart);
    const ratio = overlap / unitMs;
    addInto(acc, bucket, ratio);
  }
}

function sumWindowFromTimeline(timeline, family, winStartMs, winEndMs) {
  const acc = { totalTokens: 0, nonCacheTokens: 0, inputTokens: 0, cacheReadTokens: 0, generations: 0 };
  if (winEndMs <= winStartMs) return acc;

  sumBucketMap(acc, timeline.byMinute, MINUTE_MS, family, winStartMs, winEndMs);
  sumBucketMap(acc, timeline.slotSource, SLOT_MS, family, winStartMs, winEndMs);

  // Fallback for older peer device snapshots that only provide daily buckets (no bySlot/byMinute)
  for (const [dateKey, famMap] of Object.entries(timeline.legacyByDate || {})) {
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

export function normalizeStoredCycles(rawCycles) {
  if (!Array.isArray(rawCycles)) return [];
  const valid = [];
  for (const c of rawCycles) {
    const startMs = Number(c?.startMs);
    const endMs = Number(c?.endMs);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      valid.push({ startMs, endMs });
    }
  }
  valid.sort((a, b) => (a.startMs !== b.startMs ? a.startMs - b.startMs : a.endMs - b.endMs));

  // Clamp any tracked cycle whose end was interrupted by a strictly later cycle's start.
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const earlier = valid[i];
      const later = valid[j];
      if (
        later.startMs > earlier.startMs + CYCLE_JITTER_TOL_MS &&
        earlier.endMs > later.startMs + CYCLE_JITTER_TOL_MS
      ) {
        earlier.endMs = Math.min(earlier.endMs, later.startMs);
      }
    }
  }

  valid.sort((a, b) => a.endMs - b.endMs);
  const deduped = [];
  for (const c of valid) {
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(c.endMs - prev.endMs) <= CYCLE_JITTER_TOL_MS) {
      deduped[deduped.length - 1] = c;
    } else {
      deduped.push(c);
    }
  }
  return deduped;
}

/**
 * Merge multiple calibration maps (local + peer devices) commutatively.
 */
export function mergeCalibrationMaps(...maps) {
  const merged = {};
  for (const calMap of maps) {
    if (!calMap || typeof calMap !== 'object') continue;
    for (const [key, entry] of Object.entries(calMap)) {
      if (!entry || typeof entry !== 'object') continue;
      if (!merged[key]) {
        merged[key] = { cycles: [] };
      }
      const dst = merged[key];
      const cap = Number(entry.capacityTokens || 0);
      const upd = Number(entry.updatedAt || 0);
      if (cap > 0 && (upd >= Number(dst.updatedAt || 0) || !dst.capacityTokens)) {
        dst.capacityTokens = cap;
        if (upd > 0) dst.updatedAt = upd;
      }
      if (Array.isArray(entry.cycles) && entry.cycles.length > 0) {
        dst.cycles = normalizeStoredCycles([...dst.cycles, ...entry.cycles]).slice(-MAX_STORED_CYCLES);
      }
    }
  }
  return merged;
}

function recordObservedCycle(calCycles, startMs, endMs, durationMs, nowMs) {
  const next = calCycles.map((c) => ({ ...c }));
  let dirty = false;

  const idx = next.findIndex((c) => Math.abs(c.endMs - endMs) <= CYCLE_JITTER_TOL_MS);
  if (idx >= 0) {
    const existing = next[idx];
    if (
      Math.abs(existing.endMs - endMs) > CYCLE_DRIFT_WRITE_MS ||
      Math.abs(existing.startMs - startMs) > CYCLE_DRIFT_WRITE_MS
    ) {
      next[idx] = { startMs, endMs };
      dirty = true;
    }
  } else {
    // If an earlier tracked cycle was interrupted by a non-regular/early reset, clamp its endMs to startMs.
    for (let i = 0; i < next.length; i++) {
      const prev = next[i];
      if (prev.startMs < startMs && prev.endMs > startMs + CYCLE_JITTER_TOL_MS && endMs > prev.endMs + CYCLE_JITTER_TOL_MS) {
        next[i] = { startMs: prev.startMs, endMs: startMs };
        dirty = true;
      }
    }
    next.push({ startMs, endMs });
    dirty = true;
  }

  const normalized = normalizeStoredCycles(next);
  const cutoffMs = nowMs - TIMELINE_RETENTION_MS - durationMs;
  const pruned = normalized.filter((c) => c.endMs >= cutoffMs).slice(-MAX_STORED_CYCLES);
  if (pruned.length !== next.length) {
    dirty = true;
  }
  return { cycles: pruned, dirty };
}

function hasUsageInBucketMap(bucketMap, unitMs, family, afterMs, beforeMs) {
  for (const [key, famMap] of Object.entries(bucketMap || {})) {
    const idx = Number(key);
    if (!Number.isFinite(idx)) continue;
    const unitStart = idx * unitMs;
    const unitEnd = unitStart + unitMs;
    if (unitStart < afterMs || unitEnd > beforeMs) continue;
    if (Number(famMap?.[family]?.totalTokens || 0) > 0) return true;
  }
  return false;
}

function hasIntermediateSlotUsage(timeline, family, afterMs, beforeMs) {
  return (
    hasUsageInBucketMap(timeline.byMinute, MINUTE_MS, family, afterMs, beforeMs) ||
    hasUsageInBucketMap(timeline.slotSource, SLOT_MS, family, afterMs, beforeMs)
  );
}

function pushBucketIntervals(out, bucketMap, unitMs, family, minStartMs, cycleStartMs) {
  for (const [key, famMap] of Object.entries(bucketMap || {})) {
    const idx = Number(key);
    if (!Number.isFinite(idx)) continue;
    if (Number(famMap?.[family]?.totalTokens || 0) <= 0) continue;
    const start = idx * unitMs;
    const end = start + unitMs;
    if (start < minStartMs || end > cycleStartMs) continue;
    out.push({ start, end });
  }
}

function collectPreCycleSlots(timeline, family, minStartMs, cycleStartMs) {
  const raw = [];
  pushBucketIntervals(raw, timeline.byMinute, MINUTE_MS, family, minStartMs, cycleStartMs);
  pushBucketIntervals(raw, timeline.slotSource, SLOT_MS, family, minStartMs, cycleStartMs);
  if (!raw.length) return [];

  raw.sort((a, b) => (a.start !== b.start ? a.start - b.start : a.end - b.end));
  const merged = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = raw[i];
    if (curr.start <= prev.end) {
      prev.end = Math.max(prev.end, curr.end);
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

function reconstructPrevCycleFromSlots(activeSlots, cycleStartMs, durationMs, hasCleanAnchorAtZero = false) {
  if (!activeSlots.length) return null;

  let anchorIdx = hasCleanAnchorAtZero ? 0 : -1;
  for (let i = activeSlots.length - 1; i >= 1; i--) {
    if (activeSlots[i].start - activeSlots[i - 1].end >= durationMs) {
      anchorIdx = i;
      break;
    }
  }

  if (anchorIdx !== -1) {
    let simStart = activeSlots[anchorIdx].start;
    let simEnd = simStart + durationMs;
    for (let j = anchorIdx + 1; j < activeSlots.length; j++) {
      const s = activeSlots[j];
      if (s.start >= simEnd) {
        if (cycleStartMs - simEnd <= CYCLE_JITTER_TOL_MS) {
          simEnd = cycleStartMs;
          simStart = simEnd - durationMs;
          break;
        }
        simStart = s.start;
        simEnd = Math.min(s.start + durationMs, cycleStartMs);
      }
    }
    if (simEnd > cycleStartMs) {
      if (simEnd - cycleStartMs <= CYCLE_JITTER_TOL_MS) {
        simEnd = cycleStartMs;
        simStart = simEnd - durationMs;
      } else {
        simEnd = cycleStartMs;
      }
    }
    return { startMs: simStart, endMs: simEnd, source: 'timeline' };
  }

  const lastSlot = activeSlots[activeSlots.length - 1];
  if (cycleStartMs - lastSlot.end > CYCLE_JITTER_TOL_MS) {
    return {
      startMs: lastSlot.end - durationMs,
      endMs: lastSlot.end,
      source: 'timeline',
    };
  }

  return {
    startMs: cycleStartMs - durationMs,
    endMs: cycleStartMs,
    source: 'adjacent',
  };
}

function resolvePreviousCycleWindow({
  calCycles,
  timeline,
  family,
  cycleStartMs,
  cycleEndMs,
  isLockedCurrent,
  durationMs,
}) {
  let latestPrev = null;
  for (let i = calCycles.length - 1; i >= 0; i--) {
    const c = calCycles[i];
    if (isLockedCurrent && Math.abs(c.endMs - cycleEndMs) <= CYCLE_JITTER_TOL_MS) continue;
    if (c.endMs <= cycleStartMs + CYCLE_JITTER_TOL_MS) {
      latestPrev = c;
      break;
    }
  }

  let searchMinMs = -Infinity;
  if (latestPrev) {
    const gapMs = cycleStartMs - latestPrev.endMs;
    const isStale = gapMs >= durationMs && hasIntermediateSlotUsage(timeline, family, latestPrev.endMs, cycleStartMs);
    if (!isStale) {
      const clampedEnd = Math.min(latestPrev.endMs, cycleStartMs);
      const clampedStart = Math.min(latestPrev.startMs, clampedEnd);
      return {
        startMs: clampedStart,
        endMs: clampedEnd,
        source: 'recorded',
      };
    }
    searchMinMs = latestPrev.endMs;
  }

  const preSlots = collectPreCycleSlots(timeline, family, searchMinMs, cycleStartMs);
  const reconstructed = reconstructPrevCycleFromSlots(
    preSlots,
    cycleStartMs,
    durationMs,
    Number.isFinite(searchMinMs)
  );
  if (reconstructed) return reconstructed;

  return {
    startMs: cycleStartMs - durationMs,
    endMs: cycleStartMs,
    source: 'adjacent',
  };
}

/**
 * Compute per-window token usage, remaining capacity estimates, and combined
 * (current + previous cycle) burn rate & runway forecasts.
 */
export function buildQuotaForecasts({ quota, merged, calibration = {}, idleProbes = null, nowMs = Date.now() }) {
  if (!quota || !Array.isArray(quota.groups) || !quota.groups.length) {
    return { quota, calibrationUpdates: {} };
  }

  const timeline = {
    byMinute: merged?.byMinute || {},
    slotSource: merged?.fallbackBySlot ?? merged?.bySlot ?? {},
    legacyByDate: merged?.legacyByDate || {},
  };
  const accountHash = quota.accountHash || 'default';
  const calibrationUpdates = {};

  const groups = quota.groups.map((grp) => {
    const family = grp.family || 'gemini';
    const windows = (grp.windows || []).map((win) => {
      const kind = win.kind === 'weekly' ? 'weekly' : '5h';
      const winMinutes = Number(win.windowMinutes);
      const durationMs =
        Number.isFinite(winMinutes) && winMinutes > 0
          ? winMinutes * 60_000
          : kind === 'weekly'
            ? WINDOW_7D_MS
            : WINDOW_5H_MS;
      const resetMs = win.resetTime ? Date.parse(win.resetTime) : NaN;
      const hasReset = Number.isFinite(resetMs);

      const remFrac =
        typeof win.remainingFraction === 'number' && Number.isFinite(win.remainingFraction)
          ? Math.max(0, Math.min(1, win.remainingFraction))
          : null;
      const usedFrac = remFrac !== null ? Math.max(0, 1 - remFrac) : null;

      const rawCycleEndMs = hasReset ? resetMs : nowMs;
      const rawCycleStartMs = rawCycleEndMs - durationMs;
      const rawCurrEndMs = Math.min(nowMs, rawCycleEndMs);
      const rawCurrUsed = sumWindowFromTimeline(timeline, family, rawCycleStartMs, rawCurrEndMs);

      const calKey = `${accountHash}:${family}:${kind}`;
      const prevProbe = idleProbes instanceof Map ? idleProbes.get(calKey) : null;
      const resetSlidForward =
        Boolean(prevProbe) &&
        hasReset &&
        resetMs - prevProbe.resetMs >= 15_000;

      const isFloatingIdle =
        hasReset &&
        remFrac === 1 &&
        rawCurrUsed.totalTokens === 0 &&
        (resetMs >= nowMs + durationMs - FLOATING_IDLE_TOL_MS || resetSlidForward);

      if (idleProbes instanceof Map) {
        if (hasReset && remFrac === 1 && rawCurrUsed.totalTokens === 0) {
          idleProbes.set(calKey, { resetMs, observedAtMs: nowMs });
        } else {
          idleProbes.delete(calKey);
        }
      }

      const isLockedCurrent = hasReset && !isFloatingIdle;

      const cycleEndMs = rawCycleEndMs;
      const cycleStartMs = isFloatingIdle ? nowMs : rawCycleStartMs;
      const elapsedMs = isFloatingIdle
        ? 0
        : hasReset
          ? Math.max(0, Math.min(durationMs, nowMs - cycleStartMs))
          : durationMs;
      const timeLeftMs = hasReset ? Math.max(0, resetMs - nowMs) : null;
      const currUsed = isFloatingIdle
        ? { totalTokens: 0, nonCacheTokens: 0, inputTokens: 0, cacheReadTokens: 0, generations: 0 }
        : rawCurrUsed;

      const calEntry = calibration?.[calKey];
      let calCycles = normalizeStoredCycles(calEntry?.cycles);
      let nextCalEntry = calEntry && typeof calEntry === 'object' ? { ...calEntry } : {};
      let calDirty = false;

      if (isLockedCurrent) {
        const recorded = recordObservedCycle(calCycles, cycleStartMs, cycleEndMs, durationMs, nowMs);
        calCycles = recorded.cycles;
        if (recorded.dirty) {
          nextCalEntry.cycles = calCycles;
          calDirty = true;
        }
      }

      const prevWindow = resolvePreviousCycleWindow({
        calCycles,
        timeline,
        family,
        cycleStartMs,
        cycleEndMs,
        isLockedCurrent,
        durationMs,
      });
      const prevStartMs = prevWindow.startMs;
      const prevEndMs = prevWindow.endMs;
      const prevUsed = sumWindowFromTimeline(timeline, family, prevStartMs, prevEndMs);

      let estimatedCapacityTokens = null;
      let estimatedRemainingTokens = null;
      let capacitySource = 'none';

      if (remFrac === 0) {
        estimatedRemainingTokens = 0;
        if (currUsed.totalTokens > 0) {
          estimatedCapacityTokens = currUsed.totalTokens;
          nextCalEntry.capacityTokens = currUsed.totalTokens;
          nextCalEntry.updatedAt = nowMs;
          calDirty = true;
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
          nextCalEntry.capacityTokens = rawCapacity;
          nextCalEntry.updatedAt = nowMs;
          calDirty = true;
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

      if (calDirty) {
        calibrationUpdates[calKey] = nextCalEntry;
      }

      const minElapsedMs = kind === 'weekly' ? 30 * 60_000 : 10 * 60_000;
      const effCurrMs = Math.max(elapsedMs, minElapsedMs);
      const effPrevMs = Math.max(minElapsedMs, Math.min(durationMs, prevEndMs - prevStartMs));
      const currTokens = currUsed.totalTokens;
      const prevTokens = prevUsed.totalTokens;

      let burnRatePerHour = 0;
      let rateSource = 'none';
      if (currTokens > 0 && prevTokens > 0) {
        burnRatePerHour = (currTokens + prevTokens) / ((effCurrMs + effPrevMs) / 3600_000);
        rateSource = 'curr+prev';
      } else if (currTokens > 0) {
        burnRatePerHour = currTokens / (effCurrMs / 3600_000);
        rateSource = 'curr';
      } else if (prevTokens > 0) {
        burnRatePerHour = prevTokens / (effPrevMs / 3600_000);
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

      const currCacheDenom = currUsed.inputTokens + currUsed.cacheReadTokens;
      const currCacheHitRate =
        currCacheDenom > 0 ? Number((currUsed.cacheReadTokens / currCacheDenom).toFixed(4)) : null;
      const prevCacheDenom = prevUsed.inputTokens + prevUsed.cacheReadTokens;
      const prevCacheHitRate =
        prevCacheDenom > 0 ? Number((prevUsed.cacheReadTokens / prevCacheDenom).toFixed(4)) : null;

      return {
        ...win,
        forecast: {
          kind,
          family,
          windowMs: durationMs,
          cycleStartMs,
          cycleEndMs,
          cycleActive: !isFloatingIdle,
          prevCycleStartMs: prevStartMs,
          prevCycleEndMs: prevEndMs,
          prevCycleSource: prevWindow.source,
          currUsedTokens: currTokens,
          currNonCacheTokens: currUsed.nonCacheTokens,
          currInputTokens: currUsed.inputTokens,
          currCacheReadTokens: currUsed.cacheReadTokens,
          currCacheHitRate,
          currGenerations: currUsed.generations,
          prevUsedTokens: prevTokens,
          prevNonCacheTokens: prevUsed.nonCacheTokens,
          prevInputTokens: prevUsed.inputTokens,
          prevCacheReadTokens: prevUsed.cacheReadTokens,
          prevCacheHitRate,
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
