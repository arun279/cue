import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { queryKeys } from "../data/query-keys";
import type { ShowIds } from "../domain/model/ids";
import type { LibraryEntry, Stopped } from "../domain/model/library";
import { buildResumeShowOps, buildStopShowOp } from "../domain/write-queue/ops";
import { useRuntime } from "../runtime/runtime";
import { showUndoable } from "../stores/snackbar-store";
import { patchStopped, rereadLists, stoppedIn } from "./library-cache";
import { useOptimisticWrite, writeTarget } from "./useOptimisticWrite";

export interface HideController {
  hide(showId: number, ids: ShowIds, title: string): Promise<void>;
  unhide(showId: number, ids: ShowIds, title: string): Promise<void>;
  stopWatching(entry: LibraryEntry): void;
}

export function useHideShow(): HideController {
  const runtime = useRuntime();
  const submit = useOptimisticWrite();
  const queryClient = useQueryClient();

  const revalidate = useCallback(
    (showId: number) => {
      rereadLists(queryClient, [queryKeys.library()]);
      void queryClient.invalidateQueries({ queryKey: queryKeys.showProgress(showId) });
    },
    [queryClient],
  );

  /** Stops the show the way `stopped` says, or resumes it when that is null. */
  const writeStopped = useCallback(
    async (showId: number, ids: ShowIds, stopped: Stopped | null) => {
      const before = stoppedIn(queryClient, showId);
      patchStopped(queryClient, showId, stopped);
      const ops =
        stopped === null
          ? buildResumeShowOps({ newId: runtime.newId, ids })
          : [buildStopShowOp(stopped, { opId: runtime.newId(), ids })];
      const outcome = await submit(writeTarget("show", showId), ops, () => revalidate(showId));
      return { outcome, before };
    },
    [queryClient, revalidate, runtime, submit],
  );

  const setHidden = useCallback(
    async (showId: number, ids: ShowIds, title: string, stopped: Stopped | null) => {
      const { outcome, before } = await writeStopped(showId, ids, stopped);
      if (outcome === "failed") return;
      showUndoable(`${title} ${stopped === null ? "resumed" : "stopped"}`, async () => {
        await writeStopped(showId, ids, before);
      });
    },
    [writeStopped],
  );

  const hide = useCallback(
    (showId: number, ids: ShowIds, title: string) => setHidden(showId, ids, title, "hidden"),
    [setHidden],
  );
  const unhide = useCallback(
    (showId: number, ids: ShowIds, title: string) => setHidden(showId, ids, title, null),
    [setHidden],
  );
  const stopWatching = useCallback(
    (entry: LibraryEntry) =>
      void hide(
        entry.showId,
        { trakt: entry.showId, tmdb: entry.tmdbId ?? undefined },
        entry.title,
      ),
    [hide],
  );

  return {
    hide,
    unhide,
    stopWatching,
  };
}
