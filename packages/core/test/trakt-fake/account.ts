/**
 * The account the fake serves: one default library covering every variant real
 * accounts have shown, or a generated one of a given size for the request budget.
 *
 * Every show is a flat list of episodes in watch order plus a linear `completed`
 * counter, which keeps the watched breakdown, progress tree, history rows and
 * writes derivable from one number a write can move. Seeded dates count from
 * `FIXTURE_NOW`, so the account is the same on every day it runs.
 */

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const HOUR = 3_600_000;

export const FIXTURE_NOW = Date.parse("2026-10-15T00:00:00.000Z");

/** The session the account is signed in with before any OAuth grant. */
export const SESSION = {
  access_token: "fake-access-token",
  refresh_token: "fake-refresh-token",
} as const;

type EpisodeType = "series_premiere" | "season_premiere" | "season_finale" | "standard";

export interface Episode {
  readonly traktId: number;
  readonly season: number;
  readonly number: number;
  readonly title: string;
  readonly overview: string | null;
  readonly firstAired: number | null;
  readonly runtime: number | null;
  readonly obscure: boolean;
  readonly type: EpisodeType;
}

export interface ShowSpec {
  readonly trakt: number;
  readonly tmdb: number;
  readonly slug: string;
  readonly title: string;
  readonly year: number | null;
  readonly status: string;
  readonly network: string | null;
  readonly runtime: number;
  readonly genres: readonly string[];
  readonly overview: string;
  /** Episode counts of the seasons that air weekly from `startDaysAgo`. */
  readonly seasons: readonly number[];
  readonly startDaysAgo: number;
  readonly completed: number;
  readonly lastWatchedDaysAgo: number | null;
  readonly collectedDaysAgo?: number;
  readonly inWatchlist?: boolean;
  readonly hidden?: boolean;
  readonly shelf?: boolean;
  readonly sparseIds?: boolean;
  readonly noArt?: boolean;
  /** The last this many episodes have no date yet. */
  readonly tba?: number;
  /** Two in every four episodes lack an overview, still and ids. */
  readonly sparseEpisodes?: boolean;
  readonly numbering?: "continuous";
  readonly specials?: number;
  readonly specialsWatched?: number;
  /** One more season whose episodes all air at the same instant, `inDays` from now. */
  readonly drop?: { readonly episodes: number; readonly inDays: number };
  /** The user's progress snapshot was taken this many days ago (trakt/api-help#446). */
  readonly snapshotDaysAgo?: number;
}

export interface MovieSpec {
  readonly trakt: number;
  readonly tmdb: number;
  readonly slug: string;
  readonly title: string;
  readonly year: number | null;
  readonly released: string | null;
  readonly runtime: number;
  readonly genres: readonly string[];
  readonly overview: string;
  readonly lastWatchedDaysAgo: number | null;
  readonly rewatchedDaysAgo?: number;
  readonly collectedDaysAgo?: number;
  readonly inWatchlist?: boolean;
  readonly shelf?: boolean;
  readonly noArt?: boolean;
}

export interface Show extends ShowSpec {
  hidden: boolean;
  inWatchlist: boolean;
  completed: number;
  collectedAt: number | null;
  lastWatchedAt: number | null;
  readonly episodes: readonly Episode[];
  readonly specialEpisodes: readonly Episode[];
  /** `watched_at` of each watched special, by trakt id. */
  readonly specialsWatchedAt: Map<number, number>;
  /** `watched_at` by episode trakt id, so a mark keeps its own stamp. */
  readonly watchedAt: Map<number, number>;
  /** When the user's progress snapshot was taken, if it is older than now. */
  progressAt: number | undefined;
}

export interface Movie extends MovieSpec {
  inWatchlist: boolean;
  collectedAt: number | null;
  watchedAt: number | null;
}

interface Activities {
  episodes: number;
  showsHidden: number;
  showsWatchlist: number;
  movies: number;
  moviesWatchlist: number;
  watchlist: number;
  dropped: number;
  readonly untracked: number;
}

