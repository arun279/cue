import { queryKeys } from "@data/query-keys";
import type { MovieEntry } from "@data/trakt/movie-library";
import { byTitle } from "@domain/library-buckets";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { queryStatus, USER_STATE_STALE_TIME } from "@ui/hooks/query-freshness";
import { type MovieLibraryData, useRuntime } from "@ui/runtime/runtime";
import { useMemo } from "react";

/** Honest movie taxonomy (Rams #6): a film is watched or not — no episode
 * progress — so the library groups into Watchlist (want to watch) and Watched
 * (seen). Collection (owned) would be a third, non-empty-only segment once
 * `/sync/collection/movies` is wired (deferred). */
interface MovieSegment {
  readonly key: "watchlist" | "watched";
  readonly label: string;
  readonly entries: readonly MovieEntry[];
}

/** Movie-appropriate sort keys (parity of placement, honesty of options): the
 * show "Progress" axis is meaningless for a binary movie, so the film triad is
 * Recently watched (last_watched_at desc) / A–Z / Release year (newest first). */
export type MovieSort = "recently-watched" | "alphabetical" | "release-year";

export interface MovieLibraryView {
  readonly segments: readonly MovieSegment[];
  readonly trackedCount: number;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly hasData: boolean;
  /** Epoch ms of the last successful sync — the pill's "· <time ago>" recency. */
  readonly syncedAt: number;
  entryFor(movieId: number): MovieEntry | undefined;
  refetch(): void;
}

/**
 * Insert-or-replace a movie entry in the persisted `movieLibrary` cache. Shared
 * by the mark-watched and watchlist toggles so an optimistic flip on a movie
 * that isn't in the library yet (never watched, not watchlisted) materializes it
 * instead of being dropped, and an existing entry is updated in place.
 */
export function writeMovieEntry(client: QueryClient, entry: MovieEntry): void {
  client.setQueryData<MovieLibraryData>(queryKeys.movieLibrary(), (old) => {
    if (old === undefined) return old;
    const exists = old.entries.some((e) => e.movieId === entry.movieId);
    const entries = exists
      ? old.entries.map((e) => (e.movieId === entry.movieId ? entry : e))
      : [...old.entries, entry];
    return { ...old, entries };
  });
}

function byWatchedAt(a: MovieEntry, b: MovieEntry): number {
  return (b.watchedAt ?? "").localeCompare(a.watchedAt ?? "") || byTitle(a, b);
}

function byYear(a: MovieEntry, b: MovieEntry): number {
  return (b.year ?? 0) - (a.year ?? 0) || byTitle(a, b);
}

/** Newest-added first — the queue order for the Watchlist (a film has no watch
 * date to sort by, so "recently added" is the honest analogue). Falls back to
 * title when `listedAt` is absent (a pre-`listedAt` cache), never throwing order away. */
function byListedAt(a: MovieEntry, b: MovieEntry): number {
  return (b.listedAt ?? "").localeCompare(a.listedAt ?? "") || byTitle(a, b);
}

function comparatorFor(sort: MovieSort): (a: MovieEntry, b: MovieEntry) => number {
  if (sort === "alphabetical") return byTitle;
  if (sort === "release-year") return byYear;
  return byWatchedAt;
}

/** The Watchlist's comparator: same A–Z / Release-year axes as Watched, but the
 * default "recently" axis means recently *added* (there is no watch date on an
 * unwatched film), so the freshest picks lead the queue. */
function watchlistComparatorFor(sort: MovieSort): (a: MovieEntry, b: MovieEntry) => number {
  if (sort === "alphabetical") return byTitle;
  if (sort === "release-year") return byYear;
  return byListedAt;
}

/**
 * The Library movie read: the persisted `movieLibrary` query (watched + watchlist
 * movies) grouped into the honest Watchlist / Watched segments, each ordered by
 * the chosen movie sort. A watched movie that is also watchlisted stays on Watched
 * only, so the segments never double-count. Reuses the shared cache so both the
 * Library screen and Movie detail read one query.
 */
export function useMovieLibrary(
  sort: MovieSort = "recently-watched",
  enabled = true,
): MovieLibraryView {
  const runtime = useRuntime();
  const query = useQuery({
    queryKey: queryKeys.movieLibrary(),
    queryFn: () => runtime.loadMovieLibrary(),
    staleTime: USER_STATE_STALE_TIME,
    // A single-medium user never fetches the medium they turned off — a
    // movies-off Library leaves this query idle rather than reading a hidden section.
    enabled,
  });

  const entries = query.data?.entries;
  const segments = useMemo<MovieSegment[]>(() => {
    if (entries === undefined) return [];
    const watched = [...entries.filter((e) => e.watched)].sort(comparatorFor(sort));
    const watchlist = [...entries.filter((e) => e.inWatchlist && !e.watched)].sort(
      watchlistComparatorFor(sort),
    );
    // Watchlist first (the "want to watch" pool), then Watched — matching the model's
    // "Watchlist / Watched" order and the Shows side's Watchlist-first framing. An
    // empty segment is dropped so the library never renders a phantom "Watchlist (0)"
    // header — parity with Shows' groupLibrary, which omits empty buckets.
    const ordered: MovieSegment[] = [
      { key: "watchlist", label: "Watchlist", entries: watchlist },
      { key: "watched", label: "Watched", entries: watched },
    ];
    return ordered.filter((segment) => segment.entries.length > 0);
  }, [entries, sort]);

  return {
    segments,
    trackedCount: entries?.length ?? 0,
    ...queryStatus(query, query.data !== undefined),
    entryFor: (movieId) => entries?.find((e) => e.movieId === movieId),
    refetch: () => void query.refetch(),
  };
}
