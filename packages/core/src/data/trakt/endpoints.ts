import type { z } from "zod";
import type { HistoryRange } from "../../domain/history";
import type { EpisodeIds, MovieIds, ShowIds } from "../../domain/model/ids";
import type { LastActivities } from "../../domain/sync-activities";
import type { RequestOptions, TraktClient, TraktResult } from "./client";
import { decode } from "./decode";
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

function decodeRead<T>(
  client: TraktClient,
  endpoint: string,
  result: TraktResult<unknown>,
  schema: z.ZodType<T>,
): TraktResult<T> {
  if (!result.ok) {
    client.report(endpoint, result.error);
    return result;
  }
  const decoded = decode(schema, result.data);
  if (!decoded.ok) {
    const error = { kind: "unexpected-shape", issues: decoded.issues } as const;
    client.report(endpoint, error);
    return { ok: false, error };
  }
  if (decoded.skipped.length > 0) {
    client.report(endpoint, { kind: "skipped-fields", issues: decoded.skipped });
  }
  return { ok: true, data: decoded.data, pagination: result.pagination };
}

async function readOne<T>(
  client: TraktClient,
  endpoint: string,
  schema: z.ZodType<T>,
  path: string = endpoint,
  options: RequestOptions = {},
): Promise<TraktResult<T>> {
  return decodeRead(client, endpoint, await client.get(path, options), schema);
}

async function readAll<T>(
  client: TraktClient,
  endpoint: string,
  schema: z.ZodType<T>,
  path: string = endpoint,
  options: RequestOptions = {},
): Promise<TraktResult<T>> {
  const limit = client.policy.pageSize.list;
  return decodeRead(
    client,
    endpoint,
    await client.getAllPages(path, { limit, ...options }),
    schema,
  );
}

export function getWatchedShows(client: TraktClient): Promise<TraktResult<WatchedShow[]>> {
  return readAll(client, "/sync/watched/shows", watchedShowsSchema, undefined, {
    extended: WATCHED_SHOWS_EXTENDED,
  });
}

export function getWatchedMovies(client: TraktClient): Promise<TraktResult<WatchedMovie[]>> {
  return readAll(client, "/sync/watched/movies", watchedMoviesSchema, undefined, {
    extended: IMAGES,
  });
}

export function getShowProgress(
  client: TraktClient,
  showId: number | string,
  includeSpecials = false,
): Promise<TraktResult<Progress>> {
  const specials = includeSpecials ? "true" : "false";
  return readOne(
    client,
    "/shows/:id/progress/watched",
    progressSchema,
    `/shows/${showId}/progress/watched`,
    { extended: ART, query: { hidden: "false", specials, count_specials: specials } },
  );
}

export function getShow(
  client: TraktClient,
  showId: number | string,
): Promise<TraktResult<ShowDetailData>> {
  return readOne(client, "/shows/:id", showDetailSchema, `/shows/${showId}`, { extended: ART });
}

export function getMovie(
  client: TraktClient,
  movieId: number | string,
): Promise<TraktResult<MovieDetailData>> {
  return readOne(client, "/movies/:id", movieDetailSchema, `/movies/${movieId}`, {
    extended: ART,
  });
}

export function getShowSeasons(
  client: TraktClient,
  showId: number | string,
): Promise<TraktResult<SeasonData[]>> {
  return readOne(client, "/shows/:id/seasons", seasonsSchema, `/shows/${showId}/seasons`, {
    extended: ["episodes", "full", "images"],
  });
}

export function getEpisode(
  client: TraktClient,
  showId: number | string,
  season: number,
  episode: number,
): Promise<TraktResult<EpisodeData>> {
  const path = `/shows/${showId}/seasons/${season}/episodes/${episode}`;
  return readOne(client, "/shows/:id/seasons/:season/episodes/:episode", episodeSchema, path, {
    extended: ART,
  });
}

export function getWatchlist(
  client: TraktClient,
  type: "shows" | "movies",
): Promise<TraktResult<WatchlistItem[]>> {
  const path = `/sync/watchlist/${type}`;
  return readAll(client, path, watchlistSchema, path, { extended: ART });
}

