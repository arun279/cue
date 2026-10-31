/**
 * The account as Trakt's read bodies. The shapes are Trakt's, not the app's:
 * `/sync/watched/shows` carries no images at any level (Trakt change #775),
 * `aired_episodes` counts aired episodes only, and the per-season watched
 * breakdown appears only under `extended=progress`.
 */

import {
  type Account,
  type Episode,
  type Movie,
  RELATED_MOVIES,
  RELATED_SHOWS,
  type Show,
} from "./account.ts";

/** Where an artwork string points: a Trakt-style path without a scheme, or the served fake's own image route. */
export type Art = (kind: string, id: number, slot: string) => string;

export const traktArt: Art = (kind, id, slot) =>
  `media.trakt.tv/images/${kind}/${id}/${slot}.jpg.webp`;

export interface View {
  readonly account: Account;
  readonly art: Art;
  readonly extended: string;
}

const iso = (ms: number): string => new Date(ms).toISOString();

export const hasAired = (ep: Episode, now: number): boolean =>
  ep.firstAired !== null && ep.firstAired <= now;

export const allEpisodes = (show: Show): readonly Episode[] => [
  ...show.specialEpisodes,
  ...show.episodes,
];

/**
 * The aired episodes a user's progress counts. Trakt keeps per-user progress as a
 * snapshot that only the user's own history writes for that show refresh, so a
 * show with `progressAt` counts only what had aired by then (trakt/api-help#446).
 */
const airedEpisodes = (show: Show, now: number): Episode[] =>
  show.episodes.filter((ep) => hasAired(ep, Math.min(now, show.progressAt ?? now)));

/** When an episode was watched: its own stamp if a write set one, else derived from the counter. */
export function watchedAtOf(show: Show, index: number): number {
  const ep = show.episodes[index];
  const stamped = ep === undefined ? undefined : show.watchedAt.get(ep.traktId);
  if (stamped !== undefined) return stamped;
  const base = show.lastWatchedAt ?? ep?.firstAired ?? 0;
  return base - (show.completed - 1 - index) * 86_400_000;
}

/** Trakt sends every slot for a title, an empty list where it has no artwork; the fake draws posters, fanart and stills. */
const TITLE_SLOTS = ["poster", "fanart", "logo", "clearart", "banner", "thumb"];
const DRAWN = new Set(["poster", "fanart", "screenshot"]);

function imageSet(view: View, kind: string, id: number, noArt: boolean, slots = TITLE_SLOTS) {
  return Object.fromEntries(
    slots.map((slot) => [slot, noArt || !DRAWN.has(slot) ? [] : [view.art(kind, id, slot)]]),
  );
}

const levelsOf = (extended: string): Set<string> => new Set(extended.split(","));

const showIds = (show: Show) => ({
  trakt: show.trakt,
  slug: show.slug,
  tvdb: show.sparseIds === true ? null : show.trakt + 200_000,
  imdb: show.sparseIds === true ? null : `tt${show.trakt}`,
  tmdb: show.tmdb,
});

/** An obscure episode has no IMDb or TVDB id, and an undated one no TMDB id. */
const episodeIds = (ep: Episode) => ({
  trakt: ep.traktId,
  tvdb: ep.obscure ? null : ep.traktId + 300_000,
  imdb: ep.obscure ? null : `tt${ep.traktId}`,
  tmdb: ep.firstAired === null ? null : ep.traktId + 400_000,
});

const movieIds = (movie: Movie) => ({
  trakt: movie.trakt,
  slug: movie.slug,
  imdb: `tt${movie.trakt}`,
  tmdb: movie.tmdb,
});

/** The show block Trakt nests inside sync, calendar and history rows. */
function showRef(view: View, show: Show) {
  const levels = levelsOf(view.extended);
  return {
    title: show.title,
    year: show.year,
    ids: showIds(show),
    ...(levels.has("full") ? { status: show.status, network: show.network } : {}),
    ...(levels.has("images")
      ? { images: imageSet(view, "shows", show.trakt, show.noArt === true) }
      : {}),
  };
}

export function episodeRef(view: View, ep: Episode) {
  const levels = levelsOf(view.extended);
  return {
    season: ep.season,
    number: ep.number,
    title: ep.title,
    ids: episodeIds(ep),
    ...(levels.has("full")
      ? {
          overview: ep.overview,
          runtime: ep.runtime,
          first_aired: ep.firstAired === null ? null : iso(ep.firstAired),
          episode_type: ep.type,
        }
      : {}),
    ...(levels.has("images")
      ? { images: imageSet(view, "episodes", ep.traktId, ep.obscure, ["screenshot"]) }
      : {}),
  };
}

