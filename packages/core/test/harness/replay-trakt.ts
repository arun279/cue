import shapes from "./trakt-shapes.json" with { type: "json" };

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

export const REAL_ACCOUNT: AccountSize = {
  inProgress: 14,
  lapsed: 6,
  caughtUp: 4,
  finished: 0,
  airingWatched: 0,
  airingWatchlist: 16,
  watchlistShows: 40,
  watchlistMovies: 20,
  watchedMovies: 5,
  hidden: 0,
};

export const HEAVY_ACCOUNT: AccountSize = {
  inProgress: 300,
  lapsed: 220,
  caughtUp: 200,
  finished: 1000,
  airingWatched: 100,
  airingWatchlist: 0,
  watchlistShows: 700,
  watchlistMovies: 300,
  watchedMovies: 400,
  hidden: 100,
};

interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly bytes: number;
}

interface Reply {
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

interface Play {
  readonly historyId: number;
  readonly episode: number;
  readonly watchedAt: string;
}

const DAY_MS = 86_400_000;
const EPISODES_PER_SEASON = 10;
const AIRING_EPISODES = 3;
const BROWSE_ITEMS = 24;
const SHOW_BASE = 1_000_000;
const WATCHLIST_SHOW_BASE = 2_000_000;
const MOVIE_BASE = 3_000_000;
const WATCHED_MOVIE_BASE = 4_000_000;
const HISTORY_BASE = 9_000_000;

type Route = (groups: readonly (string | undefined)[], url: URL) => Reply | null;

interface WriteBody {
  readonly episodes?: readonly {
    readonly ids: { readonly trakt: number };
    readonly watched_at?: string;
  }[];
  readonly ids?: readonly number[];
}

function paged(all: readonly unknown[], url: URL): Reply {
  const page = Number(url.searchParams.get("page") ?? "1");
  const limit = Number(url.searchParams.get("limit") ?? "100");
  return {
    body: all.slice((page - 1) * limit, page * limit),
    headers: {
      "x-pagination-page": String(page),
      "x-pagination-limit": String(limit),
      "x-pagination-page-count": String(Math.max(1, Math.ceil(all.length / limit))),
      "x-pagination-item-count": String(all.length),
    },
  };
}

const position = (n: number) => ({
  season: Math.floor((n - 1) / EPISODES_PER_SEASON) + 1,
  number: ((n - 1) % EPISODES_PER_SEASON) + 1,
});
const episodeId = (showId: number, n: number): number => showId * 1000 + n;
const ids = (trakt: number) => ({
  trakt,
  slug: `s${trakt}`,
  tmdb: trakt,
  tvdb: trakt,
  imdb: `tt${trakt}`,
});

export class ReplayTrakt {
  readonly requests: RecordedRequest[] = [];
  readonly unrecorded: string[] = [];
  private readonly watched: number[] = [];
  private readonly aired: number[] = [];
  private readonly lastWatched: string[] = [];
  private readonly plays: Play[] = [];
  private activityStamp: string;
  private writes = 0;

  constructor(
    readonly size: AccountSize,
    private readonly now: number,
  ) {
    this.activityStamp = this.iso(-DAY_MS);
    const { inProgress, lapsed } = size;
    for (let i = 0; i < this.watchedCount; i += 1) {
      const seen = 10 + (i % 20);
      this.watched.push(seen);
      this.aired.push(i < inProgress ? seen + 1 + (i % 9) : seen);
      const daysAgo =
        i < inProgress - lapsed ? i % 7 : i < inProgress ? 30 + i : 30 + ((i * 7) % 1000);
      this.lastWatched.push(this.iso(-daysAgo * DAY_MS));
    }
  }

  get watchedCount(): number {
    return this.size.inProgress + this.size.caughtUp + this.size.finished;
  }

  get watchedPages(): number {
    return Math.max(1, Math.ceil(this.watchedCount / 100));
  }

  backlogShowIds(): number[] {
    return this.watched
      .flatMap((seen, index) => (seen < (this.aired[index] ?? 0) ? [index] : []))
      .sort((a, b) => (this.lastWatched[b] ?? "").localeCompare(this.lastWatched[a] ?? ""))
      .map((index) => SHOW_BASE + index);
  }

