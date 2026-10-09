import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { queryKeys } from "../data/query-keys";
import type { LibraryEntry } from "../data/trakt/library";
import type { ShowIds } from "../domain/model/ids";
import { buildHideShowOp, buildUnhideShowOp } from "../domain/write-queue/ops";
import { useRuntime } from "../runtime/runtime";
import { showFailure, showUndoable } from "../stores/snackbar-store";
import { patchLibraryHidden } from "./library-cache";
import { useOptimisticWrite } from "./useOptimisticWrite";

type HideKind = "hide" | "unhide";

export interface HideController {
  hide(showId: number, ids: ShowIds, title: string): Promise<void>;
  unhide(showId: number, ids: ShowIds, title: string): Promise<void>;
  stopWatching(entry: LibraryEntry): void;
}

export function useHideShow(): HideController {
  const runtime = useRuntime();
  const submit = useOptimisticWrite();
  const queryClient = useQueryClient();

  const patchHidden = useCallback(
    (showId: number, hidden: boolean) => patchLibraryHidden(queryClient, showId, hidden),
    [queryClient],
  );

  const revalidate = useCallback(
    (showId: number) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.library() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.showProgress(showId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendarPrefix() });
    },
    [queryClient],
  );

  const writeHidden = useCallback(
    async (showId: number, ids: ShowIds, title: string, kind: HideKind) => {
      const hidden = kind === "hide";
      patchHidden(showId, hidden);
      const build = hidden ? buildHideShowOp : buildUnhideShowOp;
      const op = build({
        opId: runtime.newId(),
        ids,
        inversePatch: { kind: "hidden", showId },
      });
      const outcome = await submit([op], {
        rollback: () => patchHidden(showId, !hidden),
        revalidate: () => revalidate(showId),
      });
      if (outcome === "failed") {
        showFailure(
          `Couldn't ${hidden ? "stop watching" : "resume"} ${title}. Please try again.`,
          () => {},
        );
      }
      return outcome;
    },
    [patchHidden, revalidate, runtime, submit],
  );

  const setHidden = useCallback(
    async (showId: number, ids: ShowIds, title: string, kind: HideKind) => {
      if ((await writeHidden(showId, ids, title, kind)) === "failed") return;
      showUndoable(`${title} ${kind === "hide" ? "stopped" : "resumed"}`, () => {
        void writeHidden(showId, ids, title, kind === "hide" ? "unhide" : "hide");
      });
    },
    [writeHidden],
  );

  const hide = useCallback(
    (showId: number, ids: ShowIds, title: string) => setHidden(showId, ids, title, "hide"),
    [setHidden],
  );
  const unhide = useCallback(
    (showId: number, ids: ShowIds, title: string) => setHidden(showId, ids, title, "unhide"),
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
