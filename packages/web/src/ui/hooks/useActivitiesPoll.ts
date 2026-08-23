import { useQueryClient } from "@tanstack/react-query";
import { applyReconcile } from "@ui/hooks/apply-reconcile";
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

    const flushPending = async (): Promise<number> =>
      runtime.pendingWrites() > 0 ? runtime.flushWrites() : 0;

    const runPoll = async (): Promise<void> => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      try {
        // Local ops land BEFORE the freshness check, and a reconcile never
        // applies over ops still in the log: invalidating then would repaint
        // server state that is missing the local marks (mid-binge bounce).
        // A flush that can't drain (offline / rate-limited) skips this cycle;
        // the next trigger retries.
        if ((await flushPending()) > 0 || cancelled) return;
        const reconcile = await runtime.pollActivities();
        if (cancelled || reconcile === null) return;
        await applyReconcile(queryClient, reconcile, () => cancelled);
      } finally {
        running = false;
      }
    };

    const poll = (): void => void runPoll();
    const onVisible = (): void => {
      if (document.visibilityState === "visible") poll();
    };
    // Reconnect always attempts to land deferred writes, even from a hidden
    // tab; the poll itself (and so the reconcile) stays visibility-gated.
    const onOnline = (): void => {
      if (document.visibilityState === "hidden") void flushPending();
      else poll();
    };

    poll();
    document.addEventListener("visibilitychange", onVisible);
    globalThis.addEventListener("online", onOnline);
    const interval = globalThis.setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      globalThis.removeEventListener("online", onOnline);
      globalThis.clearInterval(interval);
    };
  }, [runtime, queryClient]);
}
