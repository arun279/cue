import type { TraktClient, TraktResult } from "./client";
import * as raw from "./endpoints";
import { withReadRateRetry } from "./read-budget";

/**
 * Every authed GET the runtime and repositories issue OUTSIDE `read-budget.ts`
 * itself, pre-bound to {@link withReadRateRetry}. The architecture rule in
 * `.dependency-cruiser.cjs` forbids importing `./endpoints` from anywhere but
 * this file and `read-budget.ts`, so no OTHER caller can reach a raw read
 * directly. It does not, by itself, prove every export below is actually
 * wrapped in `pool()` rather than re-exported raw from here: that is what
 * `test/data/trakt-pooled-endpoints.test.ts`'s identity check gates, by naming
 * any export that stops being reference-distinct from its `raw` counterpart.
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
