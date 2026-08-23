import type { QueuedOp } from "@cue/core/domain/write-queue/types";
import { trackWrite } from "@ui/hooks/sync-activity-store";
import { type SubmitOutcome, useRuntime } from "@ui/runtime/runtime";
import { useCallback } from "react";

/** The cache effects a write can trigger, each run at most once per submit. */
interface OutcomeEffects {
  /** Undo the optimistic patch: run only when the write hard-fails. */
  rollback(): void;
  /** A dependent follow-up write (e.g. auto-resuming a Stopped show) that must LAND
   * before `revalidate` reads the server. Runs on any kept outcome (done | deferred),
   * awaited before `revalidate`, and its own outcome gates the revalidate: a
   * still-`deferred` (or `failed`) follow-up holds it off, since the refetch would
   * otherwise read server state the follow-up hasn't reached yet and bounce the UI.
   * Resolve to `null` when the follow-up did no write. Omit when there is none. */
  onKept?(): Promise<SubmitOutcome | null>;
  /** Refetch authoritative state: run only when the write actually lands ("done"). */
  revalidate(): void;
}

/** The seam bound to the injected runtime: submit an already-patched batch and get the settled outcome. */
export type SubmitOptimistic = (
  ops: readonly QueuedOp[],
  effects: OutcomeEffects,
) => Promise<SubmitOutcome>;

/** Worst-outcome fold: any hard failure loses; else any still-pending op keeps the
 * batch deferred; else every op landed. */
function settle(a: SubmitOutcome, b: SubmitOutcome): SubmitOutcome {
  if (a === "failed" || b === "failed") return "failed";
  if (a === "deferred" || b === "deferred") return "deferred";
  return "done";
}

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
export async function applyOptimisticWrite(
  submit: (op: QueuedOp) => Promise<SubmitOutcome>,
  ops: readonly QueuedOp[],
  effects: OutcomeEffects,
): Promise<SubmitOutcome> {
  let outcome: SubmitOutcome = "done";
  for (const op of ops) outcome = settle(outcome, await submit(op));
  if (outcome === "failed") {
    effects.rollback();
    return outcome;
  }
  const kept = await effects.onKept?.();
  if (outcome === "done" && (kept == null || kept === "done")) effects.revalidate();
  return outcome;
}

/**
 * The runtime `submit` every write surface shares, bracketed by `trackWrite` so
 * the sync pill reflects an in-flight write flush (the distinct write-side
 * "Syncing…" signal). ALL writes must submit through this: a direct
 * `runtime.submit` bypasses the bracket and leaves the pill silent while the
 * durable queue is actually flushing.
 */
export function useTrackedSubmit(): (op: QueuedOp) => Promise<SubmitOutcome> {
  const runtime = useRuntime();
  return useCallback((op) => trackWrite(() => runtime.submit(op)), [runtime]);
}

/** Bind {@link applyOptimisticWrite} to the tracked runtime submit for use inside
 * write hooks. */
export function useOptimisticWrite(): SubmitOptimistic {
  const submit = useTrackedSubmit();
  return useCallback((ops, effects) => applyOptimisticWrite(submit, ops, effects), [submit]);
}
