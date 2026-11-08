import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { queryKeys } from "../data/query-keys";
import type { SearchHit } from "../domain/discover";
import { type LibraryEntry, notStartedShow } from "../domain/model/library";
import { type MovieEntry, unwatchedMovie } from "../domain/model/movie";
import { buildAddWatchlistOp, buildRemoveWatchlistOp } from "../domain/write-queue/ops";
import {
  type MovieLibraryData,
  type SubmitOutcome,
  type UpNextData,
  useRuntime,
} from "../runtime/runtime";
import { whenNoWritePending } from "../stores/write-locks";
import { useOptimisticWrite, writeTarget } from "./useOptimisticWrite";

export type WatchlistTitle = Pick<
  SearchHit,
  "type" | "traktId" | "ids" | "title" | "year" | "posters" | "tmdbId"
>;

function listedShow({ ids, title, year, posters, tmdbId }: WatchlistTitle): LibraryEntry {
  return notStartedShow({
    showId: ids.trakt,
    title,
    year,
    status: "",
    hidden: false,
    dropped: false,
    inWatchlist: true,
    addedAt: new Date().toISOString(),
    posters,
    tmdbId,
  });
}

function listedMovie({ ids, title, year, posters, tmdbId }: WatchlistTitle): MovieEntry {
  return unwatchedMovie({
    movieId: ids.trakt,
    ids,
    title,
    year,
    inWatchlist: true,
    inCollection: false,
    addedAt: new Date().toISOString(),
    posters,
    tmdbId,
    runtime: null,
  });
}

// The library holds every watchlisted show; the movie library is built from the movie watchlist.
function membershipKeys(type: WatchlistTitle["type"]): readonly (readonly unknown[])[] {
  return type === "movie"
    ? [queryKeys.movieWatchlist(), queryKeys.movieLibrary()]
    : [queryKeys.library()];
}

function listShow(entries: readonly LibraryEntry[], title: WatchlistTitle, listed: boolean) {
  const known = entries.some((entry) => entry.showId === title.traktId);
  return [
    ...entries
      .map((entry) => (entry.showId === title.traktId ? { ...entry, inWatchlist: listed } : entry))
      .filter((entry) => entry.showId !== title.traktId || listed || entry.lastWatchedAt !== null),
    ...(listed && !known ? [listedShow(title)] : []),
  ];
}

function listMovie(entries: readonly MovieEntry[], title: WatchlistTitle, listed: boolean) {
  const known = entries.some((entry) => entry.movieId === title.traktId);
  return [
    ...entries
      .map((entry) => (entry.movieId === title.traktId ? { ...entry, inWatchlist: listed } : entry))
      .filter((entry) => entry.inWatchlist || entry.watched || entry.inCollection),
    ...(listed && !known ? [listedMovie(title)] : []),
  ];
}

/** `entries` with the title's own entry as it was in `before`, and every other entry as it is. */
function restoreOwn<T extends { readonly inWatchlist: boolean }>(
  entries: readonly T[],
  isOwn: (entry: T) => boolean,
  before: T | undefined,
): T[] {
  if (before === undefined) return entries.filter((entry) => !isOwn(entry));
  if (!entries.some(isOwn)) return [...entries, before];
  return entries.map((entry) =>
    isOwn(entry) ? { ...entry, inWatchlist: before.inWatchlist } : entry,
  );
}

/** Takes back only what patching the title's membership changed. */
function membershipRevert(client: QueryClient, title: WatchlistTitle): () => void {
  if (title.type === "show") {
    const isOwn = (entry: LibraryEntry) => entry.showId === title.traktId;
    const before = client.getQueryData<UpNextData>(queryKeys.library())?.entries.find(isOwn);
    return () =>
      client.setQueryData<UpNextData>(queryKeys.library(), (old) =>
        old === undefined ? old : { ...old, entries: restoreOwn(old.entries, isOwn, before) },
      );
  }
  const isOwn = (entry: MovieEntry) => entry.movieId === title.traktId;
  const listed = client
    .getQueryData<readonly MovieEntry[]>(queryKeys.movieWatchlist())
    ?.find(isOwn);
  const known = client
    .getQueryData<MovieLibraryData>(queryKeys.movieLibrary())
    ?.entries.find(isOwn);
  return () => {
    client.setQueryData<readonly MovieEntry[]>(queryKeys.movieWatchlist(), (old) =>
      old === undefined ? old : restoreOwn(old, isOwn, listed),
    );
    client.setQueryData<MovieLibraryData>(queryKeys.movieLibrary(), (old) =>
      old === undefined ? old : { ...old, entries: restoreOwn(old.entries, isOwn, known) },
    );
  };
}

function patchMembership(client: QueryClient, title: WatchlistTitle, listed: boolean): void {
  if (title.type === "show") {
    client.setQueryData<UpNextData>(queryKeys.library(), (old) =>
      old === undefined ? old : { ...old, entries: listShow(old.entries, title, listed) },
    );
    return;
  }
  client.setQueryData<readonly MovieEntry[]>(queryKeys.movieWatchlist(), (entries) =>
    entries === undefined
      ? entries
      : [
          ...entries.filter((entry) => entry.movieId !== title.traktId),
          ...(listed ? [listedMovie(title)] : []),
        ],
  );
  client.setQueryData<MovieLibraryData>(queryKeys.movieLibrary(), (old) =>
    old === undefined ? old : { ...old, entries: listMovie(old.entries, title, listed) },
  );
}

export function useSetWatchlisted(): (
  title: WatchlistTitle,
  listed: boolean,
) => Promise<SubmitOutcome> {
  const runtime = useRuntime();
  const client = useQueryClient();
  const submit = useOptimisticWrite();
  return useCallback(
    async (title, listed) => {
      const keys = membershipKeys(title.type);
      await Promise.all(keys.map((queryKey) => client.cancelQueries({ queryKey })));
      const revert = membershipRevert(client, title);
      patchMembership(client, title, listed);
      const op = (listed ? buildAddWatchlistOp : buildRemoveWatchlistOp)({
        opId: runtime.newId(),
        section: title.type === "movie" ? "movies" : "shows",
        ids: title.ids,
      });
      return submit(writeTarget(title.type, title.traktId), [{ ops: [op], revert }], () => {
        whenNoWritePending(() => {
          for (const queryKey of keys) void client.invalidateQueries({ queryKey });
        });
      });
    },
    [client, runtime, submit],
  );
}
