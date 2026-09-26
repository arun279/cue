import type { LibraryEntry } from "@cue/core/data/trakt/library";
import type { MovieEntry } from "@cue/core/data/trakt/movie-library";
import {
  chipBuckets,
  groupMovieLibrary,
  type LibrarySort,
  type MovieSort,
} from "@cue/core/domain/library-buckets";
import { useEffect, useState } from "react";
import { TEST_IDS } from "../../ui/test-ids";

export type Segment = "shows" | "movies";
type ShowChip = "watching" | "watchlist" | "stopped" | "finished";
export type MovieChip = "watchlist" | "watched";
export type ChipKey = ShowChip | MovieChip;

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
  /** Partial because a segment holds only its own chips, and the screen reads
   * whichever one the rail has selected. */
  readonly items: Readonly<Partial<Record<ChipKey, readonly LibraryItem[]>>>;
}

export interface SortOption<T> {
  readonly id: T;
  readonly label: string;
  readonly testID: string;
}

/** The rail's order, which is the order the web app reads in. */
const SHOW_CHIPS: readonly { key: ShowChip; label: string; testID: string }[] = [
  { key: "watching", label: "Watching", testID: TEST_IDS.libraryChipWatching },
  { key: "watchlist", label: "Watchlist", testID: TEST_IDS.libraryChipWatchlist },
  { key: "stopped", label: "Stopped", testID: TEST_IDS.libraryChipStopped },
  { key: "finished", label: "Finished", testID: TEST_IDS.libraryChipFinished },
];

const MOVIE_CHIPS: readonly { key: MovieChip; label: string; testID: string }[] = [
  { key: "watchlist", label: "Watchlist", testID: TEST_IDS.libraryChipWatchlist },
  { key: "watched", label: "Watched", testID: TEST_IDS.libraryChipWatched },
];

export const SHOW_SORTS: readonly SortOption<LibrarySort>[] = [
  { id: "recently-watched", label: "Recently watched", testID: TEST_IDS.sortRecentlyWatched },
  { id: "alphabetical", label: "A-Z", testID: TEST_IDS.sortAlphabetical },
  { id: "progress", label: "Progress", testID: TEST_IDS.sortProgress },
];

/**
 * Medium-honest: a film has no progress, and the recency a watchlist is ordered
 * by is when it was added rather than when it was watched.
 */
export function movieSorts(chip: MovieChip): readonly SortOption<MovieSort>[] {
  return [
    {
      id: "recently-watched",
      label: chip === "watchlist" ? "Recently added" : "Recently watched",
      testID: TEST_IDS.sortRecentlyWatched,
    },
    { id: "alphabetical", label: "A-Z", testID: TEST_IDS.sortAlphabetical },
    { id: "release-year", label: "Release year", testID: TEST_IDS.sortReleaseYear },
  ];
}

export function showChips(
  entries: readonly LibraryEntry[],
  now: number,
  thresholdMs: number,
  sort: LibrarySort,
): LibraryView {
  const buckets = chipBuckets(entries, now, thresholdMs, sort);
  return {
    chips: SHOW_CHIPS.map((chip) => ({ ...chip, count: buckets[chip.key].length })),
    items: {
      watching: buckets.watching.map(toShowItem),
      watchlist: buckets.watchlist.map(toShowItem),
      stopped: buckets.stopped.map(toShowItem),
      finished: buckets.finished.map(toShowItem),
    },
  };
}

export function movieChips(entries: readonly MovieEntry[], sort: MovieSort): LibraryView {
  const segments = groupMovieLibrary(entries, sort);
  const of = (key: MovieChip): LibraryItem[] =>
    (segments.find((segment) => segment.key === key)?.entries ?? []).map((entry) => ({
      kind: "movie",
      entry,
    }));
  const items = { watchlist: of("watchlist"), watched: of("watched") };
  return {
    chips: MOVIE_CHIPS.map((chip) => ({ ...chip, count: items[chip.key].length })),
    items,
  };
}

const toShowItem = (entry: LibraryEntry): LibraryItem => ({ kind: "show", entry });

export function keyOf(item: LibraryItem): string {
  return item.kind === "show" ? `show-${item.entry.showId}` : `movie-${item.entry.movieId}`;
}

/**
 * The filter runs on the settled query rather than the keystroke, so a grid of
 * artwork is laid out once per pause instead of once per letter.
 */
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
