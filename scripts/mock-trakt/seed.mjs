/**
 * The account the mock serves, and the Trakt bodies it serves it as.
 *
 * One seeded library, held in memory and moved by the write endpoints, so a mark
 * made in the app shows up on the next progress read. Every show is a flat list
 * of episodes in watch order plus a linear `completed` counter: the same model
 * the hermetic Playwright fixtures use, because it keeps the watched breakdown,
 * the progress tree, the history rows and the writes all derivable from one
 * number a write can move.
 *
 * The shapes are Trakt's, not the app's: `/sync/watched/shows` carries no images
 * at any level (Trakt change #775), `aired_episodes` counts aired episodes only,
 * and the per-season watched breakdown appears only under `extended=progress`.
 * A body more generous than the API certifies an API that does not exist.
 */

const DAY = 86_400_000;
const WEEK = 7 * DAY;

const EPISODE_TITLES = [
  "Low Tide",
  "Signal Fire",
  "The Long Way Down",
  "Paper Anchors",
  "Cold Open",
  "Hollow Point",
  "The Quiet Part",
  "Salt Air",
  "Nightjar",
  "Small Debts",
  "Half Measures",
  "The Undertow",
  "Glass and Grain",
];

const EPISODE_OVERVIEWS = [
  "A missed call turns into a longer night than anyone planned for.",
  "An old debt comes due and nobody wants to be the one to settle it.",
  "The plan survives contact with reality for almost an hour.",
  "Two people tell the same story and only one of them is lying.",
];

/**
 * Air dates run forward from `startDaysAgo` on a weekly cadence, so the seed
 * stays plausible whenever it boots: recent episodes are recent, and the shows
 * that should have something on the way still do.
 */
function buildEpisodes(spec, now) {
  const episodes = [];
  let index = 0;
  spec.seasons.forEach((count, seasonIndex) => {
    for (let number = 1; number <= count; number += 1) {
      episodes.push({
        traktId: spec.trakt * 100 + index,
        season: seasonIndex + 1,
        number,
        title: EPISODE_TITLES[(spec.trakt + index) % EPISODE_TITLES.length],
        overview: EPISODE_OVERVIEWS[(spec.trakt + index) % EPISODE_OVERVIEWS.length],
        firstAired: now - spec.startDaysAgo * DAY + index * WEEK,
        runtime: spec.runtime,
      });
      index += 1;
    }
  });
  return episodes;
}

/**
 * Eight shows covering every Up Next state at once: three with an aired backlog
 * (the queue), two idle past the staleness threshold (the lapsed drawer), two
 * with an episode still to air (On the way, Calendar), one finished, and one
 * watchlisted but never started.
 */
