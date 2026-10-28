import { beforeEach, describe, expect, it } from "vitest";
import { TraktClient } from "@/core/data/trakt/client";
import {
  getCollectionShows,
  getHistory,
  getItemPlays,
  getRelatedShows,
  getShowProgress,
  getUserSettings,
  getWatchedMovies,
  getWatchedShows,
  itemsBody,
} from "@/core/data/trakt/endpoints";
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

it("opts specials into the progress payload only when asked", async () => {
  const without = data(await getShowProgress(client, 8809));
  const withSpecials = data(await getShowProgress(client, 8809, true));
  expect(queriesTo("/shows/8809/progress/watched").map((query) => query.get("specials"))).toEqual([
    "false",
    "true",
  ]);
  expect([without.completed, withSpecials.completed]).toEqual([0, 4]);
});

it("strips user settings to the identity block", async () => {
  const settings = data(await getUserSettings(client));
  expect(settings.user).toMatchObject({ username: "cue-demo", name: "Cue Demo" });
  expect("account" in settings).toBe(false);
});

it("passes a transport failure through without parsing", async () => {
  const signedOut = new TraktClient({ clientId: "cid", fetch: fake.fetch });
  expect(await getWatchedShows(signedOut)).toEqual({
    ok: false,
    error: { kind: "unauthorized" },
  });
});

describe("watched endpoints send the payload params the app reads", () => {
  it("requests watched shows with extended=full,progress and an explicit page limit", async () => {
    await getWatchedShows(client);
    const [query] = queriesTo("/sync/watched/shows");
    // Since Trakt change #775 the watched breakdown ships only under `progress` and the show's
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
