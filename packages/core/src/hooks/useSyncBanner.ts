import { useEffect, useState, useSyncExternalStore } from "react";
import { readsPausedUntil, subscribeReadPause } from "../data/trakt/read-budget";
import { useOptionalRuntime } from "../runtime/runtime";
import { useSyncActivity } from "../stores/sync-activity-store";
import { PENDING_GRACE_MS, PENDING_THRESHOLD, type SyncBanner, syncBanner } from "../sync-contract";
import type { QueryStatus } from "./query-freshness";
import { useIsOffline } from "./useIsOffline";

/**
 * Coarse re-sample while something is outstanding. Neither the durable op-log
 * nor the shared rate-limit deadline has a transition to re-render on: a
 * background flush drains the log with nothing in flight, and a countdown is
 * just the clock moving. Only runs while there is something to count.
 */
const SAMPLE_MS = 1000;

function useClock(active: boolean): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick((n) => n + 1), SAMPLE_MS);
    return () => clearInterval(timer);
  }, [active]);
  return Date.now();
}

/** True once the backlog has stood past the grace window; false the moment it drains. */
function usePendingLate(backedUp: boolean): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!backedUp) {
      setLate(false);
      return;
    }
    const timer = setTimeout(() => setLate(true), PENDING_GRACE_MS);
    return () => clearTimeout(timer);
  }, [backedUp]);
  return late && backedUp;
}

/**
 * The one ambient sync signal, assembled for whichever screen asks: its own
 * change-driven read, this device's connectivity, the shared read pause and the
 * durable write backlog, folded by the contract into at most one line. Pending
 * is the HIGHER of the in-flight flush count and the durable queue depth: a mark
 * deferred offline sits in the op-log with nothing in flight, and it is still
 * pending.
 */
export function useSyncBanner(status: QueryStatus): SyncBanner | null {
  const runtime = useOptionalRuntime();
  const offline = useIsOffline();
  const resumeReadsAt = useSyncExternalStore(subscribeReadPause, readsPausedUntil);
  const inFlight = useSyncActivity((state) => state.pending);
  const pending = Math.max(inFlight, runtime?.pendingWrites() ?? 0);
  const now = useClock(pending > 0 || resumeReadsAt > Date.now());
  const pendingLate = usePendingLate(pending >= PENDING_THRESHOLD);

  return syncBanner({
    offline,
    failure: status.failure,
    retrying: status.retrying,
    hasData: status.hasData,
    resumeReadsAt,
    pending,
    pendingLate,
    now,
  });
}
