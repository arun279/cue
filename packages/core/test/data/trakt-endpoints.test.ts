import { TraktClient } from "@cue/core/data/trakt/client";
import {
  getCollectionShows,
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
  itemsBody,
  searchTrakt,
} from "@cue/core/data/trakt/endpoints";
import { beforeEach, describe, expect, it } from "vitest";
import { createTraktFake } from "../trakt-fake/fake.ts";

const fake = createTraktFake();
const client = new TraktClient({
  clientId: "cid",
  getToken: () => fake.session().access_token,
  fetch: fake.fetch,
});

beforeEach(() => fake.reset());

/** The query string of every request the fake received for `path`. */
const queriesTo = (path: string): URLSearchParams[] =>
  fake.requests
    .filter((request) => request.path === path)
    .map(({ search }) => new URLSearchParams(search));

function data<T>(result: { ok: true; data: T } | { ok: false }): T {
  if (!result.ok) throw new Error("the read failed");
  return result.data;
}

it("limits related shows to six and requests inline artwork", async () => {
  const related = data(await getRelatedShows(client, 8803));
  const [query] = queriesTo("/shows/8803/related");
  expect(query?.get("limit")).toBe("6");
  expect(query?.get("extended")).toContain("images");
  expect(related).toHaveLength(6);
  expect(related[0]?.images?.poster).toHaveLength(1);
});

