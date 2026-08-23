import { dismissSnack, showSnack } from "@ui/components/snackbar-store";
import type { MarkSeasonController } from "@ui/hooks/useMarkSeason";
import { type RefObject, useEffect, useRef } from "react";

/**
 * A pending "+N earlier" offer: set by the surface at mark time (when the tapped
 * episode had earlier unwatched episodes) and matched against the undoable it
 * belongs to by label, so the dual-action snackbar only ever decorates its own
 * mark. `run` closes over the backfill (mark-up-to-here with absorbed Undo).
 */
export interface BackfillOffer {
  /** The undo label of the single mark this offer rides on. */
  readonly markLabel: string;
  readonly count: number;
  run(): void;
}

interface MarkSnackOptions {
  readonly backfill?: RefObject<BackfillOffer | null>;
  /** Runs after the snackbar Undo settles (e.g. refresh a plays read). */
  readonly onAfterUndo?: () => void;
}

/**
 * Map a MarkSeasonController's outcomes onto the app snackbar: undoable →
 * message + `Undo` (plus the dual-action `+N earlier` when a backfill offer is
 * riding on that exact mark), notice → message-only, error → message + Dismiss.
 * One shared wiring so the show page and the episode sheet read identically.
 */
export function useMarkSnacks(marks: MarkSeasonController, options: MarkSnackOptions = {}): void {
  const { backfill, onAfterUndo } = options;
  const seq = marks.undoable?.seq;
  const label = marks.undoable?.label;
  const { undo, clearError, dismissNotice, error, notice } = marks;
  // One snack per undoable: an unrelated dep changing identity (a fresh callback
  // after a re-render) must not re-present it and reset its timer.
  const shownSeq = useRef<number | null>(null);

  useEffect(() => {
    if (seq === undefined || label === undefined || shownSeq.current === seq) return;
    shownSeq.current = seq;
    const offer = backfill?.current ?? null;
    const withBackfill = offer !== null && offer.markLabel === label;
    showSnack({
      message: label,
      actions: [
        ...(withBackfill
          ? [
              {
                label: `+${offer.count} earlier`,
                testId: "snackbar-action-backfill",
                onPress: () => {
                  if (backfill !== undefined) backfill.current = null;
                  offer.run();
                },
              },
            ]
          : []),
        {
          label: "Undo",
          testId: "snackbar-undo",
          onPress: () => {
            dismissSnack();
            void undo().then(onAfterUndo);
          },
        },
      ],
    });
  }, [seq, label, undo, backfill, onAfterUndo]);

  useEffect(() => {
    if (error === null) return;
    showSnack({ message: error, actions: [{ label: "Dismiss", onPress: dismissSnack }] });
    clearError();
  }, [error, clearError]);

  useEffect(() => {
    if (notice === null) return;
    showSnack({ message: notice });
    dismissNotice();
  }, [notice, dismissNotice]);
}
