import { expect, it } from "vitest";
import { TraktClient } from "@/core/data/trakt/client";
import * as endpoints from "@/core/data/trakt/endpoints";
import * as bulk from "@/core/domain/write-queue/bulk";
import * as ops from "@/core/domain/write-queue/ops";
import type { QueuedOp } from "@/core/domain/write-queue/types";
import { FIXTURE_NOW } from "./account.ts";
import { createTraktFake } from "./fake.ts";

type ExportsOfType<M, F> = { [K in keyof M]: M[K] extends F ? K : never }[keyof M];
type Read = ExportsOfType<
  typeof endpoints,
  (client: TraktClient, ...rest: never[]) => Promise<unknown>
>;
type Write = ExportsOfType<
  typeof ops & typeof bulk,
  (...args: never[]) => QueuedOp | readonly QueuedOp[]
>;

const WATCHED_AT = "2026-01-01T00:00:00.000Z";

type Result = { readonly ok: boolean };

/**
 * Every Trakt read the app has, over ids the fake's account holds, keyed so that a
 * new one fails to compile until it is called here.
 */
const READS: Readonly<Record<Read, (client: TraktClient) => Promise<Result | readonly Result[]>>> =
  {
    getWatchedShows: (client) => endpoints.getWatchedShows(client),
    getWatchedMovies: (client) => endpoints.getWatchedMovies(client),
    getShowProgress: (client) =>
      Promise.all([
        endpoints.getShowProgress(client, 8803),
        endpoints.getShowProgress(client, 8807),
        endpoints.getShowProgress(client, 8809, true),
      ]),
    getShow: (client) => endpoints.getShow(client, 8801),
    getMovie: (client) => endpoints.getMovie(client, 5501),
    getShowSeasons: (client) => endpoints.getShowSeasons(client, 8809),
    getEpisode: (client) => endpoints.getEpisode(client, 8803, 2, 3),
    getWatchlist: (client) =>
      Promise.all([
        endpoints.getWatchlist(client, "shows"),
        endpoints.getWatchlist(client, "movies"),
      ]),
    getCollectionShows: (client) => endpoints.getCollectionShows(client),
    getCollectionMovies: (client) => endpoints.getCollectionMovies(client),
    getMyShowsCalendar: (client) => endpoints.getMyShowsCalendar(client, "2026-10-15", 7),
    searchTrakt: (client) => endpoints.searchTrakt(client, "harbor"),
    getGenres: (client) =>
      Promise.all([endpoints.getGenres(client, "shows"), endpoints.getGenres(client, "movies")]),
    getTrendingShows: (client) => endpoints.getTrendingShows(client),
    getPopularShows: (client) => endpoints.getPopularShows(client),
    getTrendingMovies: (client) => endpoints.getTrendingMovies(client),
    getPopularMovies: (client) => endpoints.getPopularMovies(client),
    getRelatedMovies: (client) => endpoints.getRelatedMovies(client, 5502),
    getRelatedShows: (client) => endpoints.getRelatedShows(client, 8803),
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
      Promise.all([
        endpoints.getItemPlays(client, "shows", 8801),
        endpoints.getItemPlays(client, "episodes", 880608),
        endpoints.getItemPlays(client, "movies", 5501),
      ]),
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

it("routes every request the app's Trakt reads and writes send, and parses every read it answers", async () => {
  const fake = createTraktFake();
  let sent = 0;
  const client = new TraktClient({
    clientId: "client",
    getToken: () => fake.session().access_token,
    fetch: (input, init) => {
      sent += 1;
      return fake.fetch(input, init);
    },
  });
  const silent: string[] = [];
  const refused: string[] = [];
  for (const [name, read] of Object.entries(READS)) {
    const before = sent;
    const results = [await read(client)].flat();
    if (sent === before) silent.push(name);
    if (results.some((result) => !result.ok)) refused.push(name);
  }
  for (const [name, write] of Object.entries(WRITES)) {
    const queued = [write()].flat();
    if (queued.length === 0) silent.push(name);
    for (const { method, path, body } of queued.flatMap((op) => [op.request, op.inverse]))
      await client.send(method, path, { body });
  }
  expect({ noRoute: fake.noRoute, silent, refused }).toEqual({
    noRoute: [],
    silent: [],
    refused: [],
  });
});
