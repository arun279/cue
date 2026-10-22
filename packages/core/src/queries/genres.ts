import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "../data/query-keys";
import type { CueRuntime } from "../runtime/runtime";

export const genreNamesQuery = (runtime: CueRuntime) =>
  queryOptions({
    queryKey: queryKeys.genres(),
    queryFn: () => runtime.loadGenreNames(),
    staleTime: Number.POSITIVE_INFINITY,
  });
