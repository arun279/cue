import { readsPausedUntil } from "@cue/core/data/trakt/read-budget";
import { useSyncNow } from "@cue/core/hooks/useSyncNow";
import { useHaptics } from "@cue/core/ports/haptics";
import { useCallback } from "react";

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