export interface Account {
  readonly now: number;
  shows: Show[];
  movies: Movie[];
  readonly user: { readonly username: string; readonly name: string };
  dropped: { readonly show: Show; readonly at: number }[];
  /** Second plays, by episode and by movie trakt id. */
  readonly rewatchedEpisodes: Map<number, number>;
  readonly rewatchedMovies: Map<number, number>;
  /** Trakt's "Multiple Plays" setting. Off, a play for a watched item replaces its play. */
  readonly multiplePlays: boolean;
  readonly activities: Activities;
}

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

/** Trakt's `episode_type`, as recorded on calendar rows: the first episode of each season opens it. */
function episodeType(index: number, offset: number, count: number): EpisodeType {
  if (index === 0) return "series_premiere";
  if (offset === 0) return "season_premiere";
  return offset === count - 1 && count > 1 ? "season_finale" : "standard";
}

interface Slot {
  readonly season: number;
  readonly offset: number;
  readonly count: number;
  readonly at: number | null;
}

/** Weekly seasons from `startDaysAgo`, then the drop, every episode of it at one instant. */
function slotsOf(spec: ShowSpec, now: number): Slot[] {
  const weekly = spec.seasons.flatMap((count, seasonIndex) =>
    Array.from({ length: count }, (_, offset) => ({ season: seasonIndex + 1, offset, count })),
  );
  const undated = weekly.length - (spec.tba ?? 0);
  const drop = spec.drop;
  return [
    ...weekly.map((slot, index) => ({
      ...slot,
      at: index >= undated ? null : now - spec.startDaysAgo * DAY + index * WEEK,
    })),
    ...(drop === undefined
      ? []
      : Array.from({ length: drop.episodes }, (_, offset) => ({
          season: spec.seasons.length + 1,
          offset,
          count: drop.episodes,
          at: now + drop.inDays * DAY + 7 * HOUR,
        }))),
  ];
}

/**
 * An episode Trakt knows little about: one more than a week away, or two in every
 * four of a show with `sparseEpisodes`, has no overview, still, IMDb or TVDB id;
 * one more than a week away has no runtime.
 */
function buildEpisodes(spec: ShowSpec, now: number): Episode[] {
  return slotsOf(spec, now).map(({ season, offset, count, at }, index) => {
    const distant = at === null || at > now + WEEK;
    const obscure = distant || (spec.sparseEpisodes === true && index % 4 < 2);
    return {
      traktId: spec.trakt * 100 + index,
      season,
      number: spec.numbering === "continuous" ? index + 1 : offset + 1,
      title: EPISODE_TITLES[(spec.trakt + index) % EPISODE_TITLES.length] ?? "",
      overview: obscure
        ? null
        : (EPISODE_OVERVIEWS[(spec.trakt + index) % EPISODE_OVERVIEWS.length] ?? null),
      firstAired: at,
      runtime: distant ? null : spec.runtime,
      obscure,
      type: episodeType(index, offset, count),
    };
  });
}

/** Specials sit outside the watch order: their ids live in their own range. */
const SPECIAL_IDS = 50_000_000;
const SPECIAL_EVERY_WEEKS = 13;

function buildSpecials(spec: ShowSpec, now: number): Episode[] {
  return Array.from({ length: spec.specials ?? 0 }, (_, index) => ({
    traktId: SPECIAL_IDS + spec.trakt * 100 + index,
    season: 0,
    number: index + 1,
    title: EPISODE_TITLES[(spec.trakt + index + 3) % EPISODE_TITLES.length] ?? "",
    overview: EPISODE_OVERVIEWS[(spec.trakt + index) % EPISODE_OVERVIEWS.length] ?? null,
    firstAired: now - spec.startDaysAgo * DAY + (index + 1) * SPECIAL_EVERY_WEEKS * WEEK - 2 * DAY,
    runtime: spec.runtime,
    obscure: false,
    type: "standard",
  }));
}

