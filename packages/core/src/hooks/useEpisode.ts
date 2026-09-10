import { useQuery } from "@tanstack/react-query";
import type { EpisodeDetail } from "../data/trakt/episode-detail";
import { type QueryStatus, queryStatus } from "../queries/freshness";
import { episodeQuery } from "../queries/shows";
import { useRuntime } from "../runtime/runtime";

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
  const query = useQuery(episodeQuery(runtime, showId, season, number));
  return {
    episode: query.data,
    ...queryStatus(query, query.data !== undefined),
    refetch: () => void query.refetch(),
  };
}
