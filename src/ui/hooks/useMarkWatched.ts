import { queryKeys } from "@data/query-keys";
import { advancePastNext, type LibraryEntry, type MarkContext } from "@data/trakt/library";
import { isTerminalStatus } from "@domain/watch-status";
import { buildMarkEpisodeOp, buildUnmarkEpisodeOp } from "@domain/write-queue/ops";
import { useQueryClient } from "@tanstack/react-query";
import { type UpNextData, useRuntime } from "@ui/runtime/runtime";
import { useCallback, useRef, useState } from "react";

interface UndoState {
  readonly showId: number;
  readonly title: string;
  readonly episodeCode: string;
  /** True when this mark completed an ended/canceled show — drives the quiet
   * "You finished X" closure copy (no gamification). */
  readonly finished: boolean;
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
  /** The mark op that owns this undo slot — so a *later* hard failure of an
   * earlier mark can't clear a newer show's toast (or one the user already undid). */
  readonly opId: string;
  readonly showId: number;
  readonly title: string;
  readonly episodeCode: string;
  readonly finished: boolean;
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
  // Which mark op currently owns the undo slot, tracked synchronously so an async
  // failure can tell whether its toast is still the one on screen.
  const activeOpId = useRef<string | null>(null);

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
      // The mark completes the show when it clears the last aired episode of a run
      // that has ended — a genuine closure, not a mid-run pause.
      const finished = isTerminalStatus(entry.status) && entry.completed + 1 >= entry.aired;

      // Optimistic first: the card advances before we ever touch the network.
      patch(entry.showId, (e) => advancePastNext(e, watchedAt));

      // Confirmation + Undo AT THE POINT OF ACTION: fire synchronously with the
      // optimistic advance, not after the paced/throttled write settles — otherwise
      // the card jumps a full second before any toast and reads as a silent bump.
      const opId = crypto.randomUUID();
      activeOpId.current = opId;
      setError(null);
      setUndo({
        opId,
        showId: entry.showId,
        title: entry.title,
        episodeCode,
        finished,
        episodeIds: episode.ids,
        watchedAt,
        preCompleted: entry.completed,
        beforeMark,
      });

      const context: MarkContext = {
        showId: entry.showId,
        preCompleted: entry.completed,
        previous: beforeMark,
      };
      const op = buildMarkEpisodeOp({
        opId,
        ids: episode.ids,
        watchedAt,
        inversePatch: context,
      });

      const outcome = await runtime.submit(op);
      if (outcome === "failed") {
        // Roll this show's optimistic advance back regardless — the write is dead.
        patch(entry.showId, () => beforeMark);
        // But only surface the error / clear the toast if THIS op still owns the
        // slot: if the user has since marked another show or already undone this
        // one, don't clobber their current toast with a stale failure.
        if (activeOpId.current === opId) {
          activeOpId.current = null;
          setUndo(null);
          setError(`Couldn't mark ${entry.title} watched. Please try again.`);
        }
        return;
      }
      // Only a settled write revalidates. A "deferred" op (429/offline, still
      // durable) must keep the optimistic advance — a refetch here would read the
      // pre-mark server state and bounce the card back.
      if (outcome === "done") revalidate();
    },
    [patch, revalidate, runtime],
  );

  const runUndo = useCallback(async () => {
    const pending = undo;
    if (pending === null) return;
    activeOpId.current = null;
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
    const outcome = await runtime.submit(op);
    // Mirror markWatched: a still-durable "deferred" removal keeps its optimistic
    // rollback; revalidating before it lands would refetch the pre-undo state.
    if (outcome === "done") revalidate();
  }, [undo, patch, revalidate, runtime]);

  return {
    markWatched,
    undo: runUndo,
    dismissUndo: () => {
      activeOpId.current = null;
      setUndo(null);
    },
    clearError: () => setError(null),
    undoable:
      undo === null
        ? null
        : {
            showId: undo.showId,
            title: undo.title,
            episodeCode: undo.episodeCode,
            finished: undo.finished,
          },
    error,
  };
}