const SHOWS = [
  {
    trakt: 8801,
    tmdb: 98801,
    slug: "harbor-lights",
    title: "Harbor Lights",
    year: 2021,
    status: "returning series",
    network: "Meridian",
    runtime: 47,
    genres: ["drama", "mystery"],
    overview:
      "A harbourmaster who knows every boat in the bay starts noticing the ones that never leave.",
    seasons: [8, 8, 6],
    startDaysAgo: 400,
    completed: 20,
    lastWatchedDaysAgo: 2,
  },
  {
    trakt: 8802,
    tmdb: 98802,
    slug: "the-quiet-frontier",
    title: "The Quiet Frontier",
    year: 2019,
    status: "returning series",
    network: "Cordwood",
    runtime: 44,
    genres: ["western", "drama"],
    overview: "A frontier town keeps the peace by keeping its accounts, and its secrets, balanced.",
    seasons: [10, 10],
    startDaysAgo: 300,
    completed: 19,
    lastWatchedDaysAgo: 6,
  },
  {
    trakt: 8803,
    tmdb: 98803,
    slug: "midnight-cartography",
    title: "Midnight Cartography",
    year: 2023,
    status: "returning series",
    network: "Tessellate",
    runtime: 52,
    genres: ["thriller"],
    overview: "Two mapmakers find a road that only appears on drafts nobody admits to drawing.",
    seasons: [6, 6],
    startDaysAgo: 68,
    completed: 8,
    lastWatchedDaysAgo: 3,
  },
  {
    trakt: 8804,
    tmdb: 98804,
    slug: "paper-moon-radio",
    title: "Paper Moon Radio",
    year: 2022,
    status: "returning series",
    network: "Longwave",
    runtime: 39,
    genres: ["comedy"],
    overview: "The overnight shift at a station nobody listens to, hosted by people who need it.",
    seasons: [10, 8],
    startDaysAgo: 430,
    completed: 14,
    lastWatchedDaysAgo: 62,
  },
  {
    trakt: 8805,
    tmdb: 98805,
    slug: "glasshouse",
    title: "Glasshouse",
    year: 2018,
    status: "returning series",
    network: "Fernpost",
    runtime: 55,
    genres: ["drama"],
    overview: "A botanical institute runs on grants, grudges, and one greenhouse nobody may enter.",
    seasons: [13, 13],
    startDaysAgo: 900,
    completed: 18,
    lastWatchedDaysAgo: 140,
  },
  {
    trakt: 8806,
    tmdb: 98806,
    slug: "nine-lives-of-ada-rook",
    title: "Nine Lives of Ada Rook",
    year: 2024,
    status: "returning series",
    network: "Halyard",
    runtime: 51,
    genres: ["crime", "drama"],
    overview: "A claims investigator with nine open files and one she is not allowed to close.",
    seasons: [10],
    startDaysAgo: 58,
    completed: 9,
    lastWatchedDaysAgo: 1,
  },
  {
    trakt: 8807,
    tmdb: 98807,
    slug: "the-long-winter",
    title: "The Long Winter",
    year: 2016,
    status: "ended",
    network: "Northline",
    runtime: 58,
    genres: ["drama", "history"],
    overview:
      "Twelve episodes about one winter, told by the people who agreed never to mention it.",
    seasons: [6, 6],
    startDaysAgo: 1200,
    completed: 12,
    lastWatchedDaysAgo: 300,
  },
  {
    trakt: 8808,
    tmdb: 98808,
    slug: "coastal-static",
    title: "Coastal Static",
    year: 2025,
    status: "returning series",
    network: "Meridian",
    runtime: 43,
    genres: ["science fiction"],
    overview: "Something on the shipping forecast is answering back, politely, in the wrong order.",
    seasons: [8],
    startDaysAgo: 40,
    completed: 0,
    lastWatchedDaysAgo: null,
    inWatchlist: true,
  },
];

const MOVIES = [
  {
    trakt: 5501,
    tmdb: 95501,
    slug: "the-lantern-keeper",
    title: "The Lantern Keeper",
    year: 2021,
    released: "2021-09-17",
    runtime: 104,
    genres: ["drama"],
    overview: "The last keeper of an automated lighthouse refuses to leave on the arranged date.",
    lastWatchedDaysAgo: 12,
  },
  {
    trakt: 5502,
    tmdb: 95502,
    slug: "winter-ledger",
    title: "Winter Ledger",
    year: 2019,
    released: "2019-11-08",
    runtime: 118,
    genres: ["thriller"],
    overview: "An auditor snowed in at a country hotel finds the books balance a little too well.",
    lastWatchedDaysAgo: 40,
  },
  {
    trakt: 5503,
    tmdb: 95503,
    slug: "salt-and-static",
    title: "Salt and Static",
    year: 2024,
    released: "2024-05-31",
    runtime: 96,
    genres: ["science fiction", "drama"],
    overview:
      "A radio astronomer moves to the coast to hear one signal without the city in the way.",
    lastWatchedDaysAgo: null,
    inWatchlist: true,
  },
];

const iso = (ms) => new Date(ms).toISOString();

/** The mutable account every route reads and the write routes move. */
export function createLibrary(now = Date.now()) {
  return {
    now,
    shows: SHOWS.map((spec) => ({
      ...spec,
      hidden: false,
      inWatchlist: spec.inWatchlist === true,
      lastWatchedAt: spec.lastWatchedDaysAgo === null ? null : now - spec.lastWatchedDaysAgo * DAY,
      episodes: buildEpisodes(spec, now),
      /** `watched_at` by episode trakt id, so a mark the app made keeps its own stamp. */
      watchedAt: new Map(),
    })),
    movies: MOVIES.map((spec) => ({
      ...spec,
      inWatchlist: spec.inWatchlist === true,
      watchedAt: spec.lastWatchedDaysAgo === null ? null : now - spec.lastWatchedDaysAgo * DAY,
    })),
    user: { username: "cue-demo", name: "Cue Demo", slug: "cue-demo" },
    activities: {
      episodes: now - DAY,
      shows: now - DAY,
      movies: now - 2 * DAY,
      watchlist: now - 3 * DAY,
    },
  };
}

