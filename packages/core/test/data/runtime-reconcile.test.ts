import { TRAKT_API_BASE } from "@cue/core/data/trakt/client";
import type { QueuedOp } from "@cue/core/domain/write-queue/types";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
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

function queuedLog(): string {
  return JSON.stringify([
    queuedOp("hidden", { kind: "hidden", showId: 42 }),
    queuedOp("movie", { kind: "movie", movieId: 84 }),
    queuedOp("episode", { kind: "additive-episode", episodeTrakt: 101 }),
    queuedOp("season", {
      kind: "additive-season",
      showId: 42,
      probe: { season: 2, number: 3 },
    }),
    queuedOp("mark", { showId: 42, preCompleted: 4 }),
  ]);
}

describe("runtime write reconciliation", () => {
  it("retires every queued operation when its authoritative Trakt read shows it landed", async () => {
    const kv = memoryKv({ "cue.write-queue": queuedLog() });
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

  const unlanded = [
    {
      name: "hidden",
      inversePatch: { kind: "hidden", showId: 42 },
      read: http.get(`${TRAKT_API_BASE}/users/hidden/progress_watched`, () =>
        HttpResponse.json([]),
      ),
    },
    {
      name: "watched movie",
      inversePatch: { kind: "movie", movieId: 84 },
      read: http.get(`${TRAKT_API_BASE}/sync/watched/movies`, () => HttpResponse.json([])),
    },
    {
      name: "additive episode",
      inversePatch: { kind: "additive-episode", episodeTrakt: 101 },
      read: http.get(`${TRAKT_API_BASE}/sync/history/episodes/101`, () => HttpResponse.json([])),
    },
    {
      name: "additive season",
      inversePatch: { kind: "additive-season", showId: 42, probe: { season: 2, number: 3 } },
      read: http.get(`${TRAKT_API_BASE}/sync/history/shows/42`, () => HttpResponse.json([])),
    },
    {
      name: "progress mark",
      inversePatch: { showId: 42, preCompleted: 4 },
      read: http.get(`${TRAKT_API_BASE}/shows/42/progress/watched`, () =>
        HttpResponse.json({ aired: 10, completed: 4, next_episode: null, seasons: [] }),
      ),
    },
  ];

  it.each(unlanded)("re-dispatches a $name operation its authoritative read cannot find", async ({
    inversePatch,
    read,
  }) => {
    const kv = memoryKv({ "cue.write-queue": JSON.stringify([queuedOp("op", inversePatch)]) });
    const dispatched: unknown[] = [];
    server.use(
      read,
      http.post(`${TRAKT_API_BASE}/sync/history`, async ({ request }) => {
        dispatched.push(await request.json());
        return HttpResponse.json({ added: { episodes: 1 } });
      }),
    );

    await buildRuntime({ kv });

    await vi.waitFor(() => expect(dispatched).toHaveLength(1));
  });
});
