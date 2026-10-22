// @vitest-environment jsdom
import {
  exchangeCodeForToken,
  type OAuthConfig,
  pollDeviceToken,
  refreshAccessToken,
  requestDeviceCode,
  revokeToken,
} from "@cue/core/data/auth/oauth";
import { resolvePoster } from "@cue/core/data/image-source";
import { TraktClient, type TraktResult } from "@cue/core/data/trakt/client";
import {
  getEpisode,
  getHidden,
  getHistory,
  getItemPlays,
  getLastActivities,
  getMovie,
  getMyShowsCalendar,
  getPopularMovies,
  getPopularShows,
  getRelatedMovies,
  getRelatedShows,
  getShow,
  getShowProgress,
  getShowSeasons,
  getTrendingMovies,
  getTrendingShows,
  getUserSettings,
  getWatchedMovies,
  getWatchedShows,
  getWatchlist,
  searchTrakt,
} from "@cue/core/data/trakt/endpoints";
import { advancePastNext, type LibraryEntry } from "@cue/core/data/trakt/library";
import { loadUpNextEntries } from "@cue/core/data/trakt/read-budget";
import { diffActivities } from "@cue/core/domain/sync-activities";
import { groupUpNext } from "@cue/core/domain/up-next";
import { DEFAULT_STALENESS_THRESHOLD_MS } from "@cue/core/domain/watch-status";
import { buildMarkEpisodeOp } from "@cue/core/domain/write-queue/ops";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createSizedLibrary } from "../../../../scripts/mock-trakt/seed.mjs";
import { createMockTrakt, respond } from "../../../../scripts/mock-trakt/server.mjs";

/**
 * What stops `scripts/mock-trakt` drifting from the app it exists to feed. The
 * mock boots in-process and every seeded endpoint is read back through the app's
 * OWN client and endpoint parsers, so a body that no longer satisfies the zod
 * contracts in `src/data/trakt/schemas.ts` fails here rather than in a simulator
 * demo. The Up Next assertion goes one layer further: the seeded account has to
 * produce a queue and a lapsed drawer through the real read + grouping pipeline,
 * because a mock that parses but paints an empty app is just as useless.
 */

const mock = createMockTrakt({ port: 0, log: false });
let baseUrl = "";

beforeAll(async () => {
  baseUrl = await mock.listen();
});

afterAll(async () => {
  await mock.close();
});

afterEach(async () => {
  await fetch(`${baseUrl}/__reset`, { method: "POST" });
});

const client = (): TraktClient =>
  new TraktClient({
    clientId: "mock-client",
    getToken: () => "mock-access-token",
    baseUrl,
  });

/** Unwrap a read, failing loudly on a transport error (a parse failure throws). */
function ok<T>(result: TraktResult<T>): T {
  if (!result.ok) throw new Error(`read failed: ${JSON.stringify(result.error)}`);
  return result.data;
}

/** Send a write the way the write queue does, failing loudly on a non-2xx. */
async function write(path: string, body: unknown): Promise<unknown> {
  const response = await client().send("POST", path, { body });
  if (response.status >= 300) throw new Error(`write failed: ${response.status}`);
  return response.data;
}

const oauth = (): OAuthConfig => ({
  clientId: "mock-client",
  redirectUri: "http://127.0.0.1:4173/auth/callback",
  apiBaseUrl: baseUrl,
  siteBaseUrl: baseUrl,
});

const today = (): string => new Date(mock.library.now).toISOString().slice(0, 10);

const resetTo = async (seed: string): Promise<Response> =>
  fetch(`${baseUrl}/__reset?seed=${seed}`, { method: "POST" });

it("provides a mixed season and consecutive aired episodes for detail interactions", async () => {
  const progress = ok(await getShowProgress(client(), 8803));
  expect(progress.next_episode).toMatchObject({ season: 2, number: 3, ids: { trakt: 880308 } });
  expect(progress.seasons?.find((season) => season.number === 2)).toMatchObject({
    aired: 4,
    completed: 2,
  });
  const episode = ok(await getEpisode(client(), 8803, 2, 4));
  expect(episode.images?.screenshot?.length).toBeGreaterThan(0);
  expect(Date.parse(episode.first_aired ?? "")).toBeLessThan(mock.library.now);
});

const armFault = async (profile: string): Promise<Response> =>
  fetch(`${baseUrl}/__fault?${profile}`, { method: "POST" });

const historyWrite = (signal?: AbortSignal): Promise<Response> =>
  fetch(`${baseUrl}/sync/history`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ episodes: [{ ids: { trakt: 880100 } }] }),
    signal,
  });

