import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useRuntime } from "../runtime/runtime";
import { dismissSnack, showSnack } from "../stores/snackbar-store";
import { applyReconcile } from "./apply-reconcile";

interface SyncNow {
  readonly syncing: boolean;
  run(): Promise<boolean>;
}

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
