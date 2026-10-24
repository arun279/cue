import type { LibraryShow } from "./model/library";
import { toMs } from "./time";
import { computeWatchStatus } from "./watch-status";

export type LibrarySort =
  | "recently-watched"
  | "recently-added"
  | "alphabetical"
  | "release-year"
  | "progress";

export type ShowChipKey = "watching" | "not-started" | "stopped" | "finished";
export type MovieChipKey = "not-started" | "watched";

export type LibraryChips<T extends LibraryShow = LibraryShow> = Readonly<
  Record<ShowChipKey, readonly T[]>
>;

interface MovieLibraryItem {
  readonly title: string;
  readonly year: number | null;
  readonly watched: boolean;
  readonly watchedAt: string | null;
  readonly addedAt: string | null;
}

function chipOf(entry: LibraryShow, now: number, thresholdMs: number): ShowChipKey {
  const status = computeWatchStatus(entry, now, thresholdMs);
  switch (status) {
    case "watching":
    case "lapsed":
    case "caught-up":
      return "watching";
    case "not-started":
      return "not-started";
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
): LibraryChips<T> {
  const lists: Record<ShowChipKey, T[]> = {
    watching: [],
    "not-started": [],
    stopped: [],
    finished: [],
  };
  for (const entry of entries) lists[chipOf(entry, now, thresholdMs)].push(entry);
  return lists;
}

export function movieBuckets<T extends MovieLibraryItem>(
  entries: readonly T[],
): Readonly<Record<MovieChipKey, readonly T[]>> {
  return {
    "not-started": entries.filter((entry) => !entry.watched),
    watched: entries.filter((entry) => entry.watched),
  };
}

type Comparator<T> = (a: T, b: T) => number;

interface Sortable {
  readonly title: string;
  readonly year: number | null;
  readonly addedAt: string | null;
}

const newestFirst = (a: string | null, b: string | null): number => (toMs(b) ?? 0) - (toMs(a) ?? 0);

function byTitle(a: Sortable, b: Sortable): number {
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

function shared<T extends Sortable>(sort: LibrarySort): Comparator<T> | null {
  if (sort === "alphabetical") return byTitle;
  if (sort === "release-year") return (a, b) => (b.year ?? 0) - (a.year ?? 0) || byTitle(a, b);
  if (sort === "recently-added")
    return (a, b) => newestFirst(a.addedAt, b.addedAt) || byTitle(a, b);
  return null;
}

function progressRatio(show: LibraryShow): number {
  return show.aired > 0 ? show.completed / show.aired : 0;
}

function showComparator<T extends LibraryShow>(sort: LibrarySort): Comparator<T> {
  if (sort === "progress") return (a, b) => progressRatio(b) - progressRatio(a);
  return shared<T>(sort) ?? ((a, b) => newestFirst(a.lastWatchedAt, b.lastWatchedAt));
}

function movieComparator<T extends MovieLibraryItem>(sort: LibrarySort): Comparator<T> {
  return shared<T>(sort) ?? ((a, b) => newestFirst(a.watchedAt, b.watchedAt) || byTitle(a, b));
}

export function sortShows<T extends LibraryShow>(entries: readonly T[], sort: LibrarySort): T[] {
  return [...entries].sort(showComparator<T>(sort));
}

export function sortMovies<T extends MovieLibraryItem>(
  entries: readonly T[],
  sort: LibrarySort,
): T[] {
  return [...entries].sort(movieComparator<T>(sort));
}