/** The first seeded show. A seed with none is a broken harness, not a skipped test. */
function firstSeededShow(): (typeof mock.library.shows)[number] {
  const show = mock.library.shows[0];
  if (show === undefined) throw new Error("the mock seeds no shows");
  return show;
}

function firstSeededMovie(): (typeof mock.library.movies)[number] {
  const movie = mock.library.movies[0];
  if (movie === undefined) throw new Error("the mock seeds no movies");
  return movie;
}

/**
 * The post-mark projection against the catalogue it will be applied to: every
 * coordinate `advancePastNext` invents for a seeded show has to be an episode
 * that has actually aired, or the queue names an episode nobody can watch.
 */
describe("the post-mark projection over the seeded catalogue", () => {
  it("projects only real aired coordinates across every seeded show", () => {
    for (const show of mock.library.shows) {
      const aired = show.episodes.flatMap((episode) =>
        episode.firstAired !== null && episode.firstAired <= mock.library.now
          ? [{ ...episode, firstAired: episode.firstAired }]
          : [],
      );
      const last = aired.at(-1);
      for (const [index, episode] of aired.entries()) {
        const entry: LibraryEntry = {
          showId: show.trakt,
          title: show.title,
          year: null,
          status: show.status,
          hidden: false,
          inWatchlist: false,
          addedAt: null,
          lastWatchedAt: null,
          aired: aired.length,
          completed: index,
          nextEpisode: {
            season: episode.season,
            number: episode.number,
            title: episode.title,
            firstAired: new Date(episode.firstAired).toISOString(),
            still: null,
            ids: { trakt: episode.traktId },
          },
          lastAired: last === undefined ? null : { season: last.season, number: last.number },
          tmdbId: show.tmdb,
          runtime: show.runtime,
          posters: [],
          pendingAdvance: false,
        };
        const projected = advancePastNext(
          entry,
          new Date(mock.library.now).toISOString(),
        ).nextEpisode;
        expect({
          show: show.title,
          marked: `${episode.season}:${episode.number}`,
          projected: projected === null ? null : `${projected.season}:${projected.number}`,
          real:
            projected === null ||
            aired.some(
              (candidate) =>
                candidate.season === projected.season && candidate.number === projected.number,
            ),
        }).toMatchObject({ real: true });
      }
    }
  });
});

/**
 * Every written title, plus one title of each shape the collection shelf
 * generates: the shelf's hundreds of titles differ only in ids, names and
 * dates, so reading all of them costs seconds without parsing anything new.
 */
function representatives<T extends object>(titles: T[], shape: (title: T) => unknown): T[] {
  const shelf = new Map<unknown, T>();
  for (const title of titles) {
    if ("shelf" in title && !shelf.has(shape(title))) shelf.set(shape(title), title);
  }
  return [...titles.filter((title) => !("shelf" in title)), ...shelf.values()];
}

