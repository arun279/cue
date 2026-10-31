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
import { useOptimisticWrite } from "./useOptimisticWrite";

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
      const before = keys.map((queryKey) => [queryKey, client.getQueryData(queryKey)] as const);
      patchMembership(client, title, listed);
      const op = (listed ? buildAddWatchlistOp : buildRemoveWatchlistOp)({
        opId: runtime.newId(),
        section: title.type === "movie" ? "movies" : "shows",
        ids: title.ids,
      });
      return submit([op], {
        rollback: () => {
          for (const [queryKey, data] of before) client.setQueryData(queryKey, data);
        },
        revalidate: () => {
          for (const queryKey of keys) void client.invalidateQueries({ queryKey });
        },
      });
    },
    [client, runtime, submit],
  );
}
