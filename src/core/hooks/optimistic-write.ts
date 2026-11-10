import type { WriteOutcome } from "../domain/write-queue/queue";
import type { QueuedOp } from "../domain/write-queue/types";
import type { SubmitOutcome } from "../runtime/runtime";
import { beginWrite, endWrite } from "../stores/write-locks";

/** How the UI writes: neither call settles once the write's session has ended. */
export interface WriteGateway {
  submit(op: QueuedOp): Promise<SubmitOutcome>;
  settled(opId: string): Promise<WriteOutcome>;
}

const WORST_FIRST: readonly SubmitOutcome[] = ["failed", "deferred", "cancelled", "done"];

const worse = (a: SubmitOutcome, b: SubmitOutcome): SubmitOutcome =>
  WORST_FIRST.indexOf(a) < WORST_FIRST.indexOf(b) ? a : b;

/**
 * Queues every write before any is sent, so each is weighed against the queue as it stood. What was
 * written to `target` is read back once every write has ended, one of them landed, and no other
 * write to `target` is still pending: the last to end reads back for all of them. A write Trakt
 * refuses is read back by the runtime.
 */
export async function applyOptimisticWrite(
  gateway: WriteGateway,
  target: string,
  ops: readonly QueuedOp[],
  revalidate: () => void,
): Promise<SubmitOutcome> {
  beginWrite(target);
  const answers = await Promise.all(
    ops.map(async (op) => [op.id, await gateway.submit({ ...op, target })] as const),
  );
  void Promise.all(
    answers.map(([id, outcome]) => (outcome === "deferred" ? gateway.settled(id) : outcome)),
  ).then((ended) => endWrite(target, ended.includes("done") ? revalidate : null));
  return answers.map(([, outcome]) => outcome).reduce(worse, "done");
}
