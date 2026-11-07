import { useCallback } from "react";
import type { WriteOutcome } from "../domain/write-queue/queue";
import type { QueuedOp } from "../domain/write-queue/types";
import { type SubmitOutcome, useRuntime } from "../runtime/runtime";
import { trackWrite } from "../stores/sync-activity-store";

/**
 * A write whose session ended never answers the UI: the screens that asked for it belonged to that
 * session, and nothing they would do next may reach the next one.
 */
const unlessEnded = <T>(answer: T | "ended"): T | Promise<never> =>
  answer === "ended" ? new Promise<never>(() => {}) : answer;

/** Every write the UI makes. */
export function useTrackedSubmit(): (op: QueuedOp) => Promise<SubmitOutcome> {
  const runtime = useRuntime();
  return useCallback((op) => trackWrite(() => runtime.submit(op)).then(unlessEnded), [runtime]);
}

/** How a write the UI made ends, however long it waits to be sent. */
export function useSettled(): (opId: string) => Promise<WriteOutcome> {
  const runtime = useRuntime();
  return useCallback((opId) => runtime.settled(opId).then(unlessEnded), [runtime]);
}
