import { useEffect, useMemo, useRef } from "react";
import { stabilizePendingAdvance } from "@/core/domain/queue-order";
import type { UpNextItem } from "@/core/domain/up-next";

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
