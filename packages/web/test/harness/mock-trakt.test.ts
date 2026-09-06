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
  getShow,
  getShowProgress,
  getShowSeasons,
  getTrendingMovies,
  getTrendingShows,
  getUserSettings,
  getUserStats,
  getWatchedMovies,
  getWatchedShows,
  getWatchlist,
} from "@cue/core/data/trakt/endpoints";
import { loadUpNextEntries } from "@cue/core/data/trakt/read-budget";
import { groupUpNext } from "@cue/core/domain/up-next";
import { DEFAULT_STALENESS_THRESHOLD_MS } from "@cue/core/domain/watch-status";
import { buildMarkEpisodeOp } from "@cue/core/domain/write-queue/ops";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createMockTrakt } from "../../../../scripts/mock-trakt/server.mjs";

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

const oauth = (): OAuthConfig => ({
  clientId: "mock-client",
  redirectUri: "http://127.0.0.1:4173/auth/callback",
  apiBaseUrl: baseUrl,
  siteBaseUrl: baseUrl,
});

const today = (): string => new Date().toISOString().slice(0, 10);

const resetTo = async (seed: string): Promise<Response> =>
  fetch(`${baseUrl}/__reset?seed=${seed}`, { method: "POST" });

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
    expect(ok(await getUserStats(client())).episodes.watched).toBeGreaterThan(0);
  });

  it("serves every seeded show's detail, progress, seasons and episode reads", async () => {
    for (const show of mock.library.shows) {
      const detail = ok(await getShow(client(), show.trakt));
      expect(detail.title).toBe(show.title);
      const progress = ok(await getShowProgress(client(), show.trakt));
      expect(progress.aired).toBeGreaterThan(0);
      const seasons = ok(await getShowSeasons(client(), show.trakt));
      expect(seasons.length).toBe(show.seasons.length);
      const episode = ok(await getEpisode(client(), show.trakt, 1, 1));
      expect(episode.season).toBe(1);
    }
  });

  it("serves every seeded movie's detail read", async () => {
    for (const movie of mock.library.movies) {
      expect(ok(await getMovie(client(), movie.trakt)).title).toBe(movie.title);
    }
  });

  it("serves a calendar window with the upcoming airings the seed promises", async () => {
    const upcoming = ok(await getMyShowsCalendar(client(), today(), 28));
    expect(upcoming.length).toBeGreaterThan(0);
    expect(upcoming.every((item) => Date.parse(item.first_aired) >= Date.now())).toBe(true);
  });

  it("serves history one page at a time, with the pagination headers the client walks", async () => {
    const first = await getHistory(client(), "all", 1);
    expect(ok(first).length).toBe(30);
    expect(first.ok && first.pagination?.pageCount).toBeGreaterThan(1);
    expect(ok(await getHistory(client(), "movies", 1)).every((row) => row.type === "movie")).toBe(
      true,
    );
  });

  it("serves the browse rails as the empty lists a demo account has", async () => {
    expect(ok(await getTrendingShows(client()))).toEqual([]);
    expect(ok(await getPopularShows(client()))).toEqual([]);
    expect(ok(await getTrendingMovies(client()))).toEqual([]);
    expect(ok(await getPopularMovies(client()))).toEqual([]);
  });

  it("answers a path it does not model with 404 rather than an empty success", async () => {
    const result = await client().get("/search/show", { query: { query: "harbor" } });
    expect(result.ok ? null : result.error).toEqual({ kind: "not-found" });
  });

  it("serves a real image for every poster the app resolves", async () => {
    const detail = ok(await getShow(client(), firstSeededShow().trakt));
    const poster = resolvePoster({ title: detail.title, traktPosters: detail.images?.poster });
    expect(poster.source).toBe("trakt");
    const response = await fetch(poster.source === "trakt" ? poster.url : "");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
  });
});

describe("the seeded account fills the surfaces the harness exists to demo", () => {
  it("produces both an Up Next queue and a lapsed drawer", async () => {
    const entries = await loadUpNextEntries(client());
    const groups = groupUpNext(entries, Date.now(), DEFAULT_STALENESS_THRESHOLD_MS);
    expect(groups.queue.length).toBeGreaterThan(1);
    expect(groups.lapsed.length).toBeGreaterThan(0);
    expect(entries.some((entry) => entry.inWatchlist && entry.completed === 0)).toBe(true);
  });
});

