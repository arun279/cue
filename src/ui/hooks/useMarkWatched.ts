import { queryKeys } from "@data/query-keys";
import { advancePastNext, type LibraryEntry, type MarkContext } from "@data/trakt/library";
import { isTerminalStatus } from "@domain/watch-status";
import { buildMarkEpisodeOp, buildUnmarkEpisodeOp } from "@domain/write-queue/ops";
import { useQueryClient } from "@tanstack/react-query";
import { useOptimisticWrite } from "@ui/hooks/useOptimisticWrite";
import type { SubmitOutcome, UpNextData } from "@ui/runtime/runtime";
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
  const submit = useOptimisticWrite();
  const queryClient = useQueryClient();
  const [undo, setUndo] = useState<PendingUndo | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which mark op currently owns the undo slot, tracked synchronously so an async
  // failure can tell whether its toast is still the one on screen.
  const activeOpId = useRef<string | null>(null);
  // Synchronous in-flight lock keyed by show id. `entry.pendingAdvance` only guards
  // AFTER the optimistic cache patch re-renders, so two activations on the same
  // stale `entry` (a fast double-click / Enter key-repeat) both clear it and enqueue
  // a duplicate `POST /sync/history`. This ref is checked-and-set before the patch,
  // dropping the second activation in a synchronous burst, and released when the
  // write settles (done | failed | deferred) or the mark is undone / dismissed.
  const inFlight = useRef<Set<number>>(new Set());

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
      // Second synchronous activation in the same burst — its optimistic advance
      // hasn't re-rendered yet, so drop it before it can enqueue a duplicate play.
      if (inFlight.current.has(entry.showId)) return;
      inFlight.current.add(entry.showId);
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

      const context: MarkContext = { showId: entry.showId, preCompleted: entry.completed };
      const op = buildMarkEpisodeOp({
        opId,
        ids: episode.ids,
        watchedAt,
        inversePatch: context,
      });

      // The seam rolls the optimistic advance back on a hard failure and revalidates
      // only once the write lands ("deferred" keeps the advance — a refetch would
      // read pre-mark server state and bounce the card back).
      let outcome: SubmitOutcome;
      try {
        outcome = await submit([op], {
          rollback: () => patch(entry.showId, () => beforeMark),
          revalidate,
        });
      } finally {
        // The write has settled (done | failed | deferred) — or submit threw
        // (a persistence fault): release the lock either way so a deliberate later
        // mark of the show's next episode is never wedged behind a stuck lock.
        inFlight.current.delete(entry.showId);
      }
      // Only surface the error / clear the toast if THIS op still owns the slot: if
      // the user has since marked another show or already undone this one, don't
      // clobber their current toast with a stale failure (the rollback already ran).
      if (outcome === "failed" && activeOpId.current === opId) {
        activeOpId.current = null;
        setUndo(null);
        setError(`Couldn't mark ${entry.title} watched. Please try again.`);
      }
    },
    [patch, revalidate, submit],
  );

  const runUndo = useCallback(async () => {
    const pending = undo;
    if (pending === null) return;
    activeOpId.current = null;
    inFlight.current.delete(pending.showId);
    setUndo(null);
    patch(pending.showId, () => pending.beforeMark);
    const context: MarkContext = { showId: pending.showId, preCompleted: pending.preCompleted + 1 };
    const op = buildUnmarkEpisodeOp({
      opId: crypto.randomUUID(),
      ids: pending.episodeIds,
      watchedAt: pending.watchedAt,
      inversePatch: context,
    });
    // `patch` above is the forward (undone) state, not a rollback — so a hard failure
    // of the removal must re-advance the card to the marked state it restores to, else
    // it's stranded un-advanced while Trakt still holds the play. A "deferred" removal
    // keeps the undone state (revalidating before it lands would refetch pre-undo state).
    const outcome = await submit([op], {
      rollback: () =>
        patch(pending.showId, () => advancePastNext(pending.beforeMark, pending.watchedAt)),
      revalidate,
    });
    if (outcome === "failed") setError(`Couldn't undo ${pending.title}. Please try again.`);
  }, [undo, patch, revalidate, submit]);

  return {
    markWatched,
    undo: runUndo,
    dismissUndo: () => {
      activeOpId.current = null;
      if (undo !== null) inFlight.current.delete(undo.showId);
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
