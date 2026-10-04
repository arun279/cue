import type { z } from "zod";
import type { HistoryRange } from "../../domain/history";
import type { EpisodeIds, MovieIds, ShowIds } from "../../domain/model/ids";
import type { LastActivities } from "../../domain/sync-activities";
import type { RequestOptions, TraktClient, TraktResult } from "./client";
import {
  type CalendarItem,
  calendarSchema,
  type EpisodeData,
  episodeSchema,
  type HiddenItem,
  type HistoryItem,
  hiddenSchema,
  historySchema,
  lastActivitiesSchema,
  type MovieDetailData,
  type MovieSummary,
  movieDetailSchema,
  type Progress,
  popularMoviesSchema,
  popularShowsSchema,
  progressSchema,
  relatedMoviesSchema,
  type SearchResult,
  type SeasonData,
  type ShowDetailData,
  type ShowSummary,
  searchSchema,
  seasonsSchema,
  showDetailSchema,
  type TrendingMovie,
  type TrendingShow,
  trendingMoviesSchema,
  trendingShowsSchema,
  type UserSettings,
  type UserStats,
  userSettingsSchema,
  userStatsSchema,
  type WatchedMovie,
  type WatchedShow,
  type WatchlistItem,
  watchedMoviesSchema,
  watchedShowsSchema,
  watchlistSchema,
} from "./schemas";

const ART: readonly ["full", "images"] = ["full", "images"];
const IMAGES: readonly ["images"] = ["images"];
// Only extended=progress returns the per-season watched breakdown, and only full returns status.
const WATCHED_SHOWS_EXTENDED: readonly ["full", "progress"] = ["full", "progress"];

const LIST_PAGE_LIMIT = 100;

function parse<T>(result: TraktResult<unknown>, schema: z.ZodType<T>): TraktResult<T> {
  if (!result.ok) return result;
  return { ok: true, data: schema.parse(result.data), pagination: result.pagination };
}

export async function getWatchedShows(client: TraktClient): Promise<TraktResult<WatchedShow[]>> {
  return parse(
    await client.getAllPages("/sync/watched/shows", {
      extended: WATCHED_SHOWS_EXTENDED,
      limit: LIST_PAGE_LIMIT,
    }),
    watchedShowsSchema,
  );
}

export async function getWatchedMovies(client: TraktClient): Promise<TraktResult<WatchedMovie[]>> {
  return parse(
    await client.getAllPages("/sync/watched/movies", {
      extended: IMAGES,
      limit: LIST_PAGE_LIMIT,
    }),
    watchedMoviesSchema,
  );
}

export async function getShowProgress(
  client: TraktClient,
  showId: number | string,
  includeSpecials = false,
): Promise<TraktResult<Progress>> {
  const specials = includeSpecials ? "true" : "false";
  const options: RequestOptions = {
    extended: ART,
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

export async function getMovie(
  client: TraktClient,
  movieId: number | string,
): Promise<TraktResult<MovieDetailData>> {
  return parse(await client.get(`/movies/${movieId}`, { extended: ART }), movieDetailSchema);
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
    await client.getAllPages(`/sync/watchlist/${type}`, { extended: ART, limit: LIST_PAGE_LIMIT }),
    watchlistSchema,
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

export async function getTrendingMovies(
  client: TraktClient,
  limit = 24,
): Promise<TraktResult<TrendingMovie[]>> {
  return parse(
    await client.get("/movies/trending", { extended: ART, limit }),
    trendingMoviesSchema,
  );
}

export async function getPopularMovies(
  client: TraktClient,
  limit = 24,
): Promise<TraktResult<MovieSummary[]>> {
  return parse(await client.get("/movies/popular", { extended: ART, limit }), popularMoviesSchema);
}

export async function getRelatedMovies(
  client: TraktClient,
  movieId: number | string,
  limit = 12,
): Promise<TraktResult<MovieSummary[]>> {
  return parse(
    await client.get(`/movies/${movieId}/related`, { extended: ART, limit }),
    relatedMoviesSchema,
  );
}

export async function getRelatedShows(
  client: TraktClient,
  showId: number | string,
  limit = 6,
): Promise<TraktResult<ShowSummary[]>> {
  return parse(
    await client.get(`/shows/${showId}/related`, { extended: ART, limit }),
    popularShowsSchema,
  );
}

export async function getUserStats(client: TraktClient): Promise<TraktResult<UserStats>> {
  return parse(await client.get("/users/me/stats"), userStatsSchema);
}

export async function getUserSettings(client: TraktClient): Promise<TraktResult<UserSettings>> {
  return parse(await client.get("/users/settings"), userSettingsSchema);
}

export async function getHidden(client: TraktClient): Promise<TraktResult<HiddenItem[]>> {
  return parse(
    await client.getAllPages("/users/hidden/progress_watched", { limit: LIST_PAGE_LIMIT }),
    hiddenSchema,
  );
}

export async function getLastActivities(client: TraktClient): Promise<TraktResult<LastActivities>> {
  return parse(await client.get("/sync/last_activities"), lastActivitiesSchema);
}

type HistorySection = "all" | "episodes" | "movies";

const HISTORY_PAGE_LIMIT = 30;

export async function getHistory(
  client: TraktClient,
  section: HistorySection,
  page: number,
  range?: HistoryRange,
): Promise<TraktResult<HistoryItem[]>> {
  const path = section === "all" ? "/users/me/history" : `/users/me/history/${section}`;
  const query = range === undefined ? undefined : { start_at: range.startAt, end_at: range.endAt };
  return parse(
    await client.get(path, { extended: ART, page, limit: HISTORY_PAGE_LIMIT, query }),
    historySchema,
  );
}

export async function getItemPlays(
  client: TraktClient,
  kind: "shows" | "episodes" | "movies",
  id: number | string,
): Promise<TraktResult<HistoryItem[]>> {
  return parse(
    await client.getAllPages(`/sync/history/${kind}/${id}`, {
      extended: ["full"],
      limit: HISTORY_PAGE_LIMIT,
    }),
    historySchema,
  );
}

type IdBlock = ShowIds | MovieIds | EpisodeIds;

export interface ItemSelection {
  readonly shows?: readonly ShowIds[];
  readonly movies?: readonly MovieIds[];
  readonly episodes?: readonly EpisodeIds[];
}

export function itemsBody(selection: ItemSelection): Record<string, { ids: IdBlock }[]> {
  const sections: readonly (keyof ItemSelection)[] = ["shows", "movies", "episodes"];
  const body: Record<string, { ids: IdBlock }[]> = {};
  for (const section of sections) {
    const ids = selection[section];
    if (ids !== undefined && ids.length > 0) body[section] = ids.map((id) => ({ ids: id }));
  }
  return body;
}