describe("the seeded account parses through the app's own contracts", () => {
  it("serves the cold-sync reads", async () => {
    expect(ok(await getWatchedShows(client())).length).toBeGreaterThan(0);
    expect(ok(await getWatchedMovies(client())).length).toBeGreaterThan(0);
    expect(ok(await getWatchlist(client(), "shows")).length).toBeGreaterThan(0);
    expect(ok(await getWatchlist(client(), "movies")).length).toBeGreaterThan(0);
    expect(ok(await getHidden(client()))).toEqual([]);
    expect(ok(await getLastActivities(client())).all).toBeTruthy();
  });

  it("serves the account identity reads", async () => {
    expect(ok(await getUserSettings(client())).user.username).toBe("cue-demo");
  });

  it("carries runtimes on the watched reads Profile totals", async () => {
    const shows = ok(await getWatchedShows(client()));
    const movies = ok(await getWatchedMovies(client()));
    expect(shows.every((row) => (row.show.runtime ?? 0) > 0)).toBe(true);
    expect(movies.every((row) => (row.movie.runtime ?? 0) > 0)).toBe(true);
  });

  it("serves detail, progress, seasons and episode reads for every written show and one collection shelf show of each status", async () => {
    const shows = representatives(mock.library.shows, (entry) => entry.status);
    expect(shows.filter((show) => "shelf" in show).map((show) => show.status)).toEqual([
      "returning series",
      "ended",
      "in production",
    ]);
    for (const show of shows) {
      const detail = ok(await getShow(client(), show.trakt));
      expect(detail.title).toBe(show.title);
      expect(
        ok(await getRelatedShows(client(), show.trakt, 12)).every(
          (related) => related.ids.trakt !== show.trakt,
        ),
      ).toBe(true);
      const progress = ok(await getShowProgress(client(), show.trakt));
      expect(progress.aired > 0).toBe(show.status !== "in production");
      const seasons = ok(await getShowSeasons(client(), show.trakt));
      expect(seasons.length).toBe(show.seasons.length);
      const episode = ok(await getEpisode(client(), show.trakt, 1, 1));
      expect(episode.season).toBe(1);
    }
  });

  it("serves the detail read for every written movie and one collection shelf movie", async () => {
    const movies = representatives(mock.library.movies, () => "shelf");
    expect(movies.filter((movie) => "shelf" in movie)).toHaveLength(1);
    for (const movie of movies) {
      const detail = ok(await getMovie(client(), movie.trakt));
      expect(detail.title).toBe(movie.title);
      expect(detail.images?.poster).toHaveLength(1);
      expect(detail.images?.fanart).toHaveLength(1);
      expect(
        ok(await getRelatedMovies(client(), movie.trakt)).every(
          (related) => related.ids.trakt !== movie.trakt,
        ),
      ).toBe(true);
    }
  });

  it("serves large, small and empty related fixtures within the requested limit", async () => {
    const movies = ok(await getRelatedMovies(client(), 5501, 12));
    expect(movies).toHaveLength(7);
    expect(movies[0]).toMatchObject({
      images: { poster: [expect.any(String)], fanart: [expect.any(String)] },
    });
    expect(ok(await getRelatedMovies(client(), 5501, 6))).toHaveLength(6);
    expect(ok(await getRelatedMovies(client(), 5502, 12))).toHaveLength(2);
    expect(ok(await getRelatedMovies(client(), 5503, 12))).toEqual([]);
    const shows = ok(await getRelatedShows(client(), 8803, 12));
    expect(shows).toHaveLength(7);
    expect(shows[0]).toMatchObject({
      status: expect.any(String),
      images: { poster: [expect.any(String)] },
    });
    expect(ok(await getRelatedShows(client(), 8803, 6))).toHaveLength(6);
    expect(ok(await getRelatedShows(client(), 8807, 12))).toEqual([]);
  });

  it("serves a calendar window with the upcoming airings the seed promises", async () => {
    const upcoming = ok(await getMyShowsCalendar(client(), today(), 28));
    expect(upcoming).toContainEqual(
      expect.objectContaining({
        first_aired: "2026-10-20T00:00:00.000Z",
        episode: expect.objectContaining({ ids: expect.objectContaining({ trakt: 880609 }) }),
      }),
    );
    expect(upcoming.every((item) => Date.parse(item.first_aired) >= mock.library.now)).toBe(true);
  });

  it("serves history one page at a time, with the pagination headers the client walks", async () => {
    const first = await getHistory(client(), "all", 1);
    const rows = ok(first);
    expect(rows.length).toBe(30);
    expect(first.ok && first.pagination?.pageCount).toBeGreaterThan(1);
    const repeated = rows.filter((row) => row.episode?.ids.trakt === 880608);
    expect(repeated).toHaveLength(2);
    expect(new Set(repeated.map((row) => row.watched_at.slice(0, 10))).size).toBe(1);
    expect(ok(await getHistory(client(), "movies", 1)).every((row) => row.type === "movie")).toBe(
      true,
    );
  });

  it("serves the browse rails from the account's own titles, ranked and bare", async () => {
    expect(ok(await getTrendingShows(client())).map((row) => row.show.title)).toContain(
      "Harbor Lights",
    );
    expect(ok(await getPopularShows(client())).map((show) => show.title)).toContain(
      "Harbor Lights",
    );
    expect(ok(await getTrendingMovies(client())).map((row) => row.movie.title)).toContain(
      "The Lantern Keeper",
    );
    expect(ok(await getPopularMovies(client())).map((movie) => movie.title)).toContain(
      "The Lantern Keeper",
    );
  });

  it("searches its own titles and the catalog-only ones together", async () => {
    const hits = ok(await searchTrakt(client(), "harbor"));

    expect(hits.map((hit) => hit.show?.title ?? hit.movie?.title)).toEqual([
      "Harbor Lights",
      "The Harbor Master",
      "Harbor Sound",
    ]);
  });

  it("applies the history month window before pagination", async () => {
    const first = ok(await getHistory(client(), "all", 1))[0];
    expect(first).toBeDefined();
    const start = first?.watched_at ?? "";
    const query = new URLSearchParams({ start_at: start, end_at: start });
    const response = await fetch(`${baseUrl}/users/me/history?${query}`);
    const rows = await response.json();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row: { watched_at: string }) => row.watched_at === start)).toBe(true);
    const empty = await fetch(`${baseUrl}/users/me/history?start_at=2000-01-01&end_at=2000-02-01`);
    expect(await empty.json()).toEqual([]);
  });

  it("answers a path it does not model with 404 rather than an empty success", async () => {
    const result = await client().get("/shows/8801/people");
    expect(result.ok ? null : result.error).toEqual({ kind: "not-found" });
  });

  it("serves a real image for every poster the app resolves", async () => {
    const detail = ok(await getShow(client(), firstSeededShow().trakt));
    const poster = resolvePoster({ title: detail.title, traktPosters: detail.images?.poster });
    expect(poster.source).toBe("trakt");
    const response = await fetch(poster.source === "trakt" ? poster.url : "");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
  });

  it("serves the movie backdrop advertised by its detail read", async () => {
    const detail = ok(await getMovie(client(), firstSeededMovie().trakt));
    const response = await fetch(detail.images?.fanart?.[0] ?? "");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
  });
});

