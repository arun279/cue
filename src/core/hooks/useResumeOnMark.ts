import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { queryKeys } from "../data/query-keys";
import type { ShowIds } from "../domain/model/ids";
import type { Stopped } from "../domain/model/library";
import { buildResumeShowOps, buildStopShowOp } from "../domain/write-queue/ops";
import type { QueuedOp } from "../domain/write-queue/types";
import { useRuntime } from "../runtime/runtime";
import { latestWrite, whenNoWritePending } from "../stores/write-locks";
import { patchStopped } from "./library-cache";
import { useOptimisticWrite, writeTarget } from "./useOptimisticWrite";

/** Both show their change on screen, and queue their writes behind every write queued before them. */
export interface ResumeOnMark {
  /**
   * Resumes a stopped show. Trakt keeps the hidden and dropped lists apart, and either removal can
   * be refused on its own, so after a refusal the library is read again rather than guessed.
   */
  resume(showId: number, ids: ShowIds): void;
  /**
   * Stops a resumed show again the way it was stopped, once Trakt has taken every write in `after`;
   * at once when there is none. A refused write in `after`, or a later write to the show, leaves it
   * resumed.
   */
  stopAgain(showId: number, ids: ShowIds, stopped: Stopped, after: readonly QueuedOp[]): void;
}

export function useResumeOnMark(): ResumeOnMark {
  const { newId, settled } = useRuntime();
  const queryClient = useQueryClient();
  const submit = useOptimisticWrite();

  const resume = useCallback(
    (showId: number, ids: ShowIds): void => {
      let refused = false;
      patchStopped(queryClient, showId, null);
      void submit(
        writeTarget("show", showId),
        [
          {
            ops: buildResumeShowOps({ newId, ids }),
            revert: () => {
              refused = true;
            },
          },
        ],
        () => {
          if (refused) {
            whenNoWritePending(
              () => void queryClient.invalidateQueries({ queryKey: queryKeys.library() }),
            );
          }
        },
      );
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
        void submit(
          target,
          [
            {
              ops: [buildStopShowOp(stopped, { opId: newId(), ids })],
              revert: () => patchStopped(queryClient, showId, null),
            },
          ],
          () => {},
        );
      });
    },
    [queryClient, newId, settled, submit],
  );

  return useMemo(() => ({ resume, stopAgain }), [resume, stopAgain]);
}
