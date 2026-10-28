import { useCallback } from "react";
import type { QueuedOp } from "../domain/write-queue/types";
import type { SubmitOutcome } from "../runtime/runtime";
import { useSyncActivity } from "../stores/sync-activity-store";
import { applyOptimisticWrite, type OptimisticEffects } from "./optimistic-write";
import { useTrackedSubmit } from "./useTrackedSubmit";

export type SubmitOptimistic = (
  ops: readonly QueuedOp[],
  effects: OptimisticEffects,
) => Promise<SubmitOutcome>;

export function useOptimisticWrite(): SubmitOptimistic {
  const submit = useTrackedSubmit();
  return useCallback(
    async (ops, effects) => {
      const id = useSyncActivity.getState().startedWrites + 1;
      useSyncActivity.setState({ startedWrites: id });
      let outcome: SubmitOutcome = "failed";
      try {
        outcome = await applyOptimisticWrite(submit, ops, effects);
        return outcome;
      } finally {
        useSyncActivity.setState((state) => ({
          completedWrites: state.completedWrites + 1,
          lastWrite: { id, outcome },
        }));
      }
    },
    [submit],
  );
}
