import type { QueuedOp } from "../domain/write-queue/types";
import type { CueRuntime, SubmitOutcome } from "../runtime/runtime";
import { dismissSnack, showSnack } from "../stores/snackbar-store";

export interface OptimisticEffects {
  rollback(): void;
  onKept?(): Promise<SubmitOutcome | null>;
  revalidate(): void;
}

/** Whether a write still stands, so offering to undo it makes sense. */
export const isKept = (outcome: SubmitOutcome): boolean =>
  outcome === "done" || outcome === "deferred";

const WORST_FIRST: readonly SubmitOutcome[] = ["ended", "failed", "deferred", "cancelled", "done"];

const settle = (a: SubmitOutcome, b: SubmitOutcome): SubmitOutcome =>
  WORST_FIRST.indexOf(a) < WORST_FIRST.indexOf(b) ? a : b;

export async function submitAll(
  submit: (op: QueuedOp) => Promise<SubmitOutcome>,
  ops: readonly QueuedOp[],
): Promise<SubmitOutcome> {
  let outcome: SubmitOutcome = "done";
  for (const op of ops) outcome = settle(outcome, await submit(op));
  return outcome;
}

/** A write kept for later still rolls back and says so if Trakt refuses it, whatever screen is open by then. */
async function settleLater(
  settled: CueRuntime["settled"],
  ops: readonly QueuedOp[],
  effects: OptimisticEffects,
): Promise<void> {
  const outcome = (await Promise.all(ops.map((op) => settled(op.id)))).reduce(settle, "done");
  if (outcome === "failed") {
    effects.rollback();
    showSnack({
      message: "Couldn't save an earlier change to Trakt.",
      actions: [{ label: "Dismiss", onPress: dismissSnack }],
    });
  }
  if (outcome === "done" || outcome === "failed") effects.revalidate();
}

export async function applyOptimisticWrite(
  runtime: Pick<CueRuntime, "submit" | "settled">,
  ops: readonly QueuedOp[],
  effects: OptimisticEffects,
): Promise<SubmitOutcome> {
  const outcome = await submitAll(runtime.submit, ops);
  if (outcome === "ended" || outcome === "cancelled") return outcome;
  if (outcome === "failed") {
    effects.rollback();
    return outcome;
  }
  const kept = await effects.onKept?.();
  if (outcome === "done" && (kept == null || kept === "done")) effects.revalidate();
  if (outcome === "deferred") void settleLater(runtime.settled, ops, effects);
  return outcome;
}
