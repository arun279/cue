import { stabilizePendingAdvance } from "@cue/core/domain/queue-order";
import type { UpNextItem } from "@cue/core/domain/up-next";
import { useEffect, useMemo, useRef } from "react";

export function useStableQueueOrder(
  sorted: readonly UpNextItem[],
  pendingShowIds: ReadonlySet<number>,
): readonly UpNextItem[] {
  const previousOrder = useRef<readonly number[]>([]);
  const stable = useMemo(
    () =>
      stabilizePendingAdvance(sorted, previousOrder.current, (showId) =>
        pendingShowIds.has(showId),
      ),
    [pendingShowIds, sorted],
  );
  useEffect(() => {
    previousOrder.current = stable.map((item) => item.showId);
  }, [stable]);
  return stable;
}
