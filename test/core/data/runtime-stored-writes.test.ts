import { afterEach, expect, it, vi } from "vitest";
import { buildMarkEpisodeOp, buildUndoAddOp } from "@/core/domain/write-queue/ops";
import { OP_LOG_KEY } from "@/core/ports/storage-keys";
import { memoryKeyValueStore } from "../support/stores";
import { FIXTURE_NOW } from "../trakt-fake/account.ts";
import { startTraktFake } from "../trakt-fake/in-process.ts";
import { buildRuntime } from "./_runtime";

const fake = startTraktFake();

afterEach(() => {
  vi.useRealTimers();
});

const watchedAt = new Date(FIXTURE_NOW - 86_400_000).toISOString();

/** A write as an earlier build stored it, with the reconcile fields this build no longer reads. */
function stored(id: string, path: string, body: unknown, inversePatch: unknown) {
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
 * One write of each kind the app queues. Each targets an item the default account does not yet
 * hold in that state: 8801 is neither hidden nor dropped, 5503 is unwatched, 880100 and 8801's
 * S3E1 have one old play each, and 8803 has 8 episodes watched with S2E3 (880308) next.
 */
const STORED = [
  stored("hidden", "/users/hidden/progress_watched", show(8801), { kind: "hidden", showId: 8801 }),
  stored("dropped", "/users/hidden/dropped", show(8801), { kind: "dropped", showId: 8801 }),
  stored(
    "movie",
    "/sync/history",
    { movies: [{ ids: { trakt: 5503 }, watched_at: watchedAt }] },
    { kind: "movie", movieId: 5503 },
  ),
  stored(
    "episode",
    "/sync/history",
    { episodes: [{ ids: { trakt: 880100 }, watched_at: watchedAt }] },
    { kind: "additive-episode", episodeTrakt: 880100 },
  ),
  stored(
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
  stored(
    "mark",
    "/sync/history",
    { episodes: [{ ids: { trakt: 880308 }, watched_at: watchedAt }] },
    { showId: 8803, preCompleted: 8 },
  ),
];

/** The write reached Trakt and applied, and only its answer was lost. */
async function landed(op: {
  readonly id: string;
  readonly request: { readonly path: string; readonly body: unknown };
}): Promise<void> {
  vi.setSystemTime(Date.now() + 5000);
  const response = await fake.fetch(`https://api.trakt.tv${op.request.path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${fake.session().access_token}` },
    body: JSON.stringify(op.request.body),
  });
  if (response.status >= 300) throw new Error(`${op.id} answered ${response.status}`);
}

const rows = async (path: string): Promise<unknown[]> => (await fake.peek(path)).json();
const listed = async (path: string): Promise<number[]> =>
  (await (await fake.peek(path)).json()).map(
    (row: { show: { ids: { trakt: number } } }) => row.show.ids.trakt,
  );

/** What Trakt holds of each stored write's item. */
const trakt = async () => ({
  hidden: await listed("/users/hidden/progress_watched"),
  dropped: await listed("/users/hidden/dropped"),
  plays: [
    (await rows("/sync/history/movies/5503")).length,
    (await rows("/sync/history/episodes/880100")).length,
    (await rows("/sync/history/shows/8801")).length,
    (await rows("/sync/history/episodes/880308")).length,
  ],
});

it("sends every write the last run stored again, in order, and Trakt keeps one copy of each", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(FIXTURE_NOW);
  for (const op of STORED) await landed(op);
  const before = await trakt();
  const sent = fake.requests.length;
  const kv = memoryKeyValueStore({ [OP_LOG_KEY]: JSON.stringify(STORED) });
  vi.setSystemTime(Date.now() + 60_000);

  const runtime = await buildRuntime({ kv });
  await vi.advanceTimersByTimeAsync(STORED.length * 1100);

  expect(runtime.pendingWrites()).toBe(0);
  expect(kv.values.get(OP_LOG_KEY)).toBe("[]");
  expect(fake.requests.slice(sent).map((request) => [request.path, request.status < 300])).toEqual(
    STORED.map((op) => [op.request.path, true]),
  );
  expect(await trakt()).toEqual(before);
});

it("applies an Undo the last run queued behind its mark, removing only that mark's play", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(FIXTURE_NOW);
  const earlier = (await rows("/sync/history/episodes/880100")).length;
  const mark = buildMarkEpisodeOp({ opId: "mark", ids: { trakt: 880100 }, watchedAt });
  await landed(mark);
  const kv = memoryKeyValueStore({
    [OP_LOG_KEY]: JSON.stringify([mark, buildUndoAddOp("undo", mark)]),
  });
  vi.setSystemTime(Date.now() + 60_000);

  const runtime = await buildRuntime({ kv });
  await vi.advanceTimersByTimeAsync(5_000);

  expect(runtime.pendingWrites()).toBe(0);
  expect(await rows("/sync/history/episodes/880100")).toHaveLength(earlier);
});