describe("the placeholder images survive what they are asked to draw", () => {
  it.each([
    ["poster", 400, 600],
    ["avatar", 240, 240],
    ["fanart", 640, 360],
    ["toString", 640, 360],
  ])("serves PNG dimensions for %s", async (slot, width, height) => {
    const show = firstSeededShow();
    const response = await fetch(`${baseUrl}/images/shows/${show.trakt}/${slot}.png`);
    expect(response.status).toBe(200);
    const png = Buffer.from(await response.arrayBuffer());
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(width);
    expect(png.readUInt32BE(20)).toBe(height);
  });
});

describe("a request the mock cannot answer", () => {
  it("says so without quoting the request back", async () => {
    const probe = encodeURIComponent("<script>alert(1)</script>");
    const requests: [string, RequestInit?][] = [
      [`/${probe}`],
      [`/shows/${probe}`],
      [`/shows/${probe}/seasons`],
      [`/shows/${probe}/seasons/1/episodes/1`],
      [`/movies/${probe}`],
      [`/sync/history/shows/${probe}`],
      [`/__reset?seed=${probe}`, { method: "POST" }],
      [`/__reset?seed=${probe}`, { method: "DELETE" }],
    ];
    const answers = await Promise.all(
      requests.map(async ([path, init]) => {
        const response = await fetch(`${baseUrl}${path}`, init);
        return { path, status: response.status, body: await response.text() };
      }),
    );

    expect(
      answers.filter((answer) => answer.status !== 404 || answer.body.includes("script")),
    ).toEqual([]);
  });
});

describe("the seeded account fills the surfaces the harness exists to demo", () => {
  it("produces both an Up Next queue and a lapsed drawer", async () => {
    const entries = await loadUpNextEntries(client());
    const groups = groupUpNext(entries, mock.library.now, DEFAULT_STALENESS_THRESHOLD_MS);
    expect(groups.queue.length).toBeGreaterThan(1);
    expect(groups.lapsed.length).toBeGreaterThan(0);
    expect(entries.some((entry) => entry.inWatchlist && entry.completed === 0)).toBe(true);
  });

  it("carries a never-started collection in the hundreds, posters only from the watchlist", async () => {
    const entries = await loadUpNextEntries(client());
    const notStarted = entries.filter((entry) => entry.completed === 0);
    const listed = mock.library.shows.filter(
      (show) => show.completed === 0 && (show.collectedAt !== null || show.inWatchlist),
    );
    expect(listed.length).toBeGreaterThan(200);
    expect(notStarted).toHaveLength(listed.length);
    expect(notStarted.every((entry) => entry.addedAt !== null)).toBe(true);
    expect(notStarted.every((entry) => entry.posters.length > 0 === entry.inWatchlist)).toBe(true);
  });
});

describe("a sized account for the request budget", () => {
  it("keeps an airing show's progress at its snapshot until the user writes to it", async () => {
    const now = Date.parse("2026-10-20T12:00:00.000Z");
    const library = createSizedLibrary(
      {
        inProgress: 10,
        lapsed: 0,
        caughtUp: 0,
        finished: 0,
        airingWatched: 2,
        airingWatchlist: 0,
        watchlistShows: 0,
        watchlistMovies: 0,
        watchedMovies: 0,
        hidden: 0,
      },
      now,
    );
    const airing = library.shows.find((show) => show.progressAt !== undefined);
    if (airing === undefined) throw new Error("no airing show");
    const read = () =>
      JSON.parse(
        respond(
          library,
          "GET",
          new URL(`https://api.trakt.tv/shows/${airing.trakt}/progress/watched`),
        ).body,
      ) as { aired: number };
    const aired = airing.episodes.filter((ep) => ep.firstAired !== null && ep.firstAired <= now);
    expect(read().aired).toBe(aired.length - 2);
    respond(library, "POST", new URL("https://api.trakt.tv/sync/history"), {
      episodes: [{ ids: { trakt: airing.episodes[0]?.traktId } }],
    });
    expect(read().aired).toBe(aired.length);
  });
});

