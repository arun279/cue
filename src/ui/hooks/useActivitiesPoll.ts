import { useQueryClient } from "@tanstack/react-query";
import { useOptionalRuntime } from "@ui/runtime/runtime";
import { useEffect } from "react";

/**
 * Foreground poll cadence for the freshness gate. One `/sync/last_activities` GET
 * every 60s = 5 GETs / 5min = 0.5% of Trakt's 1000-GET / 5min per-user budget, so
 * it stays "frequent" with ~3 orders of magnitude of headroom; a ≤60s window on a
 * cross-device edit is imperceptible. Hidden tabs poll nothing.
 */
const POLL_INTERVAL_MS = 60_000;

/**
 * The single freshness gate driver. One Page-Visibility-gated poll of
 * `/sync/last_activities`: on mount (establish the baseline / catch anything that
 * changed while away), on regaining visibility, on reconnect, and on a 60s
 * interval while visible. A diffed change invalidates exactly the affected query
 * keys and, once they have refetched, advances the persisted baseline. A failed
 * check stays silent (cached data keeps showing); it never flips the pill.
 * Navigation triggers none of this, so moving between pages costs zero Trakt
 * calls and the pill rests on "Synced".
 */
export function useActivitiesPoll(): void {
  const runtime = useOptionalRuntime();
  const queryClient = useQueryClient();

  useEffect(() => {
    // The shell renders without a runtime during the pre-token /auth/callback
    // return; there is nothing to poll until a session is mounted.
    if (runtime === null) return;
    let cancelled = false;
    let running = false;

    const runPoll = async (): Promise<void> => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      try {
        const reconcile = await runtime.pollActivities();
        if (cancelled || reconcile === null) return;
        if (reconcile.keys.length > 0) {
          await Promise.all(
            reconcile.keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
          );
          if (cancelled) return;
        }
        // Advance the baseline ONLY after the invalidated queries refetched, and
        // only if none ended in error: a failed refetch must be re-detected on the
        // next poll rather than silently skipped by an advanced snapshot.
        const anyError = reconcile.keys.some((queryKey) =>
          queryClient
            .getQueryCache()
            .findAll({ queryKey })
            .some((query) => query.state.status === "error"),
        );
        if (!anyError) await reconcile.commit();
      } finally {
        running = false;
      }
    };

    const poll = (): void => void runPoll();
    const onVisible = (): void => {
      if (document.visibilityState === "visible") poll();
    };

    poll();
    document.addEventListener("visibilitychange", onVisible);
    globalThis.addEventListener("online", poll);
    const interval = globalThis.setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      globalThis.removeEventListener("online", poll);
      globalThis.clearInterval(interval);
    };
  }, [runtime, queryClient]);
}
