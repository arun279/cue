import { useCallback, useState } from "react";
import type { QueuedOp } from "../domain/write-queue/types";
import { useOptimisticWrite } from "./useOptimisticWrite";

export interface QueuedWrite {
  /**
   * Submit an already-optimistically-applied op through the shared write seam. A
   * hard failure runs `rollback` and raises `message`; a settled ("done") write
   * runs `revalidate`; a still-durable ("deferred") write keeps the optimistic
   * state and does neither: so a queued write never triggers a refetch that would
   * read pre-write server state and bounce the caller's UI.
   */
  run(op: QueuedOp, rollback: () => void, message: string, revalidate: () => void): Promise<void>;
  readonly error: string | null;
  clearError(): void;
}

/**
 * The shared optimistic-write tail (hot path) for the lighter actions:
 * calendar quick mark-watched and the search inline watchlist add. The caller
 * patches its own UI first, then hands the durable op here; the seam owns the one
 * correct outcome dispatch (rollback on fail, revalidate only on a landed write).
 * Reconcile/pacing/429 all live in the queue behind `runtime.submit`.
 */
export function useQueuedWrite(): QueuedWrite {
  const submit = useOptimisticWrite();
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (op: QueuedOp, rollback: () => void, message: string, revalidate: () => void) => {
      const outcome = await submit([op], { rollback, revalidate });
      if (outcome === "failed") setError(message);
    },
    [submit],
  );

  return { run, error, clearError: () => setError(null) };
}
