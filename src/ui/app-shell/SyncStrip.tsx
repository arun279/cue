import { useSyncActivity } from "@ui/hooks/sync-activity-store";
import { useIsOffline } from "@ui/hooks/useIsOffline";
import { type ReactElement, useEffect, useState } from "react";

interface SyncStripProps {
  /** The screen's change-driven read failed (same signal the query hands the pill). */
  readonly isError: boolean;
  /** Re-runs the failed read; renders the trailing Retry only when provided. */
  readonly onRetry?: () => void;
}

/** Marks in flight before the strip bothers the user, and for how long they
 * must stay in flight: a brief burst (binge-marking on good network) flushes
 * inside the grace window and never surfaces. */
const PENDING_THRESHOLD = 3;
const PENDING_GRACE_MS = 5000;

/** True once the write-queue has held ≥3 in-flight marks for >5s. */
function usePendingLate(): { late: boolean; pending: number } {
  const pending = useSyncActivity((state) => state.pending);
  const backedUp = pending >= PENDING_THRESHOLD;
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!backedUp) {
      setLate(false);
      return;
    }
    const timer = setTimeout(() => setLate(true), PENDING_GRACE_MS);
    return () => clearTimeout(timer);
  }, [backedUp]);
  return { late: late && backedUp, pending };
}

/**
 * Ambient sync state, rendered directly under a screen header: nothing at all
 * while healthy (silence means synced), one 32px strip when abnormal. Offline
 * outranks error (an offline device always fails its reads, and "your marks are
 * saved" is the honest message); error outranks a pending backlog.
 */
export function SyncStrip({ isError, onRetry }: SyncStripProps): ReactElement | null {
  const offline = useIsOffline();
  const { late, pending } = usePendingLate();
  const state = offline ? "offline" : isError ? "error" : late ? "pending" : null;
  if (state === null) return null;

  const message =
    state === "offline"
      ? "Offline — your marks are saved"
      : state === "error"
        ? "Trakt unreachable — showing your cached data"
        : `${pending} marks pending — will sync`;

  return (
    <div className="sync-strip" role="status" data-state={state} data-testid="sync-strip">
      <span className="sync-strip__dot" aria-hidden="true" />
      <span className="sync-strip__text">{message}</span>
      {state === "error" && onRetry !== undefined && (
        <button type="button" className="sync-strip__retry" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
