import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../data/query-keys";
import type { SeasonView } from "../data/trakt/show-detail";
import { useRuntime } from "../runtime/runtime";
import { CONTENT_STALE_TIME_MS, type QueryStatus, queryStatus } from "./query-freshness";

export interface SeasonsView extends QueryStatus {
  readonly seasons: readonly SeasonView[];
  refetch(): void;
}

/**
 * The Show detail season stream: the full season/episode tree with
 * per-episode watched flags, on its own cache key so it streams in after the
 * hero and retries independently of it.
 */
export function useSeasons(showId: number): SeasonsView {
  const runtime = useRuntime();
  const query = useQuery({
    queryKey: queryKeys.showSeasons(showId),
    queryFn: () => runtime.loadShowSeasons(showId),
    staleTime: CONTENT_STALE_TIME_MS,
  });
  return {
    seasons: query.data ?? [],
    ...queryStatus(query, query.data !== undefined),
    refetch: () => void query.refetch(),
  };
}
