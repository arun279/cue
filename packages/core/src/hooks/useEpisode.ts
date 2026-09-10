import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../data/query-keys";
import type { EpisodeDetail } from "../data/trakt/episode-detail";
import { useRuntime } from "../runtime/runtime";
import { CONTENT_STALE_TIME_MS, type QueryStatus, queryStatus } from "./query-freshness";

export interface EpisodeView extends QueryStatus {
  readonly episode: EpisodeDetail | undefined;
  refetch(): void;
}

/**
 * The Episode detail read: the single-episode content merged with
 * progress-derived watched state + prev/next nav, on its own cache key so it
 * paints from cache and retries independently.
 */
export function useEpisode(showId: number, season: number, number: number): EpisodeView {
  const runtime = useRuntime();
  const query = useQuery({
    queryKey: queryKeys.episode(showId, season, number),
    queryFn: () => runtime.loadEpisode(showId, season, number),
    staleTime: CONTENT_STALE_TIME_MS,
  });
  return {
    episode: query.data,
    ...queryStatus(query, query.data !== undefined),
    refetch: () => void query.refetch(),
  };
}
