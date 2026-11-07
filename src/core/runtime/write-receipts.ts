import { parseWriteReceipt } from "../data/trakt/write-receipt";
import {
  learnPlayPolicy,
  type PlayPolicy,
  receiptApplied,
  receiptChanged,
  type WriteReceipt,
} from "../domain/write-queue/receipt";
import type { DispatchResult, QueuedOp } from "../domain/write-queue/types";
import { createJsonStore } from "../ports/json-store";
import type { KeyValueStore } from "../ports/kv";
import { PLAY_POLICY_KEY } from "../ports/storage-keys";
import { usePlayPolicy } from "../stores/play-policy-store";

export interface WriteReceipts {
  settle(op: QueuedOp, result: DispatchResult, firstSend: boolean): boolean;
  receiptOf(opId: string): WriteReceipt | null;
}

export async function createWriteReceipts(kv: KeyValueStore): Promise<WriteReceipts> {
  const store = createJsonStore<PlayPolicy>(kv, PLAY_POLICY_KEY, (value) =>
    value === "one-play" || value === "multiple" ? value : "unknown",
  );
  usePlayPolicy.setState({ policy: (await store.read()) ?? "unknown" });
  const receipts = new Map<string, WriteReceipt>();

  return {
    settle(op, result, firstSend) {
      const answer = parseWriteReceipt(result.data);
      if (answer === null) return true;
      const applied = op.toState === "absent" || receiptApplied(answer);
      // Trakt may answer a send that repeats an earlier one as if it added the play again.
      const receipt = firstSend ? answer : { ...answer, added: 0 };
      if (!receiptChanged(receipt)) return applied;
      receipts.set(op.id, receipt);
      const current = usePlayPolicy.getState().policy;
      const policy = learnPlayPolicy(current, op, receipt);
      if (policy !== current) {
        usePlayPolicy.setState({ policy });
        void store.write(policy);
      }
      return applied;
    },

    receiptOf: (opId) => receipts.get(opId) ?? null,
  };
}
