/**
 * The write endpoints, applied to the account so the next read sees them. Each
 * answer follows the bodies recorded from real Trakt: which count sections a
 * write answers with, what `not_found` echoes, and which activity stamps move.
 */

import { z } from "zod";
import {
  type Account,
  CATALOG_MOVIES,
  CATALOG_SHOWS,
  type Episode,
  libraryMovie,
  libraryShow,
  type Movie,
  type Show,
} from "./account.ts";
import { allEpisodes, playId, playItem, watchedAtOf } from "./bodies.ts";

const ids = z.looseObject({ trakt: z.number().optional(), slug: z.string().optional() });
const stamped = { watched_at: z.string().nullish() };
const item = z.looseObject({ ids: ids.optional(), ...stamped });
const season = z.looseObject({
  number: z.number(),
  ...stamped,
  episodes: z.array(z.looseObject({ number: z.number(), ...stamped })).optional(),
});

export const writeBodySchema = z.looseObject({
  shows: z.array(item.extend({ seasons: z.array(season).optional() })).optional(),
  episodes: z.array(item).optional(),
  movies: z.array(item).optional(),
  ids: z.array(z.number()).optional(),
});

export type WriteBody = z.infer<typeof writeBodySchema>;
type Item = z.infer<typeof item>;
type ShowItem = NonNullable<WriteBody["shows"]>[number];

const matchesIds = (entry: Item, trakt: number, slug: string): boolean =>
  entry.ids?.trakt === trakt || (entry.ids?.slug !== undefined && entry.ids.slug === slug);

const showOf = (account: Account, entry: Item): Show | undefined =>
  account.shows.find((show) => matchesIds(entry, show.trakt, show.slug));

const movieOf = (account: Account, entry: Item): Movie | undefined =>
  account.movies.find((movie) => matchesIds(entry, movie.trakt, movie.slug));

const episodeOf = (account: Account, traktId: number | undefined): Episode | undefined =>
  account.shows.flatMap(allEpisodes).find((ep) => ep.traktId === traktId);

/** The entries of one section that name nothing in the account, which Trakt echoes back as sent. */
const missing = <T extends Item>(
  entries: readonly T[] | undefined,
  found: (entry: T) => unknown,
): T[] => (entries ?? []).filter((entry) => found(entry) === undefined);

/** A stamp later than every activity so far, so each write reads as new to an activity diff. */
function activityTime(account: Account, clock: number): number {
  const { untracked: _, ...moving } = account.activities;
  return Math.max(clock, ...Object.values(moving).map((stamp) => stamp + 1));
}

const toMinute = (ms: number): number => Math.floor(ms / 60_000) * 60_000;
const toSecond = (ms: number): number => Math.floor(ms / 1000) * 1000;

/**
 * Each play's own `watched_at`, the nearest one sent for it (an episode's, then its
 * season's, then its show's), stored to the minute; a play sent without one is
 * stamped with the time of the request.
 */
function stampOf(sent: readonly (string | null | undefined)[], now: number): number {
  const parsed = Date.parse(sent.find((value) => value !== undefined && value !== null) ?? "");
  return toMinute(Number.isNaN(parsed) ? now : parsed);
}

interface Target {
  readonly ep: Episode;
  readonly sent: readonly (string | null | undefined)[];
}

interface Counts {
  movies: number;
  episodes: number;
}

interface Tally {
  readonly added: Counts;
  readonly updated: Counts;
  readonly deleted: Counts;
}

/** An episode named in a bulk `shows[].seasons[]` tree, with what was sent at each level. */
function seasonTarget(shows: readonly ShowItem[], ep: Episode): Target | null {
  const entry = shows.find((candidate) => candidate.seasons?.some((s) => s.number === ep.season));
  const season = entry?.seasons?.find((candidate) => candidate.number === ep.season);
  if (season === undefined) return null;
  const named = season.episodes?.find((candidate) => candidate.number === ep.number);
  if (season.episodes !== undefined && named === undefined) return null;
  return { ep, sent: [named?.watched_at, season.watched_at, entry?.watched_at] };
}

