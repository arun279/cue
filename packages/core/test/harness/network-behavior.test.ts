import { queryKeys } from "@cue/core/data/query-keys";
import { createAuthorizedFetch } from "@cue/core/data/trakt/authorized-fetch";
import { TraktClient } from "@cue/core/data/trakt/client";
import { getShowProgress, getUserSettings } from "@cue/core/data/trakt/endpoints";
import {
  readsPausedUntil,
  resetReadPause,
  subscribeReadPause,
  withReadRateRetry,
} from "@cue/core/data/trakt/read-budget";
import { markedAt, ownPlays } from "@cue/core/domain/reversal";
import { buildBulkMarkOps } from "@cue/core/domain/write-queue/bulk";
import {
  buildAddEpisodePlayOp,
  buildAddWatchlistOp,
  buildMarkEpisodeOp,
  markedEpisodesOf,
} from "@cue/core/domain/write-queue/ops";
import { planLandedUndo, removeEpisodePlays } from "@cue/core/hooks/resolve-unmark";
import { PLAY_POLICY_KEY } from "@cue/core/ports/storage-keys";
import { libraryQuery } from "@cue/core/queries/library";
import {
  createQueryCachePolicy,
  createQueryClient,
  restorableCache,
} from "@cue/core/runtime/query-cache";
import { usePlayPolicy } from "@cue/core/stores/play-policy-store";
import { dehydrate, hydrate } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRuntime } from "../data/_runtime";
import { memoryKeyValueStore } from "../support/stores";
import { startTraktFake } from "../trakt-fake/in-process.ts";

const fake = startTraktFake();

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  resetReadPause();
});

const since = (start: number) => fake.requests.slice(start);
const posted = (path: string) =>
  vi.waitFor(() =>
    expect(fake.requests.some((entry) => entry.method === "POST" && entry.path === path)).toBe(
      true,
    ),
  );
function nextReadPause(): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = subscribeReadPause(() => {
      unsubscribe();
      resolve();
    });
  });
}

function queryFailure(
  queryClient: ReturnType<typeof createQueryClient>,
  queryKey: readonly unknown[],
  count: number,
): Promise<void> {
  if (queryClient.getQueryState(queryKey)?.fetchFailureCount === count) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      if (queryClient.getQueryState(queryKey)?.fetchFailureCount !== count) return;
      unsubscribe();
      resolve();
    });
  });
}

function authorizedClient(): TraktClient {
  const authorized = createAuthorizedFetch({
    inner: (input, init) => fetch(input, init),
    token: fake.session(),
    config: { clientId: "mock-client", redirectUri: "cue://oauth" },
    persist: async () => undefined,
    endSession: async () => undefined,
  });
  return new TraktClient({
    clientId: "mock-client",
    getToken: authorized.accessToken,
    fetch: authorized.fetch,
  });
}

describe("read failures", () => {
  it("honors a capped Retry-After and holds other reads behind the pause", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-09-10T12:00:00.000Z"));
    fake.fail({ method: "GET", path: /^\/shows\/8801\/progress\/watched$/ }, 429, 301);
    const start = fake.requests.length;
    const paused = nextReadPause();
    const read = withReadRateRetry(() => getShowProgress(authorizedClient(), 8801));
    await paused;
    expect(readsPausedUntil() - Date.now()).toBe(300_500);

    const sibling = withReadRateRetry(() => getUserSettings(authorizedClient()));
    await vi.advanceTimersByTimeAsync(300_499);
    expect(since(start)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    const [result, siblingResult] = await Promise.all([read, sibling]);
    expect(result.ok).toBe(true);
    expect(siblingResult.ok).toBe(true);
    expect(since(start)).toHaveLength(3);
  });

  it("retries two server failures on the query ladder", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-09-10T12:00:00.000Z"));
    fake.fail({ method: "GET", path: /^\/calendars\/my\/shows\//, times: 2 }, 503);
    const cue = await buildRuntime();
    const queryClient = createQueryClient();
    const start = fake.requests.length;
    const queryKey = queryKeys.calendar("2026-09-10", 28);
    const read = queryClient.fetchQuery({
      queryKey,
      queryFn: () => cue.loadCalendar("2026-09-10", 28),
    });
    await queryFailure(queryClient, queryKey, 1);
    const secondFailure = queryFailure(queryClient, queryKey, 2);
    await vi.advanceTimersByTimeAsync(2200);
    await secondFailure;
    await vi.advanceTimersByTimeAsync(4400);
    await expect(read).resolves.toMatchObject({ entries: expect.any(Array) });
    expect(since(start).filter((entry) => entry.path.startsWith("/calendars/"))).toHaveLength(3);
  });

  it("ends a manual refresh with the shared rate-limit pause still published", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-09-10T12:00:00.000Z"));
    fake.fail({ method: "GET", path: /^\/sync\/last_activities$/, times: 4 }, 429, 0);
    const cue = await buildRuntime();
    const start = fake.requests.length;
    let paused = nextReadPause();
    const poll = cue.pollActivities();
    for (let attempt = 1; attempt < 4; attempt += 1) {
      await paused;
      expect(since(start)).toHaveLength(attempt);
      paused = nextReadPause();
      await vi.advanceTimersByTimeAsync(500);
    }
    await expect(poll).resolves.toBeNull();
    expect(since(start)).toHaveLength(4);
    expect(readsPausedUntil()).toBeGreaterThan(Date.now());
  });
});

