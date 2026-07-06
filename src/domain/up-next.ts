import type { EpisodeRef, LibraryShow } from "./model/library";
import { toMs } from "./time";
import { computeWatchStatus } from "./watch-status";

export type UpNextSort = "recently-watched" | "air-date" | "alphabetical";

export interface UpNextItem {
  readonly showId: number;
  readonly title: string;
  readonly episode: EpisodeRef;
  readonly lastWatchedAt: string | null;
  readonly backlog: number;
}

export function selectUpNext(
  shows: readonly LibraryShow[],
  now: number,
  thresholdMs: number,
  sort: UpNextSort = "recently-watched",
): UpNextItem[] {
  const items = shows
    .filter((s) => computeWatchStatus(s, now, thresholdMs) === "watching")
    .flatMap((s): UpNextItem[] => {
      const ep = s.nextEpisode;
      // `watching` guarantees this is non-null and aired; this only narrows TS.
      if (ep === null) return [];
      return [
        {
          showId: s.showId,
          title: s.title,
          episode: ep,
          lastWatchedAt: s.lastWatchedAt,
          backlog: Math.max(0, s.aired - s.completed),
        },
      ];
    });
  items.sort(comparatorFor(sort));
  return items;
}

function comparatorFor(sort: UpNextSort): (a: UpNextItem, b: UpNextItem) => number {
  switch (sort) {
    case "air-date":
      return byAirDate;
    case "alphabetical":
      return byTitle;
    default:
      return byRecentlyWatched;
  }
}

function airMs(item: UpNextItem): number {
  return toMs(item.episode.firstAired) ?? Number.POSITIVE_INFINITY;
}

function watchedMs(item: UpNextItem): number {
  return toMs(item.lastWatchedAt) ?? Number.NEGATIVE_INFINITY;
}

function byAirDate(a: UpNextItem, b: UpNextItem): number {
  const x = airMs(a);
  const y = airMs(b);
  return x === y ? 0 : x - y;
}

function byTitle(a: UpNextItem, b: UpNextItem): number {
  const c = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  return c !== 0 ? c : byAirDate(a, b);
}

function byRecentlyWatched(a: UpNextItem, b: UpNextItem): number {
  const wa = watchedMs(a);
  const wb = watchedMs(b);
  return wa === wb ? byAirDate(a, b) : wb - wa;
}
