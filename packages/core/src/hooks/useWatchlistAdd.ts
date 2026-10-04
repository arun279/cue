import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { queryKeys } from "../data/query-keys";
import type { SearchHit } from "../data/trakt/search";
import { buildAddWatchlistOp, buildRemoveWatchlistOp } from "../domain/write-queue/ops";
import type { QueuedOp } from "../domain/write-queue/types";
import { libraryQuery, movieLibraryQuery, watchlistQuery } from "../queries/library";
import { type MovieLibraryData, type UpNextData, useRuntime } from "../runtime/runtime";
import { useOptimisticWrite } from "./useOptimisticWrite";

export interface WatchlistAddView {
  isAdded(hit: SearchHit): boolean;
  add(hit: SearchHit): Promise<void>;
  remove(hit: SearchHit): Promise<void>;
  readonly addError: string | null;
  clearAddError(): void;
}

function sectionOf(type: "show" | "movie"): "shows" | "movies" {
  return type === "movie" ? "movies" : "shows";
}

// Trakt ids are namespaced per media type.
function addKey(hit: SearchHit): string {
  return `${hit.type}:${hit.traktId}`;
}

export function useWatchlistAdd(): WatchlistAddView {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const submit = useOptimisticWrite();
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<ReadonlySet<string>>(() => new Set());

  const run = useCallback(
    async (op: QueuedOp, rollback: () => void, message: string, revalidate: () => void) => {
      if ((await submit([op], { rollback, revalidate })) === "failed") setError(message);
    },
    [submit],
  );

  const [watchlistShows, watchlistMovies] = useQueries({
    queries: [watchlistQuery(runtime, "shows"), watchlistQuery(runtime, "movies")],
  });
  const listedShows = watchlistShows.data;
  const listedMovies = watchlistMovies.data;

  const libraryEntries = useQuery({ ...libraryQuery(runtime), enabled: false }).data?.entries;
  const movieEntries = useQuery({ ...movieLibraryQuery(runtime), enabled: false }).data?.entries;

  const isListed = useCallback(
    (hit: SearchHit) =>
      hit.type === "movie"
        ? (listedMovies?.includes(hit.traktId) ?? false) ||
          (movieEntries?.some((entry) => entry.movieId === hit.traktId) ?? false)
        : (listedShows?.includes(hit.traktId) ?? false) ||
          (libraryEntries?.some((entry) => entry.showId === hit.traktId) ?? false),
    [listedShows, listedMovies, libraryEntries, movieEntries],
  );

  const isAdded = useCallback(
    (hit: SearchHit) => added.has(addKey(hit)) || isListed(hit),
    [added, isListed],
  );

  const revalidateMembership = useCallback(
    (section: "shows" | "movies") => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.watchlist(section) });
      void queryClient.invalidateQueries({
        queryKey: section === "movies" ? queryKeys.movieLibrary() : queryKeys.library(),
      });
    },
    [queryClient],
  );

  const add = useCallback(
    async (hit: SearchHit) => {
      const key = addKey(hit);
      if (added.has(key) || isListed(hit)) return;
      setAdded((prev) => new Set(prev).add(key));
      const section = sectionOf(hit.type);
      const op = buildAddWatchlistOp({ opId: runtime.newId(), section, ids: hit.ids });
      await run(
        op,
        () =>
          setAdded((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          }),
        `Couldn't add ${hit.title} to your watchlist. Please try again.`,
        () => revalidateMembership(section),
      );
    },
    [added, isListed, run, revalidateMembership, runtime.newId],
  );

  const remove = useCallback(
    async (hit: SearchHit) => {
      const key = addKey(hit);
      const section = sectionOf(hit.type);
      setAdded((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      const aggregateKey = section === "movies" ? queryKeys.movieLibrary() : queryKeys.library();
      await Promise.all([
        queryClient.cancelQueries({ queryKey: queryKeys.watchlist(section) }),
        queryClient.cancelQueries({ queryKey: aggregateKey }),
      ]);
      const watchlistKey = queryKeys.watchlist(section);
      const beforeWatchlist = queryClient.getQueryData<readonly number[]>(watchlistKey);
      const beforeAggregate = queryClient.getQueryData<UpNextData | MovieLibraryData>(aggregateKey);
      queryClient.setQueryData<readonly number[]>(watchlistKey, (old) =>
        old?.filter((id) => id !== hit.traktId),
      );
      if (section === "movies") {
        queryClient.setQueryData<MovieLibraryData>(queryKeys.movieLibrary(), (old) =>
          old === undefined
            ? undefined
            : { ...old, entries: old.entries.filter((entry) => entry.movieId !== hit.traktId) },
        );
      } else {
        queryClient.setQueryData<UpNextData>(queryKeys.library(), (old) =>
          old === undefined
            ? undefined
            : { ...old, entries: old.entries.filter((entry) => entry.showId !== hit.traktId) },
        );
      }
      const op = buildRemoveWatchlistOp({ opId: runtime.newId(), section, ids: hit.ids });
      await run(
        op,
        () => {
          setAdded((prev) => new Set(prev).add(key));
          queryClient.setQueryData(watchlistKey, beforeWatchlist);
          queryClient.setQueryData(aggregateKey, beforeAggregate);
        },
        `Couldn't remove ${hit.title} from your watchlist. Please try again.`,
        () => revalidateMembership(section),
      );
    },
    [run, queryClient, revalidateMembership, runtime.newId],
  );

  return { isAdded, add, remove, addError: error, clearAddError: () => setError(null) };
}
