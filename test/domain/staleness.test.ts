import {
  computeStalenessThreshold,
  FALLBACK_STALENESS_MS,
  interWatchGaps,
  MIN_INTER_WATCH_GAPS,
  percentile,
  selectStaleShows,
} from "@domain/staleness";
import { describe, expect, it } from "vitest";
import { DAY, iso, makeEpisode, makeShow, NOW } from "./_helpers";

describe("interWatchGaps", () => {
  it("sorts, diffs consecutive timestamps, and drops non-positive gaps", () => {
    expect(interWatchGaps([30, 10, 20, 20])).toEqual([10, 10]);
  });
  it("returns empty for fewer than two timestamps", () => {
    expect(interWatchGaps([5])).toEqual([]);
  });
});

describe("percentile (linear interpolation)", () => {
  it("interpolates between ranks", () => {
    expect(percentile([10, 20, 30, 40], 75)).toBe(32.5);
  });
  it("handles the extremes and a single value", () => {
    expect(percentile([10, 20, 30, 40], 0)).toBe(10);
    expect(percentile([10, 20, 30, 40], 100)).toBe(40);
    expect(percentile([7], 50)).toBe(7);
  });
  it("clamps out-of-range p and returns NaN when empty", () => {
    expect(percentile([1, 2, 3], 150)).toBe(3);
    expect(Number.isNaN(percentile([], 50))).toBe(true);
  });
});

describe("computeStalenessThreshold", () => {
  const gaps = Array.from({ length: MIN_INTER_WATCH_GAPS }, (_unused, i) => (i + 1) * DAY);
  // MIN gaps needs MIN+1 timestamps; build a rising series with those gaps.
  const timestamps: number[] = [0];
  for (const g of gaps) timestamps.push((timestamps.at(-1) ?? 0) + g);

  it("falls back to a provisional 21-day default when history is too thin", () => {
    expect(computeStalenessThreshold([1, 2, 3])).toEqual({
      thresholdMs: FALLBACK_STALENESS_MS,
      provisional: true,
    });
  });

  it("self-calibrates from the user's own gaps at the default 75th percentile", () => {
    const result = computeStalenessThreshold(timestamps, "default");
    expect(result.provisional).toBe(false);
    expect(result.thresholdMs).toBe(percentile(gaps, 75));
  });

  it("looser/tighter select higher/lower percentiles", () => {
    const looser = computeStalenessThreshold(timestamps, "looser").thresholdMs;
    const tighter = computeStalenessThreshold(timestamps, "tighter").thresholdMs;
    expect(looser).toBeGreaterThan(tighter);
    expect(looser).toBe(percentile(gaps, 90));
    expect(tighter).toBe(percentile(gaps, 50));
  });
});

describe("selectStaleShows", () => {
  const threshold = 14 * DAY;
  it("surfaces resumable shows idle beyond the threshold, most-stale first", () => {
    const shows = [
      makeShow({ showId: 1, lastWatchedAt: iso(NOW - 30 * DAY), nextEpisode: makeEpisode() }),
      makeShow({ showId: 2, lastWatchedAt: iso(NOW - 20 * DAY), nextEpisode: makeEpisode() }),
      makeShow({ showId: 3, lastWatchedAt: iso(NOW - 2 * DAY), nextEpisode: makeEpisode() }),
    ];
    expect(selectStaleShows(shows, threshold, NOW).map((s) => s.showId)).toEqual([1, 2]);
  });

  it("excludes hidden, caught-up (no next episode), and never-watched shows", () => {
    const shows = [
      makeShow({ showId: 1, hidden: true, lastWatchedAt: iso(NOW - 30 * DAY) }),
      makeShow({ showId: 2, nextEpisode: null, lastWatchedAt: iso(NOW - 30 * DAY) }),
      makeShow({ showId: 3, lastWatchedAt: null, nextEpisode: makeEpisode() }),
    ];
    expect(selectStaleShows(shows, threshold, NOW)).toHaveLength(0);
  });
});
