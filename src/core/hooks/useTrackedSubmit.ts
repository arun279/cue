import { useCallback } from "react";
import type { QueuedOp } from "../domain/write-queue/types";
import { type SubmitOutcome, useRuntime } from "../runtime/runtime";
import { trackWrite } from "../stores/sync-activity-store";

export function useTrackedSubmit(): (op: QueuedOp) => Promise<SubmitOutcome> {
  const runtime = useRuntime();
  return useCallback((op) => trackWrite(() => runtime.submit(op)), [runtime]);
}
