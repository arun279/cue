import { parseWriteReceipt } from "../data/trakt/write-receipt";
import {
  learnPlayPolicy,
  type PlayPolicy,
  receiptApplied,
  type WriteReceipt,
} from "../domain/write-queue/receipt";
import type { DispatchResult, QueuedOp } from "../domain/write-queue/types";
import { createJsonStore } from "../ports/json-store";
import type { KeyValueStore } from "../ports/kv";
import { PLAY_POLICY_KEY } from "../ports/storage-keys";
import { usePlayPolicy } from "../stores/play-policy-store";

export interface WriteReceipts {
  settle(op: QueuedOp, result: DispatchResult): boolean;
  receiptOf(opId: string): WriteReceipt | null;
  clear(): Promise<void>;
}

export async function createWriteReceipts(kv: KeyValueStore): Promise<WriteReceipts> {
  const store = createJsonStore<PlayPolicy>(kv, PLAY_POLICY_KEY, (value) =>
    value === "one-play" || value === "multiple" ? value : "unknown",
  );
  usePlayPolicy.setState({ policy: (await store.read()) ?? "unknown" });
  const receipts = new Map<string, WriteReceipt>();

  return {
    settle(op, result) {
      const receipt = parseWriteReceipt(result.data);
      if (receipt === null) return true;
      receipts.set(op.id, receipt);
      const current = usePlayPolicy.getState().policy;
      const policy = learnPlayPolicy(current, op, receipt);
      if (policy !== current) {
        usePlayPolicy.setState({ policy });
        void store.write(policy);
      }
      return op.toState === "absent" || receiptApplied(receipt);
    },

    receiptOf: (opId) => receipts.get(opId) ?? null,

    async clear() {
      receipts.clear();
      usePlayPolicy.setState({ policy: "unknown" });
      await store.clear();
    },
  };
}
