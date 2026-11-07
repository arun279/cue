import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueuedOp } from "@/core/domain/write-queue/types";
import { applyOptimisticWrite } from "@/core/hooks/optimistic-write";
import type { CueRuntime, SubmitOutcome } from "@/core/runtime/runtime";
import { dismissSnack, useSnackbar } from "@/core/stores/snackbar-store";

type Settled = Awaited<ReturnType<CueRuntime["settled"]>>;

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

/** A runtime whose submits answer `outcomes` in turn, and whose kept writes end when `end` says. */
function writer(outcomes: readonly SubmitOutcome[]) {
  const seen: string[] = [];
  const endings = new Map<string, (outcome: Settled) => void>();
  const settlements = new Map<string, Promise<Settled>>();
  const runtime: Pick<CueRuntime, "submit" | "settled"> = {
    submit: (queued) => {
      seen.push(queued.id);
      return Promise.resolve(outcomes[seen.length - 1] ?? "done");
    },
    settled: (opId) => {
      const settlement =
        settlements.get(opId) ?? new Promise<Settled>((resolve) => endings.set(opId, resolve));
      settlements.set(opId, settlement);
      return settlement;
    },
  };
  const end = async (opId: string, outcome: Settled): Promise<void> => {
    void runtime.settled(opId);
    endings.get(opId)?.(outcome);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { runtime, seen, end };
}

/** Drive the seam over one op per queued outcome; report the settled outcome, the
 * effect spies, and the ops actually submitted (in order). */
async function exercise(outcomes: readonly SubmitOutcome[]) {
  const { runtime, seen, end } = writer(outcomes);
  const rollback = vi.fn();
  const revalidate = vi.fn();
  const ops = outcomes.map((_, n) => op(`op-${n}`));
  const outcome = await applyOptimisticWrite(runtime, ops, { rollback, revalidate });
  return { outcome, rollback, revalidate, seen, end };
}

/** Drive the seam with an `onKept` follow-up that itself settles to `keptOutcome`
 * (or does no write when omitted), recording the order the effects fired plus the
 * batch outcome the seam returns to the caller. */
async function exerciseKept(
  primary: SubmitOutcome,
  keptOutcome?: SubmitOutcome,
): Promise<{ order: string[]; outcome: SubmitOutcome }> {
  const order: string[] = [];
  const rollback = vi.fn(() => void order.push("rollback"));
  const onKept = vi.fn(() => {
    order.push("onKept");
    return Promise.resolve(keptOutcome ?? null);
  });
  const revalidate = vi.fn(() => void order.push("revalidate"));
  const outcome = await applyOptimisticWrite(writer([primary]).runtime, [op("a")], {
    rollback,
    onKept,
    revalidate,
  });
  return { order, outcome };
}

beforeEach(dismissSnack);

interface Case {
  readonly name: string;
  readonly outcomes: readonly SubmitOutcome[];
  readonly settled: SubmitOutcome;
  readonly rolledBack: boolean;
  readonly revalidated: boolean;
}

// A batch settles to its worst op (failed > deferred > cancelled > done): roll back iff any op
// hard-fails, revalidate iff every op lands, keep the optimistic state on deferred.
const cases: readonly Case[] = [
  {
    name: 'single "done" revalidates, never rolls back',
    outcomes: ["done"],
    settled: "done",
    rolledBack: false,
    revalidated: true,
  },
  {
    name: 'single "deferred" keeps optimistic: neither effect',
    outcomes: ["deferred"],
    settled: "deferred",
    rolledBack: false,
    revalidated: false,
  },
  {
    name: 'single "failed" rolls back, never revalidates',
    outcomes: ["failed"],
    settled: "failed",
    rolledBack: true,
    revalidated: false,
  },
  {
    name: 'batch all "done" revalidates once',
    outcomes: ["done", "done"],
    settled: "done",
    rolledBack: false,
    revalidated: true,
  },
  {
    name: 'batch with a "deferred" keeps optimistic (no revalidate)',
    outcomes: ["done", "deferred"],
    settled: "deferred",
    rolledBack: false,
    revalidated: false,
  },
  {
    name: 'batch with a "failed" rolls the whole batch back',
    outcomes: ["done", "failed"],
    settled: "failed",
    rolledBack: true,
    revalidated: false,
  },
  {
    name: '"failed" beats "deferred" in a batch',
    outcomes: ["deferred", "failed"],
    settled: "failed",
    rolledBack: true,
    revalidated: false,
  },
  {
    name: 'single "cancelled" leaves the state its opposite set: neither effect',
    outcomes: ["cancelled"],
    settled: "cancelled",
    rolledBack: false,
    revalidated: false,
  },
  {
    name: 'a batch with a "cancelled" write is not refetched',
    outcomes: ["done", "cancelled"],
    settled: "cancelled",
    rolledBack: false,
    revalidated: false,
  },
];

describe("applyOptimisticWrite: the shared write seam", () => {
  it.each(cases)("$name", async ({ outcomes, settled, rolledBack, revalidated }) => {
    const { outcome, rollback, revalidate } = await exercise(outcomes);
    expect(outcome).toBe(settled);
    expect(rollback).toHaveBeenCalledTimes(rolledBack ? 1 : 0);
    expect(revalidate).toHaveBeenCalledTimes(revalidated ? 1 : 0);
  });

  it("submits every op in a batch exactly once, in order", async () => {
    const { seen } = await exercise(["done", "done", "done"]);
    expect(seen).toEqual(["op-0", "op-1", "op-2"]);
  });

  it('awaits onKept before revalidate on a landed ("done") write', async () => {
    expect((await exerciseKept("done")).order).toEqual(["onKept", "revalidate"]);
  });

  it('runs onKept but never revalidate when the write is "deferred"', async () => {
    expect((await exerciseKept("deferred")).order).toEqual(["onKept"]);
  });

  it('skips onKept and rolls back when the write "failed"', async () => {
    expect((await exerciseKept("failed")).order).toEqual(["rollback"]);
  });

  it('does nothing at all when the write\'s session "ended", whatever else the batch did', async () => {
    expect(await exerciseKept("ended")).toEqual({ order: [], outcome: "ended" });
    const batch = await exercise(["done", "ended", "failed"]);
    expect(batch.outcome).toBe("ended");
    expect(batch.rollback).not.toHaveBeenCalled();
    expect(batch.revalidate).not.toHaveBeenCalled();
  });

  it('holds off revalidate when the follow-up is still "deferred", even on a landed batch', async () => {
    const { order, outcome } = await exerciseKept("done", "deferred");
    expect(order).toEqual(["onKept"]);
    expect(outcome).toBe("done");
  });

  it("a failed follow-up holds off revalidate but never fails the landed batch", async () => {
    const { order, outcome } = await exerciseKept("done", "failed");
    expect(order).toEqual(["onKept"]);
    expect(outcome).toBe("done");
  });

  it('revalidates once both the batch and the follow-up land ("done")', async () => {
    const { order, outcome } = await exerciseKept("done", "done");
    expect(order).toEqual(["onKept", "revalidate"]);
    expect(outcome).toBe("done");
  });

  it("rolls back, refetches and says so when a kept write is refused later", async () => {
    const { outcome, rollback, revalidate, end } = await exercise(["done", "deferred"]);
    expect(outcome).toBe("deferred");
    await end("op-0", "done");
    expect(rollback).not.toHaveBeenCalled();
    await end("op-1", "failed");
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(useSnackbar.getState().snack?.message).toBe("Couldn't save an earlier change to Trakt.");
  });

  it("refetches once a kept write lands later", async () => {
    const { rollback, revalidate, end } = await exercise(["deferred"]);
    await end("op-0", "done");
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(rollback).not.toHaveBeenCalled();
  });

  it.each([
    "cancelled",
    "ended",
  ] as const)('leaves a kept write that ends "%s" later alone', async (later) => {
    const { rollback, revalidate, end } = await exercise(["deferred"]);
    await end("op-0", later);
    expect(rollback).not.toHaveBeenCalled();
    expect(revalidate).not.toHaveBeenCalled();
    expect(useSnackbar.getState().snack).toBeNull();
  });
});
