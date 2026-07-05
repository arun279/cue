import { queryKeys } from "@data/query-keys";
import { advancePastNext, type LibraryEntry, type MarkContext } from "@data/trakt/library";
import { buildMarkEpisodeOp, buildUnmarkEpisodeOp } from "@domain/write-queue/ops";
import { useQueryClient } from "@tanstack/react-query";
import { type UpNextData, useRuntime } from "@ui/runtime/runtime";
import { useCallback, useState } from "react";

interface UndoState {
  readonly showId: number;
  readonly title: string;
  readonly episodeCode: string;
}

export interface MarkWatched {
  markWatched(entry: LibraryEntry): Promise<void>;
  undo(): Promise<void>;
  dismissUndo(): void;
  clearError(): void;
  readonly undoable: UndoState | null;
  readonly error: string | null;
}

interface PendingUndo {
  readonly showId: number;
  readonly title: string;
  readonly episodeCode: string;
  readonly episodeIds: NonNullable<LibraryEntry["nextEpisode"]>["ids"];
  readonly watchedAt: string;
  readonly preCompleted: number;
  readonly beforeMark: LibraryEntry;
}

function episodeCodeOf(entry: LibraryEntry): string {
  const ep = entry.nextEpisode;
  if (ep === null) return "";
  return `S${String(ep.season).padStart(2, "0")}E${String(ep.number).padStart(2, "0")}`;
}

/**
 * The mark-watched hot path: advance the card optimistically in
 * the Query cache BEFORE the network write, enqueue a durable, paced
 * `POST /sync/history` (frozen `watched_at`) through the injected runtime, and
 * expose an Undo that issues the stored inverse `/sync/history/remove`. A hard
 * failure rolls the cache back; a success revalidates for the authoritative next
 * episode. 429/network handling lives in the queue behind `runtime.submit`.
 */
export function useMarkWatched(): MarkWatched {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const [undo, setUndo] = useState<PendingUndo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const patch = useCallback(
    (showId: number, next: (entry: LibraryEntry) => LibraryEntry) => {
      queryClient.setQueryData<UpNextData>(queryKeys.library(), (old) =>
        old === undefined
          ? old
          : { ...old, entries: old.entries.map((e) => (e.showId === showId ? next(e) : e)) },
      );
    },
    [queryClient],
  );

  const revalidate = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: queryKeys.library() }),
    [queryClient],
  );

  const markWatched = useCallback(
    async (entry: LibraryEntry) => {
      const episode = entry.nextEpisode;
      if (episode === null || entry.pendingAdvance) return;
      const watchedAt = new Date().toISOString();
      const beforeMark = entry;
      const episodeCode = episodeCodeOf(entry);

      // Optimistic first: the card advances before we ever touch the network.
      patch(entry.showId, (e) => advancePastNext(e, watchedAt));

      const context: MarkContext = {
        showId: entry.showId,
        preCompleted: entry.completed,
        previous: beforeMark,
      };
      const op = buildMarkEpisodeOp({
        opId: crypto.randomUUID(),
        ids: episode.ids,
        watchedAt,
        inversePatch: context,
      });

      const outcome = await runtime.submit(op);
      if (outcome === "failed") {
        patch(entry.showId, () => beforeMark);
        setError(`Couldn't mark ${entry.title} watched. Please try again.`);
        return;
      }
      revalidate();
      setUndo({
        showId: entry.showId,
        title: entry.title,
        episodeCode,
        episodeIds: episode.ids,
        watchedAt,
        preCompleted: entry.completed,
        beforeMark,
      });
    },
    [patch, revalidate, runtime],
  );

  const runUndo = useCallback(async () => {
    const pending = undo;
    if (pending === null) return;
    setUndo(null);
    patch(pending.showId, () => pending.beforeMark);
    const context: MarkContext = {
      showId: pending.showId,
      preCompleted: pending.preCompleted + 1,
      previous: pending.beforeMark,
    };
    const op = buildUnmarkEpisodeOp({
      opId: crypto.randomUUID(),
      ids: pending.episodeIds,
      watchedAt: pending.watchedAt,
      inversePatch: context,
    });
    await runtime.submit(op);
    revalidate();
  }, [undo, patch, revalidate, runtime]);

  return {
    markWatched,
    undo: runUndo,
    dismissUndo: () => setUndo(null),
    clearError: () => setError(null),
    undoable:
      undo === null
        ? null
        : { showId: undo.showId, title: undo.title, episodeCode: undo.episodeCode },
    error,
  };
}