export function getMyShowsCalendar(
  client: TraktClient,
  startDate: string,
  days: number,
): Promise<TraktResult<CalendarItem[]>> {
  const path = `/calendars/my/shows/${startDate}/${days}`;
  return readOne(client, "/calendars/my/shows/:start/:days", calendarSchema, path, {
    extended: ART,
  });
}

export function searchTrakt(
  client: TraktClient,
  query: string,
  types: readonly ("show" | "movie")[] = ["show", "movie"],
): Promise<TraktResult<SearchResult[]>> {
  return readOne(client, "/search/:types", searchSchema, `/search/${types.join(",")}`, {
    query: { query },
    extended: ART,
  });
}

export function getTrendingShows(
  client: TraktClient,
  limit = 24,
): Promise<TraktResult<TrendingShow[]>> {
  return readOne(client, "/shows/trending", trendingShowsSchema, undefined, {
    extended: ART,
    limit,
  });
}

export function getPopularShows(
  client: TraktClient,
  limit = 24,
): Promise<TraktResult<ShowSummary[]>> {
  return readOne(client, "/shows/popular", popularShowsSchema, undefined, { extended: ART, limit });
}

export function getTrendingMovies(
  client: TraktClient,
  limit = 24,
): Promise<TraktResult<TrendingMovie[]>> {
  return readOne(client, "/movies/trending", trendingMoviesSchema, undefined, {
    extended: ART,
    limit,
  });
}

export function getPopularMovies(
  client: TraktClient,
  limit = 24,
): Promise<TraktResult<MovieSummary[]>> {
  return readOne(client, "/movies/popular", popularMoviesSchema, undefined, {
    extended: ART,
    limit,
  });
}

export function getRelatedMovies(
  client: TraktClient,
  movieId: number | string,
  limit = 12,
): Promise<TraktResult<MovieSummary[]>> {
  return readOne(client, "/movies/:id/related", popularMoviesSchema, `/movies/${movieId}/related`, {
    extended: ART,
    limit,
  });
}

export function getRelatedShows(
  client: TraktClient,
  showId: number | string,
  limit = 6,
): Promise<TraktResult<ShowSummary[]>> {
  return readOne(client, "/shows/:id/related", popularShowsSchema, `/shows/${showId}/related`, {
    extended: ART,
    limit,
  });
}

export function getUserStats(client: TraktClient): Promise<TraktResult<UserStats>> {
  return readOne(client, "/users/me/stats", userStatsSchema);
}

export function getUserSettings(client: TraktClient): Promise<TraktResult<UserSettings>> {
  return readOne(client, "/users/settings", userSettingsSchema);
}

export function getHidden(client: TraktClient): Promise<TraktResult<HiddenItem[]>> {
  return readAll(client, "/users/hidden/progress_watched", hiddenSchema);
}

export function getLastActivities(client: TraktClient): Promise<TraktResult<LastActivities>> {
  return readOne(client, "/sync/last_activities", lastActivitiesSchema);
}

type HistorySection = "all" | "episodes" | "movies";

export function getHistory(
  client: TraktClient,
  section: HistorySection,
  page: number,
  range?: HistoryRange,
): Promise<TraktResult<HistoryItem[]>> {
  const path = section === "all" ? "/users/me/history" : `/users/me/history/${section}`;
  const query = range === undefined ? undefined : { start_at: range.startAt, end_at: range.endAt };
  const limit = client.policy.pageSize.history;
  return readOne(client, path, historySchema, path, { extended: ART, page, limit, query });
}

export function getItemPlays(
  client: TraktClient,
  kind: "shows" | "episodes" | "movies",
  id: number | string,
): Promise<TraktResult<HistoryItem[]>> {
  return readAll(
    client,
    `/sync/history/${kind}/:id`,
    historySchema,
    `/sync/history/${kind}/${id}`,
    {
      extended: ["full"],
      limit: client.policy.pageSize.history,
    },
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
