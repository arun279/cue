import { useQueryClient } from "@tanstack/react-query";
import { dismissSnack, showSnack } from "@ui/components/snackbar-store";
import { applyReconcile } from "@ui/hooks/apply-reconcile";
import { useRuntime } from "@ui/runtime/runtime";
import { useCallback, useState } from "react";

interface SyncNow {
  readonly syncing: boolean;
  /** Resolves true when the pass completed cleanly. */
  run(): Promise<boolean>;
}

/**
 * The one manual sync pass, shared by Settings' "Sync now" row and the pull
 * gesture: land our own writes first (a deferred mark must reach Trakt here, not
 * sit in the log behind a "synced just now" line), then run one
 * `/sync/last_activities` reconcile, invalidating exactly the changed keys and
 * advancing the baseline only after those queries refetched cleanly. A failed
 * pass says so once, in the app's own snackbar, so both entry points fail the
 * same way instead of each inventing its own message.
 */
export function useSyncNow(): SyncNow {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  const run = useCallback(async (): Promise<boolean> => {
    setSyncing(true);
    try {
      const remaining = await runtime.flushWrites();
      const reconcile = remaining === 0 ? await runtime.pollActivities() : null;
      const clean = reconcile !== null && (await applyReconcile(queryClient, reconcile));
      if (!clean) {
        showSnack({
          message: "Couldn't reach Trakt. Check your connection.",
          actions: [{ label: "Dismiss", onPress: dismissSnack }],
        });
      }
      return clean;
    } finally {
      setSyncing(false);
    }
  }, [runtime, queryClient]);

  return { syncing, run };
}
