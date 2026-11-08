import { useCallback } from "react";
import { type SubmitOutcome, useRuntime } from "../runtime/runtime";
import { applyOptimisticWrite, type OptimisticChange } from "./optimistic-write";
import { useTrackedSubmit } from "./useTrackedSubmit";

/** The show or movie a write changes; its read back waits for every pending write to it. */
export const writeTarget = (kind: "show" | "movie", id: number): string => `${kind}:${id}`;

export type SubmitOptimistic = (
  target: string,
  changes: readonly OptimisticChange[],
  revalidate: () => void,
) => Promise<SubmitOutcome>;

export function useOptimisticWrite(): SubmitOptimistic {
  const submit = useTrackedSubmit();
  const { settled } = useRuntime();
  return useCallback(
    (target, changes, revalidate) =>
      applyOptimisticWrite({ submit, settled }, target, changes, revalidate),
    [submit, settled],
  );
}
