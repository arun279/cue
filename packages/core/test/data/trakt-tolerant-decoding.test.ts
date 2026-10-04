import { type ReadProblem, TRAKT_API_BASE, TraktClient } from "@cue/core/data/trakt/client";
import { incidentReport, parseIncidents, recordIncident } from "@cue/core/data/trakt/diagnostics";
import { getUserStats, getWatchedShows } from "@cue/core/data/trakt/endpoints";
import { INCIDENTS_KEY } from "@cue/core/ports/storage-keys";
import { useReadIncidents } from "@cue/core/stores/read-incidents-store";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mswServer } from "./_msw";
import { buildRuntime, memoryKv } from "./_runtime";

const server = mswServer();

const STATS_PATH = `${TRAKT_API_BASE}/users/me/stats`;

const documentedStats = {
  movies: { plays: 155, watched: 114, minutes: 15650, collected: 933, ratings: 256, comments: 28 },
  shows: { watched: 16, collected: 7, ratings: 63, comments: 20 },
  seasons: { ratings: 6, comments: 1 },
  episodes: { plays: 552, watched: 534, minutes: 17330, collected: 117, ratings: 64, comments: 14 },
  network: { friends: 1, followers: 4, following: 11 },
  ratings: { total: 9, distribution: { "1": 0, "5": 4, "10": 2 } },
};

const largeAccountStats = {
  movies: { plays: 4662, watched: 3143, minutes: 467614, collected: 6, ratings: 2892, comments: 0 },
  shows: { watched: 552, collected: 86, ratings: 525, comments: 0 },
  seasons: { ratings: 108, comments: 0 },
  episodes: { plays: 35908, watched: 26825, minutes: 1185294, collected: 1346, ratings: 18465 },
  network: { friends: 42, followers: 142, following: 48 },
  ratings: { total: 21990, distribution: { "7": 10628, "8": 7334 } },
};

const driftedStats = {
  movies: { watched: 3143 },
  shows: { watched: null },
  episodes: { watched: "26825", minutes: 1185294 },
  vip_stats: { year: 2026 },
};

function recordingClient(): { client: TraktClient; problems: [string, ReadProblem][] } {
  const problems: [string, ReadProblem][] = [];
  const client = new TraktClient({
    clientId: "cid",
    report: (endpoint, problem) => problems.push([endpoint, problem]),
  });
  return { client, problems };
}

function serveStats(body: Parameters<typeof HttpResponse.json>[0]): void {
  server.use(http.get(STATS_PATH, () => HttpResponse.json(body)));
}

describe("user stats decode tolerantly", () => {
  it("reads the documented shape without recording anything", async () => {
    serveStats(documentedStats);
    const { client, problems } = recordingClient();
    expect(await getUserStats(client)).toEqual({
      ok: true,
      data: {
        movies: { watched: 114, minutes: 15650 },
        episodes: { watched: 534, minutes: 17330 },
        shows: { watched: 16 },
      },
      pagination: null,
    });
    expect(problems).toEqual([]);
  });

  it("reads a large account's counts and minutes intact", async () => {
    serveStats(largeAccountStats);
    const { client, problems } = recordingClient();
    const result = await getUserStats(client);
    expect(result.ok && result.data).toEqual({
      movies: { watched: 3143, minutes: 467614 },
      episodes: { watched: 26825, minutes: 1185294 },
      shows: { watched: 552 },
    });
    expect(problems).toEqual([]);
  });

  it("keeps what it can read from a drifted shape and records the field it skipped", async () => {
    serveStats(driftedStats);
    const { client, problems } = recordingClient();
    const result = await getUserStats(client);
    expect(result.ok && result.data).toEqual({
      movies: { watched: 3143 },
      episodes: { watched: 26825, minutes: 1185294 },
      shows: { watched: undefined },
    });
    expect(problems).toEqual([
      [
        "/users/me/stats",
        {
          kind: "skipped-fields",
          issues: [{ path: "shows.watched", message: expect.stringContaining("number") }],
        },
      ],
    ]);
  });

  it("names Trakt's empty 204 reply instead of a shape failure", async () => {
    server.use(http.get(STATS_PATH, () => new HttpResponse(null, { status: 204 })));
    const { client, problems } = recordingClient();
    expect(await getUserStats(client)).toEqual({ ok: false, error: { kind: "no-content" } });
    expect(problems).toEqual([["/users/me/stats", { kind: "no-content" }]]);
  });

  it("fails clearly and records the path when an essential field is gone", async () => {
    serveStats(["not", "an", "object"]);
    const { client, problems } = recordingClient();
    const result = await getUserStats(client);
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "unexpected-shape", issues: [{ path: "(root)" }] },
    });
    expect(problems).toEqual([["/users/me/stats", !result.ok && result.error]]);
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
    const first = recordIncident([], "/users/me/stats", { kind: "timeout" }, 1);
    const second = recordIncident(first, "/sync/watched/shows", { kind: "network" }, 2);
    const third = recordIncident(second, "/users/me/stats", { kind: "server", status: 503 }, 3);
    expect(third).toEqual([
      { endpoint: "/users/me/stats", kind: "server", detail: "HTTP 503", at: 3 },
      { endpoint: "/sync/watched/shows", kind: "network", detail: "", at: 2 },
    ]);
  });

  it("writes a plain-text report of endpoint, kind and detail only", () => {
    const incidents = recordIncident(
      [],
      "/users/me/stats",
      { kind: "unexpected-shape", issues: [{ path: "episodes.minutes", message: "bad" }] },
      Date.UTC(2026, 9, 3, 22, 14),
    );
    expect(incidentReport(incidents, "1.4.0 (2101)")).toBe(
      [
        "Cue 1.4.0 (2101) Trakt diagnostics",
        "2026-10-03T22:14:00.000Z  /users/me/stats  unexpected-shape  episodes.minutes: bad",
      ].join("\n"),
    );
  });

  it("reads back only well-formed persisted incidents", () => {
    const stored = [{ endpoint: "/users/me/stats", kind: "no-content", detail: "", at: 5 }];
    expect(parseIncidents(stored)).toEqual(stored);
    expect(parseIncidents([{ ...stored[0], kind: "made-up" }])).toEqual([]);
  });

  it("records a failed read in memory and in the persisted store, and hydrates it", async () => {
    server.use(http.get(STATS_PATH, () => new HttpResponse(null, { status: 204 })));
    const kv = memoryKv();
    const runtime = await buildRuntime({ kv });
    await expect(runtime.loadStats()).rejects.toMatchObject({ failure: { kind: "no-content" } });

    const recorded = useReadIncidents.getState().incidents;
    expect(recorded).toMatchObject([{ endpoint: "/users/me/stats", kind: "no-content" }]);
    expect(parseIncidents(JSON.parse(kv.values.get(INCIDENTS_KEY) ?? "null"))).toEqual(recorded);

    useReadIncidents.setState({ incidents: [] });
    await buildRuntime({ kv });
    expect(useReadIncidents.getState().incidents).toEqual(recorded);
  });
});
