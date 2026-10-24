import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { queryKeys } from "../data/query-keys";
import type { SearchHit } from "../data/trakt/search";
import { buildAddWatchlistOp, buildRemoveWatchlistOp } from "../domain/write-queue/ops";
import type { QueuedOp } from "../domain/write-queue/types";
import { libraryQuery, movieLibraryQuery, movieWatchlistQuery } from "../queries/library";
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

// The library holds every watchlisted show; movies have a list of their own until the movie library loads.
function membershipKeys(section: "shows" | "movies"): readonly (readonly unknown[])[] {
  return section === "movies"
    ? [queryKeys.movieWatchlist(), queryKeys.movieLibrary()]
    : [queryKeys.library()];
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

  const listedMovies = useQuery(movieWatchlistQuery(runtime)).data;

  const libraryEntries = useQuery({ ...libraryQuery(runtime), enabled: false }).data?.entries;
  const movieEntries = useQuery({ ...movieLibraryQuery(runtime), enabled: false }).data?.entries;

  const listedIds = useMemo(
    () => ({
      movie: new Set([
        ...(listedMovies ?? []),
        ...(movieEntries ?? []).map(({ movieId }) => movieId),
      ]),
      show: new Set((libraryEntries ?? []).map(({ showId }) => showId)),
    }),
    [listedMovies, libraryEntries, movieEntries],
  );
  const isListed = useCallback(
    (hit: SearchHit) => listedIds[hit.type].has(hit.traktId),
    [listedIds],
  );

  const isAdded = useCallback(
    (hit: SearchHit) => added.has(addKey(hit)) || isListed(hit),
    [added, isListed],
  );

  const revalidateMembership = useCallback(
    (section: "shows" | "movies") => {
      for (const queryKey of membershipKeys(section))
        void queryClient.invalidateQueries({ queryKey });
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
      const keys = membershipKeys(section);
      await Promise.all(keys.map((queryKey) => queryClient.cancelQueries({ queryKey })));
      const before = keys.map(
        (queryKey) => [queryKey, queryClient.getQueryData(queryKey)] as const,
      );
      if (section === "movies") {
        queryClient.setQueryData<readonly number[]>(queryKeys.movieWatchlist(), (old) =>
          old?.filter((id) => id !== hit.traktId),
        );
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
          for (const [queryKey, data] of before) queryClient.setQueryData(queryKey, data);
        },
        `Couldn't remove ${hit.title} from your watchlist. Please try again.`,
        () => revalidateMembership(section),
      );
    },
    [run, queryClient, revalidateMembership, runtime.newId],
  );

  return { isAdded, add, remove, addError: error, clearAddError: () => setError(null) };
}