/** The episodes of one show a write names: by episode id, by history row, or by season (all of it, or listed numbers). */
function targetedEpisodes(show: Show, body: WriteBody): Target[] {
  const rows = new Set((body.ids ?? []).map(playItem));
  const shows = (body.shows ?? []).filter((entry) => matchesIds(entry, show.trakt, show.slug));
  return allEpisodes(show).flatMap((ep) => {
    const direct = (body.episodes ?? []).find((entry) => entry.ids?.trakt === ep.traktId);
    if (direct !== undefined || rows.has(ep.traktId)) return [{ ep, sent: [direct?.watched_at] }];
    return seasonTarget(shows, ep) ?? [];
  });
}

/** Stamps every watched episode with the date it reads now, so a later write cannot move an earlier play. */
function settlePlays(show: Show): void {
  show.episodes.slice(0, show.completed).forEach((ep, index) => {
    if (!show.watchedAt.has(ep.traktId)) show.watchedAt.set(ep.traktId, watchedAtOf(show, index));
  });
}

const isWatched = (show: Show, ep: Episode): boolean =>
  ep.season === 0
    ? show.specialsWatchedAt.has(ep.traktId)
    : show.episodes.indexOf(ep) < show.completed;

/** A play for a watched episode is a second play, or with Multiple Plays off replaces the first's date. */
function addEpisodePlay(
  account: Account,
  show: Show,
  ep: Episode,
  stamp: number,
  tally: Tally,
): void {
  const watched = isWatched(show, ep);
  if (watched && account.multiplePlays) {
    account.rewatchedEpisodes.set(ep.traktId, stamp);
    tally.added.episodes += 1;
    return;
  }
  if (watched) tally.updated.episodes += 1;
  else tally.added.episodes += 1;
  if (ep.season === 0) {
    show.specialsWatchedAt.set(ep.traktId, stamp);
    return;
  }
  show.watchedAt.set(ep.traktId, stamp);
  show.completed = Math.max(show.completed, show.episodes.indexOf(ep) + 1);
  show.lastWatchedAt = Math.max(show.lastWatchedAt ?? 0, stamp);
}

/**
 * Removes the plays a write names: a history row id removes that one play, and an
 * item removes every play of it (recorded as `deleted.movies: 2` for a movie with
 * two plays). Answers how many plays went.
 */
function removeEpisodePlays(
  account: Account,
  show: Show,
  ep: Episode,
  rows: ReadonlySet<number>,
): number {
  const second = account.rewatchedEpisodes.has(ep.traktId);
  const onlySecond = rows.has(playId(ep.traktId, 2)) && !rows.has(playId(ep.traktId));
  account.rewatchedEpisodes.delete(ep.traktId);
  if (onlySecond) return 1;
  if (ep.season === 0) show.specialsWatchedAt.delete(ep.traktId);
  else {
    const index = show.episodes.indexOf(ep);
    show.completed = Math.min(show.completed, index);
    show.watchedAt.delete(ep.traktId);
    if (show.completed === 0) show.lastWatchedAt = null;
  }
  return second ? 2 : 1;
}

function applyShowWrite(
  account: Account,
  show: Show,
  body: WriteBody,
  remove: boolean,
  now: number,
  tally: Tally,
) {
  const targeted = targetedEpisodes(show, body).filter(({ ep }) => !remove || isWatched(show, ep));
  if (targeted.length === 0) return false;
  settlePlays(show);
  show.progressAt = undefined;
  const rows = new Set(body.ids ?? []);
  for (const { ep, sent } of targeted) {
    if (remove) tally.deleted.episodes += removeEpisodePlays(account, show, ep, rows);
    else addEpisodePlay(account, show, ep, stampOf(sent, now), tally);
  }
  return true;
}

const sentFor = (movie: Movie, body: WriteBody) =>
  (body.movies ?? []).find((entry) => matchesIds(entry, movie.trakt, movie.slug))?.watched_at;

const movieTargeted = (movie: Movie, body: WriteBody): boolean =>
  (body.movies ?? []).some((entry) => matchesIds(entry, movie.trakt, movie.slug)) ||
  (body.ids ?? []).some((id) => playItem(id) === movie.trakt);

