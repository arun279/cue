import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { ShowIds } from "../domain/model/ids";
import { buildHideShowOp, buildUnhideShowOp } from "../domain/write-queue/ops";
import { type SubmitOutcome, useRuntime } from "../runtime/runtime";
import { isLibraryHidden, patchLibraryHidden } from "./library-cache";
import { useTrackedSubmit } from "./useTrackedSubmit";

export interface ResumeOnMark {
  willResume(showId: number): boolean;
  resumeIfStopped(showId: number, ids: ShowIds): Promise<SubmitOutcome | null>;
  reStop(showId: number, ids: ShowIds): Promise<SubmitOutcome>;
}

export function useResumeOnMark(): ResumeOnMark {
  const runtime = useRuntime();
  const submit = useTrackedSubmit();
  const queryClient = useQueryClient();

  const willResume = useCallback(
    (showId: number): boolean => isLibraryHidden(queryClient, showId),
    [queryClient],
  );

  const resumeIfStopped = useCallback(
    async (showId: number, ids: ShowIds): Promise<SubmitOutcome | null> => {
      if (!isLibraryHidden(queryClient, showId)) return null;
      patchLibraryHidden(queryClient, showId, false);
      return submit(
        buildUnhideShowOp({
          opId: runtime.newId(),
          ids,
          inversePatch: { kind: "hidden", showId },
        }),
      );
    },
    [queryClient, runtime, submit],
  );

  const reStop = useCallback(
    (showId: number, ids: ShowIds): Promise<SubmitOutcome> => {
      patchLibraryHidden(queryClient, showId, true);
      return submit(
        buildHideShowOp({
          opId: runtime.newId(),
          ids,
          inversePatch: { kind: "hidden", showId },
        }),
      );
    },
    [queryClient, runtime, submit],
  );

  return { willResume, resumeIfStopped, reStop };
}
