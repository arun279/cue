import type { LibraryShow } from "./model/library";
import { toMs } from "./time";
import { computeWatchStatus, type WatchStatus } from "./watch-status";

export type LibrarySort = "recently-watched" | "alphabetical" | "progress";

export interface LibraryBucket {
  readonly status: WatchStatus;
  readonly shows: readonly LibraryShow[];
}

const DISPLAY_ORDER: readonly WatchStatus[] = [
  "watching",
  "lapsed",
  "not-started",
  "caught-up",
  "ended",
  "abandoned",
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

function byMostLapsed(a: LibraryShow, b: LibraryShow): number {
  return (
    (toMs(a.lastWatchedAt) ?? Number.NEGATIVE_INFINITY) -
    (toMs(b.lastWatchedAt) ?? Number.NEGATIVE_INFINITY)
  );
}

export function groupLibrary(
  shows: readonly LibraryShow[],
  now: number,
  thresholdMs: number,
  sort: LibrarySort,
): LibraryBucket[] {
  const byStatus = new Map<WatchStatus, LibraryShow[]>();
  for (const show of shows) {
    const status = computeWatchStatus(show, now, thresholdMs);
    const list = byStatus.get(status);
    if (list === undefined) byStatus.set(status, [show]);
    else list.push(show);
  }

  const comparator = comparatorFor(sort);
  const buckets: LibraryBucket[] = [];
  for (const status of DISPLAY_ORDER) {
    const list = byStatus.get(status);
    if (list === undefined || list.length === 0) continue;
    buckets.push({
      status,
      shows: [...list].sort(status === "lapsed" ? byMostLapsed : comparator),
    });
  }
  return buckets;
}
