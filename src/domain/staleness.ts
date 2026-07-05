import type { LibraryShow } from "./model/library";
import { toMs } from "./time";

export type StalenessSensitivity = "looser" | "default" | "tighter";

const PERCENTILE_FOR: Record<StalenessSensitivity, number> = {
  looser: 90,
  default: 75,
  tighter: 50,
};

/** 21 days = three weekly-release cycles; the stated provisional default. */
export const FALLBACK_STALENESS_MS = 21 * 24 * 60 * 60 * 1000;

/**
 * Five inter-watch gaps (six logged watches) is the smallest sample where the
 * 75th-percentile default is interpolated from several observations rather than
 * pinned to a lone extreme; below it the self-calibrated line is noise and we
 * fall back to the stated 21-day default instead.
 */
export const MIN_INTER_WATCH_GAPS = 5;

export interface StalenessThreshold {
  readonly thresholdMs: number;
  readonly provisional: boolean;
}

export interface StaleShow {
  readonly showId: number;
  readonly title: string;
  readonly gapMs: number;
}

/** Consecutive gaps between a user's watch timestamps (positive gaps only). */
export function interWatchGaps(watchedAtMs: readonly number[]): number[] {
  const sorted = [...watchedAtMs].sort((a, b) => a - b);
  const gaps: number[] = [];
  let prev: number | undefined;
  for (const t of sorted) {
    if (prev !== undefined) {
      const g = t - prev;
      if (g > 0) gaps.push(g);
    }
    prev = t;
  }
  return gaps;
}

/** Linear-interpolated percentile (`p` in 0..100) over `values`. */
export function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const clamped = Math.min(100, Math.max(0, p));
  const rank = (clamped / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const frac = rank - lower;
  const lo = sorted[lower];
  if (lo === undefined) return Number.NaN;
  const hi = sorted[lower + 1];
  return hi === undefined ? lo : lo + frac * (hi - lo);
}

/**
 * Self-calibrating staleness threshold: the p-th percentile of the user's
 * own inter-watch gaps (looser/default/tighter = 90th/75th/50th), or the
 * provisional 21-day fallback when history is too thin to calibrate.
 */
export function computeStalenessThreshold(
  historyWatchedAtMs: readonly number[],
  sensitivity: StalenessSensitivity = "default",
): StalenessThreshold {
  const gaps = interWatchGaps(historyWatchedAtMs);
  if (gaps.length < MIN_INTER_WATCH_GAPS) {
    return { thresholdMs: FALLBACK_STALENESS_MS, provisional: true };
  }
  return { thresholdMs: percentile(gaps, PERCENTILE_FOR[sensitivity]), provisional: false };
}

/**
 * Shows to surface as "haven't watched in a while": something to resume
 * (`nextEpisode != null`), not hidden, and idle for longer than `thresholdMs`.
 * Most-stale first.
 */
export function selectStaleShows(
  shows: readonly LibraryShow[],
  thresholdMs: number,
  now: number,
): StaleShow[] {
  const out: StaleShow[] = [];
  for (const s of shows) {
    if (s.hidden || s.nextEpisode === null) continue;
    const last = toMs(s.lastWatchedAt);
    if (last === null) continue;
    const gap = now - last;
    if (gap > thresholdMs) out.push({ showId: s.showId, title: s.title, gapMs: gap });
  }
  out.sort((a, b) => b.gapMs - a.gapMs);
  return out;
}
