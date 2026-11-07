import type { WriteOutcome } from "../domain/write-queue/queue";
import type { QueuedOp } from "../domain/write-queue/types";
import type { SubmitOutcome } from "../runtime/runtime";
import { dismissSnack, showSnack } from "../stores/snackbar-store";

export interface OptimisticEffects {
  rollback(): void;
  onKept?(): Promise<SubmitOutcome | null>;
  /** Reads back what the write touched: after it landed, or after Trakt refused it once kept. */
  revalidate(landed: boolean): void;
}

/** How the UI writes: neither call settles once the write's session has ended. */
export interface WriteGateway {
  submit(op: QueuedOp): Promise<SubmitOutcome>;
  settled(opId: string): Promise<WriteOutcome>;
}

const WORST_FIRST: readonly SubmitOutcome[] = ["failed", "deferred", "cancelled", "done"];

const settle = (a: SubmitOutcome, b: SubmitOutcome): SubmitOutcome =>
  WORST_FIRST.indexOf(a) < WORST_FIRST.indexOf(b) ? a : b;

/** Queues every write before any is sent, so each is weighed against the queue as it stood. */
export async function submitAll(
  submit: WriteGateway["submit"],
  ops: readonly QueuedOp[],
): Promise<SubmitOutcome> {
  return (await Promise.all(ops.map((op) => submit(op)))).reduce(settle, "done");
}

/** A write kept for later still rolls back and says so if Trakt refuses it, whatever screen is open by then. */
async function settleLater(
  settled: WriteGateway["settled"],
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
  if (outcome === "done" || outcome === "failed") effects.revalidate(outcome === "done");
}

export async function applyOptimisticWrite(
  gateway: WriteGateway,
  ops: readonly QueuedOp[],
  effects: OptimisticEffects,
): Promise<SubmitOutcome> {
  const outcome = await submitAll(gateway.submit, ops);
  if (outcome === "cancelled") return outcome;
  if (outcome === "failed") {
    effects.rollback();
    return outcome;
  }
  const kept = await effects.onKept?.();
  if (outcome === "done" && (kept == null || kept === "done")) effects.revalidate(true);
  if (outcome === "deferred") void settleLater(gateway.settled, ops, effects);
  return outcome;
}
