import { useCallback } from "react";
import type { QueuedOp } from "../domain/write-queue/types";
import { type SubmitOutcome, useRuntime } from "../runtime/runtime";
import { trackWrite } from "../stores/sync-activity-store";

/**
 * Every write the UI makes. A write whose session ended never settles here: the screens that
 * asked for it belonged to that session, and nothing they would do next may reach the next one.
 */
export function useTrackedSubmit(): (op: QueuedOp) => Promise<SubmitOutcome> {
  const runtime = useRuntime();
  return useCallback(
    (op) =>
      trackWrite(() => runtime.submit(op)).then((outcome) =>
        outcome === "ended" ? new Promise<never>(() => {}) : outcome,
      ),
    [runtime],
  );
}
