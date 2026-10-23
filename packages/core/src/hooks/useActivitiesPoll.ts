import {
  focusManager,
  onlineManager,
  type QueryClient,
  skipToken,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";
import { queryKeys } from "../data/query-keys";
import { type CueRuntime, useOptionalRuntime } from "../runtime/runtime";
import { useSyncActivity } from "../stores/sync-activity-store";
import { applyReconcile, refetchFailedReads } from "./apply-reconcile";

const POLL_INTERVAL_MS = 60_000;

async function flushThenReconcile(
  runtime: CueRuntime,
  queryClient: QueryClient,
  signal: AbortSignal,
): Promise<boolean> {
  const remaining = runtime.pendingWrites() > 0 ? await runtime.flushWrites() : 0;
  if (remaining > 0 || signal.aborted || !focusManager.isFocused()) return false;
  const reconcile = await runtime.pollActivities();
  if (signal.aborted) return false;
  if (reconcile !== null) {
    await refetchFailedReads(queryClient);
    if (!signal.aborted) await applyReconcile(queryClient, reconcile, () => signal.aborted);
  }
  if (signal.aborted) return false;
  useSyncActivity.getState().setChecked(true);
  return true;
}

export function useActivitiesPoll(): void {
  const runtime = useOptionalRuntime();
  const queryClient = useQueryClient();

  useQuery({
    queryKey: queryKeys.lastActivities(),
    queryFn:
      runtime === null
        ? skipToken
        : ({ signal }) => flushThenReconcile(runtime, queryClient, signal),
    refetchInterval: POLL_INTERVAL_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    notifyOnChangeProps: [],
  });

  useEffect(() => {
    if (runtime === null) return;
    const unsubscribe = onlineManager.subscribe((online) => {
      if (online && !focusManager.isFocused() && runtime.pendingWrites() > 0) {
        void runtime.flushWrites();
      }
    });
    return () => {
      unsubscribe();
      useSyncActivity.getState().setChecked(false);
    };
  }, [runtime]);
}
