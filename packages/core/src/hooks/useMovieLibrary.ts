import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { MovieEntry } from "../data/trakt/movie-library";
import { byTitle } from "../domain/library-buckets";
import { type QueryStatus, queryStatus } from "../queries/freshness";
import { movieLibraryQuery } from "../queries/library";
import { useRuntime } from "../runtime/runtime";

/** Honest movie taxonomy (Rams #6): a film is watched or not: no episode
 * progress: so the library groups into Watchlist (want to watch) and Watched
 * (seen). Collection (owned) would be a third, non-empty-only segment once
 * `/sync/collection/movies` is wired (deferred). */
interface MovieSegment {
  readonly key: "watchlist" | "watched";
  readonly label: string;
  readonly entries: readonly MovieEntry[];
}

/** Movie-appropriate sort keys (parity of placement, honesty of options): the
 * show "Progress" axis is meaningless for a binary movie, so the film triad is
 * Recently watched (last_watched_at desc) / A-Z / Release year (newest first). */
export type MovieSort = "recently-watched" | "alphabetical" | "release-year";

export interface MovieLibraryView extends QueryStatus {
  readonly segments: readonly MovieSegment[];
  readonly trackedCount: number;
  entryFor(movieId: number): MovieEntry | undefined;
  refetch(): void;
}

function byWatchedAt(a: MovieEntry, b: MovieEntry): number {
  return (b.watchedAt ?? "").localeCompare(a.watchedAt ?? "") || byTitle(a, b);
}

function byYear(a: MovieEntry, b: MovieEntry): number {
  return (b.year ?? 0) - (a.year ?? 0) || byTitle(a, b);
}

/** Newest-added first: the queue order for the Watchlist (a film has no watch
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

/** The Watchlist's comparator: same A-Z / Release-year axes as Watched, but the
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
    ...movieLibraryQuery(runtime),
    // A single-medium user never fetches the medium they turned off: a
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
    // Watchlist first (the "want to watch" pool), then Watched: matching the model's
    // "Watchlist / Watched" order and the Shows side's Watchlist-first framing. An
    // empty segment is dropped so the library never renders a phantom "Watchlist (0)"
    // header: parity with Shows' groupLibrary, which omits empty buckets.
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