describe("seed profiles", () => {
  it("keeps the default account unchanged", async () => {
    const response = await fetch(`${baseUrl}/__reset`, { method: "POST" });
    expect(await response.json()).toEqual({ reset: true });
    expect(mock.library.shows.map((show) => show.trakt)).toEqual([
      8801, 8802, 8803, 8804, 8805, 8806, 8807, 8808,
    ]);
    expect(mock.library.movies.map((movie) => movie.trakt)).toEqual([5501, 5502, 5503]);
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

  it("serves a profile with zero stats", async () => {
    await resetTo("zeroed-stats");
    expect(ok(await getUserStats(client()))).toEqual({
      movies: { watched: 0, minutes: 0 },
      episodes: { watched: 0, minutes: 0 },
      shows: { watched: 0 },
    });
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
    await fetch(`${baseUrl}/__reset`, { method: "POST" });
    expect((await fetch(`${baseUrl}/shows/8802/progress/watched`)).status).toBe(200);
  });

  it("holds a write open until the client disconnects and reset clears it", async () => {
    await armFault("hold-write");
    const controller = new AbortController();
    const request = historyWrite(controller.signal).catch(() => null);
    // Long enough that an answered write would have answered: a window this
    // assertion could lose on a loaded runner is a window that proves nothing.
    expect(
      await Promise.race([request, new Promise((resolve) => setTimeout(resolve, 250, "held"))]),
    ).toBe("held");
    controller.abort();
    await request;
    await fetch(`${baseUrl}/__reset`, { method: "POST" });
    expect((await historyWrite()).status).toBe(200);
  });

  it("drops a write connection until reset", async () => {
    await armFault("drop-write");
    await expect(historyWrite()).rejects.toThrow("fetch failed");
    await fetch(`${baseUrl}/__reset`, { method: "POST" });
    expect((await historyWrite()).status).toBe(200);
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
      episodes: [{ ids: { trakt: next.ids.trakt }, watched_at: new Date().toISOString() }],
    };
    expect(ok(await client().post("/sync/history", body))).toMatchObject({
      added: { episodes: 1 },
    });

    const after = ok(await getShowProgress(client(), show.trakt));
    expect(after.completed).toBe(before.completed + 1);
    expect(after.next_episode?.ids.trakt).not.toBe(next.ids.trakt);

    ok(await client().post("/sync/history/remove", { episodes: body.episodes }));
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
    ok(await client().post("/sync/history/remove", { ids: [newest.id] }));
    expect(ok(await getShowProgress(client(), show.trakt)).completed).toBe(before.completed - 1);

    ok(
      await client().post("/sync/history", {
        episodes: [{ ids: { trakt: episode.ids.trakt }, watched_at: newest.watched_at }],
      }),
    );
    expect(ok(await getShowProgress(client(), show.trakt)).completed).toBe(before.completed);
  });

  it("reports a write that matched nothing rather than answering a silent success", async () => {
    const response = ok(
      await client().post("/sync/history", {
        episodes: [{ ids: { trakt: 1 }, watched_at: new Date().toISOString() }],
      }),
    );
    expect(response).toMatchObject({
      added: { episodes: 0 },
      not_found: { episodes: [{ ids: { trakt: 1 } }] },
    });
  });

  it("hides and unhides a show, which is what the hidden read then serves", async () => {
    const show = firstSeededShow();
    const body = { shows: [{ ids: { trakt: show.trakt } }] };

    expect(ok(await client().post("/users/hidden/progress_watched", body))).toMatchObject({
      added: { shows: 1 },
    });
    expect(ok(await getHidden(client())).map((row) => row.show?.ids.trakt)).toEqual([show.trakt]);

    ok(await client().post("/users/hidden/progress_watched/remove", body));
    expect(ok(await getHidden(client()))).toEqual([]);
  });

  it("adds and removes a watchlist entry the watchlist read then reflects", async () => {
    const show = firstSeededShow();
    const body = { shows: [{ ids: { trakt: show.trakt } }] };
    const listed = async (): Promise<(number | undefined)[]> =>
      ok(await getWatchlist(client(), "shows")).map((row) => row.show?.ids.trakt);
    const before = await listed();
    expect(before).not.toContain(show.trakt);

    expect(ok(await client().post("/sync/watchlist", body))).toMatchObject({ added: { shows: 1 } });
    expect(await listed()).toContain(show.trakt);

    ok(await client().post("/sync/watchlist/remove", body));
    expect(await listed()).toEqual(before);
  });
});

describe("the OAuth surface both flows need", () => {
  it("issues a device code and resolves the very first poll", async () => {
    const code = await requestDeviceCode(oauth(), "challenge");
    expect(code.userCode).toBe("CUE-MOCK");
    const result = await pollDeviceToken(oauth(), code.deviceCode, "verifier");
    expect(result.status).toBe("success");
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