const daysAgo = (now: number, days: number | null | undefined): number | null =>
  days === null || days === undefined ? null : now - days * DAY;

function watchedSpecials(spec: ShowSpec, specials: readonly Episode[], now: number) {
  const last = daysAgo(now, spec.lastWatchedDaysAgo) ?? now;
  const count = spec.specialsWatched ?? 0;
  return new Map(
    specials.slice(0, count).map((sp, index) => [sp.traktId, last - (count - 1 - index) * DAY]),
  );
}

export function libraryShow(spec: ShowSpec, now: number): Show {
  const specialEpisodes = buildSpecials(spec, now);
  return {
    ...spec,
    hidden: spec.hidden === true,
    inWatchlist: spec.inWatchlist === true,
    collectedAt: daysAgo(now, spec.collectedDaysAgo),
    lastWatchedAt: daysAgo(now, spec.lastWatchedDaysAgo),
    episodes: buildEpisodes(spec, now),
    specialEpisodes,
    specialsWatchedAt: watchedSpecials(spec, specialEpisodes, now),
    watchedAt: new Map(),
    progressAt: daysAgo(now, spec.snapshotDaysAgo) ?? undefined,
  };
}

export const libraryMovie = (spec: MovieSpec, now: number): Movie => ({
  ...spec,
  inWatchlist: spec.inWatchlist === true,
  collectedAt: daysAgo(now, spec.collectedDaysAgo),
  watchedAt: daysAgo(now, spec.lastWatchedDaysAgo),
});

const show = (spec: Omit<ShowSpec, "tmdb">): ShowSpec => ({ ...spec, tmdb: spec.trakt + 90_000 });
const movie = (spec: Omit<MovieSpec, "tmdb">): MovieSpec => ({
  ...spec,
  tmdb: spec.trakt + 90_000,
});

/**
 * The shows with plays: three with an aired backlog (the queue), lapsed ones past
 * the staleness threshold, airing ones (On the way, Calendar), a finished one, one
 * watchlisted and never started, a hidden one and a dropped one. Then the shapes
 * real accounts carry: a show watched only through its specials, a long runner
 * numbered from its specials, one numbered across seasons, a thinly catalogued
 * one, one whose progress snapshot predates its newest episode, and a played show
 * whose next season drops all at once.
 */