export function movieRef(view: View, movie: Movie) {
  const levels = levelsOf(view.extended);
  return {
    title: movie.title,
    year: movie.year,
    ids: movieIds(movie),
    ...(levels.has("full")
      ? {
          overview: movie.overview,
          runtime: movie.runtime,
          released: movie.released,
          genres: movie.genres,
        }
      : {}),
    ...(levels.has("images")
      ? { images: imageSet(view, "movies", movie.trakt, movie.noArt === true) }
      : {}),
  };
}

export const findShow = (account: Account, id: string | number | undefined): Show | undefined =>
  account.shows.find((show) => show.trakt === Number(id) || show.slug === id);

export const findMovie = (account: Account, id: string | number | undefined): Movie | undefined =>
  account.movies.find((movie) => movie.trakt === Number(id) || movie.slug === id);

export function relatedShowsBody(view: View, show: Show) {
  return (RELATED_SHOWS.get(show.trakt) ?? []).flatMap((id) => {
    const related = findShow(view.account, id);
    return related === undefined ? [] : [showRef(view, related)];
  });
}

export function relatedMoviesBody(view: View, movie: Movie) {
  return (RELATED_MOVIES.get(movie.trakt) ?? []).flatMap((id) => {
    const related = findMovie(view.account, id);
    return related === undefined ? [] : [movieRef(view, related)];
  });
}

const playsOf = (account: Account, traktId: number): number =>
  1 + (account.rewatchedEpisodes.get(traktId)?.length ?? 0);

/** An episode's newest play by date, which is not always the last one added (recorded). */
export const latestPlay = (account: Account, traktId: number, first: number): number =>
  Math.max(first, ...(account.rewatchedEpisodes.get(traktId) ?? []));

const watchedEntry = (account: Account, traktId: number, number: number, at: number) => ({
  number,
  plays: playsOf(account, traktId),
  last_watched_at: iso(latestPlay(account, traktId, at)),
});

/** The watched-episode breakdown: watched episodes only, grouped by season, specials first. */
function watchedSeasons(account: Account, show: Show) {
  const bySeason = new Map<number, ReturnType<typeof watchedEntry>[]>();
  const add = (season: number, entry: ReturnType<typeof watchedEntry>): void => {
    bySeason.set(season, [...(bySeason.get(season) ?? []), entry]);
  };
  for (const sp of show.specialEpisodes) {
    const at = show.specialsWatchedAt.get(sp.traktId);
    if (at !== undefined) add(0, watchedEntry(account, sp.traktId, sp.number, at));
  }
  show.episodes.slice(0, show.completed).forEach((ep, index) => {
    add(ep.season, watchedEntry(account, ep.traktId, ep.number, watchedAtOf(show, index)));
  });
  return [...bySeason].map(([number, episodes]) => ({ number, episodes }));
}

const specialPlays = (account: Account, show: Show): number =>
  [...show.specialsWatchedAt.keys()].reduce((sum, traktId) => sum + playsOf(account, traktId), 0);

/** Every play of the show: each episode's, specials' and second plays included (recorded). */
const showPlays = (account: Account, show: Show): number =>
  show.episodes
    .slice(0, show.completed)
    .reduce((sum, ep) => sum + playsOf(account, ep.traktId), specialPlays(account, show));

const isPlayed = (show: Show): boolean => show.completed > 0 || show.specialsWatchedAt.size > 0;

/**
 * `/sync/watched/shows`: shows with at least one play, `aired_episodes` and
 * `runtime` always, `status` only under `extended=full`, the watched breakdown
 * only under `extended=progress`, and no images at any level.
 */
export function watchedShowsBody(view: View) {
  const { account } = view;
  const levels = levelsOf(view.extended);
  return account.shows.filter(isPlayed).map((show) => ({
    plays: showPlays(account, show),
    last_watched_at: iso(show.lastWatchedAt ?? account.now),
    last_updated_at: iso(show.lastWatchedAt ?? account.now),
    reset_at: show.resetAt === null ? null : iso(show.resetAt),
    ...(show.watchedRow?.last_watched_at === null ? { last_watched_at: null } : {}),
    show: {
      title: show.title,
      year: show.year,
      ids: showIds(show),
      aired_episodes: show.watchedRow?.aired_episodes ?? airedEpisodes(show, account.now).length,
      runtime: show.runtime,
      ...(levels.has("full") ? { status: show.status, network: show.network } : {}),
    },
    ...(levels.has("progress") ? { seasons: watchedSeasons(account, show) } : {}),
  }));
}

