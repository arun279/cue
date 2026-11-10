import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { ShowIds } from "../domain/model/ids";
import type { Stopped } from "../domain/model/library";
import { buildResumeShowOps, buildStopShowOp } from "../domain/write-queue/ops";
import type { QueuedOp } from "../domain/write-queue/types";
import { useRuntime } from "../runtime/runtime";
import { latestWrite } from "../stores/write-locks";
import { patchStopped } from "./library-cache";
import { useOptimisticWrite, writeTarget } from "./useOptimisticWrite";

export interface ResumeOnMark {
  resume(showId: number, ids: ShowIds): void;
  /**
   * Stops a resumed show again once Trakt has taken every write in `after`. A refused write in
   * `after`, or a later write to the show, leaves it resumed.
   */
  stopAgain(showId: number, ids: ShowIds, stopped: Stopped, after: readonly QueuedOp[]): void;
}

export function useResumeOnMark(): ResumeOnMark {
  const { newId, settled } = useRuntime();
  const queryClient = useQueryClient();
  const submit = useOptimisticWrite();

  const resume = useCallback(
    (showId: number, ids: ShowIds): void => {
      patchStopped(queryClient, showId, null);
      void submit(writeTarget("show", showId), buildResumeShowOps({ newId, ids }));
    },
    [queryClient, newId, submit],
  );

  const stopAgain = useCallback(
    (showId: number, ids: ShowIds, stopped: Stopped, after: readonly QueuedOp[]): void => {
      const target = writeTarget("show", showId);
      const undo = latestWrite(target);
      void Promise.all(after.map((op) => settled(op.id))).then((outcomes) => {
        if (outcomes.includes("failed") || latestWrite(target) !== undo) return;
        patchStopped(queryClient, showId, stopped);
        void submit(target, [buildStopShowOp(stopped, { opId: newId(), ids })]);
      });
    },
    [queryClient, newId, settled, submit],
  );

  return useMemo(() => ({ resume, stopAgain }), [resume, stopAgain]);
}