const EVERY_READ = { method: "GET", times: Number.POSITIVE_INFINITY } as const;

describe("a refresh that fails", () => {
  it.each([
    ["Trakt is down", () => fake.fail(EVERY_READ, 503)],
    ["Trakt rate-limits every read", () => fake.fail(EVERY_READ, 429, 1)],
    ["Trakt never answers", () => void fake.hold(EVERY_READ)],
    ["the connection drops", () => fake.drop(EVERY_READ)],
  ])("keeps the last good queue for the next launch when %s", async (_, arm) => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-09-10T12:00:00.000Z"));
    const cue = await buildRuntime();
    const session = createQueryClient();
    const library = libraryQuery(cue);
    const loaded = await session.fetchQuery(library);
    arm();
    const refresh = session.refetchQueries({ queryKey: library.queryKey });
    for (let tick = 0; tick < 60 && session.isFetching(library) > 0; tick += 1) {
      await vi.advanceTimersByTimeAsync(5_000);
    }
    await refresh;
    expect(session.getQueryState(library.queryKey)?.status).toBe("error");

    const { shouldDehydrateQuery } = createQueryCachePolicy(session);
    const persisted = JSON.stringify(
      restorableCache({ clientState: dehydrate(session, { shouldDehydrateQuery }) }),
    );
    const relaunch = createQueryClient();
    hydrate(relaunch, JSON.parse(persisted).clientState);

    expect(relaunch.getQueryData(library.queryKey)).toEqual(loaded);
    expect(relaunch.getQueryState(library.queryKey)?.status).toBe("success");
  });
});

const HISTORY = /^\/sync\/history$/;

describe("write faults", () => {
  const mark = () =>
    buildMarkEpisodeOp({
      opId: "fault-mark",
      ids: { trakt: 880120 },
      watchedAt: "2026-09-10T12:00:00.000Z",
      inversePatch: { showId: 8801, preCompleted: 20 },
    });

  it("keeps a held write pending until the fault is released", async () => {
    const release = fake.hold({ method: "POST", path: HISTORY });
    const cue = await buildRuntime();
    const submitted = cue.submit(mark());
    await posted("/sync/history");
    expect(cue.inFlightOpId()).toBe("fault-mark");
    expect(cue.pendingWrites()).toBe(1);
    release();
    await expect(submitted).resolves.toBe("done");
    expect(cue.pendingWrites()).toBe(0);
  });

  it("reconciles an applied write whose response was lost without posting twice", async () => {
    fake.drop({ method: "POST", path: HISTORY }, "after");
    const cue = await buildRuntime();
    const start = fake.requests.length;
    await expect(cue.submit(mark())).resolves.toBe("done");
    const requests = since(start);
    expect(requests.filter((entry) => entry.path === "/sync/history")).toHaveLength(1);
    expect(requests.filter((entry) => entry.path === "/shows/8801/progress/watched")).toHaveLength(
      1,
    );
  });
});

