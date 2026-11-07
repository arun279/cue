import { isAdditiveOp, markedEpisodesOf } from "./ops";
import type { QueuedOp } from "./types";

export interface WriteReceipt {
  readonly added: number;
  readonly updated: number;
  readonly deleted: number;
  readonly existing: number;
  readonly notFound: number;
}

/**
 * Whether Trakt changed anything. One that changed nothing, as when a write is sent again after its
 * answer was lost, says nothing about what the earlier send did.
 */
export const receiptChanged = (receipt: WriteReceipt): boolean =>
  receipt.added + receipt.updated + receipt.deleted + receipt.existing > 0;

export function receiptApplied(receipt: WriteReceipt): boolean {
  return receiptChanged(receipt) || receipt.notFound === 0;
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
  const marked = markedEpisodesOf(op);
  const replayedOneWatched =
    isAdditiveOp(op) && marked?.traktIds.size === 1 && marked.positions.size === 0;
  return replayedOneWatched && receipt.added === 1 ? "multiple" : current;
}
