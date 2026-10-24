import { type ReadProblem, TraktClient, TraktReadError } from "@cue/core/data/trakt/client";
import { incidentReport, parseIncidents, recordIncident } from "@cue/core/data/trakt/diagnostics";
import {
  getHistory,
  getLastActivities,
  getMovie,
  getShowProgress,
  getUserSettings,
  getWatchedMovies,
  getWatchedShows,
} from "@cue/core/data/trakt/endpoints";
import { loadUpNextEntries } from "@cue/core/data/trakt/read-budget";
import { INCIDENTS_KEY } from "@cue/core/ports/storage-keys";
import { useReadIncidents } from "@cue/core/stores/read-incidents-store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTraktFake } from "../trakt-fake/fake.ts";
import { buildRuntime, memoryKv } from "./_runtime";

/**
 * Bodies Trakt does not send on purpose: drifted fields, missing essentials, pages
 * without their headers. The fake answers only what Trakt was recorded sending, so
 * these come from a stub fetch.
 */

const PAGE = { "X-Pagination-Page": "1", "X-Pagination-Page-Count": "1" };

const json = (body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...headers },
  });

function answering(reply: (url: URL) => Response) {
  const problems: [string, ReadProblem][] = [];
  const client = new TraktClient({
    clientId: "cid",
    report: (endpoint, problem) => problems.push([endpoint, problem]),
    fetch: async (input) => reply(new URL(String(input))),
  });
  return { client, problems };
}

const serving = (body: unknown) => answering(() => json(body, PAGE));

afterEach(() => vi.unstubAllGlobals());

const watchedMovie = (trakt: number, movie: Record<string, unknown> = {}) => ({
  plays: 1,
  last_watched_at: "2026-07-01T00:00:00.000Z",
  last_updated_at: "2026-07-01T00:00:00.000Z",
  movie: { title: `Movie ${trakt}`, year: 2020, ids: { trakt, slug: `movie-${trakt}` }, ...movie },
});

const largeAccountMovies = Array.from({ length: 250 }, (_, index) =>
  watchedMovie(index + 1, { runtime: 90 + (index % 60) }),
);

const driftedMovies = [
  watchedMovie(1, { runtime: "118", tagline: "new key" }),
  watchedMovie(2, { year: null }),
  watchedMovie(3, { runtime: "about two hours" }),
];

const runtimes = (result: Awaited<ReturnType<typeof getWatchedMovies>>) =>
  result.ok ? result.data.map((row) => [row.movie.ids.trakt, row.movie.runtime]) : null;

describe("watched movies, the source of Profile's movie totals, decode tolerantly", () => {
  it("reads what Trakt sends without recording anything", async () => {
    const fake = createTraktFake();
    const problems: [string, ReadProblem][] = [];
    const client = new TraktClient({
      clientId: "cid",
      getToken: () => fake.session().access_token,
      report: (endpoint, problem) => problems.push([endpoint, problem]),
      fetch: fake.fetch,
    });
    expect(runtimes(await getWatchedMovies(client))).toContainEqual([5501, 104]);
    expect(problems).toEqual([]);
  });

  it("reads a large account's full page intact", async () => {
    const { client, problems } = serving(largeAccountMovies);
    const result = await getWatchedMovies(client);
    expect(result.ok && result.data).toHaveLength(250);
    expect(runtimes(result)?.[249]).toEqual([250, 99]);
    expect(problems).toEqual([]);
  });

  it("keeps what it can read from a drifted shape and records the field it skipped", async () => {
    const { client, problems } = serving(driftedMovies);
    const result = await getWatchedMovies(client);
    expect(runtimes(result)).toEqual([
      [1, 118],
      [2, undefined],
      [3, undefined],
    ]);
    expect(result.ok && result.data[1]?.movie.year).toBeNull();
    expect(problems).toEqual([
      [
        "/sync/watched/movies",
        {
          kind: "skipped-fields",
          issues: [{ path: "2.movie.runtime", message: expect.stringContaining("number") }],
        },
      ],
    ]);
  });

  it("names an empty 204 reply instead of a shape failure", async () => {
    const { client, problems } = answering(() => new Response(null, { status: 204 }));
    expect(await getUserSettings(client)).toEqual({ ok: false, error: { kind: "no-content" } });
    expect(problems).toEqual([["/users/settings", { kind: "no-content" }]]);
  });

  it("fails clearly and records the path when an essential field is gone", async () => {
    const { client, problems } = serving(["not", "an", "object"]);
    const result = await getUserSettings(client);
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "unexpected-shape", issues: [{ path: "(root)" }] },
    });
    expect(problems).toEqual([["/users/settings", !result.ok && result.error]]);
  });
});

