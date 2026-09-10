import { useCallback } from "react";
import type { QueuedOp } from "../domain/write-queue/types";
import type { SubmitOutcome } from "../runtime/runtime";
import { applyOptimisticWrite, type OptimisticEffects } from "./optimistic-write";
import { useTrackedSubmit } from "./useTrackedSubmit";

/** The cache effects a write can trigger, each run at most once per submit. */
/** The seam bound to the injected runtime: submit an already-patched batch and get the settled outcome. */
export type SubmitOptimistic = (
  ops: readonly QueuedOp[],
  effects: OptimisticEffects,
) => Promise<SubmitOutcome>;

/**
 * The single optimistic-write dispatch every write surface shares. The caller has
 * already patched its cache and built the durable op(s); this submits them and
 * applies the one correct outcome rule: roll back on "failed", revalidate on
 * "done", and KEEP the optimistic state on "deferred" (durable but not-yet-landed,
 * revalidating would refetch pre-write server state and bounce the UI). A batch
 * settles to its worst outcome, so a season mark rolls back iff any op hard-fails
 * and revalidates iff every op landed. On a kept outcome an optional `onKept`
 * follow-up write is awaited before revalidate, and revalidate runs only when both
 * the batch AND the follow-up landed: a deferred follow-up hasn't reached the
 * server, so refetching would refile the item to its pre-follow-up state. The
 * follow-up never turns a landed primary write into a failure the caller sees: the
 * batch outcome stands and is returned for surfaces that layer their own
 * success/error handling (undo slot, in-flight lock) on top. A thrown submit
 * propagates unhandled so the caller's own teardown (e.g. an in-flight-lock
 * `finally`) still runs.
 */
/** Bind {@link applyOptimisticWrite} to the tracked runtime submit for use inside
 * write hooks. */
export function useOptimisticWrite(): SubmitOptimistic {
  const submit = useTrackedSubmit();
  return useCallback((ops, effects) => applyOptimisticWrite(submit, ops, effects), [submit]);
}
