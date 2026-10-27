import { focusManager, type QueryClient, queryOptions } from "@tanstack/react-query";
import { queryKeys } from "../data/query-keys";
import type { ActivitiesReconcile, CueRuntime } from "../runtime/runtime";
import { useSyncActivity } from "../stores/sync-activity-store";

/** Activity stamps only move when Trakt data changes, so a read that failed is fetched again
 * whenever Trakt answers a poll, rather than waiting for its data to change. */
function refetchFailedReads(queryClient: QueryClient): Promise<void> {
  return queryClient.refetchQueries({
    type: "active",
    predicate: (query) => query.state.status === "error" && query.state.fetchStatus === "idle",
  });
}

async function applyReconcile(
  queryClient: QueryClient,
  reconcile: ActivitiesReconcile,
  isCancelled: () => boolean,
): Promise<boolean> {
  if (reconcile.keys.length > 0) {
    await Promise.all(
      reconcile.keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
    if (isCancelled()) return false;
  }
  const refreshed = reconcile.keys.every((queryKey) =>
    queryClient
      .getQueryCache()
      .findAll({ queryKey, type: "active" })
      .every((query) => query.state.status === "success" && query.state.fetchStatus === "idle"),
  );
  if (!refreshed) return false;
  await reconcile.commit();
  return true;
}

type SyncOutcome = "synced" | "failed" | "skipped";

async function syncWithTrakt(
  runtime: CueRuntime,
  queryClient: QueryClient,
  signal: AbortSignal,
): Promise<SyncOutcome> {
  const remaining = runtime.pendingWrites() > 0 ? await runtime.flushWrites() : 0;
  if (remaining > 0) return "failed";
  if (signal.aborted || !focusManager.isFocused()) return "skipped";
  const reconcile = await runtime.pollActivities();
  if (signal.aborted) return "skipped";
  let synced = false;
  if (reconcile !== null) {
    await refetchFailedReads(queryClient);
    synced =
      !signal.aborted && (await applyReconcile(queryClient, reconcile, () => signal.aborted));
  }
  if (signal.aborted) return "skipped";
  useSyncActivity.getState().setChecked(true);
  return synced ? "synced" : "failed";
}

/** One pass of flushing this device's writes and then reconciling with Trakt's activities, shared
 * by the background poll and a sync the user asks for. */
export const syncQuery = (runtime: CueRuntime) =>
  queryOptions({
    queryKey: queryKeys.lastActivities(),
    queryFn: ({ client, signal }) => syncWithTrakt(runtime, client, signal),
  });
