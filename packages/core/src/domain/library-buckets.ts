import type { LibraryShow } from "./model/library";
import { toMs } from "./time";
import { computeWatchStatus } from "./watch-status";

export type LibrarySort = "recently-watched" | "alphabetical" | "progress";
export type MovieSort = "recently-watched" | "alphabetical" | "release-year";

type LibraryChipKey = "watching" | "watchlist" | "stopped" | "finished";

export type LibraryChips<T extends LibraryShow = LibraryShow> = Readonly<
  Record<LibraryChipKey, readonly T[]>
>;

interface MovieLibraryItem {
  readonly title: string;
  readonly year: number | null;
  readonly watched: boolean;
  readonly watchedAt: string | null;
  readonly inWatchlist: boolean;
  readonly listedAt: string | null;
}

export interface MovieSegment<T extends MovieLibraryItem = MovieLibraryItem> {
  readonly key: "watchlist" | "watched";
  readonly label: string;
  readonly entries: readonly T[];
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
function byTitle<T extends { title: string }>(a: T, b: T): number {
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

function byWatchedAt<T extends MovieLibraryItem>(a: T, b: T): number {
  return (b.watchedAt ?? "").localeCompare(a.watchedAt ?? "") || byTitle(a, b);
}

function byYear<T extends MovieLibraryItem>(a: T, b: T): number {
  return (b.year ?? 0) - (a.year ?? 0) || byTitle(a, b);
}

function byListedAt<T extends MovieLibraryItem>(a: T, b: T): number {
  return (b.listedAt ?? "").localeCompare(a.listedAt ?? "") || byTitle(a, b);
}

function movieComparator<T extends MovieLibraryItem>(sort: MovieSort): (a: T, b: T) => number {
  if (sort === "alphabetical") return byTitle;
  if (sort === "release-year") return byYear;
  return byWatchedAt;
}

function movieWatchlistComparator<T extends MovieLibraryItem>(
  sort: MovieSort,
): (a: T, b: T) => number {
  if (sort === "alphabetical") return byTitle;
  if (sort === "release-year") return byYear;
  return byListedAt;
}

export function groupMovieLibrary<T extends MovieLibraryItem>(
  entries: readonly T[],
  sort: MovieSort,
): MovieSegment<T>[] {
  const watched = entries.filter((entry) => entry.watched).sort(movieComparator(sort));
  const watchlist = entries
    .filter((entry) => entry.inWatchlist && !entry.watched)
    .sort(movieWatchlistComparator(sort));
  const segments: MovieSegment<T>[] = [
    { key: "watchlist", label: "Watchlist", entries: watchlist },
    { key: "watched", label: "Watched", entries: watched },
  ];
  return segments.filter((segment) => segment.entries.length > 0);
}

function comparatorFor(sort: LibrarySort): (a: LibraryShow, b: LibraryShow) => number {
  if (sort === "alphabetical") return byTitle;
  if (sort === "progress") {
    return (a, b) => progressRatio(b) - progressRatio(a);
  }
  return (a, b) => (toMs(b.lastWatchedAt) ?? 0) - (toMs(a.lastWatchedAt) ?? 0);
}