/** Removing a movie's history row removes that play; removing the movie removes every play of it. */
function removeMoviePlays(account: Account, movie: Movie, body: WriteBody, tally: Tally): boolean {
  if (movie.watchedAt === null) return false;
  const rows = new Set(body.ids ?? []);
  const onlySecond = rows.has(playId(movie.trakt, 2)) && !rows.has(playId(movie.trakt));
  const plays = account.rewatchedMovies.delete(movie.trakt) ? 2 : 1;
  if (!onlySecond) movie.watchedAt = null;
  tally.deleted.movies += onlySecond ? 1 : plays;
  return true;
}

function addMoviePlay(account: Account, movie: Movie, stamp: number, tally: Tally): true {
  if (movie.watchedAt !== null && account.multiplePlays) {
    account.rewatchedMovies.set(movie.trakt, stamp);
    tally.added.movies += 1;
    return true;
  }
  if (movie.watchedAt === null) tally.added.movies += 1;
  else tally.updated.movies += 1;
  movie.watchedAt = stamp;
  return true;
}

/** A bulk entry with a season the show does not have is echoed whole, seasons that applied included. */
function seasonsNotFound(account: Account, shows: readonly ShowItem[] | undefined): ShowItem[] {
  return (shows ?? []).filter((entry) => {
    const show = showOf(account, entry);
    const known = new Set(show === undefined ? [] : allEpisodes(show).map((ep) => ep.season));
    return show !== undefined && (entry.seasons ?? []).some((s) => !known.has(s.number));
  });
}

function historyNotFound(account: Account, body: WriteBody) {
  return {
    movies: missing(body.movies, (entry) => movieOf(account, entry)),
    shows: missing(body.shows, (entry) => showOf(account, entry)),
    seasons: seasonsNotFound(account, body.shows),
    episodes: missing(body.episodes, (entry) => episodeOf(account, entry.ids?.trakt)),
    people: [],
    users: [],
    ...(body.ids === undefined
      ? {}
      : {
          ids: body.ids.filter(
            (id) =>
              episodeOf(account, playItem(id)) === undefined &&
              movieOf(account, { ids: { trakt: playItem(id) } }) === undefined,
          ),
        }),
  };
}

/**
 * `POST /sync/history` and its `/remove`. Bodies arrive as `episodes[]`, a
 * `shows[].seasons[]` tree, `movies[]`, or `ids[]` of history rows. Trakt stamps
 * the write, not the play: marking something as watched last Tuesday moves the
 * account's activity to now.
 */
export function applyHistoryWrite(
  account: Account,
  body: WriteBody,
  remove: boolean,
  clock: number,
) {
  const now = activityTime(account, clock);
  const zero = (): Counts => ({ movies: 0, episodes: 0 });
  const tally: Tally = { added: zero(), updated: zero(), deleted: zero() };
  const shows = account.shows.filter((show) =>
    applyShowWrite(account, show, body, remove, now, tally),
  );
  if (shows.length > 0) account.activities.episodes = activityTime(account, clock);
  const movies = account.movies.filter(
    (movie) =>
      movieTargeted(movie, body) &&
      (remove
        ? removeMoviePlays(account, movie, body, tally)
        : addMoviePlay(account, movie, stampOf([sentFor(movie, body)], now), tally)),
  );
  if (movies.length > 0) account.activities.movies = activityTime(account, clock);
  return {
    ...(remove ? { deleted: tally.deleted } : { added: tally.added, updated: tally.updated }),
    not_found: historyNotFound(account, body),
  };
}

/** Catalogue titles the account does not hold yet. */
export function catalogueOnly(account: Account, now: number) {
  return {
    shows: CATALOG_SHOWS.filter(
      (spec) => !account.shows.some((own) => own.trakt === spec.trakt),
    ).map((spec) => libraryShow(spec, now)),
    movies: CATALOG_MOVIES.filter(
      (spec) => !account.movies.some((own) => own.trakt === spec.trakt),
    ).map((spec) => libraryMovie(spec, now)),
  };
}

