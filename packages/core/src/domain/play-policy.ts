import { isAdditiveOp } from "./write-queue/ops";
import type { WriteReceipt } from "./write-queue/receipt";
import type { QueuedOp } from "./write-queue/types";

// Trakt's "Multiple Plays" account setting, which the API never exposes. Learned from write receipts:
// with it off, a play posted for a watched item replaces that item's play and Trakt answers "updated".
export type PlayPolicy = "unknown" | "one-play" | "multiple";

export const PLAY_POLICIES: readonly PlayPolicy[] = ["unknown", "one-play", "multiple"];

export function learnPlayPolicy(
  current: PlayPolicy,
  op: QueuedOp,
  receipt: WriteReceipt,
): PlayPolicy {
  if (op.request.path !== "/sync/history") return current;
  if (receipt.updated > 0) return "one-play";
  // An additive play is only ever posted for an item that already has one.
  if (isAdditiveOp(op) && receipt.added > 0) return "multiple";
  return current;
}
