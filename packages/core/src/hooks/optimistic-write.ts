import type { QueuedOp } from "../domain/write-queue/types";
import type { SubmitOutcome } from "../runtime/runtime";

export interface OptimisticEffects {
  rollback(): void;
  onKept?(): Promise<SubmitOutcome | null>;
  revalidate(): void;
}

function settle(a: SubmitOutcome, b: SubmitOutcome): SubmitOutcome {
  if (a === "failed" || b === "failed") return "failed";
  if (a === "deferred" || b === "deferred") return "deferred";
  return "done";
}

export async function applyOptimisticWrite(
  submit: (op: QueuedOp) => Promise<SubmitOutcome>,
  ops: readonly QueuedOp[],
  effects: OptimisticEffects,
): Promise<SubmitOutcome> {
  let outcome: SubmitOutcome = "done";
  for (const op of ops) outcome = settle(outcome, await submit(op));
  if (outcome === "failed") {
    effects.rollback();
    return outcome;
  }
  const kept = await effects.onKept?.();
  if (outcome === "done" && (kept == null || kept === "done")) effects.revalidate();
  return outcome;
}