describe("Trakt read endpoints parse what Trakt sends", () => {
  it("parses watched shows with the aired count and the watched breakdown", async () => {
    const harbor = data(await getWatchedShows(client)).find((row) => row.show.ids.trakt === 8801);
    expect(harbor?.show).toMatchObject({ title: "Harbor Lights", aired_episodes: 22 });
    expect(harbor?.seasons?.flatMap((season) => season.episodes)).toHaveLength(20);
  });

  it("parses watched movies", async () => {
    const movies = data(await getWatchedMovies(client));
    expect(movies.map((row) => row.movie.title)).toContain("The Lantern Keeper");
  });

  it("parses the extended movie detail payload", async () => {
    const movie = data(await getMovie(client, 5501));
    expect(movie).toMatchObject({
      title: "The Lantern Keeper",
      runtime: 104,
      released: "2021-09-17",
    });
    expect(movie.images?.fanart).toHaveLength(1);
  });

  it("parses per-show progress with next_episode", async () => {
    const progress = data(await getShowProgress(client, 8803));
    expect(progress.next_episode).toMatchObject({ season: 2, number: 3 });
    expect(progress.aired).toBe(10);
  });

  it("parses a null next_episode (caught up on a finished show)", async () => {
    expect(data(await getShowProgress(client, 8807)).next_episode).toBeNull();
  });

  it("opts specials into the progress payload only when asked", async () => {
    const without = data(await getShowProgress(client, 8809));
    const withSpecials = data(await getShowProgress(client, 8809, true));
    expect(queriesTo("/shows/8809/progress/watched").map((query) => query.get("specials"))).toEqual(
      ["false", "true"],
    );
    expect([without.completed, withSpecials.completed]).toEqual([0, 4]);
  });

  it("parses the extended show detail payload", async () => {
    const show = data(await getShow(client, 8801));
    expect(show.network).toBe("Meridian");
    expect(show.images?.fanart).toHaveLength(1);
  });

  it("parses the seasons tree with episodes, specials as season 0", async () => {
    const seasons = data(await getShowSeasons(client, 8809));
    expect(seasons.map((s) => s.number)).toEqual([0, 1, 2]);
    expect(seasons[1]?.episodes?.map((ep) => ep.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("parses a single extended episode with overview + runtime", async () => {
    const episode = data(await getEpisode(client, 8803, 2, 3));
    expect(episode.overview).toEqual(expect.any(String));
    expect(episode.runtime).toBe(52);
    expect(episode.images?.screenshot).toHaveLength(1);
  });

  it("parses watchlist items", async () => {
    const shows = data(await getWatchlist(client, "shows"));
    expect(shows.map((row) => [row.type, row.show?.ids.trakt])).toContainEqual(["show", 8808]);
  });

  it("parses the personalized shows calendar, keeping the show's network", async () => {
    const rows = data(await getMyShowsCalendar(client, "2026-10-15", 7));
    const drop = rows.filter((row) => row.show.ids.trakt === 8802);
    expect(drop.map((row) => row.episode.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(drop.every((row) => row.show.network === "Cordwood")).toBe(true);
  });

  it("parses search results across the account and the catalogue", async () => {
    const hits = data(await searchTrakt(client, "harbor"));
    expect(hits.map((hit) => hit.show?.title ?? hit.movie?.title)).toEqual([
      "Harbor Lights",
      "The Harbor Master",
      "Harbor Sound",
    ]);
  });

  it("parses trending shows (watcher-wrapped rows)", async () => {
    const [first] = data(await getTrendingShows(client));
    expect(first?.watchers).toEqual(expect.any(Number));
    expect(first?.show.title).toBe("Harbor Lights");
  });

  it("parses popular shows (bare show list)", async () => {
    expect(data(await getPopularShows(client))[0]?.ids.trakt).toBe(8801);
  });

  it("parses trending movies (watcher-wrapped rows)", async () => {
    const [first] = data(await getTrendingMovies(client));
    expect(first?.watchers).toEqual(expect.any(Number));
    expect(first?.movie.title).toBe("The Lantern Keeper");
  });

  it("parses popular movies (bare movie list)", async () => {
    expect(data(await getPopularMovies(client))[0]?.ids.trakt).toBe(5501);
  });

  it("parses related movies (bare movie list)", async () => {
    expect(data(await getRelatedMovies(client, 5502)).map((movie) => movie.ids.trakt)).toEqual([
      5501, 5505,
    ]);
  });

  it("parses hidden progress_watched items", async () => {
    expect(data(await getHidden(client)).map((row) => row.show?.ids.trakt)).toEqual([8805]);
  });

  it("parses user settings, stripping everything but the identity block", async () => {
    const settings = data(await getUserSettings(client));
    expect(settings.user).toMatchObject({ username: "cue-demo", name: "Cue Demo" });
    expect(settings.user.images?.avatar?.full).toMatch(/^https:\/\//);
    // Stripped extras must not survive the parse.
    expect("account" in settings).toBe(false);
  });

  it("parses last_activities into the domain shape", async () => {
    const activities = data(await getLastActivities(client));
    expect(activities.episodes?.["watched_at"]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("passes a transport failure through without parsing", async () => {
    const signedOut = new TraktClient({ clientId: "cid", fetch: fake.fetch });
    expect(await getWatchedShows(signedOut)).toEqual({
      ok: false,
      error: { kind: "unauthorized" },
    });
  });
});

describe("watched endpoints send the honest post-#775 payload params", () => {
  it("requests watched shows with extended=full,progress and an explicit page limit", async () => {
    await getWatchedShows(client);
    const [query] = queriesTo("/sync/watched/shows");
    // Post-#775 the watched breakdown ships only under `progress` and the show's
    // `status` only under `full`. Dropping either silently zeroes every show's
    // watched count or makes no show ever read as ended.
    expect(query?.get("extended")).toBe("full,progress");
    expect(query?.get("limit")).toBe("100");
  });

  it("keeps images (drops full) on watched movies so their posters survive", async () => {
    const movies = data(await getWatchedMovies(client));
    const [query] = queriesTo("/sync/watched/movies");
    // Movies have no per-movie detail fetch in the library, so their poster art
    // comes from THIS call: `images` must stay (only the no-op `full` is dropped).
    expect(query?.get("extended")).toBe("images");
    expect(query?.get("limit")).toBe("100");
    expect(movies[0]?.movie.images?.poster).toHaveLength(1);
  });
});

describe("getHistory (the Diary feed)", () => {
  it("reads one page of /users/me/history with paging + inline art, carrying pagination", async () => {
    const result = await getHistory(client, "all", 1);
    const [query] = queriesTo("/users/me/history");
    // The paging position is what the infinite query walks; NEVER a full page walk.
    expect(result.ok && result.data).toHaveLength(30);
    expect(result.ok && result.pagination?.pageCount).toBeGreaterThan(1);
    expect(query?.get("page")).toBe("1");
    expect(query?.get("limit")).toBe("30");
    expect(query?.get("extended")).toBe("full,images");
  });

  it("bounds the read with start_at/end_at for a year/month scope (the decade jump)", async () => {
    const range = { startAt: "2026-10-01T00:00:00.000Z", endAt: "2026-10-31T23:59:59.999Z" };
    const rows = data(await getHistory(client, "all", 1, range));
    const [query] = queriesTo("/users/me/history");
    expect(query?.get("start_at")).toBe(range.startAt);
    expect(query?.get("end_at")).toBe(range.endAt);
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.every((row) => row.watched_at >= range.startAt && row.watched_at <= range.endAt),
    ).toBe(true);
  });

  it("omits start_at/end_at entirely for the unbounded recent feed", async () => {
    await getHistory(client, "all", 1);
    const [query] = queriesTo("/users/me/history");
    expect(query?.has("start_at")).toBe(false);
    expect(query?.has("end_at")).toBe(false);
  });

  it("scopes to the episodes slice for the TV filter", async () => {
    const rows = data(await getHistory(client, "episodes", 2));
    expect(queriesTo("/users/me/history/episodes")).toHaveLength(1);
    expect(rows.every((row) => row.type === "episode")).toBe(true);
  });
});

describe("scoped-history resolvers (durable per-play unmark)", () => {
  it("walks every page of /sync/history/shows/:id, flattening the plays", async () => {
    const plays = data(await getItemPlays(client, "shows", 99));
    const queries = queriesTo("/sync/history/shows/99");
    expect(queries.length).toBeGreaterThan(1);
    expect(queries.map((query) => query.get("page"))).toEqual(
      queries.map((_, index) => String(index + 1)),
    );
    expect(queries[0]?.get("extended")).toBe("full");
    expect(plays).toHaveLength(303);
    expect(new Set(plays.map((play) => play.id)).size).toBe(303);
  });

  it("reads one item's plays from /sync/history/episodes/:id", async () => {
    const plays = data(await getItemPlays(client, "episodes", 880608));
    expect(queriesTo("/sync/history/episodes/880608")).toHaveLength(1);
    // Two rows for one episode = a rewatch; both plays (with distinct ids) come back.
    expect(plays).toHaveLength(2);
    expect(new Set(plays.map((play) => play.id)).size).toBe(2);
  });
});

describe("itemsBody composes remove-by-item bodies", () => {
  it("builds a single populated section", () => {
    expect(itemsBody({ episodes: [{ trakt: 42 }] })).toEqual({
      episodes: [{ ids: { trakt: 42 } }],
    });
  });

  it("builds multiple sections and omits empty ones", () => {
    expect(itemsBody({ shows: [{ trakt: 1 }], movies: [{ trakt: 5 }], episodes: [] })).toEqual({
      shows: [{ ids: { trakt: 1 } }],
      movies: [{ ids: { trakt: 5 } }],
    });
  });

  it("returns an empty body when nothing is selected", () => {
    expect(itemsBody({})).toEqual({});
  });
});

it("reads every page of the show collection, which Trakt pages at 100 shows", async () => {
  const shows = data(await getCollectionShows(client));
  const pages = queriesTo("/sync/collection/shows").map((query) => query.get("page"));
  expect(pages).toEqual(["1", "2", "3"]);
  expect(shows.length).toBeGreaterThan(200);
  expect(new Set(shows.map((row) => row.show.ids.trakt)).size).toBe(shows.length);
});
