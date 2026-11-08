import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WriteOutcome } from "@/core/domain/write-queue/queue";
import type { QueuedOp } from "@/core/domain/write-queue/types";
import { applyOptimisticWrite, type WriteGateway } from "@/core/hooks/optimistic-write";
import type { SubmitOutcome } from "@/core/runtime/runtime";
import { dismissSnack, useSnackbar } from "@/core/stores/snackbar-store";
import { resetWriteLocks, whenNoWritePending } from "@/core/stores/write-locks";

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
  const gateway: WriteGateway = {
    submit: (queued) => {
      seen.push(queued.id);
      return Promise.resolve(outcomes[seen.length - 1] ?? "done");
    },
    settled: (opId) => {
      const settlement =
        settlements.get(opId) ?? new Promise<WriteOutcome>((resolve) => endings.set(opId, resolve));
      settlements.set(opId, settlement);
      return settlement;
    },
  };
  const end = async (opId: string, outcome: WriteOutcome): Promise<void> => {
    void gateway.settled(opId);
    endings.get(opId)?.(outcome);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { gateway, seen, end };
}

/** Drive the seam with one change per queued outcome, each of one op; report the settled outcome,
 * the spies, and the ops actually submitted (in order). */
async function exercise(outcomes: readonly SubmitOutcome[]) {
  const { gateway, seen, end } = writer(outcomes);
  const reverts = outcomes.map(() => vi.fn());
  const revalidate = vi.fn();
  const changes = outcomes.map((_, n) => ({ ops: [op(`op-${n}`)], revert: reverts[n] ?? vi.fn() }));
  const outcome = await applyOptimisticWrite(gateway, "show:1", changes, revalidate);
  const reverted = () => reverts.flatMap((revert, n) => (revert.mock.calls.length > 0 ? [n] : []));
  return { outcome, reverts, reverted, revalidate, seen, end };
}

beforeEach(() => {
  dismissSnack();
  resetWriteLocks();
});

interface Case {
  readonly name: string;
  readonly outcomes: readonly SubmitOutcome[];
  readonly settled: SubmitOutcome;
  readonly reverted: readonly number[];
  readonly revalidated: boolean;
}

// A write settles to its worst op (failed > deferred > cancelled > done). Only the changes Trakt
// refused a write of are taken back, and what was written is read back once every op is answered.
const cases: readonly Case[] = [
  {
    name: 'single "done" revalidates, takes nothing back',
    outcomes: ["done"],
    settled: "done",
    reverted: [],
    revalidated: true,
  },
  {
    name: 'single "deferred" keeps the change: neither effect yet',
    outcomes: ["deferred"],
    settled: "deferred",
    reverted: [],
    revalidated: false,
  },
  {
    name: 'single "failed" takes its change back and reads back what Trakt has',
    outcomes: ["failed"],
    settled: "failed",
    reverted: [0],
    revalidated: true,
  },
  {
    name: 'all "done" revalidates once',
    outcomes: ["done", "done"],
    settled: "done",
    reverted: [],
    revalidated: true,
  },
  {
    name: 'a "deferred" write holds off the read back',
    outcomes: ["done", "deferred"],
    settled: "deferred",
    reverted: [],
    revalidated: false,
  },
  {
    name: 'a "failed" write takes back only its own change',
    outcomes: ["done", "failed"],
    settled: "failed",
    reverted: [1],
    revalidated: true,
  },
  {
    name: '"failed" beats "deferred", and the deferred change stays',
    outcomes: ["deferred", "failed"],
    settled: "failed",
    reverted: [1],
    revalidated: false,
  },
  {
    name: 'single "cancelled" leaves the state its opposite set: neither effect',
    outcomes: ["cancelled"],
    settled: "cancelled",
    reverted: [],
    revalidated: false,
  },
  {
    name: "a write that landed beside a cancelled one is read back",
    outcomes: ["done", "cancelled"],
    settled: "cancelled",
    reverted: [],
    revalidated: true,
  },
];

