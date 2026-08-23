import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { ShowIds } from "../domain/model/ids";
import { buildHideShowOp, buildUnhideShowOp } from "../domain/write-queue/ops";
import type { SubmitOutcome } from "../runtime/runtime";
import { isLibraryHidden, patchLibraryHidden } from "./library-cache";
import { useTrackedSubmit } from "./useOptimisticWrite";

export interface ResumeOnMark {
  /** Whether marking this show right now WOULD auto-resume it: i.e. it is currently
   * Stopped. Read synchronously at mark time so a mark's Undo can decide to re-stop
   * from the mark-time state, without waiting for the (paced) resume write to settle. */
  willResume(showId: number): boolean;
  /** If the show is Stopped (hidden), auto-resume it and resolve to how the unhide
   * write settled (so the caller can hold off revalidate until it lands); `null`
   * when the show wasn't stopped and no write was made. */
  resumeIfStopped(showId: number, ids: ShowIds): Promise<SubmitOutcome | null>;
  /** Re-stop a show that a mark auto-resumed: invoked by that mark's Undo; resolves
   * to how the re-hide write settled. */
  reStop(showId: number, ids: ShowIds): Promise<SubmitOutcome>;
}

/**
 * Marking an episode of a Stopped show auto-resumes it:
 * state is derived from progress, so recording a watch must also clear the one
 * manual `hidden` flag: otherwise the show stays filed under Stopped despite new
 * progress. Silent (no snackbar); the show simply returns to Up Next and the
 * detail action flips back to "Stop watching". Undo of that mark re-stops the show
 * only when the mark actually resumed it.
 */
export function useResumeOnMark(): ResumeOnMark {
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
          opId: crypto.randomUUID(),
          ids,
          inversePatch: { kind: "hidden", showId },
        }),
      );
    },
    [queryClient, submit],
  );

  const reStop = useCallback(
    (showId: number, ids: ShowIds): Promise<SubmitOutcome> => {
      patchLibraryHidden(queryClient, showId, true);
      return submit(
        buildHideShowOp({
          opId: crypto.randomUUID(),
          ids,
          inversePatch: { kind: "hidden", showId },
        }),
      );
    },
    [queryClient, submit],
  );

  return { willResume, resumeIfStopped, reStop };
}
