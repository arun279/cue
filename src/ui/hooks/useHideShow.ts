import { queryKeys } from "@data/query-keys";
import type { ShowIds } from "@domain/model/ids";
import { buildHideShowOp, buildUnhideShowOp } from "@domain/write-queue/ops";
import { useQueryClient } from "@tanstack/react-query";
import { type UpNextData, useRuntime } from "@ui/runtime/runtime";
import { useCallback, useState } from "react";

/** Which direction the last action moved the show — drives the Undo copy + inverse. */
type HideKind = "hide" | "unhide";

interface HideUndo {
  readonly showId: number;
  readonly ids: ShowIds;
  readonly title: string;
  readonly kind: HideKind;
}

export interface HideController {
  /** Abandon a show: write it to Trakt's hidden set (drops it from Up Next + calendar). */
  hide(showId: number, ids: ShowIds, title: string): Promise<void>;
  /** Un-abandon a show: remove it from the hidden set so its progress re-places it. */
  unhide(showId: number, ids: ShowIds, title: string): Promise<void>;
  undo(): Promise<void>;
  dismissUndo(): void;
  clearError(): void;
  readonly undoable: { readonly title: string; readonly kind: HideKind } | null;
  readonly error: string | null;
}

/**
 * Abandon / un-abandon a show: the hidden set is Cue's client-side exclusion
 * source, written via Trakt's `/users/hidden/progress_watched` (+ `/remove`), so an
 * abandon drops the show from Up Next, the calendar, and the active piles into the
 * Abandoned pile, and an un-abandon returns it to whichever pile its progress
 * implies. Both are optimistic (the library cache flips `hidden` immediately) with
 * a symmetric Undo that submits the inverse op.
 */
export function useHideShow(): HideController {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const [undoState, setUndoState] = useState<HideUndo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const patchHidden = useCallback(
    (showId: number, hidden: boolean) => {
      queryClient.setQueryData<UpNextData>(queryKeys.library(), (old) =>
        old === undefined
          ? old
          : {
              ...old,
              entries: old.entries.map((e) => (e.showId === showId ? { ...e, hidden } : e)),
            },
      );
    },
    [queryClient],
  );

  const revalidate = useCallback(
    (showId: number) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.library() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.showHeader(showId) });
      // The hidden set also filters the calendar; drop any cached window so a
      // hidden show can't linger in Upcoming.
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendarPrefix() });
    },
    [queryClient],
  );

  const setHidden = useCallback(
    async (showId: number, ids: ShowIds, title: string, kind: HideKind) => {
      const hidden = kind === "hide";
      patchHidden(showId, hidden);
      const build = hidden ? buildHideShowOp : buildUnhideShowOp;
      const outcome = await runtime.submit(
        build({ opId: crypto.randomUUID(), ids, inversePatch: { kind: "hidden", showId } }),
      );
      revalidate(showId);
      if (outcome === "failed") {
        patchHidden(showId, !hidden);
        setError(`Couldn't ${hidden ? "abandon" : "un-abandon"} ${title}. Please try again.`);
        return;
      }
      setUndoState({ showId, ids, title, kind });
    },
    [patchHidden, revalidate, runtime],
  );

  const hide = useCallback(
    (showId: number, ids: ShowIds, title: string) => setHidden(showId, ids, title, "hide"),
    [setHidden],
  );
  const unhide = useCallback(
    (showId: number, ids: ShowIds, title: string) => setHidden(showId, ids, title, "unhide"),
    [setHidden],
  );

  const undo = useCallback(async () => {
    const pending = undoState;
    if (pending === null) return;
    setUndoState(null);
    // Undoing a hide un-hides; undoing an un-hide re-hides.
    const restoreHidden = pending.kind === "unhide";
    patchHidden(pending.showId, restoreHidden);
    const build = restoreHidden ? buildHideShowOp : buildUnhideShowOp;
    await runtime.submit(
      build({
        opId: crypto.randomUUID(),
        ids: pending.ids,
        inversePatch: { kind: "hidden", showId: pending.showId },
      }),
    );
    revalidate(pending.showId);
  }, [undoState, patchHidden, revalidate, runtime]);

  return {
    hide,
    unhide,
    undo,
    dismissUndo: () => setUndoState(null),
    clearError: () => setError(null),
    undoable: undoState === null ? null : { title: undoState.title, kind: undoState.kind },
    error,
  };
}
