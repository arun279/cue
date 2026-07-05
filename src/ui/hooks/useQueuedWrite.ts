import type { QueuedOp } from "@domain/write-queue/types";
import { useRuntime } from "@ui/runtime/runtime";
import { useCallback, useState } from "react";

export interface QueuedWrite {
  /**
   * Submit an already-optimistically-applied op. On a hard failure it runs
   * `rollback` and raises `message`; returns whether the write was accepted.
   */
  run(op: QueuedOp, rollback: () => void, message: string): Promise<boolean>;
  readonly error: string | null;
  clearError(): void;
}

/**
 * The shared optimistic-write tail (hot path) for the lighter actions —
 * calendar quick mark-watched and the search inline watchlist add. The caller
 * patches its own UI first, then hands the durable op here; a `failed` outcome
 * rolls the caller back and surfaces one recoverable error. Reconcile/pacing/429
 * all live in the queue behind `runtime.submit`.
 */
export function useQueuedWrite(): QueuedWrite {
  const runtime = useRuntime();
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (op: QueuedOp, rollback: () => void, message: string) => {
      const outcome = await runtime.submit(op);
      if (outcome === "failed") {
        rollback();
        setError(message);
        return false;
      }
      return true;
    },
    [runtime],
  );

  return { run, error, clearError: () => setError(null) };
}
