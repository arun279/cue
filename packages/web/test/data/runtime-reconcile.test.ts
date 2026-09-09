import { TRAKT_API_BASE } from "@cue/core/data/trakt/client";
import type { QueuedOp } from "@cue/core/domain/write-queue/types";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mswServer } from "./_msw";
import { buildRuntime, memoryKv } from "./_runtime";

const server = mswServer();
const watchedAt = "2026-07-05T21:00:00.000Z";

function queuedOp(id: string, inversePatch: unknown): QueuedOp {
  return {
    id,
    itemKey: id,
    request: { method: "POST", path: "/sync/history", body: {} },
    inverse: { method: "POST", path: "/sync/history/remove", body: {} },
    inversePatch,
    watchedAt,
    fromState: "absent",
    toState: "present",
    reconcileKeys: [],
  };
}

function episodePlay(episodeTrakt: number, season: number, number: number) {
  return {
    id: episodeTrakt,
    watched_at: watchedAt,
    action: "watch",
    type: "episode",
    episode: {
      season,
      number,
      title: "Episode",
      ids: { trakt: episodeTrakt },
    },
    show: { title: "Show", ids: { trakt: 42 } },
  };
}

describe("runtime write reconciliation", () => {
  it("retires every queued operation when its authoritative Trakt read shows it landed", async () => {
    const kv = memoryKv({
      "cue.write-queue": JSON.stringify([
        queuedOp("hidden", { kind: "hidden", showId: 42 }),
        queuedOp("movie", { kind: "movie", movieId: 84 }),
        queuedOp("episode", { kind: "additive-episode", episodeTrakt: 101 }),
        queuedOp("season", {
          kind: "additive-season",
          showId: 42,
          probe: { season: 2, number: 3 },
        }),
        queuedOp("mark", { showId: 42, preCompleted: 4 }),
      ]),
    });
    server.use(
      http.get(`${TRAKT_API_BASE}/users/hidden/progress_watched`, () =>
        HttpResponse.json([
          { hidden_at: watchedAt, type: "show", show: { title: "Show", ids: { trakt: 42 } } },
        ]),
      ),
      http.get(`${TRAKT_API_BASE}/sync/watched/movies`, () =>
        HttpResponse.json([
          {
            last_watched_at: watchedAt,
            movie: { title: "Movie", year: 2026, ids: { trakt: 84 } },
          },
        ]),
      ),
      http.get(`${TRAKT_API_BASE}/sync/history/episodes/101`, () =>
        HttpResponse.json([episodePlay(101, 1, 1)]),
      ),
      http.get(`${TRAKT_API_BASE}/sync/history/shows/42`, () =>
        HttpResponse.json([episodePlay(203, 2, 3)]),
      ),
      http.get(`${TRAKT_API_BASE}/shows/42/progress/watched`, () =>
        HttpResponse.json({ aired: 10, completed: 5, next_episode: null, seasons: [] }),
      ),
    );

    const runtime = await buildRuntime({ kv });

    expect(runtime.pendingOps()).toEqual([]);
    expect(kv.values.get("cue.write-queue")).toBe("[]");
  });
});