const unexpectedShape = (...paths: string[]) => ({
  ok: false,
  error: { kind: "unexpected-shape", issues: paths.map((path) => ({ path })) },
});

const SHOW = { title: "Severance", year: 2022, ids: { trakt: 1 } };

describe("a body missing an essential field fails as an unexpected shape", () => {
  it("rejects a watched-shows row with no aired_episodes rather than reading it as caught-up", async () => {
    // `aired_episodes` is what every un-fetched show's backlog is derived from, so
    // losing it must fail loudly here, not silently file the library as finished.
    const { client } = serving([
      { last_watched_at: "2026-07-01T00:00:00.000Z", show: SHOW, seasons: [] },
    ]);
    expect(await getWatchedShows(client)).toMatchObject(unexpectedShape("0.show.aired_episodes"));
  });

  it("fails when every watched show is missing its ids", async () => {
    const { client } = serving([{ show: { title: "No Ids" } }]);
    expect(await getWatchedShows(client)).toMatchObject(
      unexpectedShape("0.show.ids", "0.show.aired_episodes"),
    );
  });

  it("fails when a movie payload is missing its title", async () => {
    const { client } = serving({ year: 2021, ids: { trakt: 5 } });
    expect(await getMovie(client, 5)).toMatchObject(unexpectedShape("title"));
  });

  it("fails when progress omits required counts", async () => {
    const { client } = serving({ next_episode: null });
    expect(await getShowProgress(client, 1)).toMatchObject(unexpectedShape("aired", "completed"));
  });

  it("fails when user settings omit the username", async () => {
    const { client } = serving({ user: { name: "No Handle" } });
    expect(await getUserSettings(client)).toMatchObject(unexpectedShape("user.username"));
  });

  it("fails on a history row missing the play id", async () => {
    const { client } = serving([{ watched_at: "x", type: "movie" }]);
    expect(await getHistory(client, "all", 1)).toMatchObject(unexpectedShape("0.id"));
  });

  it("fails the whole Up Next snapshot on a progress body that breaks the contract", async () => {
    const watched = [
      { last_watched_at: "2026-07-01T00:00:00.000Z", show: { ...SHOW, aired_episodes: 10 } },
    ];
    const { client } = answering((url) =>
      json(
        url.pathname === "/sync/watched/shows"
          ? watched
          : url.pathname.endsWith("/watched")
            ? {}
            : [],
        PAGE,
      ),
    );
    await expect(loadUpNextEntries(client)).rejects.toThrow(TraktReadError);
  });

  it("fails at the root when the body is not JSON", async () => {
    const { client } = answering(
      () => new Response("not json", { headers: { "content-type": "text/plain" } }),
    );
    expect(await getLastActivities(client)).toMatchObject(unexpectedShape("(root)"));
  });
});

describe("optional fields Trakt has been seen leaving out", () => {
  it("tolerates user settings without a name or avatar", async () => {
    const { client } = serving({ user: { username: "sean" } });
    const result = await getUserSettings(client);
    expect(result.ok && result.data.user.username).toBe("sean");
    expect(result.ok && result.data.user.name).toBeUndefined();
  });

  it("keeps the readable last_activities stamps and drops a null one", async () => {
    const { client } = serving({
      episodes: { watched_at: "2026-07-01T00:00:00.000Z", pending_at: null },
    });
    const result = await getLastActivities(client);
    expect(result.ok && result.data.episodes).toEqual({ watched_at: "2026-07-01T00:00:00.000Z" });
  });
});

describe("page walks survive pagination headers Trakt did not send", () => {
  const page = (url: URL): number => Number(url.searchParams.get("page"));

  it("walks to an empty page when pagination headers are absent", async () => {
    const rows = Array.from({ length: 250 }, (_, id) => ({ id }));
    const { client } = answering((url) => json(rows.slice((page(url) - 1) * 100, page(url) * 100)));
    const result = await client.getAllPages("/sync/watched/shows");
    expect(result.ok && result.data).toEqual(rows);
    expect(result.ok && result.pagination).toBeNull();
  });

  it("ignores a garbled page count and stops at a page that is not a list", async () => {
    const { client } = answering((url) =>
      page(url) === 1
        ? json([{ id: 1 }], { "X-Pagination-Page": "1", "X-Pagination-Page-Count": "many" })
        : json({ error: "no such page" }),
    );
    expect(await client.getAllPages("/users/me/history")).toEqual({
      ok: true,
      data: [{ id: 1 }],
      pagination: null,
    });
  });
});

