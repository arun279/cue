import {
  buildAddEpisodePlayOp,
  buildMarkEpisodeOp,
  buildUnmarkEpisodeOp,
} from "@cue/core/domain/write-queue/ops";
import { WriteQueue, type WriteQueueDeps } from "@cue/core/domain/write-queue/queue";
import type { DispatchResult, QueuedOp } from "@cue/core/domain/write-queue/types";
import { describe, expect, it, vi } from "vitest";
import { dispatchResult, fakeClock } from "./_helpers";

const WATCHED_AT = "2026-07-05T12:00:00.000Z";
const mark = (id: string, trakt: number): QueuedOp =>
  buildMarkEpisodeOp({ opId: id, ids: { trakt }, watchedAt: WATCHED_AT });

interface Harness {
  deps: WriteQueueDeps;
  dispatch: ReturnType<typeof vi.fn>;
  reconcile: ReturnType<typeof vi.fn>;
  times: number[];
  slept: number[];
}

function harness(opts: {
  dispatch: (req: unknown) => Promise<DispatchResult>;
  reconcile?: (op: QueuedOp) => Promise<boolean>;
}): Harness {
  const clock = fakeClock(0);
  const times: number[] = [];
  const slept: number[] = [];
  const sleep = vi.fn(async (ms: number) => {
    slept.push(ms);
    await clock.sleep(ms);
  });
  const dispatch = vi.fn(async (req: unknown) => {
    times.push(clock.now());
    return opts.dispatch(req);
  });
  const reconcile = vi.fn(opts.reconcile ?? (() => Promise.resolve(false)));
  return {
    deps: { dispatch, sleep, now: clock.now, reconcile },
    dispatch,
    reconcile,
    times,
    slept,
  };
}

describe("WriteQueue dispatch + pacing", () => {
  it("dispatches queued ops ≥1000ms apart", async () => {
    const h = harness({ dispatch: () => Promise.resolve(dispatchResult(200)) });
    const q = new WriteQueue(h.deps, [mark("a", 1), mark("b", 2), mark("c", 3)]);
    const res = await q.flush();
    expect(res.completed).toHaveLength(3);
    expect(h.times).toEqual([0, 1000, 2000]);
    expect(h.slept).toEqual([1000, 1000]);
  });
});

describe("WriteQueue failure classification", () => {
  it("pauses for Retry-After on 429 then re-dispatches the identical op", async () => {
    let calls = 0;
    const h = harness({
      dispatch: () => {
        calls += 1;
        return Promise.resolve(
          calls === 1 ? dispatchResult(429, { "retry-after": "3" }) : dispatchResult(200),
        );
      },
    });
    const q = new WriteQueue(h.deps, [mark("a", 1)]);
    const res = await q.flush();
    expect(res.completed).toHaveLength(1);
    expect(h.dispatch).toHaveBeenCalledTimes(2);
    expect(h.dispatch.mock.calls[0]?.[0]).toEqual(h.dispatch.mock.calls[1]?.[0]);
    expect(h.slept).toContain(3000);
  });

  it("rolls back a definite 4xx failure with the inverse patch", async () => {
    const op = buildMarkEpisodeOp({
      opId: "a",
      ids: { trakt: 1 },
      watchedAt: WATCHED_AT,
      inversePatch: { restore: true },
    });
    const h = harness({ dispatch: () => Promise.resolve(dispatchResult(404)) });
    const q = new WriteQueue(h.deps, [op]);
    const res = await q.flush();
    expect(res.completed).toHaveLength(0);
    expect(res.failed).toEqual([{ op, inversePatch: { restore: true } }]);
  });

  it("keeps a persistent 5xx durable after the retry budget (defer, never rolled back)", async () => {
    const h = harness({ dispatch: () => Promise.resolve(dispatchResult(500)) });
    const q = new WriteQueue(h.deps, [mark("a", 1)]);
    const res = await q.flush();
    expect(res.completed).toHaveLength(0);
    expect(res.failed).toHaveLength(0);
    expect(q.size).toBe(1); // safe-retryable → stays pending for the next flush
    expect(h.dispatch).toHaveBeenCalledTimes(5);
    expect(h.slept).toEqual([1000, 2000, 4000, 8000]); // no wasted sleep after the final attempt
  });
});

describe("WriteQueue NetworkError = reconcile-before-retry", () => {
  it("retires the op without re-POSTing when Trakt already reflects it", async () => {
    const h = harness({
      dispatch: () => Promise.reject(new Error("network")),
      reconcile: () => Promise.resolve(true),
    });
    const q = new WriteQueue(h.deps, [mark("a", 1)]);
    const res = await q.flush();
    expect(res.completed).toHaveLength(1);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.reconcile).toHaveBeenCalledTimes(1);
  });

  it("re-dispatches only after a reconcile read (never a blind re-POST)", async () => {
    let calls = 0;
    const h = harness({
      dispatch: () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error("network"))
          : Promise.resolve(dispatchResult(200));
      },
      reconcile: () => Promise.resolve(false),
    });
    const q = new WriteQueue(h.deps, [mark("a", 1)]);
    const res = await q.flush();
    expect(res.completed).toHaveLength(1);
    expect(h.reconcile).toHaveBeenCalledTimes(1);
    expect(h.dispatch).toHaveBeenCalledTimes(2);
  });

  it("defers (keeps durable) when reconcile itself cannot reach the server", async () => {
    const h = harness({
      dispatch: () => Promise.reject(new Error("network")),
      reconcile: () => Promise.reject(new Error("offline")),
    });
    const q = new WriteQueue(h.deps, [mark("a", 1)]);
    const res = await q.flush();
    expect(res.completed).toHaveLength(0);
    expect(res.failed).toHaveLength(0);
    expect(q.size).toBe(1);
  });
});

