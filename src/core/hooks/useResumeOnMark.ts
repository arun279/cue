import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { ShowIds } from "../domain/model/ids";
import type { Stopped } from "../domain/model/library";
import { buildResumeShowOps, buildStopShowOp } from "../domain/write-queue/ops";
import type { QueuedOp } from "../domain/write-queue/types";
import { useRuntime } from "../runtime/runtime";
import { patchStopped } from "./library-cache";
import { useOptimisticWrite } from "./useOptimisticWrite";

/** Both show their change at once, and queue their writes behind every write queued before them. */
export interface ResumeOnMark {
  /** Resumes a stopped show for the writes in `cause`, and stops it again if Trakt refuses them all. */
  resume(showId: number, ids: ShowIds, stopped: Stopped, cause: readonly QueuedOp[]): void;
  /** Stops a resumed show again the way it was stopped before. */
  stopAgain(showId: number, ids: ShowIds, stopped: Stopped): void;
}

const NOTHING_TO_READ = (): void => {};

export function useResumeOnMark(): ResumeOnMark {
  const { newId, settled } = useRuntime();
  const queryClient = useQueryClient();
  const submit = useOptimisticWrite();

  const stopAgain = useCallback(
    (showId: number, ids: ShowIds, stopped: Stopped): void => {
      patchStopped(queryClient, showId, stopped);
      void submit(
        [
          {
            ops: [buildStopShowOp(stopped, { opId: newId(), ids })],
            revert: () => patchStopped(queryClient, showId, null),
          },
        ],
        NOTHING_TO_READ,
      );
    },
    [queryClient, newId, submit],
  );

  const resume = useCallback(
    (showId: number, ids: ShowIds, stopped: Stopped, cause: readonly QueuedOp[]): void => {
      patchStopped(queryClient, showId, null);
      void submit(
        [
          {
            ops: buildResumeShowOps({ newId, ids }),
            revert: () => patchStopped(queryClient, showId, stopped),
          },
        ],
        NOTHING_TO_READ,
      );
      void Promise.all(cause.map((op) => settled(op.id))).then((outcomes) => {
        if (outcomes.every((outcome) => outcome === "failed")) stopAgain(showId, ids, stopped);
      });
    },
    [queryClient, newId, settled, stopAgain, submit],
  );

  return useMemo(() => ({ resume, stopAgain }), [resume, stopAgain]);
}
