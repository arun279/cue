import type { EpisodeRef, LibraryShow } from "./model/library";
import { isAired, toMs } from "./time";

export type UpNextSort = "recently-watched" | "air-date" | "alphabetical";

export interface UpNextItem {
  readonly showId: number;
  readonly title: string;
  readonly episode: EpisodeRef;
  readonly lastWatchedAt: string | null;
  readonly backlog: number;
}

/**
 * The Up Next queue: every followed show's `nextEpisode`, filtered to
 * `firstAired <= now` (aired-only — future episodes are Coming soon, not here),
 * skipping caught-up shows (`nextEpisode === null`) and hidden shows, ordered by
 * the chosen strategy.
 */
export function selectUpNext(
  shows: readonly LibraryShow[],
  now: number,
  sort: UpNextSort = "recently-watched",
): UpNextItem[] {
  const items: UpNextItem[] = [];
  for (const s of shows) {
    if (s.hidden) continue;
    const ep = s.nextEpisode;
    if (ep === null || !isAired(ep.firstAired, now)) continue;
    items.push({
      showId: s.showId,
      title: s.title,
      episode: ep,
      lastWatchedAt: s.lastWatchedAt,
      backlog: Math.max(0, s.aired - s.completed),
    });
  }
  items.sort(comparatorFor(sort));
  return items;
}

/** Global "to watch" count: aired-but-unwatched episodes across non-hidden shows. */
export function countToWatch(shows: readonly LibraryShow[]): number {
  let sum = 0;
  for (const s of shows) {
    if (!s.hidden) sum += Math.max(0, s.aired - s.completed);
  }
  return sum;
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