describe("WriteQueue concurrency safety", () => {
  it("enqueues a compensating op instead of canceling the in-flight write", async () => {
    let release: (r: DispatchResult) => void = () => {};
    const gate = new Promise<DispatchResult>((res) => {
      release = res;
    });
    let call = 0;
    const h = harness({
      dispatch: () => {
        call += 1;
        return call === 1 ? gate : Promise.resolve(dispatchResult(200));
      },
    });
    const q = new WriteQueue(h.deps, [mark("a", 1)]);
    const flushed = q.flush();
    await Promise.resolve();
    q.enqueue(buildUnmarkEpisodeOp({ opId: "b", ids: { trakt: 1 }, watchedAt: WATCHED_AT }));
    expect(q.size).toBe(2); // in-flight mark preserved; opposite toggle queued behind it
    release(dispatchResult(200));
    const res = await flushed;
    expect(res.completed.map((o) => o.id)).toEqual(["a", "b"]);
    expect(h.dispatch).toHaveBeenCalledTimes(2);
  });

  it("is single-flight: concurrent flush calls share one drain, never double-dispatching", async () => {
    const h = harness({ dispatch: () => Promise.resolve(dispatchResult(200)) });
    const q = new WriteQueue(h.deps, [mark("a", 1), mark("b", 2)]);
    const [r1, r2] = await Promise.all([q.flush(), q.flush()]);
    expect(r1).toBe(r2);
    expect(h.dispatch).toHaveBeenCalledTimes(2);
  });

  it("exposes the delivering op's id while (and only while) it is in flight", async () => {
    let release: (r: DispatchResult) => void = () => {};
    const gate = new Promise<DispatchResult>((res) => {
      release = res;
    });
    const h = harness({ dispatch: () => gate });
    const q = new WriteQueue(h.deps, [mark("a", 1)]);
    expect(q.inFlightId).toBeNull();
    const flushed = q.flush();
    await Promise.resolve();
    expect(q.inFlightId).toBe("a");
    release(dispatchResult(200));
    await flushed;
    expect(q.inFlightId).toBeNull();
  });
});

describe("WriteQueue coalescing + durability", () => {
  it("coalesces a rapid toggle on one item to nothing", () => {
    const h = harness({ dispatch: () => Promise.resolve(dispatchResult(200)) });
    const q = new WriteQueue(h.deps);
    q.enqueue(mark("a", 1));
    q.enqueue(buildUnmarkEpisodeOp({ opId: "b", ids: { trakt: 1 }, watchedAt: WATCHED_AT }));
    expect(q.size).toBe(0);
  });

  it("dispatches BOTH a queued mark and a queued additive play of the same episode", async () => {
    const h = harness({ dispatch: () => Promise.resolve(dispatchResult(200)) });
    const q = new WriteQueue(h.deps);
    q.enqueue(mark("a", 1));
    q.enqueue(buildAddEpisodePlayOp({ opId: "b", ids: { trakt: 1 }, watchedAt: WATCHED_AT }));
    expect(q.size).toBe(2); // additive intent is never redundant: nothing swallowed
    const res = await q.flush();
    expect(res.completed.map((o) => o.id)).toEqual(["a", "b"]);
    expect(h.dispatch).toHaveBeenCalledTimes(2);
  });

  it("survives persist → reload and retires ops that already landed pre-crash", async () => {
    const seed = new WriteQueue(
      harness({ dispatch: () => Promise.resolve(dispatchResult(200)) }).deps,
    );
    seed.enqueue(mark("a", 1));
    seed.enqueue(mark("b", 2));
    const snapshot = seed.snapshot();
    const restored = JSON.parse(JSON.stringify(snapshot)) as QueuedOp[];
    expect(restored).toEqual(snapshot);

    const h = harness({
      dispatch: () => Promise.resolve(dispatchResult(200)),
      reconcile: (op) => Promise.resolve(op.itemKey === "episode:1"),
    });
    const q = new WriteQueue(h.deps, restored);
    await q.startupReconcile();
    expect(q.size).toBe(1);
    const res = await q.flush();
    expect(res.completed.map((o) => o.itemKey)).toEqual(["episode:2"]);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
  });

  it("keeps every op durable (never throws) when a startup reconcile read fails", async () => {
    const h = harness({
      dispatch: () => Promise.resolve(dispatchResult(200)),
      reconcile: () => Promise.reject(new Error("offline")),
    });
    const q = new WriteQueue(h.deps, [mark("a", 1), mark("b", 2)]);
    await expect(q.startupReconcile()).resolves.toBeUndefined();
    expect(q.size).toBe(2); // undetermined landing → nothing retired, boot proceeds
    const res = await q.flush();
    expect(res.completed.map((o) => o.itemKey)).toEqual(["episode:1", "episode:2"]);
  });
});
