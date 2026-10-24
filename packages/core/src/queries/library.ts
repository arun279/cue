import { queryOptions } from "@tanstack/react-query";
import { invalidateChangedShows } from "../data/query-invalidation";
import { queryKeys } from "../data/query-keys";
import type { CueRuntime, UpNextData } from "../runtime/runtime";
import { withOwnMarks } from "../stores/own-marks";
import { USER_STATE_STALE_TIME } from "./freshness";

export const libraryQuery = (runtime: CueRuntime) =>
  queryOptions({
    queryKey: queryKeys.library(),
    queryFn: async ({ client, queryKey }) => {
      const data = await runtime.loadUpNext();
      const entries = withOwnMarks(data.entries);
      invalidateChangedShows(client, client.getQueryData<UpNextData>(queryKey)?.entries, entries);
      return { ...data, entries };
    },
    staleTime: USER_STATE_STALE_TIME,
    // The load retries each failed read itself, so retrying the whole of it would read everything again.
    retry: false,
  });

export const movieLibraryQuery = (runtime: CueRuntime) =>
  queryOptions({
    queryKey: queryKeys.movieLibrary(),
    queryFn: () => runtime.loadMovieLibrary(),
    staleTime: USER_STATE_STALE_TIME,
  });

export const movieWatchlistQuery = (runtime: CueRuntime) =>
  queryOptions({
    queryKey: queryKeys.movieWatchlist(),
    queryFn: () => runtime.loadMovieWatchlistIds(),
    staleTime: USER_STATE_STALE_TIME,
  });