const SHOWS: readonly ShowSpec[] = [
  show({
    trakt: 8801,
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
    collectedDaysAgo: 500,
  }),
  show({
    trakt: 8802,
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
    drop: { episodes: 8, inDays: 5 },
  }),
  show({
    trakt: 8803,
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
  }),
  show({
    trakt: 8804,
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
  }),
  show({
    trakt: 8805,
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
    hidden: true,
  }),
  show({
    trakt: 8806,
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
  }),
  show({
    trakt: 8807,
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
  }),
  show({
    trakt: 8808,
    slug: "coastal-static",
    title: "Coastal Static",
    year: 2025,
    status: "returning series",
    network: "Meridian",
    runtime: 43,
    genres: ["science-fiction"],
    overview: "Something on the shipping forecast is answering back, politely, in the wrong order.",
    seasons: [8],
    startDaysAgo: 40,
    completed: 0,
    lastWatchedDaysAgo: null,
    inWatchlist: true,
  }),
  show({
    trakt: 8809,
    slug: "lantern-keepers",
    title: "Lantern Keepers",
    year: 2005,
    status: "returning series",
    network: "Meridian",
    runtime: 45,
    genres: ["drama"],
    overview: "A show this account has only watched the specials of.",
    seasons: [10, 10],
    startDaysAgo: 400,
    completed: 0,
    lastWatchedDaysAgo: 40,
    specials: 4,
    specialsWatched: 4,
  }),
  show({
    trakt: 8810,
    slug: "tidewater-ledger",
    title: "Tidewater Ledger",
    year: 2025,
    status: "returning series",
    network: "Halyard",
    runtime: 42,
    genres: ["drama"],
    overview:
      "A port clerk balances the books of a harbour that keeps receiving ships nobody sent.",
    seasons: [10],
    startDaysAgo: 54,
    completed: 6,
    lastWatchedDaysAgo: 12,
    snapshotDaysAgo: 12,
  }),
  show({
    trakt: 99,
    slug: "long-runner",
    title: "The Long Runner",
    year: 1989,
    status: "returning series",
    network: "Meridian",
    runtime: 22,
    genres: ["animation"],
    overview: "A show in its fourteenth season, with specials and one very long season.",
    seasons: [...Array.from({ length: 12 }, () => 22), 199, 22],
    startDaysAgo: (13 * 22 + 199) * 7 + 30,
    completed: 300,
    lastWatchedDaysAgo: 150,
    specials: 6,
    specialsWatched: 3,
  }),
  show({
    trakt: 98,
    slug: "continuous-numbers",
    title: "Continuous Numbers",
    year: 1999,
    status: "returning series",
    network: "Meridian",
    runtime: 24,
    genres: ["anime"],
    overview: "A show whose episode numbers run on across seasons.",
    seasons: [61, 16, 20],
    numbering: "continuous",
    startDaysAgo: 97 * 7 + 30,
    completed: 66,
    lastWatchedDaysAgo: 160,
  }),
  show({
    trakt: 9007,
    slug: "thin-catalogue",
    title: "The Extraordinarily Long and Winding Chronicles of the Northern Lighthouse Keepers",
    year: 2012,
    status: "returning series",
    network: null,
    runtime: 40,
    genres: ["drama"],
    overview: "A thinly catalogued show with a new season starting soon.",
    seasons: [10, 10, 8, 6],
    startDaysAgo: 28 * 7 - 10,
    tba: 2,
    completed: 9,
    lastWatchedDaysAgo: 157,
    sparseIds: true,
    sparseEpisodes: true,
    noArt: true,
  }),
];

const MOVIES: readonly MovieSpec[] = [
  movie({
    trakt: 5501,
    slug: "the-lantern-keeper",
    title: "The Lantern Keeper",
    year: 2021,
    released: "2021-09-17",
    runtime: 104,
    genres: ["drama"],
    overview: "The last keeper of an automated lighthouse refuses to leave on the arranged date.",
    lastWatchedDaysAgo: 12,
    rewatchedDaysAgo: 3,
    collectedDaysAgo: 400,
  }),
  movie({
    trakt: 5502,
    slug: "winter-ledger",
    title: "Winter Ledger",
    year: 2019,
    released: "2019-11-08",
    runtime: 118,
    genres: ["thriller"],
    overview: "An auditor snowed in at a country hotel finds the books balance a little too well.",
    lastWatchedDaysAgo: 40,
  }),
  movie({
    trakt: 5503,
    slug: "salt-and-static",
    title: "Salt and Static",
    year: 2024,
    released: "2024-05-31",
    runtime: 96,
    genres: ["science-fiction", "drama"],
    overview:
      "A radio astronomer moves to the coast to hear one signal without the city in the way.",
    lastWatchedDaysAgo: null,
    inWatchlist: true,
  }),
  ...[
    {
      slug: "low-water-mark",
      title: "Low Water Mark",
      released: "2020-03-20",
      runtime: 101,
      genres: ["drama", "mystery"],
      overview: "A surveyor finds a drowned village returning one foundation at a time.",
    },
    {
      slug: "the-cold-account",
      title: "The Cold Account",
      released: "2018-12-07",
      runtime: 112,
      genres: ["thriller"],
      overview: "A forensic accountant follows a missing payment into a town cut off by snow.",
    },
    {
      slug: "signal-shore",
      title: "Signal Shore",
      released: "2023-06-16",
      runtime: 99,
      genres: ["science-fiction", "drama"],
      overview: "A coastal listening post records tomorrow's weather in voices from the past.",
    },
    {
      slug: "mercy-point",
      title: "Mercy Point",
      released: "2017-10-13",
      runtime: 107,
      genres: ["drama"],
      overview: "Two lighthouse crews trade places and inherit each other's unfinished promises.",
    },
    {
      slug: "black-ice-tally",
      title: "Black Ice Tally",
      released: "2022-01-28",
      runtime: 115,
      genres: ["crime", "thriller"],
      overview: "A clerk counting winter road closures discovers one journey with no traveler.",
    },
  ].map((spec, index) =>
    movie({
      ...spec,
      trakt: 5504 + index,
      year: Number(spec.released.slice(0, 4)),
      lastWatchedDaysAgo: null,
    }),
  ),
];