const seedProfiles = {
  default: () => {},
  "empty-library": (library) => {
    library.shows = [];
    library.movies = [];
  },
  "watchlist-only": (library) => {
    library.shows = library.shows.filter((show) => show.inWatchlist);
    library.movies = library.movies.filter((movie) => movie.inWatchlist);
  },
  "only-stopped": (library) => {
    const stopped = library.shows.find((show) => show.trakt === 8805);
    stopped.hidden = true;
    stopped.inWatchlist = false;
    library.shows = [stopped];
    library.movies = [];
  },
  "zeroed-stats": (library) => {
    for (const show of library.shows) {
      show.completed = 0;
      show.lastWatchedAt = null;
      show.watchedAt.clear();
    }
    for (const movie of library.movies) movie.watchedAt = null;
  },
  "rewatched-episode": (library) => {
    const episode = library.shows[0].episodes[0];
    library.rewatchedEpisodes = new Map([[episode.traktId, library.now - Math.floor(DAY / 2)]]);
  },
  "rewatched-movie": (library) => {
    const movie = library.movies[0];
    library.rewatchedMovies = new Map([[movie.trakt, library.now - Math.floor(DAY / 2)]]);
  },
};

export const hasSeedProfile = (profile) => Object.hasOwn(seedProfiles, profile);

export function createSeedLibrary(profile = "default", now = Date.now()) {
  if (!hasSeedProfile(profile)) throw new Error(`Unknown seed profile: ${profile}`);
  const library = createLibrary(now);
  seedProfiles[profile](library);
  return library;
}

const airedEpisodes = (show, now) => show.episodes.filter((ep) => ep.firstAired <= now);

/** When an episode was watched: the app's own stamp if it marked it, else derived. */
function watchedAtOf(show, index) {
  const stamped = show.watchedAt.get(show.episodes[index].traktId);
  if (stamped !== undefined) return stamped;
  const base = show.lastWatchedAt ?? show.episodes[index].firstAired;
  return base - (show.completed - 1 - index) * DAY;
}

const imageSet = (origin, kind, id, slots) =>
  Object.fromEntries(slots.map((slot) => [slot, [`${origin}/images/${kind}/${id}/${slot}.svg`]]));

const showIds = (show) => ({
  trakt: show.trakt,
  slug: show.slug,
  tvdb: show.trakt + 200_000,
  imdb: `tt${show.trakt}`,
  tmdb: show.tmdb,
});

const episodeIds = (ep) => ({
  trakt: ep.traktId,
  tvdb: ep.traktId + 300_000,
  imdb: `tt${ep.traktId}`,
  tmdb: ep.traktId + 400_000,
});

const movieIds = (movie) => ({
  trakt: movie.trakt,
  slug: movie.slug,
  imdb: `tt${movie.trakt}`,
  tmdb: movie.tmdb,
});

const levelsOf = (extended) => new Set(extended.split(","));

/** The show block Trakt nests inside sync, calendar and history rows. */
function showRef(show, origin, extended) {
  const levels = levelsOf(extended);
  return {
    title: show.title,
    year: show.year,
    ids: showIds(show),
    ...(levels.has("full") ? { status: show.status, network: show.network } : {}),
    ...(levels.has("images") ? { images: imageSet(origin, "shows", show.trakt, ["poster"]) } : {}),
  };
}

function episodeRef(ep, origin, extended) {
  const levels = levelsOf(extended);
  return {
    season: ep.season,
    number: ep.number,
    title: ep.title,
    ids: episodeIds(ep),
    ...(levels.has("full")
      ? { overview: ep.overview, runtime: ep.runtime, first_aired: iso(ep.firstAired) }
      : {}),
    ...(levels.has("images")
      ? { images: imageSet(origin, "episodes", ep.traktId, ["screenshot"]) }
      : {}),
  };
}

function movieRef(movie, origin, extended) {
  const levels = levelsOf(extended);
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
      ? { images: imageSet(origin, "movies", movie.trakt, ["poster"]) }
      : {}),
  };
}

