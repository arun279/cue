import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useRuntime } from "../runtime/runtime";
import { USER_STATE_STALE_TIME } from "./query-freshness";

const playsKey = (episodeTrakt: number) => ["episode-plays", episodeTrakt] as const;

export interface EpisodePlaysView {
  /** The episode's play count, or null while unknown (read still in flight). An
   * unwatched episode is 0 without a read. */
  readonly count: number | null;
  /** Drop the cached count so it re-resolves: called after any play write settles
   * (mark, latest-play removal, rewatch add, remove-all, and their Undos). */
  refresh(): void;
}

/**
 * The episode sheet's play-count read (`/sync/history/episodes/:id`), powering
 * the rewatch-aware copy: "Watched twice", the ×N badge, and "Remove all N
 * plays…". Fetched only for a watched episode; user-state staleness means it
 * never refetches on its own, so every play write on the sheet calls `refresh`.
 */
export function useEpisodePlays(
  episodeTrakt: number | undefined,
  watched: boolean,
): EpisodePlaysView {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const enabled = episodeTrakt !== undefined && watched;
  const query = useQuery({
    queryKey: playsKey(episodeTrakt ?? 0),
    queryFn: () => runtime.loadEpisodePlays(episodeTrakt ?? 0),
    staleTime: USER_STATE_STALE_TIME,
    enabled,
  });
  const refresh = useCallback(() => {
    if (episodeTrakt !== undefined) {
      void queryClient.invalidateQueries({ queryKey: playsKey(episodeTrakt) });
    }
  }, [queryClient, episodeTrakt]);
  if (!watched) return { count: 0, refresh };
  return {
    count: query.data === undefined ? null : query.data.length,
    refresh,
  };
}
