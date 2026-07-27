import type { TraktClient, TraktResult } from "./client";
import * as raw from "./endpoints";
import { withReadRateRetry } from "./read-budget";

/**
 * Every authed GET the runtime and repositories issue OUTSIDE `read-budget.ts`
 * itself, pre-bound to {@link withReadRateRetry}. This is the only door in: the
 * architecture rule in `.dependency-cruiser.cjs` forbids importing
 * `./endpoints` from anywhere but this file and `read-budget.ts`, so a read
 * reachable from the runtime without a pooled wrapper here cannot compile
 * clean, instead of relying on a caller remembering to wrap each call site.
 */

function pool<Args extends unknown[], T>(
  fn: (client: TraktClient, ...rest: Args) => Promise<TraktResult<T>>,
): (client: TraktClient, ...rest: Args) => Promise<TraktResult<T>> {
  return (client, ...rest) => withReadRateRetry(() => fn(client, ...rest));
}

export const getHidden = pool(raw.getHidden);
export const getWatchedMovies = pool(raw.getWatchedMovies);
export const getItemPlays = pool(raw.getItemPlays);
export const getShowProgress = pool(raw.getShowProgress);
export const getShow = pool(raw.getShow);
export const getMovie = pool(raw.getMovie);
export const getShowSeasons = pool(raw.getShowSeasons);
export const getEpisode = pool(raw.getEpisode);
export const getWatchlist = pool(raw.getWatchlist);
export const getMyShowsCalendar = pool(raw.getMyShowsCalendar);
export const searchTrakt = pool(raw.searchTrakt);
export const getTrendingShows = pool(raw.getTrendingShows);
export const getPopularShows = pool(raw.getPopularShows);
export const getTrendingMovies = pool(raw.getTrendingMovies);
export const getPopularMovies = pool(raw.getPopularMovies);
export const getRelatedMovies = pool(raw.getRelatedMovies);
export const getUserStats = pool(raw.getUserStats);
export const getUserSettings = pool(raw.getUserSettings);
export const getHistory = pool(raw.getHistory);
export const getLastActivities = pool(raw.getLastActivities);
