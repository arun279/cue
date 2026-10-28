import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "../data/query-keys";
import type { CueRuntime } from "../runtime/runtime";
import { withOwnMarks } from "../stores/own-marks";
import { USER_STATE_STALE_TIME } from "./freshness";

export const libraryQuery = (runtime: CueRuntime) =>
  queryOptions({
    queryKey: queryKeys.library(),
    queryFn: async () => {
      const data = await runtime.loadUpNext();
      return { ...data, entries: withOwnMarks(data.entries) };
    },
    staleTime: USER_STATE_STALE_TIME,
    // The load retries each failed read itself, so retrying the whole of it would read everything again.
    retry: false,
  });

export const movieWatchlistQuery = (runtime: CueRuntime) =>
  queryOptions({
    queryKey: queryKeys.movieWatchlist(),
    queryFn: () => runtime.loadMovieWatchlist(),
    staleTime: USER_STATE_STALE_TIME,
  });

export const movieLibraryQuery = (runtime: CueRuntime) =>
  queryOptions({
    queryKey: queryKeys.movieLibrary(),
    queryFn: ({ client }) =>
      runtime.loadMovieLibrary(client.fetchQuery(movieWatchlistQuery(runtime))),
    staleTime: USER_STATE_STALE_TIME,
  });