describe("seed profiles", () => {
  it("serves a show watched only through its specials the way Trakt does", async () => {
    await fetch(`${baseUrl}/__reset?seed=specials-only`, { method: "POST" });
    const watched = ok(await getWatchedShows(client())).find((row) => row.show.ids.trakt === 8809);
    expect(watched?.seasons?.map((season) => season.number)).toEqual([0]);
    expect(ok(await getShowProgress(client(), 8809)).completed).toBe(0);
    const withSpecials = await fetch(
      `${baseUrl}/shows/8809/progress/watched?specials=true&count_specials=true`,
    );
    const progress = (await withSpecials.json()) as {
      completed: number;
      seasons: { number: number }[];
    };
    expect(progress.completed).toBe(4);
    expect(progress.seasons[0]?.number).toBe(0);
    await fetch(`${baseUrl}/__reset`, { method: "POST" });
  });

  it("keeps a replayed special's first play and adds a second, as for any episode", async () => {
    await fetch(`${baseUrl}/__reset?seed=specials-only`, { method: "POST" });
    const special = ok(await getShowSeasons(client(), 8809))[0]?.episodes?.[0]?.ids.trakt ?? 0;
    const plays = async () => ok(await getItemPlays(client(), "episodes", special));
    const [first] = await plays();
    const answer = await fetch(`${baseUrl}/sync/history`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        episodes: [{ ids: { trakt: special }, watched_at: "2026-10-15T00:00:00.000Z" }],
      }),
    });
    expect(await answer.json()).toMatchObject({ added: { episodes: 1 } });
    const replayed = await plays();
    expect(replayed).toHaveLength(2);
    expect(replayed).toContainEqual(
      expect.objectContaining({ id: first?.id, watched_at: first?.watched_at }),
    );
    const second = replayed.find((play) => play.id !== first?.id)?.id;
    await fetch(`${baseUrl}/sync/history/remove`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [second] }),
    });
    expect((await plays()).map((play) => play.id)).toEqual([first?.id]);
    await fetch(`${baseUrl}/__reset`, { method: "POST" });
  });

  it("numbers a long runner's seasons from its specials, and runs a continuous show's numbers on", async () => {
    await fetch(`${baseUrl}/__reset?seed=scale`, { method: "POST" });
    const seasons = ok(await getShowSeasons(client(), 99));
    expect(seasons).toHaveLength(39);
    expect(seasons[0]?.number).toBe(0);
    expect(Math.max(...seasons.map((season) => season.episodes?.length ?? 0))).toBe(199);
    const continuous = ok(await getShowSeasons(client(), 98));
    expect(continuous[1]?.episodes?.[0]?.number).toBe(62);
    await fetch(`${baseUrl}/__reset`, { method: "POST" });
  });

  it("keeps the default account unchanged", async () => {
    const response = await fetch(`${baseUrl}/__reset`, { method: "POST" });
    expect(await response.json()).toEqual({ reset: true });
    const written = (items: readonly { shelf?: boolean; trakt: number }[]) =>
      items.filter((item) => item.shelf !== true).map((item) => item.trakt);
    expect(written(mock.library.shows)).toEqual([8801, 8802, 8803, 8804, 8805, 8806, 8807, 8808]);
    expect(written(mock.library.movies)).toEqual([5501, 5502, 5503, 5504, 5505, 5506, 5507, 5508]);
  });

  it("moves every activity the app diffs past the replaced account's, even a write's", async () => {
    await write("/sync/history", {
      episodes: [{ ids: { trakt: 880308 }, watched_at: new Date(mock.library.now).toISOString() }],
    });
    const before = ok(await getLastActivities(client()));
    await resetTo("default");
    const after = ok(await getLastActivities(client()));

    expect(new Set(diffActivities(before, after))).toEqual(
      new Set(diffActivities(undefined, before)),
    );
  });

  it("serves an empty library", async () => {
    await resetTo("empty-library");
    expect(ok(await getWatchedShows(client()))).toEqual([]);
    expect(ok(await getWatchedMovies(client()))).toEqual([]);
    expect(ok(await getWatchlist(client(), "shows"))).toEqual([]);
    expect(ok(await getWatchlist(client(), "movies"))).toEqual([]);
  });

  it("serves a watchlist-only library", async () => {
    await resetTo("watchlist-only");
    expect(ok(await getWatchedShows(client()))).toEqual([]);
    expect(ok(await getWatchedMovies(client()))).toEqual([]);
    expect(ok(await getWatchlist(client(), "shows")).map((row) => row.show?.ids.trakt)).toEqual([
      8808,
    ]);
    expect(ok(await getWatchlist(client(), "movies")).map((row) => row.movie?.ids.trakt)).toEqual([
      5503,
    ]);
  });

  it("serves a library containing only a stopped show", async () => {
    await resetTo("only-stopped");
    expect(ok(await getWatchedShows(client())).map((show) => show.show.ids.trakt)).toEqual([8805]);
    expect(ok(await getHidden(client())).map((row) => row.show?.ids.trakt)).toEqual([8805]);
    expect(ok(await getWatchlist(client(), "shows"))).toEqual([]);
  });

  it("serves a profile with nothing watched", async () => {
    await resetTo("zeroed-stats");
    expect(ok(await getWatchedShows(client()))).toEqual([]);
    expect(ok(await getWatchedMovies(client()))).toEqual([]);
  });

  it("serves an episode with two plays", async () => {
    await resetTo("rewatched-episode");
    expect(ok(await getItemPlays(client(), "episodes", 880100)).map((row) => row.id)).toEqual([
      8801002, 8801001,
    ]);
  });

  it("serves a movie with two plays", async () => {
    await resetTo("rewatched-movie");
    expect(ok(await getItemPlays(client(), "movies", 5501)).map((row) => row.id)).toEqual([
      55012, 55011,
    ]);
  });
});

