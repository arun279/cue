import type { LibraryShow } from "./model/library";
import { toMs } from "./time";
import { computeWatchStatus, type WatchStatus } from "./watch-status";

export type LibrarySort = "recently-watched" | "alphabetical" | "progress";

type LibraryChipKey = "watching" | "watchlist" | "stopped" | "finished";

export type LibraryChips<T extends LibraryShow = LibraryShow> = Readonly<
  Record<LibraryChipKey, readonly T[]>
>;

export interface LibraryBucket {
  readonly status: WatchStatus;
  readonly shows: readonly LibraryShow[];
}

/**
 * Library shows ONE Watching segment: the "haven't watched in a while" (lapsed)
 * cut is now only Up Next's soft drawer, so here the derived `lapsed` status folds
 * back into Watching. Watchlist (not-started) leads: it is the "things you chose
 * to start" pool, presented first.
 */
const DISPLAY_ORDER: readonly WatchStatus[] = [
  "not-started",
  "watching",
  "caught-up",
  "ended",
  "abandoned",
];

/** Fold the derived `lapsed` cut into Watching for Library bucketing. */
function bucketStatus(show: LibraryShow, now: number, thresholdMs: number): WatchStatus {
  const status = computeWatchStatus(show, now, thresholdMs);
  return status === "lapsed" ? "watching" : status;
}

function progressRatio(show: LibraryShow): number {
  return show.aired > 0 ? show.completed / show.aired : 0;
}

function chipOf(entry: LibraryShow, now: number, thresholdMs: number): LibraryChipKey {
  const status = computeWatchStatus(entry, now, thresholdMs);
  switch (status) {
    case "watching":
    case "lapsed":
    case "caught-up":
      return "watching";
    case "not-started":
      return "watchlist";
    case "abandoned":
      return "stopped";
    case "ended":
      return "finished";
  }
}

export function chipBuckets<T extends LibraryShow>(
  entries: readonly T[],
  now: number,
  thresholdMs: number,
  sort: LibrarySort,
): LibraryChips<T> {
  const lists: Record<LibraryChipKey, T[]> = {
    watching: [],
    watchlist: [],
    stopped: [],
    finished: [],
  };
  for (const entry of entries) lists[chipOf(entry, now, thresholdMs)].push(entry);
  const comparator = comparatorFor(sort);
  for (const list of Object.values(lists)) list.sort(comparator);
  return lists;
}

/** Case-insensitive title order: the shared alphabetical comparator for both the
 * show-library buckets and the movie-library sorts. */
export function byTitle<T extends { title: string }>(a: T, b: T): number {
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

function comparatorFor(sort: LibrarySort): (a: LibraryShow, b: LibraryShow) => number {
  if (sort === "alphabetical") return byTitle;
  if (sort === "progress") {
    return (a, b) => progressRatio(b) - progressRatio(a);
  }
  return (a, b) => (toMs(b.lastWatchedAt) ?? 0) - (toMs(a.lastWatchedAt) ?? 0);
}

export function groupLibrary(
  shows: readonly LibraryShow[],
  now: number,
  thresholdMs: number,
  sort: LibrarySort,
): LibraryBucket[] {
  const byStatus = new Map<WatchStatus, LibraryShow[]>();
  for (const show of shows) {
    const status = bucketStatus(show, now, thresholdMs);
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