/** The watched-episode breakdown: watched episodes only, grouped by season. */
function watchedSeasons(show, library) {
  const bySeason = new Map();
  show.episodes.slice(0, show.completed).forEach((ep, index) => {
    const episodes = bySeason.get(ep.season) ?? [];
    const rewatchedAt = library.rewatchedEpisodes?.get(ep.traktId);
    episodes.push({
      number: ep.number,
      plays: rewatchedAt === undefined ? 1 : 2,
      last_watched_at: iso(rewatchedAt ?? watchedAtOf(show, index)),
    });
    bySeason.set(ep.season, episodes);
  });
  return [...bySeason].map(([number, episodes]) => ({ number, episodes }));
}

/**
 * `/sync/watched/shows`: shows with at least one play, `aired_episodes` always,
 * `status` only under `extended=full`, the watched breakdown only under
 * `extended=progress`, and no images at any level.
 */
export function watchedShowsBody(library, extended) {
  const levels = levelsOf(extended);
  return library.shows
    .filter((show) => show.completed > 0)
    .map((show) => ({
      plays: show.completed,
      last_watched_at: iso(show.lastWatchedAt),
      last_updated_at: iso(show.lastWatchedAt),
      reset_at: null,
      show: {
        title: show.title,
        year: show.year,
        ids: showIds(show),
        aired_episodes: airedEpisodes(show, library.now).length,
        ...(levels.has("full") ? { status: show.status, network: show.network } : {}),
      },
      ...(levels.has("progress") ? { seasons: watchedSeasons(show, library) } : {}),
    }));
}

export function watchedMoviesBody(library, origin, extended) {
  return library.movies
    .filter((movie) => movie.watchedAt !== null)
    .map((movie) => ({
      plays: library.rewatchedMovies?.has(movie.trakt) === true ? 2 : 1,
      last_watched_at: iso(library.rewatchedMovies?.get(movie.trakt) ?? movie.watchedAt),
      last_updated_at: iso(library.rewatchedMovies?.get(movie.trakt) ?? movie.watchedAt),
      movie: movieRef(movie, origin, extended),
    }));
}

/**
 * `/shows/:id/progress/watched`: counts over aired episodes, the per-season tree
 * of what is watched, and the identity of the next episode, the one thing the
 * bulk watched list cannot carry.
 */
export function progressBody(show, library, origin, extended) {
  const aired = airedEpisodes(show, library.now);
  const bySeason = new Map();
  aired.forEach((ep, index) => {
    const episodes = bySeason.get(ep.season) ?? [];
    episodes.push({
      number: ep.number,
      completed: index < show.completed,
      last_watched_at: index < show.completed ? iso(watchedAtOf(show, index)) : null,
    });
    bySeason.set(ep.season, episodes);
  });
  const next = show.episodes[show.completed];
  const previous = show.episodes[show.completed - 1];
  return {
    aired: aired.length,
    completed: Math.min(show.completed, aired.length),
    last_watched_at: show.lastWatchedAt === null ? null : iso(show.lastWatchedAt),
    reset_at: null,
    seasons: [...bySeason].map(([number, episodes]) => ({
      number,
      title: `Season ${number}`,
      aired: episodes.length,
      completed: episodes.filter((episode) => episode.completed).length,
      episodes,
    })),
    hidden_seasons: [],
    next_episode: next === undefined ? null : episodeRef(next, origin, extended),
    last_episode: previous === undefined ? null : episodeRef(previous, origin, extended),
  };
}

export function showDetailBody(show, origin, extended) {
  const levels = levelsOf(extended);
  return {
    title: show.title,
    year: show.year,
    ids: showIds(show),
    ...(levels.has("full")
      ? {
          overview: show.overview,
          first_aired: iso(show.episodes[0].firstAired),
          runtime: show.runtime,
          network: show.network,
          status: show.status,
          genres: show.genres,
        }
      : {}),
    ...(levels.has("images")
      ? { images: imageSet(origin, "shows", show.trakt, ["poster", "fanart"]) }
      : {}),
  };
}

export const movieDetailBody = movieRef;