export function watchedMoviesBody(view: View) {
  return view.account.movies.flatMap((movie) => {
    if (movie.watchedAt === null) return [];
    const last = view.account.rewatchedMovies.get(movie.trakt) ?? movie.watchedAt;
    return [
      {
        plays: view.account.rewatchedMovies.has(movie.trakt) ? 2 : 1,
        last_watched_at: iso(last),
        last_updated_at: iso(last),
        movie: { ...movieRef(view, movie), runtime: movie.runtime },
      },
    ];
  });
}

/** Season 0 for a progress read: the tree entry when `specials`, and what counts when `countSpecials`. */
function specialsProgress(view: View, show: Show, specials: boolean, countSpecials: boolean) {
  const aired = show.specialEpisodes
    .filter((sp) => hasAired(sp, view.account.now))
    .map((sp) => {
      const at = show.specialsWatchedAt.get(sp.traktId);
      return {
        number: sp.number,
        completed: at !== undefined,
        last_watched_at: at === undefined ? null : iso(at),
      };
    });
  return {
    seasonZero: specials && aired.length > 0 ? ([[0, aired]] as const) : [],
    counted: countSpecials ? aired : [],
  };
}

/** Whether the episode at a watch-order index counts as watched: played, and after any restart. */
const sinceReset = (show: Show) => (index: number) =>
  index < show.completed && (show.resetAt === null || watchedAtOf(show, index) > show.resetAt);

/** The next episode: the first unwatched one, or with a stale snapshot only one that had aired by then. */
const nextEpisodeOf = (show: Show, aired: readonly Episode[]): Episode | undefined =>
  show.progressAt === undefined ? show.episodes[show.completed] : aired[show.completed];

/**
 * `/shows/:id/progress/watched`: counts over aired episodes, the per-season tree,
 * and the next episode's identity, the one thing the bulk watched list cannot
 * carry. With `specials`, season 0 joins the tree; with `countSpecials`, its
 * episodes count in the totals too.
 */
export function progressBody(view: View, show: Show, specials: boolean, countSpecials: boolean) {
  const aired = airedEpisodes(show, view.account.now);
  const bySeason = new Map<
    number,
    { number: number; completed: boolean; last_watched_at: string | null }[]
  >(show.episodes.map((ep) => [ep.season, []]));
  const counts = sinceReset(show);
  aired.forEach((ep, index) => {
    const watched = counts(index);
    bySeason.get(ep.season)?.push({
      number: ep.number,
      completed: watched,
      last_watched_at: watched
        ? iso(latestPlay(view.account, ep.traktId, watchedAtOf(show, index)))
        : null,
    });
  });
  const { seasonZero, counted } = specialsProgress(view, show, specials, countSpecials);
  const next =
    show.resetAt === null ? nextEpisodeOf(show, aired) : aired.find((_, index) => !counts(index));
  const previous = show.episodes[show.completed - 1];
  return {
    aired: aired.length + counted.length,
    completed:
      aired.filter((_, index) => counts(index)).length +
      counted.filter((sp) => sp.completed).length,
    last_watched_at: show.lastWatchedAt === null ? null : iso(show.lastWatchedAt),
    reset_at: show.resetAt === null ? null : iso(show.resetAt),
    seasons: [...seasonZero, ...bySeason].map(([number, episodes]) => ({
      number,
      title: number === 0 ? "Specials" : `Season ${number}`,
      aired: episodes.length,
      completed: episodes.filter((episode) => episode.completed).length,
      episodes,
    })),
    hidden_seasons: [],
    next_episode: next === undefined ? null : episodeRef(view, next),
    last_episode: previous === undefined ? null : episodeRef(view, previous),
  };
}