describe("applyOptimisticWrite: the shared write seam", () => {
  it.each(cases)("$name", async ({ outcomes, settled, reverted, revalidated }) => {
    const result = await exercise(outcomes);
    expect(result.outcome).toBe(settled);
    expect(result.reverted()).toEqual(reverted);
    expect(result.revalidate).toHaveBeenCalledTimes(revalidated ? 1 : 0);
  });

  it("submits every op exactly once, in order", async () => {
    const { seen } = await exercise(["done", "done", "done"]);
    expect(seen).toEqual(["op-0", "op-1", "op-2"]);
  });

  it("takes a change back once when Trakt refuses more than one of its writes", async () => {
    const { gateway, end } = writer(["failed", "deferred"]);
    const revert = vi.fn();
    await applyOptimisticWrite(gateway, "show:1", [{ ops: [op("a"), op("b")], revert }], vi.fn());
    await end("b", "failed");
    expect(revert).toHaveBeenCalledTimes(1);
  });

  it("takes back only the change refused later, reads back once and says so", async () => {
    const { outcome, reverted, revalidate, end } = await exercise(["deferred", "deferred"]);
    expect(outcome).toBe("deferred");
    await end("op-0", "done");
    expect(reverted()).toEqual([]);
    await end("op-1", "failed");
    expect(reverted()).toEqual([1]);
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(useSnackbar.getState().snack?.message).toBe("Couldn't save an earlier change to Trakt.");
  });

  it("reads back only once no other write to the same show is pending, and then for all of them", async () => {
    const { gateway, end } = writer(["done", "deferred", "done"]);
    const reads = { first: vi.fn(), second: vi.fn(), other: vi.fn() };
    const change = (id: string) => [{ ops: [op(id)], revert: vi.fn() }];
    const first = applyOptimisticWrite(gateway, "show:1", change("a"), reads.first);
    const second = applyOptimisticWrite(gateway, "show:1", change("b"), reads.second);
    await applyOptimisticWrite(gateway, "show:2", change("c"), reads.other);
    await Promise.all([first, second]);
    expect(reads.first).not.toHaveBeenCalled();
    expect(reads.other).toHaveBeenCalledTimes(1);
    await end("b", "done");
    expect(reads.first).toHaveBeenCalledTimes(1);
    expect(reads.second).toHaveBeenCalledTimes(1);
  });

  it("lets the next write to a show read back after a write to it could not be queued", async () => {
    const failing: WriteGateway = {
      ...writer([]).gateway,
      submit: () => Promise.reject(new Error("full")),
    };
    const change = [{ ops: [op("a")], revert: vi.fn() }];
    await expect(applyOptimisticWrite(failing, "show:1", change, vi.fn())).rejects.toThrow("full");
    const read = vi.fn();
    await applyOptimisticWrite(writer(["done"]).gateway, "show:1", change, read);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads a list of many shows only once no write to any show is pending", async () => {
    const { gateway, end } = writer(["deferred"]);
    await applyOptimisticWrite(gateway, "show:2", [{ ops: [op("a")], revert: vi.fn() }], vi.fn());
    const read = vi.fn();
    whenNoWritePending(read);
    expect(read).not.toHaveBeenCalled();
    await end("a", "done");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("refetches once a kept write lands later", async () => {
    const { reverted, revalidate, end } = await exercise(["deferred"]);
    await end("op-0", "done");
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(reverted()).toEqual([]);
  });

  it("leaves a kept write that an opposite write cancels later alone", async () => {
    const { reverted, revalidate, end } = await exercise(["deferred"]);
    await end("op-0", "cancelled");
    expect(reverted()).toEqual([]);
    expect(revalidate).not.toHaveBeenCalled();
    expect(useSnackbar.getState().snack).toBeNull();
  });
});