export function seasonsBody(show, origin, extended) {
  const levels = levelsOf(extended);
  const bySeason = new Map();
  for (const ep of show.episodes) bySeason.set(ep.season, [...(bySeason.get(ep.season) ?? []), ep]);
  return [...bySeason].map(([number, episodes]) => ({
    number,
    title: `Season ${number}`,
    ids: { trakt: show.trakt * 10 + number, tmdb: show.tmdb * 10 + number },
    ...(levels.has("episodes")
      ? { episodes: episodes.map((ep) => episodeRef(ep, origin, extended)) }
      : {}),
  }));
}

export const episodeDetailBody = episodeRef;

/** `/calendars/my/shows/:start/:days`: every episode airing inside the window. */
export function calendarBody(library, origin, extended, startMs, days) {
  const end = startMs + days * DAY;
  const rows = [];
  for (const show of library.shows) {
    if (show.hidden) continue;
    for (const ep of show.episodes) {
      if (ep.firstAired < startMs || ep.firstAired >= end) continue;
      rows.push({
        first_aired: iso(ep.firstAired),
        episode: episodeRef(ep, origin, extended),
        show: showRef(show, origin, extended),
      });
    }
  }
  return rows.sort((a, b) => a.first_aired.localeCompare(b.first_aired));
}

/**
 * A history row's own id, and the item that row belongs to. Trakt mints one row
 * per play and the app removes a play by that row id, so the two halves have to
 * agree: `item trakt * 10 + play number` is reversible, which is what lets a
 * `{ ids }` removal move the same linear counter a mark moves.
 */
const playId = (traktId, play = 1) => traktId * 10 + play;
const playItem = (id) => Math.floor(id / 10);

/** `/users/me/history`: one row per play, newest first. */
export function historyRows(library, origin, extended, section) {
  const rows = [];
  if (section !== "movies") {
    for (const show of library.shows) {
      show.episodes.slice(0, show.completed).forEach((ep, index) => {
        rows.push({
          id: playId(ep.traktId),
          watched_at: iso(watchedAtOf(show, index)),
          action: "scrobble",
          type: "episode",
          episode: episodeRef(ep, origin, extended),
          show: showRef(show, origin, extended),
        });
        const rewatchedAt = library.rewatchedEpisodes?.get(ep.traktId);
        if (rewatchedAt !== undefined) {
          rows.push({
            id: playId(ep.traktId, 2),
            watched_at: iso(rewatchedAt),
            action: "scrobble",
            type: "episode",
            episode: episodeRef(ep, origin, extended),
            show: showRef(show, origin, extended),
          });
        }
      });
    }
  }
  if (section !== "episodes") {
    for (const movie of library.movies) {
      if (movie.watchedAt === null) continue;
      rows.push({
        id: playId(movie.trakt),
        watched_at: iso(movie.watchedAt),
        action: "scrobble",
        type: "movie",
        movie: movieRef(movie, origin, extended),
      });
      const rewatchedAt = library.rewatchedMovies?.get(movie.trakt);
      if (rewatchedAt !== undefined) {
        rows.push({
          id: playId(movie.trakt, 2),
          watched_at: iso(rewatchedAt),
          action: "scrobble",
          type: "movie",
          movie: movieRef(movie, origin, extended),
        });
      }
    }
  }
  return rows.sort((a, b) => b.watched_at.localeCompare(a.watched_at));
}

export function watchlistBody(library, origin, extended, type) {
  const items =
    type === "shows"
      ? library.shows.filter((show) => show.inWatchlist)
      : library.movies.filter((movie) => movie.inWatchlist);
  return items.map((item, index) => ({
    rank: index + 1,
    id: item.trakt,
    listed_at: iso(library.now - (index + 1) * DAY),
    notes: null,
    type: type === "shows" ? "show" : "movie",
    ...(type === "shows"
      ? { show: showRef(item, origin, extended) }
      : { movie: movieRef(item, origin, extended) }),
  }));
}

export function hiddenBody(library, origin) {
  return library.shows
    .filter((show) => show.hidden)
    .map((show) => ({
      hidden_at: iso(library.activities.shows),
      type: "show",
      show: showRef(show, origin, "full"),
    }));
}

