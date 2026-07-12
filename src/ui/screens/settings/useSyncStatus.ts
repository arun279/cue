import { useQueryClient } from "@tanstack/react-query";
import { dismissSnack, showSnack } from "@ui/components/snackbar-store";
import { applyReconcile } from "@ui/hooks/apply-reconcile";
import { useSyncActivity } from "@ui/hooks/sync-activity-store";
import { useRuntime } from "@ui/runtime/runtime";
import { useCallback, useEffect, useState } from "react";
import { newestSyncedAt, syncStatusLine } from "./sync-status";

/** How often the "N min ago" phrase re-renders while the screen is open. */
const TICK_MS = 30_000;

interface SyncStatus {
  /** `Last synced 2 min ago · 0 pending` */
  readonly line: string;
  /** Durable ops still awaiting Trakt (deferred writes included). */
  readonly pending: number;
  readonly syncing: boolean;
  syncNow(): Promise<void>;
}

/**
 * The Settings ▸ Data view over the sync machinery that already exists: the
 * status line derives from the query cache's freshness plus the write-queue's
 * in-flight counter, and `syncNow` runs one manual pass of the same
 * `/sync/last_activities` reconcile the background poll drives — invalidate
 * exactly the changed keys, and advance the baseline only after those queries
 * refetched cleanly (a failed refetch must be re-detected next pass, never
 * silently skipped). A clean pass with zero changes still counts as "synced
 * just now": server and device agreeing IS the sync.
 */
export function useSyncStatus(): SyncStatus {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  // Re-render signal only: any flush activity means the durable count may have
  // moved. The count itself reads the queue's snapshot, so a mark deferred
  // offline stays counted until it truly lands (never "0 pending" by omission).
  useSyncActivity((state) => state.pending);
  const pending = runtime.pendingWrites();
  const [syncing, setSyncing] = useState(false);
  const [checkedAt, setCheckedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const syncNow = useCallback(async (): Promise<void> => {
    setSyncing(true);
    try {
      // Land our own writes before asking what changed: a deferred mark must
      // flush here, not sit in the log behind a "synced just now" line.
      const remaining = await runtime.flushWrites();
      const reconcile = remaining === 0 ? await runtime.pollActivities() : null;
      if (reconcile === null) {
        showSnack({
          message: "Couldn't reach Trakt — check your connection.",
          actions: [{ label: "Dismiss", onPress: dismissSnack }],
        });
        return;
      }
      await applyReconcile(queryClient, reconcile);
      setCheckedAt(Date.now());
      setNow(Date.now());
    } finally {
      setSyncing(false);
    }
  }, [runtime, queryClient]);

  const syncedAt = Math.max(
    newestSyncedAt(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.state),
    ),
    checkedAt,
  );

  return { line: syncStatusLine(syncedAt, pending, now), pending, syncing, syncNow };
}
