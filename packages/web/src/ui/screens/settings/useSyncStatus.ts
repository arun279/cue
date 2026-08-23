import { queryKeys } from "@cue/core/data/query-keys";
import { useSyncNow } from "@cue/core/hooks/useSyncNow";
import { useRuntime } from "@cue/core/runtime/runtime";
import { useSyncActivity } from "@cue/core/stores/sync-activity-store";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { newestSyncedAt, syncStatusLine } from "./sync-status";

/** How often the "N min ago" phrase re-renders while the screen is open. */
const TICK_MS = 30_000;

const ACCOUNT_QUERY_PREFIXES = [
  queryKeys.library(),
  queryKeys.movieLibrary(),
  queryKeys.watchlist("shows"),
  queryKeys.watchlist("movies"),
  queryKeys.historyPrefix(),
  queryKeys.calendarPrefix(),
  queryKeys.lastActivities(),
  queryKeys.userStats(),
  queryKeys.userSettings(),
] as const;

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
 * in-flight counter, and `syncNow` is the shared manual pass ({@link useSyncNow},
 * the same one the pull gesture runs) plus the one thing only this screen shows:
 * a clean pass with zero changes still counts as "synced just now", because
 * server and device agreeing IS the sync.
 */
export function useSyncStatus(): SyncStatus {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  // Re-render signal only: any flush activity means the durable count may have
  // moved. The count itself reads the queue's snapshot, so a mark deferred
  // offline stays counted until it truly lands (never "0 pending" by omission).
  useSyncActivity((state) => state.pending);
  const pending = runtime.pendingWrites();
  const { syncing, run } = useSyncNow();
  const [checkedAt, setCheckedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const syncNow = useCallback(async (): Promise<void> => {
    if (!(await run())) return;
    setCheckedAt(Date.now());
    setNow(Date.now());
  }, [run]);

  const syncedAt = Math.max(
    newestSyncedAt(queryClient.getQueryCache().getAll(), ACCOUNT_QUERY_PREFIXES),
    checkedAt,
  );

  return { line: syncStatusLine(syncedAt, pending, now), pending, syncing, syncNow };
}
