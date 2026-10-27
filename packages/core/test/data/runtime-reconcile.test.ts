import type { QueuedOp } from "@cue/core/domain/write-queue/types";
import { OP_LOG_KEY } from "@cue/core/ports/storage-keys";
import { describe, expect, it, vi } from "vitest";
import { memoryKeyValueStore } from "../support/stores";
import { FIXTURE_NOW } from "../trakt-fake/account.ts";
import { startTraktFake } from "../trakt-fake/in-process.ts";
import { buildRuntime } from "./_runtime";

let now = FIXTURE_NOW;
const fake = startTraktFake({ clock: () => now });
const watchedAt = new Date(FIXTURE_NOW - 86_400_000).toISOString();

function queuedOp(id: string, path: string, body: unknown, inversePatch: unknown): QueuedOp {
  return {
    id,
    itemKey: id,
    request: { method: "POST", path, body },
    inverse: { method: "POST", path: `${path}/remove`, body },
    inversePatch,
    watchedAt,
    fromState: "absent",
    toState: "present",
    reconcileKeys: [],
  };
}

const show = (trakt: number) => ({ shows: [{ ids: { trakt } }] });

/**
 * One queued write per authoritative read the runtime reconciles against. Each
 * targets an item the default account does not yet hold in that state: 8801 is
 * neither hidden nor dropped, 5503 is unwatched, 880100 and 8801's S3E1 have one
 * old play each, and 8803 has 8 episodes watched with S2E3 (880308) next.
 */
const OPS = [
  queuedOp("hidden", "/users/hidden/progress_watched", show(8801), {
    kind: "hidden",
    showId: 8801,
  }),
  queuedOp("dropped", "/users/hidden/dropped", show(8801), { kind: "dropped", showId: 8801 }),
  queuedOp(
    "movie",
    "/sync/history",
    { movies: [{ ids: { trakt: 5503 }, watched_at: watchedAt }] },
    { kind: "movie", movieId: 5503 },
  ),
  queuedOp(
    "episode",
    "/sync/history",
    { episodes: [{ ids: { trakt: 880100 }, watched_at: watchedAt }] },
    { kind: "additive-episode", episodeTrakt: 880100 },
  ),
  queuedOp(
    "season",
    "/sync/history",
    {
      shows: [
        {
          ids: { trakt: 8801 },
          watched_at: watchedAt,
          seasons: [{ number: 3, episodes: [{ number: 1 }] }],
        },
      ],
    },
    { kind: "additive-season", showId: 8801, probe: { season: 3, number: 1 } },
  ),
  queuedOp(
    "mark",
    "/sync/history",
    { episodes: [{ ids: { trakt: 880308 }, watched_at: watchedAt }] },
    { showId: 8803, preCompleted: 8 },
  ),
];

/** The write reached Trakt and applied, and only its answer was lost. */
async function landed(op: QueuedOp): Promise<void> {
  now += 5000;
  const response = await fake.fetch(`https://api.trakt.tv${op.request.path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${fake.session().access_token}` },
    body: JSON.stringify(op.request.body),
  });
  if (response.status >= 300) throw new Error(`${op.id} answered ${response.status}`);
}

const posts = (path: string) =>
  fake.requests.filter((request) => request.method === "POST" && request.path === path);

describe("runtime write reconciliation", () => {
  it("retires every queued operation when its authoritative Trakt read shows it landed", async () => {
    for (const op of OPS) await landed(op);
    const sent = fake.requests.length;
    const kv = memoryKeyValueStore({ [OP_LOG_KEY]: JSON.stringify(OPS) });

    const runtime = await buildRuntime({ kv });

    expect(runtime.pendingOps()).toEqual([]);
    expect(kv.values.get(OP_LOG_KEY)).toBe("[]");
    expect(fake.requests.slice(sent).filter((request) => request.method === "POST")).toEqual([]);
  });

  it.each(
    OPS.map((op) => [op.id, op] as const),
  )("re-dispatches a queued %s write its authoritative read cannot find", async (_, op) => {
    const kv = memoryKeyValueStore({ [OP_LOG_KEY]: JSON.stringify([op]) });

    await buildRuntime({ kv });

    await vi.waitFor(() => expect(posts(op.request.path)).toHaveLength(1));
    expect(posts(op.request.path)[0]?.body).toEqual(op.request.body);
  });
});