describe("write receipts", () => {
  // The seed's first show has its first 20 episodes watched.
  const watched = { trakt: 880100 };
  const at = "2026-10-14T12:34:00.000Z";

  it("keeps what Trakt said and learns that the account keeps one play per episode", async () => {
    fake.reset({ multiplePlays: false });
    const kv = memoryKeyValueStore();
    const cue = await buildRuntime({ kv });
    const op = buildMarkEpisodeOp({ opId: "replace", ids: watched, watchedAt: at });
    await expect(cue.submit(op)).resolves.toBe("done");
    expect(cue.writeReceipt("replace")).toEqual({
      added: 0,
      updated: 1,
      deleted: 0,
      existing: 0,
      notFound: 0,
    });
    expect(usePlayPolicy.getState().policy).toBe("one-play");
    expect(await kv.read(PLAY_POLICY_KEY)).toBe(JSON.stringify("one-play"));
    await cue.endLocalSession();
    expect(usePlayPolicy.getState().policy).toBe("unknown");
  });

  it("keeps a write's answer while the next write is still being delivered, so its Undo is safe", async () => {
    fake.reset({ multiplePlays: false });
    const release = fake.hold({ method: "POST", path: HISTORY, after: 1 });
    const cue = await buildRuntime();
    const first = buildMarkEpisodeOp({ opId: "first", ids: watched, watchedAt: at });
    const second = buildMarkEpisodeOp({ opId: "second", ids: { trakt: 880101 }, watchedAt: at });
    const done = Promise.all([cue.submit(first), cue.submit(second)]);
    await vi.waitFor(
      () => expect(fake.requests.filter((entry) => entry.path === "/sync/history")).toHaveLength(2),
      { timeout: 5000 },
    );
    expect(cue.inFlightOpId()).toBe("second");
    expect(cue.writeReceipt("first")).toMatchObject({ added: 0, updated: 1 });
    const undo = await planLandedUndo(
      cue,
      ["first"],
      () => cue.loadEpisodePlays(watched.trakt),
      () => at,
      (play) => play.episodeTrakt,
    );
    expect(undo).toEqual({ kind: "replaced", count: 1 });
    release();
    await expect(done).resolves.toEqual(["done", "done"]);
  });

  it("learns that the account keeps every play when Add a play on one episode adds a play", async () => {
    const cue = await buildRuntime();
    const op = buildAddEpisodePlayOp({ opId: "again", ids: watched, watchedAt: at });
    await expect(cue.submit(op)).resolves.toBe("done");
    expect(cue.writeReceipt("again")?.added).toBe(1);
    expect(usePlayPolicy.getState().policy).toBe("multiple");
  });

  it("undoes a landed season mark by removing exactly its plays, though Trakt stores whole minutes", async () => {
    const cue = await buildRuntime();
    const before = (await cue.loadShowProgress(8803)).completed;
    const [mark] = buildBulkMarkOps(
      {
        showIds: { trakt: 8803 },
        seasons: [
          {
            number: 2,
            episodes: [3, 4].map((number) => ({
              number,
              firstAired: "2020-01-01T00:00:00.000Z",
              watched: false,
            })),
          },
        ],
        includeSpecials: false,
      },
      Date.now(),
      "2026-10-14T12:34:56.789Z",
      () => "season",
    );
    if (mark === undefined) throw new Error("the season mark must produce an op");
    await expect(cue.submit(mark)).resolves.toBe("done");
    const marked = markedEpisodesOf(mark);
    const own = ownPlays(
      await cue.loadShowPlays(8803),
      markedAt(marked === null ? [] : [marked]),
      (play) => play.episodeTrakt,
    );
    expect(own).toHaveLength(2);
    const removal = removeEpisodePlays("undo", own);
    await expect(cue.submit(removal)).resolves.toBe("done");
    expect((await cue.loadShowProgress(8803)).completed).toBe(before);
  });

  it("lands a watchlist add for a title the account does not hold yet", async () => {
    const cue = await buildRuntime();
    const add = buildAddWatchlistOp({ opId: "list", section: "shows", ids: { trakt: 8901 } });
    await expect(cue.submit(add)).resolves.toBe("done");
    expect(cue.writeReceipt("list")?.added).toBe(1);
  });

  it("fails an add Trakt answered without applying, so the app does not show it as watched", async () => {
    const cue = await buildRuntime();
    const op = buildMarkEpisodeOp({ opId: "missing", ids: { trakt: 1 }, watchedAt: at });
    await expect(cue.submit(op)).resolves.toBe("failed");
  });
});