  readonly fetch = async (
    input: string | URL | globalThis.Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = `${url.pathname}${url.search}`;
    const reply =
      method === "GET" ? this.read(url) : this.write(url.pathname, String(init?.body ?? "{}"));
    if (reply === null) {
      this.unrecorded.push(`${method} ${path}`);
      return new Response("{}", { status: 404 });
    }
    const text = JSON.stringify(reply.body);
    this.requests.push({ method, path, bytes: Buffer.byteLength(text) });
    return new Response(text, {
      status: method === "GET" ? 200 : 201,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  };

  bytesOf(path: string): number {
    const reply = this.read(new URL(path, "https://api.trakt.tv"));
    if (reply === null) throw new Error(`no fixture for ${path}`);
    return Buffer.byteLength(JSON.stringify(reply.body));
  }

  bytesOfList(path: string): number {
    const pages = Number(
      this.read(new URL(path, "https://api.trakt.tv"))?.headers?.["x-pagination-page-count"] ?? 1,
    );
    let bytes = 0;
    for (let page = 1; page <= pages; page += 1)
      bytes += this.bytesOf(`${path}?page=${page}&limit=100`);
    return bytes;
  }

  private iso(offsetMs: number): string {
    return new Date(this.now + offsetMs).toISOString();
  }

  private readonly routes: readonly (readonly [RegExp, Route])[] = [
    [/^\/shows\/(\d+)$/, ([id]) => ({ body: { ...shapes.showInfo, ids: ids(Number(id)) } })],
    [/^\/shows\/(\d+)\/progress\/watched$/, ([id]) => this.ofWatched(id, (i) => this.progress(i))],
    [/^\/shows\/(\d+)\/seasons$/, ([id]) => this.ofWatched(id, (i) => this.seasons(i))],
    [
      /^\/calendars\/my\/shows\/(\d{4}-\d{2}-\d{2})\/(\d+)$/,
      ([start, days]) => ({ body: this.calendar(start ?? "", Number(days)) }),
    ],
    [
      /^\/sync\/history\/episodes\/(\d+)$/,
      ([id], url) => paged(this.episodePlays(Number(id)), url),
    ],
    [/^\/sync\/last_activities$/, () => ({ body: this.activities() })],
    [/^\/users\/settings$/, () => ({ body: shapes.settings })],
    [/^\/sync\/watched\/shows$/, (_, url) => paged(this.watchedShows(), url)],
    [/^\/users\/hidden\/progress_watched$/, (_, url) => paged(this.hiddenShows(), url)],
    [
      /^\/sync\/watchlist\/shows$/,
      (_, url) => paged(this.list(this.size.watchlistShows, WATCHLIST_SHOW_BASE, "show"), url),
    ],
    [
      /^\/sync\/watchlist\/movies$/,
      (_, url) => paged(this.list(this.size.watchlistMovies, MOVIE_BASE, "movie"), url),
    ],
    [
      /^\/sync\/watched\/movies$/,
      (_, url) => paged(this.list(this.size.watchedMovies, WATCHED_MOVIE_BASE, "watched"), url),
    ],
    [/^\/shows\/trending$/, () => ({ body: this.browse(shapes.trendingShow, "show") })],
    [/^\/shows\/popular$/, () => ({ body: this.browse(shapes.popularShow) })],
    [/^\/movies\/trending$/, () => ({ body: this.browse(shapes.trendingMovie, "movie") })],
    [/^\/movies\/popular$/, () => ({ body: this.browse(shapes.popularMovie) })],
  ];

  private read(url: URL): Reply | null {
    for (const [pattern, route] of this.routes) {
      const match = pattern.exec(url.pathname);
      if (match !== null) return route(match.slice(1), url);
    }
    return null;
  }

  private write(path: string, raw: string): Reply | null {
    const body = JSON.parse(raw) as WriteBody;
    if (path === "/sync/history") {
      for (const { ids: episode, watched_at } of body.episodes ?? []) {
        this.addPlay(episode.trakt, watched_at ?? this.iso(0));
      }
      return this.moved(shapes.historyAdded);
    }
    if (path === "/sync/history/remove") {
      for (const historyId of body.ids ?? []) this.removePlay(historyId);
      return this.moved(shapes.historyRemoved);
    }
    return null;
  }

  private addPlay(episode: number, watchedAt: string): void {
    const index = Math.floor(episode / 1000) - SHOW_BASE;
    this.plays.push({ historyId: HISTORY_BASE + this.plays.length, episode, watchedAt });
    this.watched[index] = (this.watched[index] ?? 0) + 1;
    this.lastWatched[index] = watchedAt;
  }

  private removePlay(historyId: number): void {
    const at = this.plays.findIndex((play) => play.historyId === historyId);
    const play = this.plays[at];
    if (play === undefined) return;
    this.plays.splice(at, 1);
    const index = Math.floor(play.episode / 1000) - SHOW_BASE;
    this.watched[index] = (this.watched[index] ?? 1) - 1;
  }

  private ofWatched(id: string | undefined, body: (index: number) => unknown): Reply | null {
    const index = Number(id) - SHOW_BASE;
    return index >= 0 && index < this.watchedCount ? { body: body(index) } : null;
  }

  private episodePlays(episode: number): unknown[] {
    return this.plays
      .filter((play) => play.episode === episode)
      .map((play) => ({
        ...shapes.episodePlay,
        id: play.historyId,
        watched_at: play.watchedAt,
        episode: { ...shapes.episodePlay.episode, ids: ids(episode) },
      }));
  }

  private moved(body: unknown): Reply {
    this.writes += 1;
    this.activityStamp = this.iso(this.writes * 1000);
    return { body };
  }

  private activities(): unknown {
    const stamp = (section: Record<string, string>) =>
      Object.fromEntries(Object.keys(section).map((key) => [key, this.iso(-DAY_MS)]));
    const base = shapes.lastActivities;
    return {
      ...base,
      all: this.activityStamp,
      episodes: { ...stamp(base.episodes), watched_at: this.activityStamp },
      movies: stamp(base.movies),
      shows: stamp(base.shows),
      seasons: stamp(base.seasons),
      watchlist: stamp(base.watchlist),
    };
  }

  private showOf(index: number) {
    const id = SHOW_BASE + index;
    return {
      ...shapes.watchedShow.show,
      ids: ids(id),
      title: `Show ${id}`,
      status: index < this.size.inProgress + this.size.caughtUp ? "returning series" : "ended",
      aired_episodes: this.aired[index] ?? 0,
    };
  }

  private watchedShows(): unknown[] {
    return this.watched.map((seen, index) => ({
      ...shapes.watchedShow,
      plays: seen,
      last_watched_at: this.lastWatched[index],
      last_updated_at: this.lastWatched[index],
      show: this.showOf(index),
      seasons: this.seasonNumbers(seen).map((season) => ({
        number: season,
        episodes: this.episodeNumbers(season, seen).map((number) => ({
          number,
          plays: 1,
          last_watched_at: this.lastWatched[index],
        })),
      })),
    }));
  }

  private seasonNumbers(count: number): number[] {
    return Array.from({ length: Math.ceil(count / EPISODES_PER_SEASON) }, (_, i) => i + 1);
  }

  private episodeNumbers(season: number, count: number): number[] {
    const first = (season - 1) * EPISODES_PER_SEASON;
    const length = Math.min(EPISODES_PER_SEASON, count - first);
    return Array.from({ length }, (_, i) => i + 1);
  }

  private episode(showId: number, n: number, firstAired: string) {
    return {
      ...shapes.progress.next_episode,
      ...position(n),
      ids: ids(episodeId(showId, n)),
      first_aired: firstAired,
    };
  }

  private progress(index: number): unknown {
    const id = SHOW_BASE + index;
    const seen = this.watched[index] ?? 0;
    const aired = this.aired[index] ?? 0;
    const recent = this.lastWatched[index] ?? null;
    return {
      ...shapes.progress,
      aired,
      completed: Math.min(seen, aired),
      last_watched_at: recent,
      last_episode: seen > 0 ? this.episode(id, seen, this.iso(-400 * DAY_MS)) : null,
      next_episode: seen < aired ? this.episode(id, seen + 1, this.iso(-400 * DAY_MS)) : null,
      seasons: this.seasonNumbers(aired).map((season) => {
        const episodes = this.episodeNumbers(season, aired).map((number) => {
          const done = (season - 1) * EPISODES_PER_SEASON + number <= seen;
          return { number, completed: done, last_watched_at: done ? recent : null };
        });
        return {
          ...shapes.progress.seasons[0],
          number: season,
          aired: episodes.length,
          completed: episodes.filter((episode) => episode.completed).length,
          episodes,
        };
      }),
    };
  }

  private seasons(index: number): unknown[] {
    const id = SHOW_BASE + index;
    const aired = this.aired[index] ?? 0;
    return this.seasonNumbers(aired).map((season) => ({
      ...shapes.season,
      ids: ids(id * 100 + season),
      number: season,
      episodes: this.episodeNumbers(season, aired).map((number) => ({
        ...shapes.season.episodes[0],
        season,
        number,
        ids: ids(episodeId(id, (season - 1) * EPISODES_PER_SEASON + number)),
        first_aired: this.iso(-30 * DAY_MS),
      })),
    }));
  }

  private calendar(start: string, days: number): unknown[] {
    const from = Date.parse(`${start}T00:00:00.000Z`) - DAY_MS;
    const to = from + (days + 2) * DAY_MS;
    const airing: { show: unknown; showId: number; next: number; slot: number }[] = [];
    for (let i = 0; i < this.size.airingWatched; i += 1) {
      const index =
        i * Math.floor((this.size.inProgress + this.size.caughtUp) / this.size.airingWatched);
      airing.push({
        show: this.showOf(index),
        showId: SHOW_BASE + index,
        next: (this.aired[index] ?? 0) + 1,
        slot: i,
      });
    }
    for (let i = 0; i < this.size.airingWatchlist; i += 1) {
      const showId = WATCHLIST_SHOW_BASE + i;
      airing.push({
        show: { ...shapes.calendarEntry.show, ids: ids(showId), title: `Show ${showId}` },
        showId,
        next: 1,
        slot: i,
      });
    }
    return airing.flatMap(({ show, showId, next, slot }) =>
      Array.from({ length: AIRING_EPISODES }, (_, k) => {
        const firstAired = this.iso((((slot + 9 * k) % 50) - 30) * DAY_MS);
        return {
          first_aired: firstAired,
          show,
          episode: this.episode(showId, next + k, firstAired),
        };
      }).filter(({ first_aired }) => {
        const at = Date.parse(first_aired);
        return at >= from && at < to;
      }),
    );
  }

  private hiddenShows(): unknown[] {
    const first = this.size.inProgress + this.size.caughtUp;
    return Array.from({ length: this.size.hidden }, (_, i) => ({
      hidden_at: this.iso(-i * DAY_MS),
      type: "show",
      show: this.showOf(first + i),
    }));
  }

  private list(count: number, base: number, kind: "show" | "movie" | "watched"): unknown[] {
    return Array.from({ length: count }, (_, i) => {
      const id = base + i;
      if (kind === "show") {
        return {
          ...shapes.watchlistShow,
          id,
          rank: i + 1,
          show: { ...shapes.watchlistShow.show, ids: ids(id), title: `Show ${id}` },
        };
      }
      const template = kind === "movie" ? shapes.watchlistMovie : shapes.watchedMovie;
      return { ...template, movie: { ...template.movie, ids: ids(id), title: `Movie ${id}` } };
    });
  }

  private browse(template: Record<string, unknown>, wrap?: "show" | "movie"): unknown[] {
    return Array.from({ length: BROWSE_ITEMS }, (_, i) => {
      const id = 8_000_000 + i;
      if (wrap === undefined) return { ...template, ids: ids(id) };
      return { ...template, [wrap]: { ...(template[wrap] as object), ids: ids(id) } };
    });
  }
}
