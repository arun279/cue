import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../data/query-keys";
import type { TraktFailure } from "../data/trakt/client";
import type { EpisodeDetail } from "../data/trakt/episode-detail";
import { useRuntime } from "../runtime/runtime";
import { readFailureOf } from "../sync-contract";
import { CONTENT_STALE_TIME_MS } from "./query-freshness";

export interface EpisodeView {
  readonly episode: EpisodeDetail | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  /** Why the read failed, so the screen's error body names it rather than guessing. */
  readonly failure: TraktFailure | null;
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
    isLoading: query.isLoading,
    isError: query.isError,
    failure: readFailureOf(query.error),
    refetch: () => void query.refetch(),
  };
}
