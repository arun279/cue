import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "../data/query-keys";
import type { CueRuntime } from "../runtime/runtime";

const SEARCH_TYPES = "show,movie";

/**
 * Trending and popular are editorial lists that shift slowly, so a five minute
 * horizon keeps them warm across a session: leaving Search and coming back does
 * not spend a read the reader cannot tell apart from the one before it.
 */
const BROWSE_STALE_TIME_MS = 5 * 60 * 1000;

export const searchQuery = (runtime: CueRuntime, query: string) =>
  queryOptions({
    queryKey: queryKeys.search(query, SEARCH_TYPES),
    queryFn: () => runtime.search(query),
  });

export const browseQuery = (runtime: CueRuntime) =>
  queryOptions({
    queryKey: queryKeys.browse(),
    queryFn: () => runtime.loadBrowse(),
    staleTime: BROWSE_STALE_TIME_MS,
  });