describe("fault profiles", () => {
  it("returns one unauthorized read, then clears", async () => {
    await armFault("next-read-401");
    expect((await fetch(`${baseUrl}/users/settings`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/users/settings`)).status).toBe(200);
  });

  it("refuses refreshes until reset", async () => {
    await armFault("refuse-refresh");
    expect((await fetch(`${baseUrl}/oauth/token`, { method: "POST" })).status).toBe(401);
    await fetch(`${baseUrl}/__reset`, { method: "POST" });
    expect((await fetch(`${baseUrl}/oauth/token`, { method: "POST" })).status).toBe(200);
  });

  it("rate limits after a fan-out has begun until reset", async () => {
    await armFault("rate-limit-progress");
    expect((await fetch(`${baseUrl}/shows/8801/progress/watched`)).status).toBe(200);
    const limited = await fetch(`${baseUrl}/shows/8802/progress/watched`);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("1");
    expect(JSON.parse(limited.headers.get("x-ratelimit") ?? "{}")).toMatchObject({
      name: "AUTHED_API_GET_LIMIT",
      remaining: 0,
    });
    await fetch(`${baseUrl}/__reset`, { method: "POST" });
    expect((await fetch(`${baseUrl}/shows/8802/progress/watched`)).status).toBe(200);
  });

  it("holds a write open until deleting the fault releases it", async () => {
    await armFault("hold-write");
    const controller = new AbortController();
    const request = historyWrite(controller.signal);
    // Long enough that an answered write would have answered: a window this
    // assertion could lose on a loaded runner is a window that proves nothing.
    expect(
      await Promise.race([request, new Promise((resolve) => setTimeout(resolve, 250, "held"))]),
    ).toBe("held");
    await fetch(`${baseUrl}/__fault`, { method: "DELETE" });
    const released = await Promise.race([
      request.then((response) => response.status),
      new Promise((resolve) => setTimeout(resolve, 250, "still held")),
    ]);
    controller.abort();
    expect(released).toBe(201);
  });

  it("drops a write connection until reset", async () => {
    await armFault("drop-write");
    await expect(historyWrite()).rejects.toThrow("fetch failed");
    await fetch(`${baseUrl}/__reset`, { method: "POST" });
    expect((await historyWrite()).status).toBe(201);
  });

  it("fails only the second history page until reset", async () => {
    await armFault("fail-history-page");
    expect((await fetch(`${baseUrl}/users/me/history?page=1`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/users/me/history?page=2`)).status).toBe(503);
    await fetch(`${baseUrl}/__reset`, { method: "POST" });
    expect((await fetch(`${baseUrl}/users/me/history?page=2`)).status).toBe(200);
  });

  // The mock is plain Node with no build step, so its op-log is a literal. It is
  // only worth seeding if it is what the app's own builder would have written.
  it("seeds an operation log the write queue would replay, until reset", async () => {
    const armed = await (await armFault("seed-op-log")).json();
    expect(armed.opLog).toEqual([
      buildMarkEpisodeOp({
        opId: "e2e-pending-880100",
        ids: { trakt: 880100 },
        watchedAt: "2026-01-01T00:00:00.000Z",
        inversePatch: { showId: 8801, preCompleted: 20 },
      }),
    ]);
    await fetch(`${baseUrl}/__reset`, { method: "POST" });
    expect((await (await fetch(`${baseUrl}/__fault`)).json()).opLog).toEqual([]);
  });
});

