import { useEffect, useState } from "react";
import {
  chipBuckets,
  type LibrarySort,
  type MovieChipKey,
  movieBuckets,
  type ShowChipKey,
  sortMovies,
  sortShows,
} from "@/core/domain/library-buckets";
import type { LibraryEntry } from "@/core/domain/model/library";
import type { MovieEntry } from "@/core/domain/model/movie";
import type { SegmentOption } from "../../ui/SegmentedControl";
import { TEST_IDS } from "../../ui/test-ids";

export type Segment = "shows" | "movies";
export type ChipKey = ShowChipKey | MovieChipKey;

export type LibraryItem =
  | { readonly kind: "show"; readonly entry: LibraryEntry }
  | { readonly kind: "movie"; readonly entry: MovieEntry };

export interface Chip {
  readonly key: ChipKey;
  readonly label: string;
  readonly count: number;
  readonly testID: string;
}

export interface LibraryView {
  readonly chips: readonly Chip[];
  items(chip: ChipKey, sort: LibrarySort): readonly LibraryItem[];
}

export interface SortOption {
  readonly id: LibrarySort;
  readonly label: string;
  readonly testID: string;
}

export const SEGMENTS: readonly SegmentOption<Segment>[] = [
  { value: "shows", label: "Shows", testID: TEST_IDS.librarySegmentShows },
  { value: "movies", label: "Movies", testID: TEST_IDS.librarySegmentMovies },
];

const NOT_STARTED = {
  key: "not-started",
  label: "Not started",
  testID: TEST_IDS.libraryChipNotStarted,
} as const;

const SHOW_CHIPS: readonly { key: ShowChipKey; label: string; testID: string }[] = [
  { key: "watching", label: "Watching", testID: TEST_IDS.libraryChipWatching },
  NOT_STARTED,
  { key: "stopped", label: "Stopped", testID: TEST_IDS.libraryChipStopped },
  { key: "finished", label: "Finished", testID: TEST_IDS.libraryChipFinished },
];

const MOVIE_CHIPS: readonly { key: MovieChipKey; label: string; testID: string }[] = [
  NOT_STARTED,
  { key: "watched", label: "Watched", testID: TEST_IDS.libraryChipWatched },
];

const SORT: Readonly<Record<LibrarySort, SortOption>> = {
  "recently-watched": {
    id: "recently-watched",
    label: "Recently watched",
    testID: TEST_IDS.sortRecentlyWatched,
  },
  "recently-added": {
    id: "recently-added",
    label: "Recently added",
    testID: TEST_IDS.sortRecentlyAdded,
  },
  alphabetical: { id: "alphabetical", label: "A-Z", testID: TEST_IDS.sortAlphabetical },
  progress: { id: "progress", label: "Progress", testID: TEST_IDS.sortProgress },
  "release-year": { id: "release-year", label: "Release year", testID: TEST_IDS.sortReleaseYear },
};

export function sortsFor(segment: Segment, chip: ChipKey): readonly [SortOption, ...SortOption[]] {
  if (chip === "not-started")
    return [SORT["recently-added"], SORT.alphabetical, SORT["release-year"]];
  if (segment === "shows") return [SORT["recently-watched"], SORT.alphabetical, SORT.progress];
  return [SORT["recently-watched"], SORT.alphabetical, SORT["release-year"]];
}

export function showChips(
  entries: readonly LibraryEntry[],
  now: number,
  thresholdMs: number,
): LibraryView {
  const buckets = chipBuckets(entries, now, thresholdMs);
  const lists: Partial<Record<ChipKey, readonly LibraryEntry[]>> = buckets;
  return {
    chips: SHOW_CHIPS.map((chip) => ({ ...chip, count: buckets[chip.key].length })),
    items: (chip, sort) => sortShows(lists[chip] ?? [], sort).map(toShowItem),
  };
}

export function movieChips(entries: readonly MovieEntry[]): LibraryView {
  const buckets = movieBuckets(entries);
  const lists: Partial<Record<ChipKey, readonly MovieEntry[]>> = buckets;
  return {
    chips: MOVIE_CHIPS.map((chip) => ({ ...chip, count: buckets[chip.key].length })),
    items: (chip, sort) => sortMovies(lists[chip] ?? [], sort).map(toMovieItem),
  };
}

const toShowItem = (entry: LibraryEntry): LibraryItem => ({ kind: "show", entry });
const toMovieItem = (entry: MovieEntry): LibraryItem => ({ kind: "movie", entry });

export function keyOf(item: LibraryItem): string {
  return item.kind === "show" ? `show-${item.entry.showId}` : `movie-${item.entry.movieId}`;
}

export const FILTER_DEBOUNCE_MS = 300;

export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}

export function matching(items: readonly LibraryItem[], query: string): readonly LibraryItem[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return items;
  return items.filter((item) => item.entry.title.toLowerCase().includes(needle));
}

export function matchesElsewhere(view: LibraryView, chip: ChipKey, query: string): readonly Chip[] {
  return view.chips
    .filter((other) => other.key !== chip)
    .map((other) => ({
      ...other,
      count: matching(view.items(other.key, "alphabetical"), query).length,
    }))
    .filter((other) => other.count > 0);
}