/** Adding a catalogue title to the watchlist brings it into the account, as on Trakt. */
function adoptCatalogue(account: Account, body: WriteBody): void {
  const { shows, movies } = catalogueOnly(account, account.now);
  account.shows.push(
    ...shows.filter((show) => (body.shows ?? []).some((e) => matchesIds(e, show.trakt, show.slug))),
  );
  account.movies.push(
    ...movies.filter((movie) =>
      (body.movies ?? []).some((e) => matchesIds(e, movie.trakt, movie.slug)),
    ),
  );
}

const listCounts = (shows: number, movies: number) => ({ movies, shows, seasons: 0, episodes: 0 });

/**
 * `POST /sync/watchlist` and its `/remove`. A show write moves
 * `shows.watchlisted_at`, a movie write `movies.watchlisted_at`, and both move
 * `watchlist.updated_at`; `lists.updated_at` stays. The answer carries the whole
 * watchlist's `item_count` and its `updated_at`, to the second.
 */
export function applyWatchlistWrite(
  account: Account,
  body: WriteBody,
  remove: boolean,
  clock: number,
) {
  if (!remove) adoptCatalogue(account, body);
  const shows = (body.shows ?? []).flatMap((entry) => showOf(account, entry) ?? []);
  const movies = (body.movies ?? []).flatMap((entry) => movieOf(account, entry) ?? []);
  const changed = <T extends { inWatchlist: boolean }>(items: readonly T[]) =>
    items.filter((it) => it.inWatchlist === remove);
  const moved = { shows: changed(shows), movies: changed(movies) };
  const at = toSecond(activityTime(account, clock));
  for (const listed of [...moved.shows, ...moved.movies]) listed.inWatchlist = !remove;
  if (moved.shows.length > 0) account.activities.showsWatchlist = at;
  if (moved.movies.length > 0) account.activities.moviesWatchlist = at;
  account.activities.watchlist = at;
  const counts = listCounts(moved.shows.length, moved.movies.length);
  const itemCount = [...account.shows, ...account.movies].filter(
    (listed) => listed.inWatchlist,
  ).length;
  return {
    ...(remove
      ? { deleted: counts }
      : {
          added: counts,
          existing: listCounts(
            shows.length - moved.shows.length,
            movies.length - moved.movies.length,
          ),
        }),
    not_found: {
      movies: missing(body.movies, (entry) => movieOf(account, entry)),
      shows: missing(body.shows, (entry) => showOf(account, entry)),
      seasons: [],
      episodes: [],
      people: [],
      users: [],
    },
    list: { updated_at: new Date(at).toISOString(), item_count: itemCount },
  };
}

function hiddenReceipt(account: Account, body: WriteBody, matched: number, remove: boolean) {
  const counts = { shows: matched };
  return {
    ...(remove ? { deleted: counts } : { added: counts }),
    not_found: {
      movies: [],
      shows: missing(body.shows, (entry) => showOf(account, entry)),
      seasons: [],
    },
  };
}

/** `POST /users/hidden/progress_watched` and its `/remove`. Trakt counts a show already hidden as added again. */
export function applyHiddenWrite(
  account: Account,
  body: WriteBody,
  remove: boolean,
  clock: number,
) {
  const matched = (body.shows ?? []).flatMap((entry) => showOf(account, entry) ?? []);
  for (const show of matched) show.hidden = !remove;
  if (matched.length > 0) account.activities.showsHidden = activityTime(account, clock);
  return hiddenReceipt(account, body, matched.length, remove);
}

/** `POST /users/hidden/dropped` and its `/remove`. Trakt keeps a dropped show on the calendar. */
export function applyDroppedWrite(
  account: Account,
  body: WriteBody,
  remove: boolean,
  clock: number,
) {
  const matched = (body.shows ?? []).flatMap((entry) => showOf(account, entry) ?? []);
  const at = activityTime(account, clock);
  account.dropped = account.dropped.filter(({ show }) => !matched.includes(show));
  if (!remove) account.dropped.push(...matched.map((show) => ({ show, at })));
  if (matched.length > 0) account.activities.dropped = at;
  return hiddenReceipt(account, body, matched.length, remove);
}
