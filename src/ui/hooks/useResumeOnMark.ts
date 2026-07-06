import type { ShowIds } from "@domain/model/ids";
import { buildHideShowOp, buildUnhideShowOp } from "@domain/write-queue/ops";
import { useQueryClient } from "@tanstack/react-query";
import { useRuntime } from "@ui/runtime/runtime";
import { useCallback } from "react";
import { isLibraryHidden, patchLibraryHidden } from "./library-cache";

export interface ResumeOnMark {
  /** If the show is Stopped (hidden), auto-resume it; resolves to whether it resumed. */
  resumeIfStopped(showId: number, ids: ShowIds): Promise<boolean>;
  /** Re-stop a show that a mark auto-resumed — invoked by that mark's Undo. */
  reStop(showId: number, ids: ShowIds): Promise<void>;
}

/**
 * Marking an episode of a Stopped show auto-resumes it:
 * state is derived from progress, so recording a watch must also clear the one
 * manual `hidden` flag — otherwise the show stays filed under Stopped despite new
 * progress. Silent (no snackbar); the show simply returns to Up Next and the
 * detail action flips back to "Stop watching". Undo of that mark re-stops the show
 * only when the mark actually resumed it.
 */
export function useResumeOnMark(): ResumeOnMark {
  const runtime = useRuntime();
  const queryClient = useQueryClient();

  const resumeIfStopped = useCallback(
    async (showId: number, ids: ShowIds): Promise<boolean> => {
      if (!isLibraryHidden(queryClient, showId)) return false;
      patchLibraryHidden(queryClient, showId, false);
      await runtime.submit(
        buildUnhideShowOp({
          opId: crypto.randomUUID(),
          ids,
          inversePatch: { kind: "hidden", showId },
        }),
      );
      return true;
    },
    [queryClient, runtime],
  );

  const reStop = useCallback(
    async (showId: number, ids: ShowIds): Promise<void> => {
      patchLibraryHidden(queryClient, showId, true);
      await runtime.submit(
        buildHideShowOp({
          opId: crypto.randomUUID(),
          ids,
          inversePatch: { kind: "hidden", showId },
        }),
      );
    },
    [queryClient, runtime],
  );

  return { resumeIfStopped, reStop };
}
