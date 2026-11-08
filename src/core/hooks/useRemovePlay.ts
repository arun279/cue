import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { queryKeys } from "../data/query-keys";
import type { HistoryEntry } from "../domain/history";
import {
  buildMarkEpisodeOp,
  buildMarkMovieOp,
  buildRemoveHistoryPlayOp,
} from "../domain/write-queue/ops";
import { type SubmitOutcome, useRuntime } from "../runtime/runtime";
import { dismissSnack, showSnack, showUndoable } from "../stores/snackbar-store";
import { refreshShowProgress } from "./library-cache";
import { useOptimisticWrite } from "./useOptimisticWrite";

export interface RemovePlayController {
  readonly removedIds: ReadonlySet<number>;
  removePlay(entry: HistoryEntry, remaining?: number): Promise<void>;
}

const withoutId = (set: ReadonlySet<number>, id: number): Set<number> => {
  const next = new Set(set);
  next.delete(id);
  return next;
};

function showError(message: string): void {
  showSnack({ message, actions: [{ label: "Dismiss", onPress: dismissSnack }] });
}

export function useRemovePlay(): RemovePlayController {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const submit = useOptimisticWrite();
  const [removedIds, setRemovedIds] = useState<ReadonlySet<number>>(() => new Set());

  const revalidate = useCallback(
    (entry: HistoryEntry) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.historyPrefix() });
      if (entry.type === "movie") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.movieLibrary() });
        return;
      }
      refreshShowProgress(
        queryClient,
        entry.mediaId,
        () => runtime.loadShowProgress(entry.mediaId),
        { season: entry.season, number: entry.number },
      );
    },
    [queryClient, runtime],
  );

  const restore = useCallback(
    async (entry: HistoryEntry, removal: Promise<SubmitOutcome>) => {
      setRemovedIds((previous) => withoutId(previous, entry.historyId));
      if ((await removal) === "failed") return;
      const op = (entry.type === "movie" ? buildMarkMovieOp : buildMarkEpisodeOp)({
        opId: runtime.newId(),
        ids: entry.ids,
        watchedAt: entry.watchedAt,
      });
      const outcome = await submit(
        [
          {
            ops: [op],
            revert: () => setRemovedIds((previous) => new Set(previous).add(entry.historyId)),
          },
        ],
        () => revalidate(entry),
      );
      if (outcome === "failed") showError("Couldn't restore that play. Please try again.");
    },
    [submit, revalidate, runtime.newId],
  );

  const removePlay = useCallback(
    async (entry: HistoryEntry, remaining = 0) => {
      setRemovedIds((previous) => new Set(previous).add(entry.historyId));
      const op = buildRemoveHistoryPlayOp({
        opId: runtime.newId(),
        ids: [entry.historyId],
        restore: {
          section: entry.type === "movie" ? "movies" : "episodes",
          ids: entry.ids,
          watchedAt: entry.watchedAt,
        },
      });
      const removal = submit(
        [
          {
            ops: [op],
            revert: () => setRemovedIds((previous) => withoutId(previous, entry.historyId)),
          },
        ],
        () => revalidate(entry),
      );
      showUndoable(remaining > 0 ? `Removed 1 play · ${remaining} remain` : "Removed play", () =>
        restore(entry, removal),
      );
      if ((await removal) === "failed") showError("Couldn't remove that play. Please try again.");
    },
    [submit, revalidate, restore, runtime.newId],
  );

  return { removedIds, removePlay };
}
