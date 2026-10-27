import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { queryKeys } from "../data/query-keys";
import { assembleLibrary, type LibraryEntry } from "../data/trakt/library";
import { assembleMovieLibrary, type MovieEntry } from "../data/trakt/movie-library";
import type { WatchlistItem } from "../data/trakt/schemas";
import type { SearchHit } from "../data/trakt/search";
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
  "type" | "traktId" | "ids" | "title" | "year" | "posters"
>;

function listedRow({ type, title, year, ids, posters }: WatchlistTitle): WatchlistItem {
  const media = { title, year, ids, images: { poster: [...posters] } };
  const listed_at = new Date().toISOString();
  return type === "movie" ? { type, listed_at, movie: media } : { type, listed_at, show: media };
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
    ...(listed && !known
      ? assembleLibrary({
          watchedShows: [],
          progress: new Map(),
          hiddenShowIds: new Set(),
          watchlistShows: [listedRow(title)],
          collectionShows: [],
        })
      : []),
  ];
}

function listMovie(entries: readonly MovieEntry[], title: WatchlistTitle, listed: boolean) {
  const known = entries.some((entry) => entry.movieId === title.traktId);
  return [
    ...entries
      .map((entry) => (entry.movieId === title.traktId ? { ...entry, inWatchlist: listed } : entry))
      .filter((entry) => entry.inWatchlist || entry.watched || entry.inCollection),
    ...(listed && !known
      ? assembleMovieLibrary({
          watchedMovies: [],
          watchlistMovies: [listedRow(title)],
          collectionMovies: [],
        })
      : []),
  ];
}

function patchMembership(client: QueryClient, title: WatchlistTitle, listed: boolean): void {
  if (title.type === "show") {
    client.setQueryData<UpNextData>(queryKeys.library(), (old) =>
      old === undefined ? old : { ...old, entries: listShow(old.entries, title, listed) },
    );
    return;
  }
  client.setQueryData<readonly WatchlistItem[]>(queryKeys.movieWatchlist(), (rows) =>
    rows === undefined
      ? rows
      : [
          ...rows.filter((row) => row.movie?.ids.trakt !== title.traktId),
          ...(listed ? [listedRow(title)] : []),
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
