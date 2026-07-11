import type { EpisodeRef, LibraryShow } from "@domain/model/library";
import type { DispatchResult } from "@domain/write-queue/types";

export const DAY = 24 * 60 * 60 * 1000;
/** Fixed "now" so aired/unaired fixtures are deterministic: 2026-07-05 UTC. */
export const NOW = Date.UTC(2026, 6, 5);

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function makeEpisode(overrides: Partial<EpisodeRef> = {}): EpisodeRef {
  return {
    season: 1,
    number: 1,
    title: "Pilot",
    firstAired: iso(NOW - DAY),
    ids: { trakt: 900 },
    ...overrides,
  };
}

export function makeShow(overrides: Partial<LibraryShow> = {}): LibraryShow {
  return {
    showId: 1,
    title: "Show",
    status: "returning series",
    hidden: false,
    inWatchlist: false,
    lastWatchedAt: iso(NOW - DAY),
    aired: 10,
    completed: 5,
    nextEpisode: makeEpisode(),
    progressKnown: true,
    ...overrides,
  };
}

export const THRESHOLD = 21 * DAY;
export const airedNext = makeEpisode({ firstAired: iso(NOW - DAY) });
export const futureNext = makeEpisode({ firstAired: iso(NOW + DAY) });

export function dispatchResult(
  status: number,
  headers: Record<string, string> = {},
): DispatchResult {
  return { status, headers, data: null };
}

/** A clock whose `sleep` advances time: deterministic pacing without real timers. */
export function fakeClock(start = 0): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
} {
  let t = start;
  return {
    now: () => t,
    sleep: (ms: number) => {
      t += ms;
      return Promise.resolve();
    },
  };
}
