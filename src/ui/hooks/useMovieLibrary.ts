import { queryKeys } from "@data/query-keys";
import type { MovieEntry } from "@data/trakt/movie-library";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { type MovieLibraryData, useRuntime } from "@ui/runtime/runtime";
import { useMemo } from "react";

interface MovieShelf {
  readonly key: "watched" | "watchlist";
  readonly label: string;
  readonly entries: readonly MovieEntry[];
}

export interface MovieLibraryView {
  readonly shelves: readonly MovieShelf[];
  readonly tmdbConfig: MovieLibraryData["tmdbConfig"];
  readonly trackedCount: number;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly hasData: boolean;
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
  return (b.watchedAt ?? "").localeCompare(a.watchedAt ?? "");
}

function byTitle(a: MovieEntry, b: MovieEntry): number {
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

/**
 * The My Shows movie library read: the persisted `movieLibrary` query (watched +
 * watchlist movies) split into two poster shelves — Watched (most-recent first)
 * and Watchlist (to-watch, alphabetical). A watched movie that is also
 * watchlisted stays on Watched only, so the shelves never double-count.
 */
export function useMovieLibrary(): MovieLibraryView {
  const runtime = useRuntime();
  const query = useQuery({
    queryKey: queryKeys.movieLibrary(),
    queryFn: () => runtime.loadMovieLibrary(),
  });

  const entries = query.data?.entries;
  const shelves = useMemo<MovieShelf[]>(() => {
    if (entries === undefined) return [];
    const watched = entries.filter((e) => e.watched).sort(byWatchedAt);
    const watchlist = entries.filter((e) => e.inWatchlist && !e.watched).sort(byTitle);
    return [
      { key: "watched", label: "Watched", entries: watched },
      { key: "watchlist", label: "Watchlist", entries: watchlist },
    ];
  }, [entries]);

  return {
    shelves,
    tmdbConfig: query.data?.tmdbConfig ?? null,
    trackedCount: entries?.length ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    hasData: query.data !== undefined,
    entryFor: (movieId) => entries?.find((e) => e.movieId === movieId),
    refetch: () => void query.refetch(),
  };
}
