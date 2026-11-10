import { describe, expect, it, vi } from "vitest";
import {
  buildAddEpisodePlayOp,
  buildMarkEpisodeOp,
  buildUndoAddOp,
  buildUnmarkEpisodeOp,
} from "@/core/domain/write-queue/ops";
import { type Settlement, WriteQueue, type WriteQueueDeps } from "@/core/domain/write-queue/queue";
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

function harness(
  answer: (req: unknown) => Promise<DispatchResult>,
  ownPlays: WriteQueueDeps["ownPlays"] = () => Promise.resolve([]),
): Harness {
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
    deps: {
      dispatch,
      sleep,
      now: clock.now,
      settle: () => "applied",
      ownPlays,
      save: async () => {},
      refused: () => {},
    },
    dispatch,
    clock,
    times,
    slept,
    sent: () => dispatch.mock.calls.map(([req]) => JSON.stringify(req)),
  };
}

const ok = () => Promise.resolve(dispatchResult(200));
const states = (q: WriteQueue, ...ids: string[]) => ids.map((id) => q.stateOf(id));

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
    expect(states(q, "a", "b", "c")).toEqual(["done", "done", "done"]);
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
    expect(q.stateOf("a")).toBe("done");
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
    expect(states(q, "a", "b")).toEqual(["failed", "done"]);
  });

  it("keeps a write through one flush of server errors, without a sleep after the last try", async () => {
    const h = harness(() => Promise.resolve(dispatchResult(500)));
    const q = new WriteQueue(h.deps, [mark("a", 1), mark("b", 2)]);
    await q.flush();
    expect(states(q, "a", "b")).toEqual(["sent", "sent"]);
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
    expect(states(q, "a", "b")).toEqual(["sent", "sent"]);
    await h.clock.sleep(60_000);
    await q.flush();
    expect(states(q, "a", "b")).toEqual(["failed", "done"]);
    await expect(q.settled("a")).resolves.toBe("failed");
    expect(q.size).toBe(0);
  });

  it("gives up on a write once it has been refused for five minutes, then waits out the pause before the next", async () => {
    const h = harness((req) =>
      Promise.resolve(
        JSON.stringify(req).includes('"trakt":1')
          ? dispatchResult(429, { "retry-after": "300" })
          : dispatchResult(200),
      ),
    );
    const q = new WriteQueue(h.deps, [mark("a", 1), mark("b", 2)]);
    await q.flush();
    expect(states(q, "a", "b")).toEqual(["failed", "done"]);
    expect(h.times).toEqual([0, 300_000, 600_000]);
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
    expect(states(q, "a", "b")).toEqual(["done", "done"]);
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
    const settle = (op: QueuedOp, result: DispatchResult): Settlement => {
      order.push(`settle ${op.id} ${JSON.stringify(result.data)}`);
      return "applied";
    };
    await new WriteQueue({ ...h.deps, settle }, [mark("a", 1), mark("b", 2)]).flush();
    expect(order).toEqual([
      "send a",
      'settle a {"added":{"episodes":1}}',
      "send b",
      'settle b {"added":{"episodes":1}}',
    ]);
  });

  it("tells settle whether Trakt answered a write's first send", async () => {
    const answers = [
      () => ok(),
      () => Promise.reject(new Error("network")),
      () => ok(),
      () => Promise.resolve(dispatchResult(503)),
      () => ok(),
      () => ok(),
    ];
    const h = harness(() => (answers.shift() ?? ok)());
    const firsts: [string, boolean][] = [];
    const settle = (op: QueuedOp, _result: DispatchResult, firstSend: boolean): Settlement => {
      firsts.push([op.id, firstSend]);
      return "applied";
    };
    const q = new WriteQueue({ ...h.deps, settle }, []);
    for (const id of ["a", "lost", "refused"]) q.enqueue(mark(id, id.length));
    await q.flush();
    await q.flush();
    await new WriteQueue({ ...h.deps, settle }, [mark("stored", 9)]).flush();
    expect(firsts).toEqual([
      ["a", true],
      ["lost", false],
      ["refused", false],
      ["stored", false],
    ]);
  });

  it("fails a write whose answer shows Trakt did not apply it", async () => {
    const h = harness(() => Promise.resolve(answered({ not_found: { episodes: [{}] } })));
    const q = new WriteQueue({ ...h.deps, settle: () => "refused" as const }, [mark("a", 1)]);
    await q.flush();
    expect(q.stateOf("a")).toBe("failed");
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
    expect(states(q, "a", "b")).toEqual(["done", "done"]);
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
    expect(states(q, "a", "b")).toEqual(["done", "done"]);
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

  it("counts a write as sent from the moment it goes until Trakt has answered it for good", async () => {
    const held = gate();
    const h = harness(() => held.answer);
    const q = new WriteQueue(h.deps);
    q.enqueue(mark("a", 1));
    expect(q.stateOf("a")).toBe("unsent");
    const flushed = q.flush();
    await vi.waitFor(() => expect(h.dispatch).toHaveBeenCalled());
    expect(q.stateOf("a")).toBe("sent");
    held.release(dispatchResult(200));
    await flushed;
    expect(q.stateOf("a")).toBe("done");
  });
});