export function lastActivitiesBody(library) {
  const { episodes, shows, movies, watchlist } = library.activities;
  return {
    all: iso(Math.max(episodes, shows, movies, watchlist)),
    movies: { watched_at: iso(movies), watchlisted_at: iso(watchlist) },
    episodes: { watched_at: iso(episodes), collected_at: iso(episodes) },
    shows: { rated_at: iso(shows), hidden_at: iso(shows) },
    seasons: { watched_at: iso(episodes) },
    watchlist: { updated_at: iso(watchlist) },
    lists: { updated_at: iso(watchlist) },
    account: { settings_at: iso(library.now - 30 * DAY) },
  };
}

export function userSettingsBody(library, origin) {
  return {
    user: {
      username: library.user.username,
      private: false,
      name: library.user.name,
      vip: false,
      ids: { slug: library.user.slug },
      images: { avatar: { full: `${origin}/images/users/1/avatar.svg` } },
    },
    account: { timezone: "America/New_York", date_format: "mdy", time_24hr: false },
  };
}

export function userStatsBody(library) {
  const watchedMovies = library.movies.filter((movie) => movie.watchedAt !== null);
  return {
    movies: {
      watched: watchedMovies.length,
      minutes: watchedMovies.reduce((total, movie) => total + movie.runtime, 0),
    },
    episodes: {
      watched: library.shows.reduce((total, show) => total + show.completed, 0),
      minutes: library.shows.reduce((total, show) => total + show.completed * show.runtime, 0),
    },
    shows: { watched: library.shows.filter((show) => show.completed > 0).length },
  };
}

/**
 * The seeded item a write's `{ids}` block names. Trakt accepts a trakt id or a
 * slug in the same position, so both are tried, and an id block that names
 * nothing resolves to undefined rather than to the first item.
 */
const showById = (library, ids) =>
  library.shows.find((show) => show.trakt === ids.trakt || show.slug === ids.slug);

const movieById = (library, ids) =>
  library.movies.find((movie) => movie.trakt === ids.trakt || movie.slug === ids.slug);

const episodeById = (library, ids) =>
  library.shows.flatMap((show) => show.episodes).find((ep) => ep.traktId === ids.trakt);

/** Split one `{ids}` section of a write body into the seeded items it names and
 * the entries that name nothing, which Trakt echoes back under `not_found`. */
function matchSection(items, lookup) {
  const matched = [];
  const missing = [];
  for (const item of items ?? []) {
    const found = lookup(item.ids ?? {});
    if (found === undefined) missing.push(item);
    else matched.push(found);
  }
  return { matched, missing };
}

/** The play a history-row id points at, whichever kind of item minted it. */
const playTarget = (library, id) =>
  episodeById(library, { trakt: playItem(id) }) ?? movieById(library, { trakt: playItem(id) });

/** The episode trakt ids a history write targets, by any of the three routes in. */
function targetedEpisodes(show, body) {
  const direct = [
    ...(body.episodes ?? []).map((item) => item.ids?.trakt),
    // A per-play unmark sends history-play ids, which the rows mint with playId.
    ...(body.ids ?? []).map(playItem),
  ];
  const bulk = (body.shows ?? []).filter((item) => item.ids?.trakt === show.trakt);
  return show.episodes.flatMap((ep, index) => {
    if (direct.includes(ep.traktId)) return [index];
    const seasons = bulk.flatMap((item) => item.seasons ?? []);
    const season = seasons.find((item) => item.number === ep.season);
    if (season === undefined) return [];
    // A season token (no `episodes`) covers the whole season.
    if (season.episodes !== undefined && !season.episodes.some((e) => e.number === ep.number)) {
      return [];
    }
    return [index];
  });
}

