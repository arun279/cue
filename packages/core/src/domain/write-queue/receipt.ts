import { isAdditiveOp } from "./ops";
import type { QueuedOp } from "./types";

export interface WriteReceipt {
  readonly added: number;
  readonly updated: number;
  readonly deleted: number;
  readonly existing: number;
  readonly notFound: number;
}

export function receiptApplied(receipt: WriteReceipt): boolean {
  const changed = receipt.added + receipt.updated + receipt.deleted + receipt.existing;
  return changed > 0 || receipt.notFound === 0;
}

export function replacedPlays(receipt: WriteReceipt | null): number {
  return receipt?.updated ?? 0;
}

export type PlayPolicy = "unknown" | "one-play" | "multiple";

export function learnPlayPolicy(
  current: PlayPolicy,
  op: QueuedOp,
  receipt: WriteReceipt,
): PlayPolicy {
  if (op.request.path !== "/sync/history") return current;
  if (receipt.updated > 0) return "one-play";
  if (isAdditiveOp(op) && receipt.added > 0) return "multiple";
  return current;
}