describe("list decoders drop a malformed row instead of the whole list", () => {
  const row = (trakt: unknown, year: unknown) => ({
    last_watched_at: "2026-07-01T00:00:00.000Z",
    show: { title: `Show ${trakt}`, year, ids: { trakt }, aired_episodes: "8" },
  });

  it("keeps the readable rows, coercing numeric strings, and records the dropped one", async () => {
    const { client, problems } = serving([row(1, "2019"), row({ id: 2 }, 2020), row(3, "soon")]);
    const result = await getWatchedShows(client);
    expect(result.ok && result.data.map((show) => [show.show.ids.trakt, show.show.year])).toEqual([
      [1, 2019],
      [3, undefined],
    ]);
    expect(result.ok && result.data[0]?.show.aired_episodes).toBe(8);
    expect(problems).toEqual([
      [
        "/sync/watched/shows",
        {
          kind: "skipped-fields",
          issues: [
            { path: "1.show.ids.trakt", message: expect.any(String) },
            { path: "2.show.year", message: expect.any(String) },
          ],
        },
      ],
    ]);
  });
});

describe("read incidents", () => {
  it("keeps the latest problem per endpoint, newest first", () => {
    const first = recordIncident([], "/users/settings", { kind: "timeout" }, 1);
    const second = recordIncident(first, "/sync/watched/shows", { kind: "network" }, 2);
    const third = recordIncident(second, "/users/settings", { kind: "server", status: 503 }, 3);
    expect(third).toEqual([
      { endpoint: "/users/settings", kind: "server", detail: "HTTP 503", at: 3 },
      { endpoint: "/sync/watched/shows", kind: "network", detail: "", at: 2 },
    ]);
  });

  it("writes a plain-text report of endpoint, kind and detail only", () => {
    const incidents = recordIncident(
      [],
      "/users/settings",
      { kind: "unexpected-shape", issues: [{ path: "episodes.minutes", message: "bad" }] },
      Date.UTC(2026, 9, 3, 22, 14),
    );
    expect(incidentReport(incidents, "1.4.0 (2101)")).toBe(
      [
        "Cue 1.4.0 (2101) diagnostics",
        "2026-10-03T22:14:00.000Z  /users/settings  unexpected-shape  episodes.minutes: bad",
      ].join("\n"),
    );
  });

  it("details a rate limit by its Retry-After when Trakt sends one", () => {
    const limited = recordIncident([], "/a", { kind: "rate-limited", retryAfterMs: 2000 }, 1);
    const unbounded = recordIncident([], "/b", { kind: "rate-limited", retryAfterMs: null }, 1);
    expect(limited[0]?.detail).toBe("retry after 2000 ms");
    expect(unbounded[0]?.detail).toBe("");
  });

  it("says so when there is nothing to report", () => {
    expect(incidentReport([], "1.4.0 (2101)")).toBe("Cue 1.4.0 (2101) diagnostics\nNo errors");
  });

  it("reports a failed start first, with the error it failed on", () => {
    const incidents = recordIncident([], "/sync/watched", { kind: "timeout" }, 2);
    const start = { at: Date.UTC(2026, 9, 3, 22, 14), detail: "Error: database is locked" };

    expect(incidentReport(incidents, "1.4.0 (2101)", start)).toBe(
      [
        "Cue 1.4.0 (2101) diagnostics",
        "2026-10-03T22:14:00.000Z  start  Error: database is locked",
        "1970-01-01T00:00:00.002Z  /sync/watched  timeout",
      ].join("\n"),
    );
  });

  it("reads back only well-formed persisted incidents", () => {
    const stored = [{ endpoint: "/users/settings", kind: "no-content", detail: "", at: 5 }];
    expect(parseIncidents(stored)).toEqual(stored);
    expect(parseIncidents([{ ...stored[0], kind: "made-up" }])).toEqual([]);
  });

  it("records a failed read in memory and in the persisted store, and hydrates it", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 204 }));
    const kv = memoryKv();
    const runtime = await buildRuntime({ kv });
    await expect(runtime.loadUserProfile()).rejects.toMatchObject({
      failure: { kind: "no-content" },
    });

    const recorded = useReadIncidents.getState().incidents;
    expect(recorded).toMatchObject([{ endpoint: "/users/settings", kind: "no-content" }]);
    expect(parseIncidents(JSON.parse(kv.values.get(INCIDENTS_KEY) ?? "null"))).toEqual(recorded);

    useReadIncidents.setState({ incidents: [] });
    await buildRuntime({ kv });
    expect(useReadIncidents.getState().incidents).toEqual(recorded);
  });
});
