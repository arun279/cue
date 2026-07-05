import type { LibraryShow } from "./model/library";
import { toMs } from "./time";
import { computeWatchStatus, type WatchStatus } from "./watch-status";

export type LibrarySort = "recently-watched" | "alphabetical" | "progress";

export interface LibraryBucket {
  readonly status: WatchStatus;
  readonly shows: readonly LibraryShow[];
}

/**
 * Display order for the My Shows status groups — the acceptance
 * order verbatim: Watching / Up to date / Coming soon / Ended / Stopped / To
 * watch. `not-started` (tracked but not yet started, not watchlisted) has no
 * named group in that order and trails last. A status with no shows is omitted so the
 * screen never shows an empty header.
 */
const DISPLAY_ORDER: readonly WatchStatus[] = [
  "watching",
  "up-to-date",
  "coming-soon",
  "ended",
  "stopped",
  "to-watch",
  "not-started",
];

function progressRatio(show: LibraryShow): number {
  return show.aired > 0 ? show.completed / show.aired : 0;
}

function comparatorFor(sort: LibrarySort): (a: LibraryShow, b: LibraryShow) => number {
  if (sort === "alphabetical") {
    return (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  }
  if (sort === "progress") {
    return (a, b) => progressRatio(b) - progressRatio(a);
  }
  return (a, b) => (toMs(b.lastWatchedAt) ?? 0) - (toMs(a.lastWatchedAt) ?? 0);
}

/**
 * Group the library into aired-based status buckets and sort each bucket
 * by the chosen strategy. `computeWatchStatus` already routes a hidden show to
 * `stopped` (and nowhere else), so grouping needs no extra hidden handling.
 */
export function groupLibrary(
  shows: readonly LibraryShow[],
  now: number,
  sort: LibrarySort,
): LibraryBucket[] {
  const byStatus = new Map<WatchStatus, LibraryShow[]>();
  for (const show of shows) {
    const status = computeWatchStatus(show, now);
    const list = byStatus.get(status);
    if (list === undefined) byStatus.set(status, [show]);
    else list.push(show);
  }

  const comparator = comparatorFor(sort);
  const buckets: LibraryBucket[] = [];
  for (const status of DISPLAY_ORDER) {
    const list = byStatus.get(status);
    if (list === undefined || list.length === 0) continue;
    buckets.push({ status, shows: [...list].sort(comparator) });
  }
  return buckets;
}