/**
 * The collection a long-time Trakt user carries: hundreds of titles added over the
 * years and never started. Generated, every show fully aired long before now so
 * none reaches the calendar, and each added on its own day so "Recently added" is
 * a total order. Every 25th title is announced and not out: no year, artwork or
 * collection entry yet, and a show has no network, IMDb or TVDB id either.
 */
const SHELF_SIZE = { shows: 300, movies: 150 };
const ANNOUNCED_EVERY = 25;
const WORDS = [
  "Amber Copper Distant Fallow Granite Hidden Iron Juniper Kestrel Linen",
  "Orchard Parish Quarry Ridge Summit Thicket Valley Willow Yard Meadow",
  "Accord Bargain Census Drift Errand Fable Gambit Harvest Inquest Jubilee",
].map((words) => words.split(" "));

const shelfTitle = (index: number): string =>
  [index % 10, Math.floor(index / 10) % 10, Math.floor(index / 100) % 10]
    .map((at, word) => WORDS[word]?.[at] ?? "")
    .join(" ");

const slugOf = (title: string): string => title.toLowerCase().replaceAll(" ", "-");
const announced = (index: number): boolean => index % ANNOUNCED_EVERY === 7;

const SHELF_SHOWS: readonly ShowSpec[] = Array.from({ length: SHELF_SIZE.shows }, (_, index) => {
  const base = show({
    trakt: 7000 + index,
    slug: slugOf(shelfTitle(index)),
    title: shelfTitle(index),
    year: 2000 + (index % 24),
    status: index % 3 === 0 ? "returning series" : "ended",
    network: "Meridian",
    runtime: 45,
    genres: ["drama"],
    overview: "A title from the collection, added and not yet started.",
    seasons: [6],
    startDaysAgo: 900 + index,
    completed: 0,
    lastWatchedDaysAgo: null,
    collectedDaysAgo: 10 + index,
    shelf: true,
    ...(index % 50 === 0 ? { specials: 2 } : {}),
  });
  if (!announced(index)) return base;
  const { collectedDaysAgo: _notCollected, ...rest } = base;
  return {
    ...rest,
    year: null,
    status: "in production",
    inWatchlist: index === 7,
    network: null,
    sparseIds: true,
    noArt: true,
    startDaysAgo: -120,
  };
});

const SHELF_MOVIES: readonly MovieSpec[] = Array.from({ length: SHELF_SIZE.movies }, (_, index) => {
  const year = 1990 + (index % 34);
  const base = movie({
    trakt: 6000 + index,
    slug: slugOf(shelfTitle(index + 500)),
    title: shelfTitle(index + 500),
    year,
    released: `${year}-06-01`,
    runtime: 100,
    genres: ["drama"],
    overview: "A film from the collection, added and not yet watched.",
    lastWatchedDaysAgo: null,
    collectedDaysAgo: 10 + index,
    shelf: true,
  });
  if (!announced(index)) return base;
  const { collectedDaysAgo: _notCollected, ...rest } = base;
  return { ...rest, year: null, released: null, noArt: true };
});

export const RELATED_SHOWS: ReadonlyMap<number, readonly number[]> = new Map([
  [8803, [8801, 8802, 8804, 8805, 8806, 8807, 8808]],
  [8801, [8803, 8808, 8802]],
  [8807, []],
]);

