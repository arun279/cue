import { describe, expect, it, vi } from "vitest";
import {
  buildAddEpisodePlayOp,
  buildMarkEpisodeOp,
  buildUnmarkEpisodeOp,
} from "@/core/domain/write-queue/ops";
import { WriteQueue, type WriteQueueDeps } from "@/core/domain/write-queue/queue";
import type { DispatchResult, QueuedOp } from "@/core/domain/write-queue/types";
import { dispatchResult, fakeClock } from "./_helpers";

const WATCHED_AT = "2026-07-05T12:00:00.000Z";
const mark = (id: string, trakt: number): QueuedOp =>
  buildMarkEpisodeOp({ opId: id, ids: { trakt }, watchedAt: WATCHED_AT });
const unmark = (id: string, trakt: number): QueuedOp =>
  buildUnmarkEpisodeOp({ opId: id, ids: { trakt }, watchedAt: WATCHED_AT });
const addPlay = (id: string, trakt: number): QueuedOp =>
  buildAddEpisodePlayOp({ opId: id, ids: { trakt }, watchedAt: WATCHED_AT });

interface Harness {
  deps: WriteQueueDeps;
  dispatch: ReturnType<typeof vi.fn>;
  clock: ReturnType<typeof fakeClock>;
  times: number[];
  slept: number[];
  sent: () => string[];
}

function harness(answer: (req: unknown) => Promise<DispatchResult>): Harness {
  const clock = fakeClock(0);
  const times: number[] = [];
  const slept: number[] = [];
  const sleep = vi.fn(async (ms: number) => {
    slept.push(ms);
    await clock.sleep(ms);
  });
  const dispatch = vi.fn(async (req: unknown) => {
    times.push(clock.now());
    return answer(req);
  });
  return {
    deps: { dispatch, sleep, now: clock.now, settle: () => true },
    dispatch,
    clock,
    times,
    slept,
    sent: () => dispatch.mock.calls.map(([req]) => JSON.stringify(req)),
  };
}

const ok = () => Promise.resolve(dispatchResult(200));
const outcomes = (q: WriteQueue, ...ids: string[]) => ids.map((id) => q.outcomeOf(id));

function gate(): { answer: Promise<DispatchResult>; release: (r: DispatchResult) => void } {
  let release: (r: DispatchResult) => void = () => {};
  const answer = new Promise<DispatchResult>((resolve) => {
    release = resolve;
  });
  return { answer, release };
}

describe("WriteQueue dispatch + pacing", () => {
  it("keeps every dispatch outside the prior request's one-second window", async () => {
    const h = harness(ok);
    const q = new WriteQueue(h.deps, [mark("a", 1), mark("b", 2), mark("c", 3)]);
    await q.flush();
    expect(outcomes(q, "a", "b", "c")).toEqual(["done", "done", "done"]);
    expect(h.times).toEqual([0, 1100, 2200]);
    expect(h.slept).toEqual([1100, 1100]);
  });
});

