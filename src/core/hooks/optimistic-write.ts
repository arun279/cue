import type { WriteOutcome } from "../domain/write-queue/queue";
import type { QueuedOp } from "../domain/write-queue/types";
import type { SubmitOutcome } from "../runtime/runtime";
import { dismissSnack, showSnack } from "../stores/snackbar-store";
import { beginWrite, endWrite } from "../stores/write-locks";

/** A change shown at once, with the writes that make it on Trakt. */
export interface OptimisticChange {
  readonly ops: readonly QueuedOp[];
  /** Takes this change, and only this change, back on screen once Trakt refuses one of its writes. */
  revert(): void;
}

/** How the UI writes: neither call settles once the write's session has ended. */
export interface WriteGateway {
  submit(op: QueuedOp): Promise<SubmitOutcome>;
  settled(opId: string): Promise<WriteOutcome>;
}

type Outcomes = Map<QueuedOp, SubmitOutcome>;

const WORST_FIRST: readonly SubmitOutcome[] = ["failed", "deferred", "cancelled", "done"];

const worse = (a: SubmitOutcome, b: SubmitOutcome): SubmitOutcome =>
  WORST_FIRST.indexOf(a) < WORST_FIRST.indexOf(b) ? a : b;

const answered = (outcomes: Outcomes): boolean =>
  [...outcomes.values()].some((outcome) => outcome === "done" || outcome === "failed");

function revertRefused(
  changes: readonly OptimisticChange[],
  outcomes: Outcomes,
  reverted: Set<OptimisticChange>,
): boolean {
  const refused = changes.filter(
    (change) => !reverted.has(change) && change.ops.some((op) => outcomes.get(op) === "failed"),
  );
  for (const change of refused) {
    change.revert();
    reverted.add(change);
  }
  return refused.length > 0;
}

/** A write kept for later still rolls back and says so if Trakt refuses it, whatever screen is open by then. */
async function settleLater(
  settled: WriteGateway["settled"],
  changes: readonly OptimisticChange[],
  outcomes: Outcomes,
  reverted: Set<OptimisticChange>,
): Promise<void> {
  const kept = [...outcomes].filter(([, outcome]) => outcome === "deferred").map(([op]) => op);
  for (const op of kept) outcomes.set(op, await settled(op.id));
  if (revertRefused(changes, outcomes, reverted)) {
    showSnack({
      message: "Couldn't save an earlier change to Trakt.",
      actions: [{ label: "Dismiss", onPress: dismissSnack }],
    });
  }
}

/**
 * Queues every write before any is sent, so each is weighed against the queue as it stood. Each
 * change Trakt refuses a write of is taken back, the others stay. What was written to `target` is
 * read back once Trakt has answered every write, and no other write to `target` is still pending:
 * the last to settle reads back for all of them.
 */
export async function applyOptimisticWrite(
  gateway: WriteGateway,
  target: string,
  changes: readonly OptimisticChange[],
  revalidate: () => void,
): Promise<SubmitOutcome> {
  beginWrite(target);
  const outcomes: Outcomes = new Map();
  let later: Promise<void> | null = null;
  try {
    const ops = changes.flatMap((change) => change.ops);
    const answers = await Promise.all(
      ops.map(async (op) => [op, await gateway.submit(op)] as const),
    );
    for (const [op, outcome] of answers) outcomes.set(op, outcome);
    const reverted = new Set<OptimisticChange>();
    revertRefused(changes, outcomes, reverted);
    if ([...outcomes.values()].includes("deferred")) {
      later = settleLater(gateway.settled, changes, outcomes, reverted);
    }
    return [...outcomes.values()].reduce(worse, "done");
  } finally {
    const ended = (): void => endWrite(target, answered(outcomes) ? revalidate : null);
    if (later === null) ended();
    else void later.finally(ended);
  }
}
