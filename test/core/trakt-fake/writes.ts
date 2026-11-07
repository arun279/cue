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
import { allEpisodes, hasAired, latestPlay, playId, playIdsOf, watchedAtOf } from "./bodies.ts";

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

/** Trakt stamps activity to the second, at the time of the write. */
const activityTime = (clock: number): number => Math.floor(clock / 1000) * 1000;

const toMinute = (ms: number): number => Math.floor(ms / 60_000) * 60_000;

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
  /** Named itself, so a removal takes every play of it, not only the rows it names. */
  readonly byItem: boolean;
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
  return { ep, sent: [named?.watched_at, season.watched_at, entry?.watched_at], byItem: true };
}

/** The episodes of one show a write names: by episode id, by history row, or by season (all of it, or listed numbers). */
function targetedEpisodes(account: Account, show: Show, body: WriteBody): Target[] {
  const rows = new Set(body.ids ?? []);
  const shows = (body.shows ?? []).filter((entry) => matchesIds(entry, show.trakt, show.slug));
  return allEpisodes(show).flatMap((ep) => {
    const direct = (body.episodes ?? []).find((entry) => entry.ids?.trakt === ep.traktId);
    const byRow = episodeRows(account, show, ep).some((id) => rows.has(id));
    if (direct !== undefined || byRow) {
      return [{ ep, sent: [direct?.watched_at], byItem: direct !== undefined }];
    }
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

const firstPlays = (show: Show, ep: Episode): Map<number, number> =>
  ep.season === 0 ? show.specialsWatchedAt : show.watchedAt;

/** An episode's play dates in play order: its first, then each later one. */
const episodeStamps = (account: Account, show: Show, ep: Episode): number[] =>
  isWatched(show, ep)
    ? [
        firstPlays(show, ep).get(ep.traktId) ?? 0,
        ...(account.rewatchedEpisodes.get(ep.traktId) ?? []),
      ]
    : [];

const episodeRows = (account: Account, show: Show, ep: Episode): readonly number[] =>
  playIdsOf(account, ep.traktId, episodeStamps(account, show, ep).length);

const movieRows = (account: Account, movie: Movie): readonly number[] =>
  playIdsOf(
    account,
    movie.trakt,
    movie.watchedAt === null ? 0 : account.rewatchedMovies.has(movie.trakt) ? 2 : 1,
  );

/** Records an item's rows after a change: those of `rows` it keeps, then a new one when `added`. */
function setRows(
  account: Account,
  traktId: number,
  rows: readonly number[],
  keep: (id: number) => boolean,
  added: boolean,
): void {
  const used = account.playRows.get(traktId)?.used ?? rows.length;
  const kept = rows.filter(keep);
  account.playRows.set(traktId, {
    ids: added ? [...kept, playId(traktId, used + 1)] : kept,
    used: added ? used + 1 : used,
  });
}

const every = (): boolean => true;

/**
 * A play for a watched episode is one more play, or with Multiple Plays off replaces the first's date.
 * A play the episode already has at that minute is not added again
 * (https://github.com/trakt/trakt-api/discussions/694).
 */
function addEpisodePlay(
  account: Account,
  show: Show,
  ep: Episode,
  stamp: number,
  tally: Tally,
): void {
  const stamps = episodeStamps(account, show, ep);
  if (stamps.includes(stamp)) return;
  const watched = stamps.length > 0;
  if (watched && !account.multiplePlays) tally.updated.episodes += 1;
  else {
    setRows(account, ep.traktId, episodeRows(account, show, ep), every, true);
    tally.added.episodes += 1;
  }
  if (watched && account.multiplePlays) {
    account.rewatchedEpisodes.set(ep.traktId, [...stamps.slice(1), stamp]);
    return;
  }
  firstPlays(show, ep).set(ep.traktId, stamp);
  if (ep.season !== 0) show.completed = Math.max(show.completed, show.episodes.indexOf(ep) + 1);
}

/**
 * The show's newest play by date, so a backdated play leaves it and removing the newest rolls it
 * back (recorded). An unaired special's play never counts (recorded); an aired special's counts,
 * which is recorded only for a show with no other play.
 */
function lastPlayOf(account: Account, show: Show): number | null {
  const specials = show.specialEpisodes.filter((sp) => hasAired(sp, account.now));
  const stamps = [
    ...show.episodes
      .slice(0, show.completed)
      .map((ep, index) => latestPlay(account, ep.traktId, watchedAtOf(show, index))),
    ...specials.flatMap((sp) => {
      const at = show.specialsWatchedAt.get(sp.traktId);
      return at === undefined ? [] : [latestPlay(account, sp.traktId, at)];
    }),
  ];
  return stamps.length === 0 ? null : Math.max(...stamps);
}

/**
 * Removes the plays a write names: a history row id removes that one play, an id the
 * item no longer has removes nothing, and an item removes every play of it (recorded as
 * `deleted.movies: 2` for a movie with two plays). Answers how many plays went.
 */
function removeEpisodePlays(
  account: Account,
  show: Show,
  ep: Episode,
  rows: ReadonlySet<number> | null,
): number {
  const stamps = episodeStamps(account, show, ep);
  const keep = (id: number): boolean => rows !== null && !rows.has(id);
  const plays = episodeRows(account, show, ep).map((id, play) => ({ id, at: stamps[play] ?? 0 }));
  const kept = plays.filter(({ id }) => keep(id));
  if (kept.length === plays.length) return 0;
  setRows(
    account,
    ep.traktId,
    plays.map(({ id }) => id),
    keep,
    false,
  );
  account.rewatchedEpisodes.delete(ep.traktId);
  const [earliest, ...later] = kept;
  if (earliest !== undefined) {
    if (later.length > 0)
      account.rewatchedEpisodes.set(
        ep.traktId,
        later.map(({ at }) => at),
      );
    firstPlays(show, ep).set(ep.traktId, earliest.at);
  } else {
    firstPlays(show, ep).delete(ep.traktId);
    if (ep.season !== 0) show.completed = Math.min(show.completed, show.episodes.indexOf(ep));
  }
  return plays.length - kept.length;
}

function applyShowWrite(
  account: Account,
  show: Show,
  body: WriteBody,
  remove: boolean,
  now: number,
  tally: Tally,
) {
  const targeted = targetedEpisodes(account, show, body).filter(
    ({ ep }) => !remove || isWatched(show, ep),
  );
  if (targeted.length === 0) return false;
  settlePlays(show);
  show.progressAt = undefined;
  const rows = new Set(body.ids ?? []);
  for (const { ep, sent, byItem } of targeted) {
    if (remove)
      tally.deleted.episodes += removeEpisodePlays(account, show, ep, byItem ? null : rows);
    else addEpisodePlay(account, show, ep, stampOf(sent, now), tally);
  }
  show.lastWatchedAt = lastPlayOf(account, show);
  return true;
}

const sentFor = (movie: Movie, body: WriteBody) =>
  (body.movies ?? []).find((entry) => matchesIds(entry, movie.trakt, movie.slug))?.watched_at;

const movieNamed = (movie: Movie, body: WriteBody): boolean =>
  (body.movies ?? []).some((entry) => matchesIds(entry, movie.trakt, movie.slug));

const movieTargeted = (account: Account, movie: Movie, body: WriteBody): boolean =>
  movieNamed(movie, body) || movieRows(account, movie).some((id) => body.ids?.includes(id));

/** Removing a movie's history row removes that play; removing the movie removes every play of it. */
function removeMoviePlays(account: Account, movie: Movie, body: WriteBody, tally: Tally): boolean {
  const stamps = [movie.watchedAt, account.rewatchedMovies.get(movie.trakt)];
  const keep = (id: number): boolean => !movieNamed(movie, body) && !body.ids?.includes(id);
  const plays = movieRows(account, movie).map((id, play) => ({ id, at: stamps[play] ?? null }));
  const kept = plays.filter(({ id }) => keep(id));
  if (kept.length === plays.length) return false;
  setRows(
    account,
    movie.trakt,
    plays.map(({ id }) => id),
    keep,
    false,
  );
  movie.watchedAt = kept[0]?.at ?? null;
  const second = kept[1]?.at;
  if (second == null) account.rewatchedMovies.delete(movie.trakt);
  else account.rewatchedMovies.set(movie.trakt, second);
  tally.deleted.movies += plays.length - kept.length;
  return true;
}

/** The account holds a movie's first play and at most one more, which a later play replaces. */
function addMoviePlay(account: Account, movie: Movie, stamp: number, tally: Tally): true {
  if ([movie.watchedAt, account.rewatchedMovies.get(movie.trakt)].includes(stamp)) return true;
  if (movie.watchedAt !== null && account.multiplePlays) {
    const [first] = movieRows(account, movie);
    setRows(account, movie.trakt, movieRows(account, movie), (id) => id === first, true);
    account.rewatchedMovies.set(movie.trakt, stamp);
    tally.added.movies += 1;
    return true;
  }
  if (movie.watchedAt === null) {
    tally.added.movies += 1;
    setRows(account, movie.trakt, [], every, true);
  } else tally.updated.movies += 1;
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

/** Every history row id the account holds now. */
const rowsOf = (account: Account): ReadonlySet<number> =>
  new Set([
    ...account.shows.flatMap((show) =>
      allEpisodes(show).flatMap((ep) => episodeRows(account, show, ep)),
    ),
    ...account.movies.flatMap((movie) => movieRows(account, movie)),
  ]);

function historyNotFound(account: Account, body: WriteBody) {
  return {
    movies: missing(body.movies, (entry) => movieOf(account, entry)),
    shows: missing(body.shows, (entry) => showOf(account, entry)),
    seasons: seasonsNotFound(account, body.shows),
    episodes: missing(body.episodes, (entry) => episodeOf(account, entry.ids?.trakt)),
    people: [],
    users: [],
    ...(body.ids === undefined ? {} : { ids: body.ids.filter((id) => !rowsOf(account).has(id)) }),
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
  const now = activityTime(clock);
  const zero = (): Counts => ({ movies: 0, episodes: 0 });
  const tally: Tally = { added: zero(), updated: zero(), deleted: zero() };
  const notFound = historyNotFound(account, body);
  const shows = account.shows.filter((show) =>
    applyShowWrite(account, show, body, remove, now, tally),
  );
  if (shows.length > 0) account.activities.episodes = activityTime(clock);
  const movies = account.movies.filter(
    (movie) =>
      movieTargeted(account, movie, body) &&
      (remove
        ? removeMoviePlays(account, movie, body, tally)
        : addMoviePlay(account, movie, stampOf([sentFor(movie, body)], now), tally)),
  );
  if (movies.length > 0) account.activities.movies = activityTime(clock);
  return {
    ...(remove ? { deleted: tally.deleted } : { added: tally.added, updated: tally.updated }),
    not_found: notFound,
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
  const at = activityTime(clock);
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
  if (matched.length > 0) account.activities.showsHidden = activityTime(clock);
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
  const at = activityTime(clock);
  account.dropped = account.dropped.filter(({ show }) => !matched.includes(show));
  if (!remove) account.dropped.push(...matched.map((show) => ({ show, at })));
  if (matched.length > 0) account.activities.dropped = at;
  return hiddenReceipt(account, body, matched.length, remove);
}
