import { useEffect, useState, useSyncExternalStore } from "react";
import { readsPausedUntil, subscribeReadPause } from "../data/trakt/read-budget";
import type { QueryStatus } from "../queries/freshness";
import { useOptionalRuntime } from "../runtime/runtime";
import { useSyncActivity } from "../stores/sync-activity-store";
import { PENDING_GRACE_MS, PENDING_THRESHOLD, type SyncBanner, syncBanner } from "../sync-contract";
import { useIsOffline } from "./useIsOffline";

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
