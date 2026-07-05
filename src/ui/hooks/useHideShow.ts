import { queryKeys } from "@data/query-keys";
import type { ShowIds } from "@domain/model/ids";
import { buildHideShowOp, buildUnhideShowOp } from "@domain/write-queue/ops";
import { useQueryClient } from "@tanstack/react-query";
import { type UpNextData, useRuntime } from "@ui/runtime/runtime";
import { useCallback, useState } from "react";

interface HideUndo {
  readonly showId: number;
  readonly ids: ShowIds;
  readonly title: string;
}

export interface HideController {
  hide(showId: number, ids: ShowIds, title: string): Promise<void>;
  undo(): Promise<void>;
  dismissUndo(): void;
  clearError(): void;
  readonly undoable: { readonly title: string } | null;
  readonly error: string | null;
}

/**
 * Stop (hide) a show: the Hide action writes it to Trakt's hidden set —
 * Cue's client-side exclusion source — so it drops out of Up Next and the
 * calendar and moves to the Stopped bucket. Optimistic (the library cache flips
 * `hidden` immediately) with an Undo that un-hides via the stored inverse.
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

  const hide = useCallback(
    async (showId: number, ids: ShowIds, title: string) => {
      patchHidden(showId, true);
      const outcome = await runtime.submit(
        buildHideShowOp({
          opId: crypto.randomUUID(),
          ids,
          inversePatch: { kind: "hidden", showId },
        }),
      );
      revalidate(showId);
      if (outcome === "failed") {
        patchHidden(showId, false);
        setError(`Couldn't stop ${title}. Please try again.`);
        return;
      }
      setUndoState({ showId, ids, title });
    },
    [patchHidden, revalidate, runtime],
  );

  const undo = useCallback(async () => {
    const pending = undoState;
    if (pending === null) return;
    setUndoState(null);
    patchHidden(pending.showId, false);
    await runtime.submit(
      buildUnhideShowOp({
        opId: crypto.randomUUID(),
        ids: pending.ids,
        inversePatch: { kind: "hidden", showId: pending.showId },
      }),
    );
    revalidate(pending.showId);
  }, [undoState, patchHidden, revalidate, runtime]);

  return {
    hide,
    undo,
    dismissUndo: () => setUndoState(null),
    clearError: () => setError(null),
    undoable: undoState === null ? null : { title: undoState.title },
    error,
  };
}
