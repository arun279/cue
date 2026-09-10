import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useRuntime } from "../runtime/runtime";
import { dismissSnack, showSnack } from "../stores/snackbar-store";
import { applyReconcile } from "./apply-reconcile";

interface SyncNow {
  readonly syncing: boolean;
  /** Resolves true when the pass completed cleanly, and never rejects: a caller
   * that shows the pass in progress can always settle on the answer. */
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
      if (reconcile !== null && (await applyReconcile(queryClient, reconcile))) return true;
    } catch {
      // A flush or a storage write can reject outright. That is the same failed
      // pass as a refused one, and it takes the same message below, so neither
      // caller is left showing a pass that never ends.
    } finally {
      setSyncing(false);
    }
    showSnack({
      message: "Couldn't reach Trakt. Check your connection.",
      actions: [{ label: "Dismiss", onPress: dismissSnack }],
    });
    return false;
  }, [runtime, queryClient]);

  return { syncing, run };
}