export const RELATED_MOVIES: ReadonlyMap<number, readonly number[]> = new Map([
  [5501, [5502, 5503, 5504, 5505, 5506, 5507, 5508]],
  [5502, [5501, 5505]],
  [5503, []],
]);

/**
 * Titles Trakt's catalogue carries and this account does not, so search can
 * return something to add and a watchlist add can bring a title in.
 */
export const CATALOG_SHOWS: readonly ShowSpec[] = [
  show({
    trakt: 8901,
    slug: "the-harbor-master",
    title: "The Harbor Master",
    year: 2011,
    status: "ended",
    network: "Meridian",
    runtime: 45,
    genres: ["drama"],
    overview: "A catalogue title the account has not added.",
    seasons: [6],
    startDaysAgo: 3000,
    completed: 0,
    lastWatchedDaysAgo: null,
  }),
];

export const CATALOG_MOVIES: readonly MovieSpec[] = [
  movie({
    trakt: 5601,
    slug: "harbor-sound",
    title: "Harbor Sound",
    year: 2015,
    released: "2015-06-01",
    runtime: 100,
    genres: ["drama"],
    overview: "A catalogue film the account has not added.",
    lastWatchedDaysAgo: null,
  }),
];

function emptyAccount(now: number, multiplePlays: boolean): Account {
  const stamp = (days: number): number => now - days * DAY;
  return {
    now,
    shows: [],
    movies: [],
    user: { username: "cue-demo", name: "Cue Demo" },
    dropped: [],
    rewatchedEpisodes: new Map(),
    rewatchedMovies: new Map(),
    multiplePlays,
    activities: {
      episodes: stamp(1),
      showsHidden: stamp(1),
      showsWatchlist: stamp(3),
      movies: stamp(2),
      moviesWatchlist: stamp(3),
      watchlist: stamp(3),
      dropped: stamp(30),
      untracked: stamp(30),
    },
  };
}

const DROPPED_SHOW = 8804;
const REWATCHED_EPISODE = 880608;

/** The default account; `multiplePlays` is Trakt's account setting of that name. */
export function defaultAccount(multiplePlays = true, now = FIXTURE_NOW): Account {
  const account = emptyAccount(now, multiplePlays);
  account.shows = [...SHOWS, ...SHELF_SHOWS].map((spec) => libraryShow(spec, now));
  account.movies = [...MOVIES, ...SHELF_MOVIES].map((spec) => libraryMovie(spec, now));
  account.rewatchedEpisodes.set(REWATCHED_EPISODE, now - DAY);
  for (const { trakt, rewatchedDaysAgo } of MOVIES) {
    if (rewatchedDaysAgo !== undefined)
      account.rewatchedMovies.set(trakt, now - rewatchedDaysAgo * DAY);
  }
  const dropped = account.shows.find(({ trakt }) => trakt === DROPPED_SHOW);
  if (dropped !== undefined) account.dropped.push({ show: dropped, at: now - 30 * DAY });
  return account;
}

export interface AccountSize {
  readonly inProgress: number;
  readonly lapsed: number;
  readonly caughtUp: number;
  readonly finished: number;
  readonly airingWatched: number;
  readonly airingWatchlist: number;
  readonly watchlistShows: number;
  readonly watchlistMovies: number;
  readonly watchedMovies: number;
  readonly hidden: number;
}

const SIZED_SHOWS = 100_000;
const SIZED_WATCHLIST = 200_000;
const SIZED_MOVIES = 300_000;
const SIZED_WATCHED_MOVIES = 400_000;
const PER_SEASON = 10;

const seasonsOf = (count: number): number[] =>
  Array.from({ length: Math.ceil(count / PER_SEASON) }, (_, index) =>
    Math.min(PER_SEASON, count - index * PER_SEASON),
  );