export function showDetailBody(view: View, show: Show) {
  const levels = levelsOf(view.extended);
  const premiere = show.episodes[0]?.firstAired ?? null;
  return {
    title: show.title,
    year: show.year,
    ids: showIds(show),
    ...(levels.has("full")
      ? {
          overview: show.overview,
          first_aired: premiere === null ? null : iso(premiere),
          runtime: show.runtime,
          network: show.network,
          status: show.status,
          genres: show.genres,
        }
      : {}),
    ...(levels.has("images")
      ? { images: imageSet(view, "shows", show.trakt, show.noArt === true) }
      : {}),
  };
}

export function seasonsBody(view: View, show: Show) {
  const levels = levelsOf(view.extended);
  const bySeason = new Map<number, Episode[]>();
  for (const ep of allEpisodes(show))
    bySeason.set(ep.season, [...(bySeason.get(ep.season) ?? []), ep]);
  return [...bySeason].map(([number, episodes]) => ({
    number,
    title: `Season ${number}`,
    ids: { trakt: show.trakt * 10 + number, tmdb: show.tmdb * 10 + number },
    ...(levels.has("episodes") ? { episodes: episodes.map((ep) => episodeRef(view, ep)) } : {}),
  }));
}

/** `/calendars/my/shows/:start/:days`: every episode airing inside the window, of every show not hidden. */
export function calendarBody(view: View, startMs: number, days: number) {
  const end = startMs + days * 86_400_000;
  return view.account.shows
    .filter((show) => !show.hidden)
    .flatMap((show) =>
      allEpisodes(show)
        .filter((ep) => ep.firstAired !== null && ep.firstAired >= startMs && ep.firstAired < end)
        .map((ep) => ({
          first_aired: iso(ep.firstAired ?? 0),
          episode: episodeRef(view, ep),
          show: showRef(view, show),
        })),
    )
    .sort((a, b) => a.first_aired.localeCompare(b.first_aired));
}

/**
 * A history row's own id. Trakt mints one row per play and the app removes a play
 * by that row id: `item trakt * 10 + play number` is reversible, which is what
 * lets a removal by row id move the same counter a mark moves.
 */
export const playId = (traktId: number, play = 1): number => traktId * 10 + play;
export const playItem = (id: number): number => Math.floor(id / 10);

interface Row {
  readonly id: number;
  readonly watched_at: string;
  readonly order: number;
}

/** One row per play: the first at `at`, then each later one in the order it was added. */
function playRows(at: number, replays: readonly number[], traktId: number, order: number) {
  return [at, ...replays].map((stamp, play) => ({
    id: playId(traktId, play + 1),
    watched_at: iso(stamp),
    order,
  }));
}

function episodeRows(view: View, show: Show) {
  const { account } = view;
  const of = (ep: Episode, at: number, order: number) =>
    playRows(at, account.rewatchedEpisodes.get(ep.traktId) ?? [], ep.traktId, order).map((row) => ({
      ...row,
      action: "watch",
      type: "episode",
      episode: episodeRef(view, ep),
      show: showRef(view, show),
    }));
  return [
    ...show.specialEpisodes.flatMap((sp) => {
      const at = show.specialsWatchedAt.get(sp.traktId);
      return at === undefined ? [] : of(sp, at, sp.number - 100);
    }),
    ...show.episodes
      .slice(0, show.completed)
      .flatMap((ep, index) => of(ep, watchedAtOf(show, index), index)),
  ];
}

const replaysOf = (replay: number | undefined): number[] => (replay === undefined ? [] : [replay]);

function movieRows(view: View) {
  return view.account.movies.flatMap((movie) =>
    movie.watchedAt === null
      ? []
      : playRows(
          movie.watchedAt,
          replaysOf(view.account.rewatchedMovies.get(movie.trakt)),
          movie.trakt,
          0,
        ).map((row) => ({ ...row, action: "watch", type: "movie", movie: movieRef(view, movie) })),
  );
}

/** Newest first; plays at the same minute list the later episode first, as Trakt does. */
const newestFirst = (a: Row, b: Row): number =>
  b.watched_at.localeCompare(a.watched_at) || b.order - a.order;

const withoutOrder = <T extends Row>({ order: _, ...row }: T) => row;

/** `/users/me/history[/episodes|movies]`, or the plays of the shows `only` keeps. */
export function historyRows(
  view: View,
  section: "all" | "episodes" | "movies",
  only?: (show: Show) => boolean,
) {
  const shows = view.account.shows.filter(only ?? (() => true));
  return [
    ...(section === "movies" ? [] : shows.flatMap((show) => episodeRows(view, show))),
    ...(section === "episodes" ? [] : movieRows(view)),
  ]
    .sort(newestFirst)
    .map(withoutOrder);
}

