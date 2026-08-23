import { queryKeys } from "@data/query-keys";
import type { SeasonView } from "@data/trakt/show-detail";
import { useQuery } from "@tanstack/react-query";
import { CONTENT_STALE_TIME_MS } from "@ui/hooks/query-freshness";
import { useRuntime } from "@ui/runtime/runtime";

export interface SeasonsView {
  readonly seasons: readonly SeasonView[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly hasData: boolean;
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
    isLoading: query.isLoading,
    isError: query.isError,
    hasData: query.data !== undefined,
    refetch: () => void query.refetch(),
  };
}
