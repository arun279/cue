import type { HistoryEntry } from "@cue/core/domain/history";
import { dismissSnack, showSnack } from "@ui/components/snackbar-store";
import type { HistoryView } from "@ui/hooks/useHistory";
import { useEffect, useRef } from "react";

type RemovalView = Pick<HistoryView, "toast" | "error" | "undo" | "clearError" | "dismissToast">;

/**
 * The per-play removal snackbar shared by the Diary and the home "Previously"
 * strip, riding the app singleton: an error shows Dismiss-only copy, a removal
 * offers Undo, and a successful undo is silent (the row reappearing is the
 * confirmation), so `restored` just clears. `removedMessage` lets the Diary
 * say how many plays remain; it is read through a ref so an inline closure
 * never re-fires the effect (and re-shows the snack) on unrelated renders.
 */
export function useRemovalSnacks(
  view: RemovalView,
  removedMessage?: (entry: HistoryEntry) => string,
): void {
  const { toast, error, undo, clearError, dismissToast } = view;
  const messageRef = useRef(removedMessage);
  messageRef.current = removedMessage;

  useEffect(() => {
    if (error !== null) {
      showSnack({
        message: error,
        actions: [
          {
            label: "Dismiss",
            onPress: () => {
              clearError();
              dismissSnack();
            },
          },
        ],
      });
      return;
    }
    if (toast?.kind === "removed") {
      showSnack({
        message: messageRef.current?.(toast.entry) ?? "Removed play",
        actions: [
          {
            label: "Undo",
            testId: "snackbar-undo",
            onPress: () => {
              dismissSnack();
              void undo();
            },
          },
        ],
      });
      return;
    }
    if (toast?.kind === "restored") dismissToast();
  }, [toast, error, undo, clearError, dismissToast]);
}