describe("the seeded bodies keep Trakt's shape, not the app's convenience", () => {
  it("emits the watched breakdown, status and images only at the level that asks", async () => {
    const bodyAt = async (query: string): Promise<string> =>
      JSON.stringify(await (await fetch(`${baseUrl}/sync/watched/shows${query}`)).json());

    // Trakt change #775: no images on this endpoint at any level, and the
    // breakdown and status ride their own extended levels.
    const bare = await bodyAt("");
    expect(bare).not.toContain('"seasons"');
    expect(bare).not.toContain('"status"');
    expect(bare).not.toContain('"images"');

    // The other direction, because a mock that emits everything unconditionally
    // stops being able to fail when the app drops an extended level.
    expect(await bodyAt("?extended=progress")).toContain('"seasons"');
    expect(await bodyAt("?extended=full")).toContain('"status"');
    expect(await bodyAt("?extended=full,images")).not.toContain('"images"');
  });
});

describe("writes move the account the next read sees", () => {
  it("advances progress when an episode is marked, and rolls it back on removal", async () => {
    const show = firstSeededShow();
    const before = ok(await getShowProgress(client(), show.trakt));
    const next = before.next_episode;
    if (next === null) throw new Error("the seeded show must have a next episode to mark");

    const body = {
      episodes: [
        { ids: { trakt: next.ids.trakt }, watched_at: new Date(mock.library.now).toISOString() },
      ],
    };
    expect(await write("/sync/history", body)).toMatchObject({
      added: { episodes: 1 },
    });

    const after = ok(await getShowProgress(client(), show.trakt));
    expect(after.completed).toBe(before.completed + 1);
    expect(after.next_episode?.ids.trakt).not.toBe(next.ids.trakt);

    await write("/sync/history/remove", { episodes: body.episodes });
    expect(ok(await getShowProgress(client(), show.trakt)).completed).toBe(before.completed);
  });

  it("serves one show's plays, and removes exactly the play a row names", async () => {
    const show = firstSeededShow();
    const before = ok(await getShowProgress(client(), show.trakt));
    const plays = ok(await getItemPlays(client(), "shows", show.trakt));
    // One row per watched episode, each carrying the id the removal is scoped by.
    expect(plays.length).toBe(before.completed);

    const newest = plays[0];
    const episode = newest?.episode;
    if (newest === undefined || episode === undefined) {
      throw new Error("the seeded show must have an episode play to remove");
    }
    await write("/sync/history/remove", { ids: [newest.id] });
    expect(ok(await getShowProgress(client(), show.trakt)).completed).toBe(before.completed - 1);

    await write("/sync/history", {
      episodes: [{ ids: { trakt: episode.ids.trakt }, watched_at: newest.watched_at }],
    });
    expect(ok(await getShowProgress(client(), show.trakt)).completed).toBe(before.completed);
  });

  it("reports a write that matched nothing rather than answering a silent success", async () => {
    const response = await write("/sync/history", {
      episodes: [{ ids: { trakt: 1 }, watched_at: new Date(mock.library.now).toISOString() }],
    });
    expect(response).toMatchObject({
      added: { episodes: 0 },
      not_found: { episodes: [{ ids: { trakt: 1 } }] },
    });
  });

  it("hides and unhides a show, which is what the hidden read then serves", async () => {
    const show = firstSeededShow();
    const body = { shows: [{ ids: { trakt: show.trakt } }] };

    expect(await write("/users/hidden/progress_watched", body)).toMatchObject({
      added: { shows: 1 },
    });
    expect(ok(await getHidden(client())).map((row) => row.show?.ids.trakt)).toEqual([show.trakt]);

    await write("/users/hidden/progress_watched/remove", body);
    expect(ok(await getHidden(client()))).toEqual([]);
  });

  it("adds and removes a watchlist entry the watchlist read then reflects", async () => {
    const show = firstSeededShow();
    const body = { shows: [{ ids: { trakt: show.trakt } }] };
    const listed = async (): Promise<(number | undefined)[]> =>
      ok(await getWatchlist(client(), "shows")).map((row) => row.show?.ids.trakt);
    const before = await listed();
    expect(before).not.toContain(show.trakt);

    expect(await write("/sync/watchlist", body)).toMatchObject({ added: { shows: 1 } });
    expect(await listed()).toContain(show.trakt);

    await write("/sync/watchlist/remove", body);
    expect(await listed()).toEqual(before);
  });
});

