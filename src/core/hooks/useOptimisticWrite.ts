import { useCallback } from "react";
import type { QueuedOp } from "../domain/write-queue/types";
import { type SubmitOutcome, useRuntime } from "../runtime/runtime";
import { applyOptimisticWrite, type OptimisticEffects } from "./optimistic-write";
import { useTrackedSubmit } from "./useTrackedSubmit";

export type SubmitOptimistic = (
  ops: readonly QueuedOp[],
  effects: OptimisticEffects,
) => Promise<SubmitOutcome>;

export function useOptimisticWrite(): SubmitOptimistic {
  const { settled } = useRuntime();
  const submit = useTrackedSubmit();
  return useCallback(
    (ops, effects) => applyOptimisticWrite({ submit, settled }, ops, effects),
    [submit, settled],
  );
}
