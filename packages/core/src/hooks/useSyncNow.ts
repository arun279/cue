import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useRuntime } from "../runtime/runtime";
import { dismissSnack, showSnack } from "../stores/snackbar-store";
import { syncQuery } from "./sync-query";

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
    const outcome = await queryClient.fetchQuery(syncQuery(runtime)).catch(() => "failed");
    setSyncing(false);
    if (outcome === "synced") return true;
    showSnack({
      message: "Couldn't reach Trakt. Check your connection.",
      actions: [{ label: "Dismiss", onPress: dismissSnack }],
    });
    return false;
  }, [runtime, queryClient]);

  return { syncing, run };
}
