import type { EpisodeIds, MovieIds, ShowIds } from "@domain/model/ids";
import type { LastActivities } from "@domain/sync-activities";
import type { z } from "zod";
import type { RequestOptions, TraktClient, TraktResult } from "./client";
import {
  type CalendarItem,
  calendarSchema,
  type HiddenItem,
  hiddenSchema,
  lastActivitiesSchema,
  type Progress,
  progressSchema,
  type RatingItem,
  ratingsSchema,
  type SearchResult,
  searchSchema,
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
): Promise<TraktResult<Progress>> {
  const options: RequestOptions = {
    extended: ["full"],
    query: { hidden: "false", specials: "false", count_specials: "false" },
  };
  return parse(await client.get(`/shows/${showId}/progress/watched`, options), progressSchema);
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
