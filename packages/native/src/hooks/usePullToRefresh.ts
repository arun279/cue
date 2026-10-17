import { readsPausedUntil } from "@cue/core/data/trakt/read-budget";
import { useSyncNow } from "@cue/core/hooks/useSyncNow";
import { useHaptics } from "@cue/core/ports/haptics";
import { useCallback, useState } from "react";
import { trackSync } from "../ui/harness";

export interface PullToRefresh {
  readonly refreshing: boolean;
  pull(): void;
  sync(): void;
}

export function usePullToRefresh(): PullToRefresh {
  const haptics = useHaptics();
  const { run } = useSyncNow();
  const [pulling, setPulling] = useState(false);

  const pull = useCallback(() => {
    if (readsPausedUntil() > Date.now()) {
      haptics.warning();
      return;
    }
    setPulling(true);
    void trackSync(run).finally(() => setPulling(false));
  }, [haptics, run]);
  const sync = useCallback(() => void trackSync(run), [run]);

  return { refreshing: pulling, pull, sync };
}