describe("WriteQueue saving", () => {
  it("sends a write only once the device has kept it, and fails one it cannot keep", async () => {
    const h = harness(ok);
    let full: (error: Error) => void = () => {};
    const refused: string[] = [];
    const q = new WriteQueue({
      ...h.deps,
      save: () =>
        new Promise((_, reject) => {
          full = reject;
        }),
      refused: (op) => refused.push(op.id),
    });
    q.enqueue(mark("a", 1));
    const flushed = q.flush();
    await h.clock.sleep(0);
    expect(h.dispatch).not.toHaveBeenCalled();
    full(new Error("storage full"));
    await flushed;

    expect(q.stateOf("a")).toBe("failed");
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(refused).toEqual(["a"]);
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
    expect(q.stateOf("b")).toBe("unsent");
    await q.flush();
    expect(states(q, "a", "b")).toEqual(["done", "done"]);
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
    expect(states(q, "b", "c")).toEqual(["cancelled", "cancelled"]);
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
    expect(states(q, "a", "b", "c", "d", "e")).toEqual(["done", "done", "done", "done", "done"]);
  });
});

describe("WriteQueue taking back an add that may be on Trakt", () => {
  it("removes only the rows the add made, read once the add has gone", async () => {
    const order: string[] = [];
    const h = harness(ok, (undo) => {
      order.push(`read ${undo.undoes} at ${undo.watchedAt}`);
      return Promise.resolve([11, 12]);
    });
    h.dispatch.mockImplementation(async (req: unknown) => {
      order.push(`send ${JSON.stringify(req)}`);
      return dispatchResult(200);
    });
    const added = mark("a", 1);
    const q = new WriteQueue(h.deps, [added]);
    q.enqueue(buildUndoAddOp("undo", added));
    await q.flush();
    expect(order).toEqual([
      `send ${JSON.stringify(added.request)}`,
      `read a at ${WATCHED_AT}`,
      `send ${JSON.stringify({ method: "POST", path: "/sync/history/remove", body: { ids: [11, 12] } })}`,
    ]);
    expect(states(q, "a", "undo")).toEqual(["done", "done"]);
  });

  it("fails at once only the take-backs of an add that replaced an earlier play", async () => {
    const h = harness(ok, () => Promise.resolve([12]));
    const settle = (op: QueuedOp): Settlement => (op.id === "replacing" ? "replaced" : "applied");
    const replacing = mark("replacing", 1);
    const adding = mark("adding", 2);
    const q = new WriteQueue({ ...h.deps, settle }, [replacing, adding]);
    q.enqueue(buildUndoAddOp("undo-replacing", replacing));
    q.enqueue(buildUndoAddOp("undo-adding", adding));
    await q.flush();
    expect(states(q, "undo-replacing", "undo-adding")).toEqual(["failed", "done"]);
    expect(h.dispatch).toHaveBeenCalledTimes(3);
  });

  it("sends nothing when the add left no play to remove", async () => {
    const h = harness(ok);
    const added = mark("a", 1);
    const q = new WriteQueue(h.deps, [added]);
    q.enqueue(buildUndoAddOp("undo", added));
    await q.flush();
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(q.stateOf("undo")).toBe("done");
  });

  it("sends a take-back's removal only after it was saved, finding its plays again after a failed save", async () => {
    const order: string[] = [];
    const h = harness(ok, () => Promise.resolve([11]));
    h.dispatch.mockImplementation(async (req: unknown) => {
      order.push(`send ${JSON.stringify(req)}`);
      return dispatchResult(200);
    });
    let refusals = 1;
    const save = async (ops: readonly QueuedOp[]) => {
      if (!ops.some((op) => op.id === "undo" && op.undoes === undefined)) return;
      order.push(refusals > 0 ? "save refused" : "saved");
      refusals -= 1;
      if (refusals === 0) throw new Error("storage full");
    };
    const added = mark("a", 1);
    const q = new WriteQueue({ ...h.deps, save }, [added]);
    q.enqueue(buildUndoAddOp("undo", added));
    await q.flush();
    expect(states(q, "a", "undo")).toEqual(["done", "sent"]);
    await q.flush();
    expect(q.stateOf("undo")).toBe("done");
    expect(order).toEqual([
      `send ${JSON.stringify(added.request)}`,
      "save refused",
      "saved",
      `send ${JSON.stringify({ method: "POST", path: "/sync/history/remove", body: { ids: [11] } })}`,
    ]);
  });

  it("keeps the undo first in line while the add's history cannot be read", async () => {
    let readable = false;
    const h = harness(ok, () =>
      readable ? Promise.resolve([11]) : Promise.reject(new Error("offline")),
    );
    const added = mark("a", 1);
    const q = new WriteQueue(h.deps, [added]);
    q.enqueue(buildUndoAddOp("undo", added));
    await q.flush();
    expect(states(q, "a", "undo")).toEqual(["done", "sent"]);
    readable = true;
    await q.flush();
    expect(q.stateOf("undo")).toBe("done");
    expect(h.dispatch).toHaveBeenCalledTimes(2);
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
    expect(states(q, "a", "b", "c")).toEqual(["done", "done", "done"]);
  });
});
