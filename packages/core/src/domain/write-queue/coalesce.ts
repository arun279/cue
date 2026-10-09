import type { QueuedOp } from "./types";

export function coalesce(pending: readonly QueuedOp[], incoming: QueuedOp): QueuedOp[] {
  const idx = pending.findIndex((op) => op.itemKey === incoming.itemKey);
  const existing = idx === -1 ? undefined : pending[idx];
  if (existing === undefined) return [...pending, incoming];
  if (existing.toState === incoming.toState) return [...pending];
  return [...pending.slice(0, idx), ...pending.slice(idx + 1)];
}
