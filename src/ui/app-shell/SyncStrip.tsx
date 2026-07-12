import { useSyncActivity } from "@ui/hooks/sync-activity-store";
import { useIsOffline } from "@ui/hooks/useIsOffline";
import { useOptionalRuntime } from "@ui/runtime/runtime";
import { type ReactElement, useEffect, useState } from "react";

interface SyncStripProps {
  /** The screen's change-driven read failed (same signal the query hands the pill). */
  readonly isError: boolean;
  /** Re-runs the failed read; renders the trailing Retry only when provided. */
  readonly onRetry?: () => void;
}

/** Marks pending before the strip bothers the user, and for how long they
 * must stay pending: a brief burst (binge-marking on good network) flushes
 * inside the grace window and never surfaces. */
const PENDING_THRESHOLD = 3;
const PENDING_GRACE_MS = 5000;
/** Re-sample cadence for the durable queue while it holds ops: the op-log has
 * no subscription surface, and a background flush (poll, reconnect) drains it
 * without any in-flight transition to re-render on. */
const QUEUE_SAMPLE_MS = 1000;

/** True once ≥3 marks have been pending for >5s. Pending is the HIGHER of the
 * in-flight flush count and the durable queue depth: a mark deferred offline
 * sits in the op-log with nothing in flight, and it is still pending. */
function usePendingLate(): { late: boolean; pending: number } {
  const runtime = useOptionalRuntime();
  const inFlight = useSyncActivity((state) => state.pending);
  const durable = runtime?.pendingWrites() ?? 0;
  const pending = Math.max(inFlight, durable);
  const hasDurable = durable > 0;
  const [, setSample] = useState(0);
  useEffect(() => {
    if (!hasDurable) return;
    const timer = setInterval(() => setSample((tick) => tick + 1), QUEUE_SAMPLE_MS);
    return () => clearInterval(timer);
  }, [hasDurable]);

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
      ? "Offline. Your marks are saved."
      : state === "error"
        ? "Trakt unreachable. Showing your cached data."
        : `${pending} marks pending · will sync`;

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
