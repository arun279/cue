import { useCallback } from "react";
import { type SubmitOutcome, useRuntime } from "../runtime/runtime";
import { applyOptimisticWrite, type OptimisticChange } from "./optimistic-write";
import { useTrackedSubmit } from "./useTrackedSubmit";

export type SubmitOptimistic = (
  changes: readonly OptimisticChange[],
  revalidate: () => void,
) => Promise<SubmitOutcome>;

export function useOptimisticWrite(): SubmitOptimistic {
  const submit = useTrackedSubmit();
  const { settled } = useRuntime();
  return useCallback(
    (changes, revalidate) => applyOptimisticWrite({ submit, settled }, changes, revalidate),
    [submit, settled],
  );
}
