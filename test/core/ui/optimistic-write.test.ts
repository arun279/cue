import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WriteOutcome } from "@/core/domain/write-queue/queue";
import type { QueuedOp } from "@/core/domain/write-queue/types";
import { applyOptimisticWrite, type WriteGateway } from "@/core/hooks/optimistic-write";
import type { SubmitOutcome } from "@/core/runtime/runtime";
import { resetWriteLocks, whenNoWritePending } from "@/core/stores/write-locks";

const SHOW_1 = { kind: "show", id: 1 } as const;
const SHOW_2 = { kind: "show", id: 2 } as const;

/** A minimal op whose `id` doubles as a label so a fake submit can record order. */
function op(id: string): QueuedOp {
  return {
    id,
    itemKey: id,
    request: { method: "POST", path: "/sync/history", body: {} },
    inverse: { method: "POST", path: "/sync/history/remove", body: {} },
    watchedAt: null,
    fromState: "absent",
    toState: "present",
  };
}

/** A gateway whose submits answer `outcomes` in turn, and whose kept writes end when `end` says. */
function writer(outcomes: readonly SubmitOutcome[]) {
  const seen: string[] = [];
  const endings = new Map<string, (outcome: WriteOutcome) => void>();
  const settlements = new Map<string, Promise<WriteOutcome>>();
  const settled = (opId: string): Promise<WriteOutcome> => {
    const settlement =
      settlements.get(opId) ?? new Promise<WriteOutcome>((resolve) => endings.set(opId, resolve));
    settlements.set(opId, settlement);
    return settlement;
  };
  const finish = (opId: string, outcome: WriteOutcome): void => {
    void settled(opId);
    endings.get(opId)?.(outcome);
  };
  const gateway: WriteGateway = {
    submit: (queued) => {
      seen.push(`${queued.id}@${queued.target?.kind}:${queued.target?.id}`);
      const outcome = outcomes[seen.length - 1] ?? "done";
      if (outcome !== "deferred") finish(queued.id, outcome);
      return Promise.resolve(outcome);
    },
    settled,
  };
  const end = async (opId: string, outcome: WriteOutcome): Promise<void> => {
    finish(opId, outcome);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { gateway, seen, end };
}

/** Drives the seam with one op per queued outcome; reports the settled outcome and the read back. */
async function exercise(outcomes: readonly SubmitOutcome[]) {
  const { gateway, seen, end } = writer(outcomes);
  const revalidate = vi.fn();
  const ops = outcomes.map((_, n) => op(`op-${n}`));
  const outcome = await applyOptimisticWrite(gateway, SHOW_1, ops, revalidate);
  return { outcome, revalidate, seen, end };
}

beforeEach(() => {
  resetWriteLocks();
});

interface Case {
  readonly name: string;
  readonly outcomes: readonly SubmitOutcome[];
  readonly settled: SubmitOutcome;
  readonly revalidated: boolean;
}

// A write settles to its worst op (failed > deferred > cancelled > done). What was written is read
// back once every op has ended and one of them landed; a refused op is read back by the runtime.
const cases: readonly Case[] = [
  { name: 'single "done" reads back', outcomes: ["done"], settled: "done", revalidated: true },
  {
    name: 'single "deferred" waits for the write',
    outcomes: ["deferred"],
    settled: "deferred",
    revalidated: false,
  },
  {
    name: 'single "failed" leaves the read back to the runtime',
    outcomes: ["failed"],
    settled: "failed",
    revalidated: false,
  },
  {
    name: 'all "done" reads back once',
    outcomes: ["done", "done"],
    settled: "done",
    revalidated: true,
  },
  {
    name: 'a "deferred" write holds off the read back',
    outcomes: ["done", "deferred"],
    settled: "deferred",
    revalidated: false,
  },
  {
    name: "a write that landed beside a refused one is read back",
    outcomes: ["done", "failed"],
    settled: "failed",
    revalidated: true,
  },
  {
    name: '"failed" beats "deferred"',
    outcomes: ["deferred", "failed"],
    settled: "failed",
    revalidated: false,
  },
  {
    name: 'single "cancelled" leaves the state its opposite set',
    outcomes: ["cancelled"],
    settled: "cancelled",
    revalidated: false,
  },
  {
    name: "a write that landed beside a cancelled one is read back",
    outcomes: ["done", "cancelled"],
    settled: "cancelled",
    revalidated: true,
  },
];

describe("applyOptimisticWrite: the shared write seam", () => {
  it.each(cases)("$name", async ({ outcomes, settled, revalidated }) => {
    const result = await exercise(outcomes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.outcome).toBe(settled);
    expect(result.revalidate).toHaveBeenCalledTimes(revalidated ? 1 : 0);
  });

  it("submits every op exactly once, in order, each naming the show it changes", async () => {
    const { seen } = await exercise(["done", "done", "done"]);
    expect(seen).toEqual(["op-0@show:1", "op-1@show:1", "op-2@show:1"]);
  });

  it("reads back only once no other write to the same show is pending, and then for all of them", async () => {
    const { gateway, end } = writer(["done", "deferred", "done"]);
    const reads = { first: vi.fn(), second: vi.fn(), other: vi.fn() };
    const first = applyOptimisticWrite(gateway, SHOW_1, [op("a")], reads.first);
    const second = applyOptimisticWrite(gateway, SHOW_1, [op("b")], reads.second);
    await applyOptimisticWrite(gateway, SHOW_2, [op("c")], reads.other);
    await Promise.all([first, second]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reads.first).not.toHaveBeenCalled();
    expect(reads.other).toHaveBeenCalledTimes(1);
    await end("b", "done");
    expect(reads.first).toHaveBeenCalledTimes(1);
    expect(reads.second).toHaveBeenCalledTimes(1);
  });

  it("reads a list of many shows only once no write to any show is pending", async () => {
    const { gateway, end } = writer(["deferred"]);
    await applyOptimisticWrite(gateway, SHOW_2, [op("a")], vi.fn());
    const read = vi.fn();
    whenNoWritePending(read);
    expect(read).not.toHaveBeenCalled();
    await end("a", "done");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads back once a kept write lands later", async () => {
    const { revalidate, end } = await exercise(["deferred"]);
    await end("op-0", "done");
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("leaves a kept write that an opposite write cancels later alone", async () => {
    const { revalidate, end } = await exercise(["deferred"]);
    await end("op-0", "cancelled");
    expect(revalidate).not.toHaveBeenCalled();
  });
});
