import { TraktClient } from "@cue/core/data/trakt/client";
import * as endpoints from "@cue/core/data/trakt/endpoints";
import * as bulk from "@cue/core/domain/write-queue/bulk";
import * as ops from "@cue/core/domain/write-queue/ops";
import type { QueuedOp } from "@cue/core/domain/write-queue/types";
import { expect, it } from "vitest";
import { createSeedLibrary, FIXTURE_NOW } from "../../../../scripts/mock-trakt/seed.mjs";
import { respond } from "../../../../scripts/mock-trakt/server.mjs";

type ExportsOfType<M, F> = { [K in keyof M]: M[K] extends F ? K : never }[keyof M];
type Read = ExportsOfType<
  typeof endpoints,
  (client: TraktClient, ...rest: never[]) => Promise<unknown>
>;
type Write = ExportsOfType<
  typeof ops & typeof bulk,
  (...args: never[]) => QueuedOp | readonly QueuedOp[]
>;

const DAY = "2026-01-01";
const WATCHED_AT = `${DAY}T00:00:00.000Z`;

/** Every Trakt read the app has, keyed so that a new one fails to compile until it is called here. */
const READS: Readonly<Record<Read, (client: TraktClient) => Promise<unknown>>> = {
  getWatchedShows: (client) => endpoints.getWatchedShows(client),
  getWatchedMovies: (client) => endpoints.getWatchedMovies(client),
  getShowProgress: (client) => endpoints.getShowProgress(client, 1),
  getShow: (client) => endpoints.getShow(client, 1),
  getMovie: (client) => endpoints.getMovie(client, 1),
  getShowSeasons: (client) => endpoints.getShowSeasons(client, 1),
  getEpisode: (client) => endpoints.getEpisode(client, 1, 1, 1),
  getWatchlist: (client) =>
    Promise.all([
      endpoints.getWatchlist(client, "shows"),
      endpoints.getWatchlist(client, "movies"),
    ]),
  getCollectionShows: (client) => endpoints.getCollectionShows(client),
  getCollectionMovies: (client) => endpoints.getCollectionMovies(client),
  getMyShowsCalendar: (client) => endpoints.getMyShowsCalendar(client, DAY, 7),
  searchTrakt: (client) => endpoints.searchTrakt(client, "query"),
  getGenres: (client) =>
    Promise.all([endpoints.getGenres(client, "shows"), endpoints.getGenres(client, "movies")]),
  getTrendingShows: (client) => endpoints.getTrendingShows(client),
  getPopularShows: (client) => endpoints.getPopularShows(client),
  getTrendingMovies: (client) => endpoints.getTrendingMovies(client),
  getPopularMovies: (client) => endpoints.getPopularMovies(client),
  getRelatedMovies: (client) => endpoints.getRelatedMovies(client, 1),
  getRelatedShows: (client) => endpoints.getRelatedShows(client, 1),
  getUserSettings: (client) => endpoints.getUserSettings(client),
  getHidden: (client) => endpoints.getHidden(client),
  getDropped: (client) => endpoints.getDropped(client),
  getHistoryPlay: (client) => endpoints.getHistoryPlay(client, 1),
  getLastActivities: (client) => endpoints.getLastActivities(client),
  getHistory: (client) =>
    Promise.all(
      (["all", "episodes", "movies"] as const).map((section) =>
        endpoints.getHistory(client, section, 1),
      ),
    ),
  getItemPlays: (client) =>
    Promise.all(
      (["shows", "episodes", "movies"] as const).map((kind) =>
        endpoints.getItemPlays(client, kind, 1),
      ),
    ),
};

const history = { opId: "op", ids: { trakt: 1 }, watchedAt: WATCHED_AT };
const show = { opId: "op", ids: { trakt: 1 } };
const restore = { section: "episodes", ids: { trakt: 1 }, watchedAt: WATCHED_AT } as const;

/** Every write the app queues, keyed the same way as the reads. */
const WRITES: Readonly<Record<Write, () => QueuedOp | readonly QueuedOp[]>> = {
  buildMarkEpisodeOp: () => ops.buildMarkEpisodeOp(history),
  buildUnmarkEpisodeOp: () => ops.buildUnmarkEpisodeOp(history),
  buildAddEpisodePlayOp: () => ops.buildAddEpisodePlayOp(history),
  buildMarkMovieOp: () => ops.buildMarkMovieOp(history),
  buildUnmarkMovieOp: () => ops.buildUnmarkMovieOp(history),
  buildRemoveHistoryPlayOp: () => ops.buildRemoveHistoryPlayOp({ opId: "op", ids: [1], restore }),
  buildRemovePlaysOp: () =>
    ops.buildRemovePlaysOp({
      opId: "op",
      ids: [1],
      restore: [{ trakt: 1, watchedAt: WATCHED_AT }],
    }),
  buildHideShowOp: () => ops.buildHideShowOp(show),
  buildResumeShowOps: () =>
    ops.buildResumeShowOps({ newId: () => "op", showId: 1, ids: { trakt: 1 } }),
  buildAddWatchlistOp: () => ops.buildAddWatchlistOp({ ...show, section: "shows" }),
  buildRemoveWatchlistOp: () => ops.buildRemoveWatchlistOp({ ...show, section: "movies" }),
  buildBulkMarkOps: () =>
    bulk.buildBulkMarkOps(
      {
        showIds: { trakt: 1 },
        seasons: [{ number: 1, episodes: [{ number: 1, firstAired: WATCHED_AT, watched: false }] }],
        includeSpecials: false,
      },
      FIXTURE_NOW,
      WATCHED_AT,
      () => "op",
    ),
};

it("routes every request the app's Trakt reads and writes send", async () => {
  const library = createSeedLibrary("default", FIXTURE_NOW, () => FIXTURE_NOW);
  const noRoute: string[] = [];
  let sent = 0;
  const client = new TraktClient({
    clientId: "mock-client",
    getToken: () => "mock-access-token",
    fetch: async (input, init) => {
      const url = new URL(input);
      const method = init?.method ?? "GET";
      sent += 1;
      const answer = respond(library, method, url, JSON.parse(String(init?.body ?? "{}")));
      if (answer.status === 404 && answer.body.includes("no route")) {
        noRoute.push(`${method} ${url.pathname}`);
      }
      return new Response(answer.body, { status: answer.status, headers: answer.headers });
    },
  });
  const silent: string[] = [];
  for (const [name, read] of Object.entries(READS)) {
    const before = sent;
    await read(client);
    if (sent === before) silent.push(name);
  }
  for (const [name, write] of Object.entries(WRITES)) {
    const queued = [write()].flat();
    if (queued.length === 0) silent.push(name);
    for (const { method, path, body } of queued.flatMap((op) => [op.request, op.inverse]))
      await client.send(method, path, { body });
  }
  expect({ noRoute, silent }).toEqual({ noRoute: [], silent: [] });
});
