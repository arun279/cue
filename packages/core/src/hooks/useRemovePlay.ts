import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
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
  removePlay(entry: HistoryEntry): Promise<void>;
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
  const removeOutcomes = useRef(new Map<number, Promise<SubmitOutcome>>());
  const pending = useRef<HistoryEntry | null>(null);
  const undoAction = useRef<() => void>(() => {});

  const revalidate = useCallback(
    (entry: HistoryEntry) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.historyPrefix() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.userStats() });
      if (entry.type === "movie") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.movieLibrary() });
        return;
      }
      const episode =
        entry.season !== null && entry.number !== null
          ? { season: entry.season, number: entry.number }
          : undefined;
      refreshShowProgress(
        queryClient,
        entry.mediaId,
        () => runtime.loadShowProgress(entry.mediaId),
        episode,
      );
    },
    [queryClient, runtime],
  );

  const removePlay = useCallback(
    async (entry: HistoryEntry) => {
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
      const settled = submit([op], {
        rollback: () => setRemovedIds((previous) => withoutId(previous, entry.historyId)),
        revalidate: () => revalidate(entry),
      });
      removeOutcomes.current.set(entry.historyId, settled);
      pending.current = entry;
      showUndoable("Removed play", () => undoAction.current());
      if ((await settled) === "failed") {
        if (pending.current?.historyId === entry.historyId) pending.current = null;
        showError("Couldn't remove that play. Please try again.");
      }
    },
    [submit, revalidate, runtime.newId],
  );

  const undo = useCallback(async () => {
    const entry = pending.current;
    if (entry === null) return;
    pending.current = null;
    if ((await removeOutcomes.current.get(entry.historyId)) === "failed") {
      setRemovedIds((previous) => withoutId(previous, entry.historyId));
      return;
    }
    setRemovedIds((previous) => withoutId(previous, entry.historyId));
    const op =
      entry.type === "movie"
        ? buildMarkMovieOp({
            opId: runtime.newId(),
            ids: entry.ids,
            watchedAt: entry.watchedAt,
          })
        : buildMarkEpisodeOp({
            opId: runtime.newId(),
            ids: entry.ids,
            watchedAt: entry.watchedAt,
          });
    const outcome = await submit([op], {
      rollback: () => setRemovedIds((previous) => new Set(previous).add(entry.historyId)),
      revalidate: () => revalidate(entry),
    });
    if (outcome === "failed") showError("Couldn't restore that play. Please try again.");
  }, [submit, revalidate, runtime.newId]);

  undoAction.current = () => void undo();
  return { removedIds, removePlay };
}
