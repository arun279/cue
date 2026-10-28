import { useCallback } from "react";
import { useSyncNow } from "@/core/hooks/useSyncNow";
import { useHaptics } from "@/core/ports/haptics";
import { useRuntime } from "@/core/runtime/runtime";

export interface PullToRefresh {
  readonly refreshing: boolean;
  pull(): void;
}

export function usePullToRefresh(): PullToRefresh {
  const runtime = useRuntime();
  const haptics = useHaptics();
  const { syncing, run } = useSyncNow();

  const pull = useCallback(() => {
    if (runtime.readsPausedUntil() > Date.now()) {
      haptics.warning();
      return;
    }
    void run();
  }, [runtime, haptics, run]);

  return { refreshing: syncing, pull };
}