const listedRow = (view: View, index: number) => ({
  rank: index + 1,
  listed_at: iso(view.account.now - (index + 1) * 86_400_000),
  notes: null,
});

export function watchlistBody(view: View, type: "shows" | "movies") {
  const { account } = view;
  return type === "shows"
    ? account.shows
        .filter((show) => show.inWatchlist)
        .map((show, index) => ({
          ...listedRow(view, index),
          id: show.trakt,
          type: "show",
          show: showRef(view, show),
        }))
    : account.movies
        .filter((movie) => movie.inWatchlist)
        .map((movie, index) => ({
          ...listedRow(view, index),
          id: movie.trakt,
          type: "movie",
          movie: movieRef(view, movie),
        }));
}

/**
 * `/sync/collection/shows`: each show with the last time an episode of it was
 * collected, without artwork even when asked for it, as Trakt sends it. Cue reads
 * membership only, so the per-season breakdown is left out.
 */
export function collectionShowsBody(view: View) {
  const bare = { ...view, extended: view.extended.replace(/,?images/, "") };
  return view.account.shows.flatMap((show) =>
    show.collectedAt === null
      ? []
      : [
          {
            last_collected_at: iso(show.collectedAt),
            last_updated_at: iso(show.collectedAt),
            show: showRef(bare, show),
          },
        ],
  );
}

export function collectionMoviesBody(view: View) {
  return view.account.movies.flatMap((movie) =>
    movie.collectedAt === null
      ? []
      : [
          {
            collected_at: iso(movie.collectedAt),
            updated_at: iso(movie.collectedAt),
            movie: movieRef(view, movie),
          },
        ],
  );
}

const hiddenRow = (view: View, show: Show, at: number) => ({
  hidden_at: iso(at),
  type: "show",
  show: { ...showRef(view, show), aired_episodes: airedEpisodes(show, view.account.now).length },
});

export const hiddenBody = (view: View) =>
  view.account.shows
    .filter((show) => show.hidden)
    .map((show) => hiddenRow(view, show, view.account.activities.showsHidden));

export const droppedBody = (view: View) =>
  view.account.dropped.map(({ show, at }) => hiddenRow(view, show, at));

const MOVIE_STAMPS = [
  "watched_at",
  "collected_at",
  "rated_at",
  "watchlisted_at",
  "favorited_at",
  "recommendations_at",
  "commented_at",
  "paused_at",
  "hidden_at",
];
const EPISODE_STAMPS = [
  "watched_at",
  "collected_at",
  "rated_at",
  "watchlisted_at",
  "commented_at",
  "paused_at",
];
const SHOW_STAMPS = [
  "rated_at",
  "watchlisted_at",
  "favorited_at",
  "recommendations_at",
  "commented_at",
  "hidden_at",
  "dropped_at",
];

/**
 * `/sync/last_activities`: every section and key Trakt sends. The ones this
 * account's writes move carry their own stamps; the rest share one that never moves.
 */
export function lastActivitiesBody(account: Account) {
  const a = account.activities;
  const stamps = (keys: readonly string[], moving: Record<string, number> = {}) =>
    Object.fromEntries(keys.map((key) => [key, iso(moving[key] ?? a.untracked)]));
  const moving = [
    a.episodes,
    a.showsHidden,
    a.showsWatchlist,
    a.movies,
    a.moviesWatchlist,
    a.watchlist,
    a.dropped,
  ];
  return {
    all: iso(Math.max(...moving)),
    movies: stamps(MOVIE_STAMPS, { watched_at: a.movies, watchlisted_at: a.moviesWatchlist }),
    episodes: stamps(EPISODE_STAMPS, { watched_at: a.episodes }),
    shows: stamps(SHOW_STAMPS, {
      hidden_at: a.showsHidden,
      dropped_at: a.dropped,
      watchlisted_at: a.showsWatchlist,
    }),
    seasons: stamps(["rated_at", "watchlisted_at", "commented_at", "hidden_at"]),
    comments: stamps(["liked_at", "blocked_at", "reacted_at"]),
    lists: stamps(["liked_at", "updated_at", "commented_at", "reacted_at"]),
    watchlist: stamps(["updated_at"], { updated_at: a.watchlist }),
    favorites: stamps(["updated_at"]),
    recommendations: stamps(["updated_at"]),
    collaborations: stamps(["updated_at"]),
    account: stamps(["settings_at", "followed_at", "following_at", "pending_at", "requested_at"]),
    saved_filters: stamps(["updated_at"]),
    notes: stamps(["updated_at"]),
  };
}

