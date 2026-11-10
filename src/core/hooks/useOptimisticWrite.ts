import { useCallback } from "react";
import type { QueuedOp, WriteTarget } from "../domain/write-queue/types";
import { type SubmitOutcome, useRuntime } from "../runtime/runtime";
import { applyOptimisticWrite } from "./optimistic-write";
import { useTrackedSubmit } from "./useTrackedSubmit";

/** The show or movie a write changes; its read back waits for every pending write to it. */
export const writeTarget = (kind: WriteTarget["kind"], id: number): WriteTarget => ({ kind, id });

export type SubmitOptimistic = (
  target: WriteTarget,
  ops: readonly QueuedOp[],
  revalidate?: () => void,
) => Promise<SubmitOutcome>;

export function useOptimisticWrite(): SubmitOptimistic {
  const submit = useTrackedSubmit();
  const { settled } = useRuntime();
  return useCallback(
    (target, ops, revalidate) => applyOptimisticWrite({ submit, settled }, target, ops, revalidate),
    [submit, settled],
  );
}
