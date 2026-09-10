import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "../data/query-keys";
import type { CueRuntime } from "../runtime/runtime";
import { CONTENT_STALE_TIME_MS } from "./freshness";

export const movieHeaderQuery = (runtime: CueRuntime, movieId: number) =>
  queryOptions({
    queryKey: queryKeys.movieHeader(movieId),
    queryFn: () => runtime.loadMovieHeader(movieId),
    staleTime: CONTENT_STALE_TIME_MS,
  });
