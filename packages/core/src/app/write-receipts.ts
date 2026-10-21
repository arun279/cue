import { parseWriteReceipt } from "../data/trakt/write-receipt";
import { learnPlayPolicy, PLAY_POLICIES, type PlayPolicy } from "../domain/play-policy";
import { receiptApplied, type WriteReceipt } from "../domain/write-queue/receipt";
import type { DispatchResult, QueuedOp } from "../domain/write-queue/types";
import { createJsonStore } from "../ports/json-store";
import type { KeyValueStore } from "../ports/kv";
import { PLAY_POLICY_KEY } from "../ports/storage-keys";
import { usePlayPolicy } from "../stores/play-policy-store";

const KEPT_RECEIPTS = 200;

export interface WriteReceipts {
  // The queue's accept hook: an add Trakt answered without applying anything did not land.
  accept(op: QueuedOp, result: DispatchResult): boolean;
  record(ops: readonly QueuedOp[], delivered: ReadonlyMap<string, DispatchResult>): Promise<void>;
  receiptOf(opId: string): WriteReceipt | null;
  clear(): Promise<void>;
}

export async function createWriteReceipts(kv: KeyValueStore): Promise<WriteReceipts> {
  const store = createJsonStore<PlayPolicy>(kv, PLAY_POLICY_KEY, (value) =>
    PLAY_POLICIES.includes(value as PlayPolicy) ? (value as PlayPolicy) : "unknown",
  );
  usePlayPolicy.setState({ policy: (await store.read()) ?? "unknown" });
  const receipts = new Map<string, WriteReceipt>();

  return {
    accept(op, result) {
      if (op.toState === "absent") return true;
      const receipt = parseWriteReceipt(result.data);
      return receipt === null || receiptApplied(receipt);
    },

    async record(ops, delivered) {
      let policy = usePlayPolicy.getState().policy;
      for (const op of ops) {
        const result = delivered.get(op.id);
        const receipt = result === undefined ? null : parseWriteReceipt(result.data);
        if (receipt === null) continue;
        receipts.set(op.id, receipt);
        policy = learnPlayPolicy(policy, op, receipt);
      }
      for (const id of [...receipts.keys()].slice(0, Math.max(0, receipts.size - KEPT_RECEIPTS))) {
        receipts.delete(id);
      }
      if (policy !== usePlayPolicy.getState().policy) {
        usePlayPolicy.setState({ policy });
        await store.write(policy);
      }
    },

    receiptOf: (opId) => receipts.get(opId) ?? null,

    async clear() {
      receipts.clear();
      usePlayPolicy.setState({ policy: "unknown" });
      await store.clear();
    },
  };
}
