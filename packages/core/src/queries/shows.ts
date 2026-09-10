import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "../data/query-keys";
import type { ShowInfo } from "../data/trakt/show-detail";
import type { CueRuntime } from "../runtime/runtime";
import { CONTENT_STALE_TIME_MS, USER_STATE_STALE_TIME } from "./freshness";

export interface ShowArt {
  readonly posters: readonly string[];
  readonly backdrops: readonly string[];
}

export const EMPTY_SHOW_ART: ShowArt = { posters: [], backdrops: [] };

export const selectArt = (info: ShowInfo): ShowArt => ({
  posters: info.posters,
  backdrops: info.backdrops,
});

export const ART_SETTLE_MS = 250;

export const showInfoQuery = (runtime: CueRuntime, showId: number) =>
  queryOptions({
    queryKey: queryKeys.showInfo(showId),
    queryFn: () => runtime.loadShowInfo(showId),
    staleTime: CONTENT_STALE_TIME_MS,
  });

export const showProgressQuery = (runtime: CueRuntime, showId: number) =>
  queryOptions({
    queryKey: queryKeys.showProgress(showId),
    queryFn: () => runtime.loadShowProgress(showId),
    staleTime: USER_STATE_STALE_TIME,
  });

export const showSeasonsQuery = (runtime: CueRuntime, showId: number) =>
  queryOptions({
    queryKey: queryKeys.showSeasons(showId),
    queryFn: () => runtime.loadShowSeasons(showId),
    staleTime: CONTENT_STALE_TIME_MS,
  });

export const episodeQuery = (
  runtime: CueRuntime,
  showId: number,
  season: number,
  episode: number,
) =>
  queryOptions({
    queryKey: queryKeys.episode(showId, season, episode),
    queryFn: () => runtime.loadEpisode(showId, season, episode),
    staleTime: CONTENT_STALE_TIME_MS,
  });