/**
 * Apply a `/sync/history` write (or its removal) to the linear counters, so the
 * next progress read reflects what the app just did. Bodies arrive as
 * `episodes[]`, a `shows[].seasons[]` subtree (bulk season marks), `movies[]`, or
 * `ids[]` of history plays (the per-play unmark). Anything the seed does not
 * have comes back in `not_found`: a write that matched nothing must not read as
 * a success the account never took.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Applies episode, bulk show, movie, and play-id history bodies for both additions and removals.
export function applyHistoryWrite(library, body, remove) {
  const stamped = Date.parse(
    (body.episodes ?? [])[0]?.watched_at ??
      (body.shows ?? [])[0]?.watched_at ??
      (body.movies ?? [])[0]?.watched_at ??
      "",
  );
  const stamp = Number.isNaN(stamped) ? Date.now() : stamped;
  const applied = { episodes: 0, movies: 0 };

  for (const show of library.shows) {
    const indices = targetedEpisodes(show, body);
    if (indices.length === 0) continue;
    applied.episodes += indices.length;
    // Trakt stamps the write, not the play: marking something as watched last
    // Tuesday moves the account's activity to now.
    library.activities.episodes = Date.now();
    if (remove) {
      show.completed = Math.min(show.completed, Math.min(...indices));
      for (const index of indices) show.watchedAt.delete(show.episodes[index].traktId);
      if (show.completed === 0) show.lastWatchedAt = null;
      continue;
    }
    show.completed = Math.max(show.completed, Math.max(...indices) + 1);
    for (const index of indices) show.watchedAt.set(show.episodes[index].traktId, stamp);
    show.lastWatchedAt = Math.max(show.lastWatchedAt ?? 0, stamp);
  }

  for (const movie of library.movies) {
    const byItem = (body.movies ?? []).some((item) => item.ids?.trakt === movie.trakt);
    if (!byItem && !(body.ids ?? []).includes(playId(movie.trakt))) continue;
    applied.movies += 1;
    movie.watchedAt = remove ? null : stamp;
    library.activities.movies = Date.now();
  }

  const counts = remove ? { deleted: applied } : { added: applied };
  return {
    ...counts,
    not_found: {
      movies: matchSection(body.movies, (ids) => movieById(library, ids)).missing,
      shows: matchSection(body.shows, (ids) => showById(library, ids)).missing,
      episodes: matchSection(body.episodes, (ids) => episodeById(library, ids)).missing,
      ids: (body.ids ?? []).filter((id) => playTarget(library, id) === undefined),
    },
  };
}

/**
 * `POST /users/hidden/progress_watched` and its `/remove`: Trakt's hidden set,
 * which Cue reads as the exclusion source it filters Up Next and the calendar
 * against. The body is the `{shows:[{ids}]}` shape every remove-by-item write
 * shares.
 */
export function applyHiddenWrite(library, body, remove) {
  const { matched, missing } = matchSection(body.shows, (ids) => showById(library, ids));
  for (const show of matched) show.hidden = !remove;
  if (matched.length > 0) library.activities.shows = Date.now();
  const counts = { shows: matched.length };
  return {
    ...(remove ? { deleted: counts } : { added: counts }),
    not_found: { movies: [], shows: missing, seasons: [] },
  };
}

/**
 * `POST /sync/watchlist` and its `/remove`. Cue's "To watch" bucket is derived
 * from membership, so this moves the same `inWatchlist` flag the watchlist reads
 * serve.
 */
export function applyWatchlistWrite(library, body, remove) {
  const shows = matchSection(body.shows, (ids) => showById(library, ids));
  const movies = matchSection(body.movies, (ids) => movieById(library, ids));
  for (const item of [...shows.matched, ...movies.matched]) item.inWatchlist = !remove;
  const counts = { shows: shows.matched.length, movies: movies.matched.length };
  if (counts.shows + counts.movies > 0) library.activities.watchlist = Date.now();
  return {
    ...(remove ? { deleted: counts } : { added: counts }),
    not_found: { movies: movies.missing, shows: shows.missing, seasons: [], episodes: [] },
  };
}

/**
 * `/sync/history/{shows|episodes|movies}/:id`: every play of ONE item, which is
 * where a durable per-play unmark gets the row ids it removes. Null when the
 * seed has no such item, so the route can answer 404 rather than an empty list
 * that reads like an item nobody has watched.
 */
export function itemPlaysBody(library, origin, extended, kind, id) {
  const ids = { trakt: Number(id), slug: String(id) };
  const rows = () =>
    historyRows(library, origin, extended, kind === "movies" ? "movies" : "episodes");
  if (kind === "movies") {
    const movie = movieById(library, ids);
    return movie === undefined ? null : rows().filter((row) => row.movie.ids.trakt === movie.trakt);
  }
  if (kind === "shows") {
    const show = showById(library, ids);
    return show === undefined ? null : rows().filter((row) => row.show.ids.trakt === show.trakt);
  }
  const episode = episodeById(library, ids);
  return episode === undefined
    ? null
    : rows().filter((row) => row.episode.ids.trakt === episode.traktId);
}
