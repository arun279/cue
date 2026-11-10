import { focusManager, onlineManager, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { refreshChangedShows } from "../runtime/library-reloads";
import { useRuntime } from "../runtime/runtime";
import { useSyncActivity } from "../stores/sync-activity-store";
import { syncQuery } from "./sync-query";

const POLL_INTERVAL_MS = 60_000;

export function useActivitiesPoll(): void {
  const runtime = useRuntime();
  const queryClient = useQueryClient();

  useQuery({
    ...syncQuery(runtime),
    refetchInterval: POLL_INTERVAL_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    notifyOnChangeProps: [],
  });

  useEffect(
    () => refreshChangedShows(queryClient, () => runtime.pendingOps()),
    [queryClient, runtime],
  );

  useEffect(() => {
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
