import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "../data/query-keys";
import type { CueRuntime } from "../runtime/runtime";
import { USER_STATE_STALE_TIME } from "./freshness";

export const libraryQuery = (runtime: CueRuntime) =>
  queryOptions({
    queryKey: queryKeys.library(),
    queryFn: () => runtime.loadUpNext(),
    staleTime: USER_STATE_STALE_TIME,
  });

export const movieLibraryQuery = (runtime: CueRuntime) =>
  queryOptions({
    queryKey: queryKeys.movieLibrary(),
    queryFn: () => runtime.loadMovieLibrary(),
    staleTime: USER_STATE_STALE_TIME,
  });

export const watchlistQuery = (runtime: CueRuntime, section: "shows" | "movies") =>
  queryOptions({
    queryKey: queryKeys.watchlist(section),
    queryFn: () => runtime.loadWatchlistIds(section),
    staleTime: USER_STATE_STALE_TIME,
  });
