import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAppVisibility } from "../ports/app-visibility";
import { useNetwork } from "../ports/network";
import { useOptionalRuntime } from "../runtime/runtime";
import { useSyncActivity } from "../stores/sync-activity-store";
import { applyReconcile } from "./apply-reconcile";

const POLL_INTERVAL_MS = 60_000;

export function useActivitiesPoll(): void {
  const runtime = useOptionalRuntime();
  const queryClient = useQueryClient();
  const visibility = useAppVisibility();
  const network = useNetwork();

  useEffect(() => {
    if (runtime === null) return;
    let cancelled = false;
    let running = false;

    const flushPending = async (): Promise<number> =>
      runtime.pendingWrites() > 0 ? runtime.flushWrites() : 0;

    const reconcileActivities = async (): Promise<void> => {
      const reconcile = await runtime.pollActivities();
      if (cancelled) return;
      if (reconcile !== null) await applyReconcile(queryClient, reconcile, () => cancelled);
      if (!cancelled) useSyncActivity.getState().setChecked(true);
    };

    const runPoll = async (): Promise<void> => {
      if (running || !visibility.isVisible()) return;
      running = true;
      try {
        if ((await flushPending()) > 0 || cancelled) return;
        await reconcileActivities();
      } finally {
        running = false;
      }
    };

    const poll = (): void => void runPoll();
    const onNetwork = (): void => {
      if (!network.isOnline()) return;
      if (visibility.isVisible()) poll();
      else void flushPending();
    };

    poll();
    const unsubscribeVisibility = visibility.subscribe(poll);
    const unsubscribeNetwork = network.subscribe(onNetwork);
    const interval = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      useSyncActivity.getState().setChecked(false);
      unsubscribeVisibility();
      unsubscribeNetwork();
      clearInterval(interval);
    };
  }, [runtime, queryClient, visibility, network]);
}
