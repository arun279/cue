import { useCallback } from "react";
import { readsPausedUntil } from "@/core/data/trakt/read-budget";
import { useSyncNow } from "@/core/hooks/useSyncNow";
import { useHaptics } from "@/core/ports/haptics";

export interface PullToRefresh {
  readonly refreshing: boolean;
  pull(): void;
}

export function usePullToRefresh(): PullToRefresh {
  const haptics = useHaptics();
  const { syncing, run } = useSyncNow();

  const pull = useCallback(() => {
    if (readsPausedUntil() > Date.now()) {
      haptics.warning();
      return;
    }
    void run();
  }, [haptics, run]);

  return { refreshing: syncing, pull };
}