interface SizedShow {
  readonly aired: number;
  readonly completed: number;
  readonly airing: boolean;
  readonly status: string;
  readonly lastWatchedDaysAgo: number | null;
  readonly inWatchlist?: boolean;
}

/** A generated show: `aired` episodes out, three more around today when it is airing. */
function sizedShow(trakt: number, shape: SizedShow, now: number): Show {
  const { aired, completed, airing, status, lastWatchedDaysAgo, inWatchlist } = shape;
  return libraryShow(
    {
      trakt,
      tmdb: trakt,
      slug: `show-${trakt}`,
      title: `Show ${trakt}`,
      year: 2010,
      status,
      network: "Meridian",
      runtime: 45,
      genres: ["drama"],
      overview: "A generated show sized for the request budget.",
      seasons: seasonsOf(aired + (airing ? 3 : 0)),
      startDaysAgo: airing ? aired * 7 + 10 : (aired - 1) * 7 + 30,
      completed,
      lastWatchedDaysAgo,
      ...(inWatchlist === undefined ? {} : { inWatchlist }),
    },
    now,
  );
}

const sizedMovie = (trakt: number, extra: Partial<MovieSpec>, now: number): Movie =>
  libraryMovie(
    {
      trakt,
      tmdb: trakt,
      slug: `movie-${trakt}`,
      title: `Movie ${trakt}`,
      year: 2015,
      released: "2015-06-01",
      runtime: 100,
      genres: ["drama"],
      overview: "A generated film sized for the request budget.",
      lastWatchedDaysAgo: null,
      ...extra,
    },
    now,
  );

function watchedDaysAgo(index: number, size: AccountSize): number {
  if (index < size.inProgress - size.lapsed) return index % 7;
  return index < size.inProgress ? 30 + index : 30 + ((index * 7) % 1000);
}

/** Shows with plays: in progress (some lapsed), caught up and finished, some airing on a stale snapshot. */
function watchedShows(size: AccountSize, now: number): Show[] {
  const live = size.inProgress + size.caughtUp;
  const airingEvery = size.airingWatched === 0 ? 0 : Math.floor(live / size.airingWatched);
  return Array.from({ length: live + size.finished }, (_, index) => {
    const seen = 10 + (index % 20);
    const airing =
      airingEvery > 0 &&
      index % airingEvery === 1 &&
      Math.floor(index / airingEvery) < size.airingWatched;
    const days = watchedDaysAgo(index, size);
    const sized = sizedShow(
      SIZED_SHOWS + index,
      {
        aired: index < size.inProgress ? seen + 1 + (index % 9) : seen,
        completed: seen,
        airing,
        status: index < live ? "returning series" : "ended",
        lastWatchedDaysAgo: airing ? Math.max(days, 11) : days,
      },
      now,
    );
    if (airing) sized.progressAt = now - 11 * DAY;
    sized.hidden = index >= live && index < live + size.hidden;
    return sized;
  });
}

/** A generated account of a given size, for the request-budget replay. */
export function sized(size: AccountSize, now = FIXTURE_NOW): Account {
  const account = emptyAccount(now, true);
  const watchlist = Array.from({ length: size.watchlistShows }, (_, index) =>
    sizedShow(
      SIZED_WATCHLIST + index,
      {
        aired: index < size.airingWatchlist ? 0 : 10,
        completed: 0,
        airing: index < size.airingWatchlist,
        status: "returning series",
        lastWatchedDaysAgo: null,
        inWatchlist: true,
      },
      now,
    ),
  );
  account.shows = [...watchedShows(size, now), ...watchlist];
  account.movies = [
    ...Array.from({ length: size.watchlistMovies }, (_, index) =>
      sizedMovie(SIZED_MOVIES + index, { inWatchlist: true }, now),
    ),
    ...Array.from({ length: size.watchedMovies }, (_, index) =>
      sizedMovie(SIZED_WATCHED_MOVIES + index, { lastWatchedDaysAgo: 5 + index }, now),
    ),
  ];
  return account;
}