describe("the OAuth surface both flows need", () => {
  it("holds a device grant pending until it is approved, and drops it on reset", async () => {
    const code = await requestDeviceCode(oauth(), "challenge");
    expect(code.userCode).toBe("CUE-MOCK");
    expect((await pollDeviceToken(oauth(), code.deviceCode, "verifier")).status).toBe("pending");
    await fetch(`${baseUrl}/__approve`, { method: "POST" });
    expect((await pollDeviceToken(oauth(), code.deviceCode, "verifier")).status).toBe("success");
    await fetch(`${baseUrl}/__reset`, { method: "POST" });
    expect((await pollDeviceToken(oauth(), code.deviceCode, "verifier")).status).toBe("pending");
  });

  it("starts every new device code pending, even after an earlier grant was approved", async () => {
    await requestDeviceCode(oauth(), "challenge");
    await fetch(`${baseUrl}/__approve`, { method: "POST" });
    const code = await requestDeviceCode(oauth(), "challenge");
    expect((await pollDeviceToken(oauth(), code.deviceCode, "verifier")).status).toBe("pending");
  });

  it("exchanges an authorization code, refreshes it, and revokes it", async () => {
    const token = await exchangeCodeForToken(oauth(), "mock-auth-code", "verifier");
    expect(token.access_token).toBe("mock-access-token");
    expect((await refreshAccessToken(oauth(), token.refresh_token)).refresh_token).toBeTruthy();
    await expect(revokeToken(oauth(), token.access_token)).resolves.toBeUndefined();
  });

  it("redirects the authorize page back to the app with the caller's state intact", async () => {
    const url = new URL(`${baseUrl}/oauth/authorize`);
    url.searchParams.set("redirect_uri", "http://127.0.0.1:4173/auth/callback");
    url.searchParams.set("state", "nonce-1");
    const response = await fetch(url, { redirect: "manual" });
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/auth/callback");
    expect(location.searchParams.get("state")).toBe("nonce-1");
    expect(location.searchParams.get("code")).toBeTruthy();
  });
});

describe("a play posted for a watched episode follows the account's Multiple Plays setting", () => {
  const WATCHED_EPISODE = 880100;
  const replay = () =>
    client().send("POST", "/sync/history", {
      body: {
        episodes: [{ ids: { trakt: WATCHED_EPISODE }, watched_at: "2026-10-14T12:34:56.789Z" }],
      },
    });

  it("adds a second play by default, stored to the minute, and removing that play keeps the first", async () => {
    const before = ok(await getShowProgress(client(), 8801)).completed;
    const response = await replay();
    expect(response.status).toBe(201);
    expect(response.data).toMatchObject({ added: { episodes: 1 }, updated: { episodes: 0 } });
    const plays = ok(await getItemPlays(client(), "episodes", WATCHED_EPISODE));
    expect(plays.map((play) => play.watched_at)).toContain("2026-10-14T12:34:00.000Z");
    expect(plays).toHaveLength(2);

    const second = plays.find((play) => play.watched_at === "2026-10-14T12:34:00.000Z");
    await write("/sync/history/remove", { ids: [second?.id] });
    expect(ok(await getItemPlays(client(), "episodes", WATCHED_EPISODE))).toHaveLength(1);
    expect(ok(await getShowProgress(client(), 8801)).completed).toBe(before);
  });

  it("replaces the play and answers updated when Multiple Plays is off", async () => {
    await resetTo("multiple-plays-off");
    const before = ok(await getShowProgress(client(), 8801)).completed;
    const response = await replay();
    expect(response.data).toMatchObject({ added: { episodes: 0 }, updated: { episodes: 1 } });
    const plays = ok(await getItemPlays(client(), "episodes", WATCHED_EPISODE));
    expect(plays.map((play) => play.watched_at)).toEqual(["2026-10-14T12:34:00.000Z"]);
    expect(ok(await getShowProgress(client(), 8801)).completed).toBe(before);
  });

  it("counts a watchlisted title as existing rather than added", async () => {
    const listed = mock.library.shows.find((show) => show.inWatchlist);
    expect(
      await write("/sync/watchlist", { shows: [{ ids: { trakt: listed?.trakt } }] }),
    ).toMatchObject({ added: { shows: 0 }, existing: { shows: 1 } });
  });
});

it("brings a catalogue title into the account when it is added to the watchlist", async () => {
  const catalogue = { shows: [{ ids: { trakt: 8901 } }] };
  expect(await write("/sync/watchlist", catalogue)).toMatchObject({
    added: { shows: 1 },
    not_found: { shows: [] },
  });
  const watchlist = ok(await getWatchlist(client(), "shows"));
  expect(watchlist.map((row) => row.show?.ids.trakt)).toContain(8901);
  const hits = ok(await searchTrakt(client(), "harbor master"));
  expect(hits.filter((hit) => hit.show?.ids.trakt === 8901)).toHaveLength(1);
});
