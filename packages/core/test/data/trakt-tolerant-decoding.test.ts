import { type ReadProblem, TRAKT_API_BASE, TraktClient } from "@cue/core/data/trakt/client";
import { incidentReport, parseIncidents, recordIncident } from "@cue/core/data/trakt/diagnostics";
import { getUserSettings, getWatchedMovies, getWatchedShows } from "@cue/core/data/trakt/endpoints";
import { INCIDENTS_KEY } from "@cue/core/ports/storage-keys";
import { useReadIncidents } from "@cue/core/stores/read-incidents-store";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mswServer } from "./_msw";
import { buildRuntime, memoryKv } from "./_runtime";

const server = mswServer();

const MOVIES_PATH = `${TRAKT_API_BASE}/sync/watched/movies`;
const SETTINGS_PATH = `${TRAKT_API_BASE}/users/settings`;
const PAGE = { "X-Pagination-Page": "1", "X-Pagination-Page-Count": "1" };

const watchedMovie = (trakt: number, movie: Record<string, unknown> = {}) => ({
  plays: 1,
  last_watched_at: "2026-07-01T00:00:00.000Z",
  last_updated_at: "2026-07-01T00:00:00.000Z",
  movie: { title: `Movie ${trakt}`, year: 2020, ids: { trakt, slug: `movie-${trakt}` }, ...movie },
});

const documentedMovies = [watchedMovie(1, { runtime: 104, overview: "x", genres: ["drama"] })];

const largeAccountMovies = Array.from({ length: 250 }, (_, index) =>
  watchedMovie(index + 1, { runtime: 90 + (index % 60) }),
);

const driftedMovies = [
  watchedMovie(1, { runtime: "118", tagline: "new key" }),
  watchedMovie(2, { year: null }),
  watchedMovie(3, { runtime: "about two hours" }),
];

function recordingClient(): { client: TraktClient; problems: [string, ReadProblem][] } {
  const problems: [string, ReadProblem][] = [];
  const client = new TraktClient({
    clientId: "cid",
    report: (endpoint, problem) => problems.push([endpoint, problem]),
  });
  return { client, problems };
}

function serveMovies(body: Parameters<typeof HttpResponse.json>[0]): void {
  server.use(http.get(MOVIES_PATH, () => HttpResponse.json(body, { headers: PAGE })));
}

const runtimes = (result: Awaited<ReturnType<typeof getWatchedMovies>>) =>
  result.ok ? result.data.map((row) => [row.movie.ids.trakt, row.movie.runtime]) : null;

describe("watched movies, the source of Profile's movie totals, decode tolerantly", () => {
  it("reads the documented shape without recording anything", async () => {
    serveMovies(documentedMovies);
    const { client, problems } = recordingClient();
    expect(runtimes(await getWatchedMovies(client))).toEqual([[1, 104]]);
    expect(problems).toEqual([]);
  });

  it("reads a large account's full page intact", async () => {
    serveMovies(largeAccountMovies);
    const { client, problems } = recordingClient();
    const result = await getWatchedMovies(client);
    expect(result.ok && result.data).toHaveLength(250);
    expect(runtimes(result)?.[249]).toEqual([250, 99]);
    expect(problems).toEqual([]);
  });

  it("keeps what it can read from a drifted shape and records the field it skipped", async () => {
    serveMovies(driftedMovies);
    const { client, problems } = recordingClient();
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
    server.use(http.get(SETTINGS_PATH, () => new HttpResponse(null, { status: 204 })));
    const { client, problems } = recordingClient();
    expect(await getUserSettings(client)).toEqual({ ok: false, error: { kind: "no-content" } });
    expect(problems).toEqual([["/users/settings", { kind: "no-content" }]]);
  });

  it("fails clearly and records the path when an essential field is gone", async () => {
    server.use(http.get(SETTINGS_PATH, () => HttpResponse.json(["not", "an", "object"])));
    const { client, problems } = recordingClient();
    const result = await getUserSettings(client);
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "unexpected-shape", issues: [{ path: "(root)" }] },
    });
    expect(problems).toEqual([["/users/settings", !result.ok && result.error]]);
  });
});

describe("list decoders drop a malformed row instead of the whole list", () => {
  const row = (trakt: unknown, year: unknown) => ({
    last_watched_at: "2026-07-01T00:00:00.000Z",
    show: { title: `Show ${trakt}`, year, ids: { trakt }, aired_episodes: "8" },
  });

  it("keeps the readable rows, coercing numeric strings, and records the dropped one", async () => {
    server.use(
      http.get(`${TRAKT_API_BASE}/sync/watched/shows`, () =>
        HttpResponse.json([row(1, "2019"), row({ id: 2 }, 2020), row(3, "soon")], {
          headers: { "X-Pagination-Page": "1", "X-Pagination-Page-Count": "1" },
        }),
      ),
    );
    const { client, problems } = recordingClient();
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
        "Cue 1.4.0 (2101) Trakt diagnostics",
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
    expect(incidentReport([], "1.4.0 (2101)")).toBe(
      "Cue 1.4.0 (2101) Trakt diagnostics\nNo errors",
    );
  });

  it("reads back only well-formed persisted incidents", () => {
    const stored = [{ endpoint: "/users/settings", kind: "no-content", detail: "", at: 5 }];
    expect(parseIncidents(stored)).toEqual(stored);
    expect(parseIncidents([{ ...stored[0], kind: "made-up" }])).toEqual([]);
  });

  it("records a failed read in memory and in the persisted store, and hydrates it", async () => {
    server.use(http.get(SETTINGS_PATH, () => new HttpResponse(null, { status: 204 })));
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
