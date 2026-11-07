import { useCallback } from "react";
import type { QueuedOp } from "../domain/write-queue/types";
import type { SubmitOutcome } from "../runtime/runtime";
import { applyOptimisticWrite, type OptimisticEffects } from "./optimistic-write";
import { useSettled, useTrackedSubmit } from "./useTrackedSubmit";

export type SubmitOptimistic = (
  ops: readonly QueuedOp[],
  effects: OptimisticEffects,
) => Promise<SubmitOutcome>;

export function useOptimisticWrite(): SubmitOptimistic {
  const submit = useTrackedSubmit();
  const settled = useSettled();
  return useCallback(
    (ops, effects) => applyOptimisticWrite({ submit, settled }, ops, effects),
    [submit, settled],
  );
}
