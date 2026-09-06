import { useEffect } from "react";
import { showFailure, showUndoable } from "../stores/snackbar-store";
import type { HideController } from "./useHideShow";

/**
 * What a stop or a resume says once it lands, for every surface that offers one.
 *
 * Stopping a show is reversible and the snackbar is where it says so, which is
 * why no stop confirm has to be the last chance to change your mind. A failure
 * speaks instead, so the two surfaces cannot invent two different messages for
 * the same refusal.
 */
export function useStopSnacks(stop: HideController): void {
  const { undoable, error, undo, clearError } = stop;

  useEffect(() => {
    if (error !== null) {
      showFailure(error, clearError);
      return;
    }
    if (undoable === null) return;
    showUndoable(
      `${undoable.title} ${undoable.kind === "hide" ? "stopped" : "resumed"}`,
      () => void undo(),
    );
  }, [undoable, error, undo, clearError]);
}
