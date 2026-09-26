import { readsPausedUntil } from "@cue/core/data/trakt/read-budget";
import { useSyncNow } from "@cue/core/hooks/useSyncNow";
import { useHaptics } from "@cue/core/ports/haptics";
import { useCallback, useState } from "react";

export interface PullToRefresh {
  readonly refreshing: boolean;
  /** Released past the platform's own trigger distance. */
  pull(): void;
  /** The nav bar item that does the same thing without a gesture. */
  sync(): void;
}

/**
 * Pull to refresh, over the one manual sync pass the nav bar item and the
 * Settings row also run. Two ways to ask for fresh data that do different
 * things is the divergence a design system exists to prevent, and it is also
 * what makes the Settings status line an honest readout of all three.
 *
 * A pull released inside the client's 429 pause ends immediately on cached data
 * rather than spinning against a window the app already knows is closed, and
 * says so in the fingers with the warning tap. The strip states the reason.
 * Until this existed a rate limited pull appeared to do nothing at all.
 */
export function usePullToRefresh(): PullToRefresh {
  const haptics = useHaptics();
  const syncNow = useSyncNow();
  const [pulling, setPulling] = useState(false);

  const pull = useCallback(() => {
    // Read live rather than from the last render: a 429 can open while the
    // screen sits, and what matters is the window at the moment of release.
    if (readsPausedUntil() > Date.now()) {
      haptics.warning();
      return;
    }
    setPulling(true);
    void syncNow.run().finally(() => setPulling(false));
  }, [haptics, syncNow]);

  return { refreshing: pulling, pull, sync: () => void syncNow.run() };
}