export function userSettingsBody(view: View) {
  const { user } = view.account;
  const avatar = view.art("users", 1, "avatar");
  return {
    user: {
      username: user.username,
      private: false,
      name: user.name,
      vip: false,
      ids: { slug: user.username },
      images: { avatar: { full: avatar.startsWith("http") ? avatar : `https://${avatar}` } },
    },
    account: { timezone: "America/New_York", date_format: "mdy", time_24hr: false },
  };
}

/** `/search/show,movie`: the account's titles and the catalogue-only ones, matched on title. */
export function searchBody(
  view: View,
  query: string,
  catalogue: { shows: readonly Show[]; movies: readonly Movie[] },
) {
  const needle = query.trim().toLowerCase();
  const rows = [
    ...[...view.account.shows, ...catalogue.shows].map((show) => ({
      type: "show",
      body: showRef(view, show),
    })),
    ...[...view.account.movies, ...catalogue.movies].map((movie) => ({
      type: "movie",
      body: movieRef(view, movie),
    })),
  ];
  return rows
    .filter((row) => needle !== "" && row.body.title.toLowerCase().includes(needle))
    .map((row, index) => ({ type: row.type, score: rows.length - index, [row.type]: row.body }));
}

/** `/{shows|movies}/{trending|popular}`: the account's own titles; trending wraps each in a watcher count. */
export function browseBody(view: View, kind: "shows" | "movies", trending: boolean) {
  const refs =
    kind === "movies"
      ? view.account.movies.filter((m) => m.shelf !== true).map((m) => movieRef(view, m))
      : view.account.shows.filter((s) => s.shelf !== true).map((s) => showRef(view, s));
  if (!trending) return refs;
  return refs.map((ref, index) => ({
    watchers: 900 - index * 60,
    [kind === "movies" ? "movie" : "show"]: ref,
  }));
}

/**
 * `/sync/history/{shows|episodes|movies}/:id`: every play of one item, which is
 * where a per-play unmark gets the row ids it removes. Null when the account has
 * no such item.
 */
export function itemPlaysBody(view: View, kind: string, id: string) {
  const { account } = view;
  const sorted = <T extends Row>(rows: readonly T[]) =>
    [...rows].sort(newestFirst).map(withoutOrder);
  if (kind === "movies") {
    const movie = findMovie(account, id);
    return movie === undefined
      ? null
      : sorted(movieRows(view).filter((row) => row.movie.ids.trakt === movie.trakt));
  }
  if (kind === "shows") {
    const show = findShow(account, id);
    return show === undefined ? null : sorted(episodeRows(view, show));
  }
  const owner = account.shows.find((show) =>
    allEpisodes(show).some((ep) => ep.traktId === Number(id)),
  );
  return owner === undefined
    ? null
    : sorted(episodeRows(view, owner).filter((row) => row.episode.ids.trakt === Number(id)));
}

const MOVIE_GENRES = [
  "Action",
  "Adventure",
  "Animation",
  "Anime",
  "Comedy",
  "Crime",
  "Documentary",
  "Donghua",
  "Drama",
  "Family",
  "Fantasy",
  "History",
  "Holiday",
  "Horror",
  "Music",
  "Musical",
  "Mystery",
  "None",
  "Romance",
  "Science Fiction",
  "Short",
  "Sporting Event",
  "Superhero",
  "Suspense",
  "Thriller",
  "War",
  "Western",
];
const SHOW_ONLY_GENRES = [
  "Biography",
  "Children",
  "Game Show",
  "Home And Garden",
  "Mini Series",
  "News",
  "Reality",
  "Soap",
  "Special Interest",
  "Talk Show",
];

const genre = (name: string) => ({ name, slug: name.toLowerCase().replaceAll(" ", "-") });

/** Trakt's `/genres/:type` lists, in its order. */
export const genresBody = (type: "shows" | "movies") =>
  (type === "movies" ? MOVIE_GENRES : [...MOVIE_GENRES, ...SHOW_ONLY_GENRES].sort()).map(genre);
