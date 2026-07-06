import type { EpisodeIds, MovieIds, ShowIds } from "@domain/model/ids";
import type { LastActivities } from "@domain/sync-activities";
import type { z } from "zod";
import type { RequestOptions, TraktClient, TraktResult } from "./client";
import {
  type CalendarItem,
  calendarSchema,
  type EpisodeData,
  episodeSchema,
  type HiddenItem,
  hiddenSchema,
  lastActivitiesSchema,
  type Progress,
  popularShowsSchema,
  progressSchema,
  type RatingItem,
  ratingsSchema,
  type SearchResult,
  type SeasonData,
  type ShowDetailData,
  type ShowSummary,
  searchSchema,
  seasonsSchema,
  showDetailSchema,
  type TrendingShow,
  trendingShowsSchema,
  type WatchedMovie,
  type WatchedShow,
  type WatchlistItem,
  watchedMoviesSchema,
  watchedShowsSchema,
  watchlistSchema,
} from "./schemas";

const ART: readonly ["full", "images"] = ["full", "images"];

/** Validate the ok payload (throws on malformed); pass transport failures through. */
function parse<T>(result: TraktResult<unknown>, schema: z.ZodType<T>): TraktResult<T> {
  if (!result.ok) return result;
  return { ok: true, data: schema.parse(result.data), pagination: result.pagination };
}

export async function getWatchedShows(client: TraktClient): Promise<TraktResult<WatchedShow[]>> {
  return parse(
    await client.getAllPages("/sync/watched/shows", { extended: ART }),
    watchedShowsSchema,
  );
}

export async function getWatchedMovies(client: TraktClient): Promise<TraktResult<WatchedMovie[]>> {
  return parse(
    await client.getAllPages("/sync/watched/movies", { extended: ART }),
    watchedMoviesSchema,
  );
}

export async function getShowProgress(
  client: TraktClient,
  showId: number | string,
  includeSpecials = false,
): Promise<TraktResult<Progress>> {
  // Show-detail's season tree opts specials in so a watched special reads as
  // watched (and isn't re-marked); Up Next / header keep them out of the counts.
  const specials = includeSpecials ? "true" : "false";
  const options: RequestOptions = {
    extended: ["full"],
    query: { hidden: "false", specials, count_specials: specials },
  };
  return parse(await client.get(`/shows/${showId}/progress/watched`, options), progressSchema);
}

export async function getShow(
  client: TraktClient,
  showId: number | string,
): Promise<TraktResult<ShowDetailData>> {
  return parse(await client.get(`/shows/${showId}`, { extended: ART }), showDetailSchema);
}

export async function getShowSeasons(
  client: TraktClient,
  showId: number | string,
): Promise<TraktResult<SeasonData[]>> {
  const options: RequestOptions = { extended: ["episodes", "full", "images"] };
  return parse(await client.get(`/shows/${showId}/seasons`, options), seasonsSchema);
}

export async function getEpisode(
  client: TraktClient,
  showId: number | string,
  season: number,
  episode: number,
): Promise<TraktResult<EpisodeData>> {
  const path = `/shows/${showId}/seasons/${season}/episodes/${episode}`;
  return parse(await client.get(path, { extended: ART }), episodeSchema);
}

export async function getWatchlist(
  client: TraktClient,
  type: "shows" | "movies",
): Promise<TraktResult<WatchlistItem[]>> {
  return parse(
    await client.getAllPages(`/sync/watchlist/${type}`, { extended: ART }),
    watchlistSchema,
  );
}

export async function getRatings(
  client: TraktClient,
  type: "shows" | "movies" | "episodes",
): Promise<TraktResult<RatingItem[]>> {
  return parse(
    await client.getAllPages(`/sync/ratings/${type}`, { extended: ["full"] }),
    ratingsSchema,
  );
}

export async function getMyShowsCalendar(
  client: TraktClient,
  startDate: string,
  days: number,
): Promise<TraktResult<CalendarItem[]>> {
  const path = `/calendars/my/shows/${startDate}/${days}`;
  return parse(await client.get(path, { extended: ART }), calendarSchema);
}

export async function searchTrakt(
  client: TraktClient,
  query: string,
  types: readonly ("show" | "movie")[] = ["show", "movie"],
): Promise<TraktResult<SearchResult[]>> {
  const path = `/search/${types.join(",")}`;
  return parse(await client.get(path, { query: { query }, extended: ART }), searchSchema);
}

/** Browse rails for empty-query Discover: the current trending + all-time
 * popular shows, art included so each renders a real 2:3 poster. Trakt caps a
 * single page at its own limit; the caller asks for one shelf's worth. */
export async function getTrendingShows(
  client: TraktClient,
  limit = 24,
): Promise<TraktResult<TrendingShow[]>> {
  return parse(await client.get("/shows/trending", { extended: ART, limit }), trendingShowsSchema);
}

export async function getPopularShows(
  client: TraktClient,
  limit = 24,
): Promise<TraktResult<ShowSummary[]>> {
  return parse(await client.get("/shows/popular", { extended: ART, limit }), popularShowsSchema);
}

export async function getHidden(client: TraktClient): Promise<TraktResult<HiddenItem[]>> {
  return parse(await client.getAllPages("/users/hidden/progress_watched"), hiddenSchema);
}

export async function getLastActivities(client: TraktClient): Promise<TraktResult<LastActivities>> {
  return parse(await client.get("/sync/last_activities"), lastActivitiesSchema);
}

type IdBlock = ShowIds | MovieIds | EpisodeIds;

/** A remove-by-item selection: any populated section becomes `[{ids},…]`. */
export interface ItemSelection {
  readonly shows?: readonly ShowIds[];
  readonly movies?: readonly MovieIds[];
  readonly episodes?: readonly EpisodeIds[];
}

/**
 * Compose the `{episodes|movies|shows:[{ids}]}` body shared by every
 * remove-by-item write (`/sync/history/remove`, `/sync/watchlist/remove`,
 * `/sync/ratings/remove`, hidden add/remove). Empty sections are omitted.
 */
export function itemsBody(selection: ItemSelection): Record<string, { ids: IdBlock }[]> {
  const sections: readonly (keyof ItemSelection)[] = ["shows", "movies", "episodes"];
  const body: Record<string, { ids: IdBlock }[]> = {};
  for (const section of sections) {
    const ids = selection[section];
    if (ids !== undefined && ids.length > 0) body[section] = ids.map((id) => ({ ids: id }));
  }
  return body;
}
