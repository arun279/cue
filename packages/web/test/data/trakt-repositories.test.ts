import { TRAKT_API_BASE, TraktClient } from "@data/trakt/client";
import { createLastActivitiesRepository } from "@data/trakt/repositories";
import type { LastActivities } from "@domain/sync-activities";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mswServer } from "./_msw";

const server = mswServer();
const client = new TraktClient({ clientId: "cid" });

/**
 * Pinned `/sync/last_activities` fixture. Every mapped section advances
 * from the STORED snapshot below, so the diff must yield the full invalidation
 * set; the unmapped fields (every `rated_at`, the `seasons`/`lists`/`account`/
 * `collaborations` sections) advance too and must yield nothing.
 */
const STORED: LastActivities = {
  all: "2026-07-01T00:00:00.000Z",
  episodes: {
    watched_at: "2026-07-01T00:00:00.000Z",
    rated_at: "2026-07-01T00:00:00.000Z",
    watchlisted_at: "2026-07-01T00:00:00.000Z",
  },
  shows: {
    rated_at: "2026-07-01T00:00:00.000Z",
    hidden_at: "2026-07-01T00:00:00.000Z",
    watchlisted_at: "2026-07-01T00:00:00.000Z",
    favorited_at: "2026-07-01T00:00:00.000Z",
  },
  movies: {
    watched_at: "2026-07-01T00:00:00.000Z",
    rated_at: "2026-07-01T00:00:00.000Z",
    watchlisted_at: "2026-07-01T00:00:00.000Z",
    hidden_at: "2026-07-01T00:00:00.000Z",
    favorited_at: "2026-07-01T00:00:00.000Z",
  },
  watchlist: { updated_at: "2026-07-01T00:00:00.000Z" },
  seasons: { rated_at: "2026-07-01T00:00:00.000Z" },
  lists: { updated_at: "2026-07-01T00:00:00.000Z" },
};

const PINNED_FRESH: LastActivities = {
  all: "2026-07-05T00:00:00.000Z",
  episodes: {
    watched_at: "2026-07-05T00:00:00.000Z",
    rated_at: "2026-07-05T00:00:00.000Z",
    watchlisted_at: "2026-07-05T00:00:00.000Z",
  },
  shows: {
    rated_at: "2026-07-05T00:00:00.000Z",
    hidden_at: "2026-07-05T00:00:00.000Z",
    watchlisted_at: "2026-07-05T00:00:00.000Z",
    favorited_at: "2026-07-05T00:00:00.000Z",
  },
  movies: {
    watched_at: "2026-07-05T00:00:00.000Z",
    rated_at: "2026-07-05T00:00:00.000Z",
    watchlisted_at: "2026-07-05T00:00:00.000Z",
    hidden_at: "2026-07-05T00:00:00.000Z",
    favorited_at: "2026-07-05T00:00:00.000Z",
  },
  watchlist: { updated_at: "2026-07-05T00:00:00.000Z" },
  seasons: { rated_at: "2026-07-05T00:00:00.000Z" },
  lists: { updated_at: "2026-07-05T00:00:00.000Z" },
};

describe("last_activities repository drives the invalidation map", () => {
  it("returns the exact invalidation targets for the pinned fixture", async () => {
    server.use(
      http.get(`${TRAKT_API_BASE}/sync/last_activities`, () => HttpResponse.json(PINNED_FRESH)),
    );
    const repo = createLastActivitiesRepository(client);
    const poll = await repo.poll(STORED);
    expect(poll.ok && poll.activities).toEqual(PINNED_FRESH);
    expect(poll.ok && [...poll.targets].sort()).toEqual(
      [
        "watched/shows",
        "progress/watched",
        "watchlist/episodes",
        "hidden/progress_watched",
        "recompute:buckets",
        "watchlist/shows",
        "recompute:following",
        "recompute:to-watch",
        "favorites/shows",
        "watched/movies",
        "movie-progress",
        "watchlist/movies",
        "hidden/movies",
        "favorites/movies",
      ].sort(),
    );
  });

  it("returns no targets when nothing advanced", async () => {
    server.use(http.get(`${TRAKT_API_BASE}/sync/last_activities`, () => HttpResponse.json(STORED)));
    const poll = await createLastActivitiesRepository(client).poll(STORED);
    expect(poll.ok && poll.targets).toEqual([]);
  });

  it("surfaces a transport failure", async () => {
    server.use(
      http.get(
        `${TRAKT_API_BASE}/sync/last_activities`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    const poll = await createLastActivitiesRepository(client).poll(STORED);
    expect(poll).toEqual({ ok: false, error: { kind: "server", status: 500 } });
  });
});