describe("WriteQueue failure classification", () => {
  it("pauses for Retry-After on 429 then re-dispatches the identical op", async () => {
    let calls = 0;
    const h = harness(() => {
      calls += 1;
      return Promise.resolve(
        calls === 1 ? dispatchResult(429, { "retry-after": "3" }) : dispatchResult(200),
      );
    });
    const q = new WriteQueue(h.deps, [mark("a", 1)]);
    await q.flush();
    expect(q.outcomeOf("a")).toBe("done");
    expect(h.dispatch).toHaveBeenCalledTimes(2);
    expect(h.dispatch.mock.calls[0]?.[0]).toEqual(h.dispatch.mock.calls[1]?.[0]);
    expect(h.slept).toContain(3000);
  });

  it("fails a write Trakt refuses, and sends the next", async () => {
    let calls = 0;
    const h = harness(() => {
      calls += 1;
      return Promise.resolve(dispatchResult(calls === 1 ? 404 : 200));
    });
    const q = new WriteQueue(h.deps, [mark("a", 1), mark("b", 2)]);
    await q.flush();
    expect(outcomes(q, "a", "b")).toEqual(["failed", "done"]);
  });

  it("keeps a write through one flush of server errors, without a sleep after the last try", async () => {
    const h = harness(() => Promise.resolve(dispatchResult(500)));
    const q = new WriteQueue(h.deps, [mark("a", 1), mark("b", 2)]);
    await q.flush();
    expect(outcomes(q, "a", "b")).toEqual([null, null]);
    expect(h.dispatch).toHaveBeenCalledTimes(5);
    expect(h.slept).toEqual([1100, 2200, 4400, 8800]);
  });

  it("gives up a write refused for five minutes and moves on to the next", async () => {
    const h = harness((req) =>
      Promise.resolve(dispatchResult(JSON.stringify(req).includes('"trakt":1') ? 503 : 200)),
    );
    const q = new WriteQueue(h.deps, [mark("a", 1), mark("b", 2)]);
    await q.flush();
    await h.clock.sleep(240_000);
    await q.flush();
    expect(outcomes(q, "a", "b")).toEqual([null, null]);
    await h.clock.sleep(60_000);
    await q.flush();
    expect(outcomes(q, "a", "b")).toEqual(["failed", "done"]);
    await expect(q.settled("a")).resolves.toBe("failed");
    expect(q.size).toBe(0);
  });

  it("keeps a write whose answer was lost first in line, and sends it again on the next flush", async () => {
    let calls = 0;
    const h = harness(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error("network")) : ok();
    });
    const q = new WriteQueue(h.deps, [mark("a", 1), mark("b", 2)]);
    await q.flush();
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(q.snapshot().map((op) => op.id)).toEqual(["a", "b"]);
    await q.flush();
    expect(outcomes(q, "a", "b")).toEqual(["done", "done"]);
    expect(h.sent()[0]).toBe(h.sent()[1]);
  });
});

describe("WriteQueue settles each answer", () => {
  const answered = (data: unknown): DispatchResult => ({ status: 201, headers: {}, data });

  it("settles a write before the next one is sent", async () => {
    const order: string[] = [];
    const h = harness(ok);
    h.dispatch.mockImplementation(async (req: unknown) => {
      order.push(`send ${JSON.stringify(req).includes('"trakt":1') ? "a" : "b"}`);
      return answered({ added: { episodes: 1 } });
    });
    const settle = (op: QueuedOp, result: DispatchResult): boolean => {
      order.push(`settle ${op.id} ${JSON.stringify(result.data)}`);
      return true;
    };
    await new WriteQueue({ ...h.deps, settle }, [mark("a", 1), mark("b", 2)]).flush();
    expect(order).toEqual([
      "send a",
      'settle a {"added":{"episodes":1}}',
      "send b",
      'settle b {"added":{"episodes":1}}',
    ]);
  });

  it("fails a write whose answer shows Trakt did not apply it", async () => {
    const h = harness(() => Promise.resolve(answered({ not_found: { episodes: [{}] } })));
    const q = new WriteQueue({ ...h.deps, settle: () => false }, [mark("a", 1)]);
    await q.flush();
    expect(q.outcomeOf("a")).toBe("failed");
    expect(h.dispatch).toHaveBeenCalledTimes(1);
  });
});

