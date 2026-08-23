import type { QueuedOp } from "./types";

/**
 * Collapse a redundant op against the pending queue: a rapid toggle on one
 * item settles to its net state. A pending op with the same `itemKey` that ends
 * in the same state as the incoming op makes the incoming op redundant (kept
 * once); one that ends in the opposite state cancels: both vanish, returning
 * the item to its original state.
 */
export function coalesce(pending: readonly QueuedOp[], incoming: QueuedOp): QueuedOp[] {
  const idx = pending.findIndex((op) => op.itemKey === incoming.itemKey);
  const existing = idx === -1 ? undefined : pending[idx];
  if (existing === undefined) return [...pending, incoming];
  if (existing.toState === incoming.toState) return [...pending];
  return [...pending.slice(0, idx), ...pending.slice(idx + 1)];
}
