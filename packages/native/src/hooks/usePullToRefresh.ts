import { readsPausedUntil } from "@cue/core/data/trakt/read-budget";
import { useSyncNow } from "@cue/core/hooks/useSyncNow";
import { useHaptics } from "@cue/core/ports/haptics";
import { useCallback, useState } from "react";

export interface PullToRefresh {
  readonly refreshing: boolean;
  pull(): void;
  sync(): void;
}

export function usePullToRefresh(): PullToRefresh {
  const haptics = useHaptics();
  const syncNow = useSyncNow();
  const [pulling, setPulling] = useState(false);

  const pull = useCallback(() => {
    if (readsPausedUntil() > Date.now()) {
      haptics.warning();
      return;
    }
    setPulling(true);
    void syncNow.run().finally(() => setPulling(false));
  }, [haptics, syncNow]);

  return { refreshing: pulling, pull, sync: () => void syncNow.run() };
}