describe("WriteQueue concurrency safety", () => {
  it("queues an opposite write behind the one in flight instead of cancelling it", async () => {
    const held = gate();
    let call = 0;
    const h = harness(() => {
      call += 1;
      return call === 1 ? held.answer : ok();
    });
    const q = new WriteQueue(h.deps, [mark("a", 1)]);
    const flushed = q.flush();
    await Promise.resolve();
    q.enqueue(unmark("b", 1));
    expect(q.size).toBe(2);
    held.release(dispatchResult(200));
    await flushed;
    expect(outcomes(q, "a", "b")).toEqual(["done", "done"]);
    expect(h.dispatch).toHaveBeenCalledTimes(2);
  });

  it("never cancels a write that was sent, even once its flush has ended", async () => {
    let calls = 0;
    const h = harness(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error("network")) : ok();
    });
    const q = new WriteQueue(h.deps);
    q.enqueue(mark("a", 1));
    await q.flush();
    q.enqueue(unmark("b", 1));
    await q.flush();
    expect(outcomes(q, "a", "b")).toEqual(["done", "done"]);
    expect(h.dispatch).toHaveBeenCalledTimes(3);
  });

  it("is single-flight: concurrent flush calls share one drain, never double-dispatching", async () => {
    const h = harness(ok);
    const q = new WriteQueue(h.deps, [mark("a", 1), mark("b", 2)]);
    const first = q.flush();
    expect(q.flush()).toBe(first);
    await first;
    expect(h.dispatch).toHaveBeenCalledTimes(2);
  });

  it("exposes the delivering op's id while (and only while) it is in flight", async () => {
    const held = gate();
    const h = harness(() => held.answer);
    const q = new WriteQueue(h.deps, [mark("a", 1)]);
    expect(q.inFlightId).toBeNull();
    const flushed = q.flush();
    await Promise.resolve();
    expect(q.inFlightId).toBe("a");
    held.release(dispatchResult(200));
    await flushed;
    expect(q.inFlightId).toBeNull();
  });
});

describe("WriteQueue coalescing", () => {
  it("cancels an unsent write and its opposite, and leaves other items alone", async () => {
    const h = harness(ok);
    const q = new WriteQueue(h.deps);
    q.enqueue(mark("a", 1));
    q.enqueue(mark("b", 2));
    q.enqueue(unmark("c", 1));
    expect(q.snapshot().map((op) => op.id)).toEqual(["b"]);
    await expect(Promise.all([q.settled("a"), q.settled("c")])).resolves.toEqual([
      "cancelled",
      "cancelled",
    ]);
  });

  it("ends a repeat of an unsent write as that write ends, sending it once", async () => {
    const h = harness(ok);
    const q = new WriteQueue(h.deps);
    q.enqueue(mark("a", 1));
    q.enqueue(mark("b", 1));
    expect(q.size).toBe(1);
    expect(q.outcomeOf("b")).toBeNull();
    await q.flush();
    expect(outcomes(q, "a", "b")).toEqual(["done", "done"]);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
  });

  it("weighs a new write against the latest one for its item", async () => {
    const h = harness(() => Promise.reject(new Error("network")));
    const q = new WriteQueue(h.deps);
    q.enqueue(mark("a", 1));
    await q.flush();
    q.enqueue(unmark("b", 1));
    q.enqueue(mark("c", 1));
    expect(q.snapshot().map((op) => op.id)).toEqual(["a"]);
    expect(outcomes(q, "b", "c")).toEqual(["cancelled", "cancelled"]);
  });

  it("never merges an additive play with a mark, an unmark, or another play", async () => {
    const h = harness(ok);
    const q = new WriteQueue(h.deps);
    q.enqueue(mark("a", 1));
    q.enqueue(addPlay("b", 1));
    q.enqueue(unmark("c", 2));
    q.enqueue(addPlay("d", 2));
    q.enqueue(addPlay("e", 2));
    expect(q.size).toBe(5);
    await q.flush();
    expect(outcomes(q, "a", "b", "c", "d", "e")).toEqual(["done", "done", "done", "done", "done"]);
  });
});

describe("WriteQueue durability", () => {
  it("sends every stored write again in order, since each may have reached Trakt before the app stopped", async () => {
    const seed = new WriteQueue(harness(ok).deps);
    seed.enqueue(mark("a", 1));
    seed.enqueue(mark("b", 2));
    const stored = JSON.parse(JSON.stringify(seed.snapshot())) as QueuedOp[];

    const h = harness(ok);
    const q = new WriteQueue(h.deps, stored);
    q.enqueue(unmark("c", 1));
    expect(q.size).toBe(3);
    await q.flush();
    expect(outcomes(q, "a", "b", "c")).toEqual(["done", "done", "done"]);
  });
});
