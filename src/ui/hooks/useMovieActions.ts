import { queryKeys } from "@data/query-keys";
import type { MovieEntry } from "@data/trakt/movie-library";
import {
  buildAddWatchlistOp,
  buildMarkMovieOp,
  buildRemoveHistoryPlayOp,
  buildRemoveWatchlistOp,
  buildUnmarkMovieOp,
} from "@domain/write-queue/ops";
import { useQueryClient } from "@tanstack/react-query";
import { resolveMovieUnmark, routeMovieUnmark } from "@ui/hooks/resolveUnmark";
import { writeMovieEntry } from "@ui/hooks/useMovieLibrary";
import { useOptimisticWrite } from "@ui/hooks/useOptimisticWrite";
import { useHaptics } from "@ui/runtime/haptics";
import type { SubmitOutcome } from "@ui/runtime/runtime";
import { useRuntime } from "@ui/runtime/runtime";
import { useCallback, useRef, useState } from "react";

interface MarkUndo {
  readonly title: string;
  /** The exact pre-mark entry, restored verbatim on Undo. */
  readonly before: MovieEntry;
  readonly watchedAt: string;
}

export interface MovieActions {
  /** Toggle a movie watched/unwatched; a mark exposes an Undo, and an unmark of a
   * rewatched movie is refused (surfaced as `notice`) rather than wiping history. */
  markWatched(entry: MovieEntry): Promise<void>;
  toggleWatchlist(entry: MovieEntry): Promise<void>;
  undoMark(): Promise<void>;
  dismissUndo(): void;
  clearError(): void;
  /** A non-error advisory: the unmark was refused because the movie has more than
   * one play (a rewatch) and per-play removal lives in the watch history. */
  readonly notice: string | null;
  dismissNotice(): void;
  readonly undoable: { readonly title: string } | null;
  readonly error: string | null;
}

/**
 * The Movie detail write surface: mark-watched (with a frozen
 * `watched_at`) and watchlist add/remove, each optimistic through the durable
 * write-queue and reconciled against watched-movie / watchlist membership. The
 * shared `movieLibrary` cache is patched instantly (materializing an entry for a
 * movie not yet in the library) so both the detail hero and the My Shows shelves
 * update at once; a hard failure rolls the patch back. A mark exposes an inline Undo
 * (the item-scoped `/sync/history/remove` inverse: it reverses the play you just
 * added). A durable unmark of a settled watch is per-play-safe and mirrors episodes
 * it resolves the movie's real plays and removes the single play by its exact
 * history id; a rewatched movie (two or more plays) is refused and routed to the
 * watch history rather than wiping every play. An unmark of a play added THIS session
 * that hasn't landed yet (its mark op still queued) reverses that exact op: which
 * coalesces against the pending mark: instead of reading live plays, which would
 * miss the in-flight write and silently retain the play.
 */
export function useMovieActions(): MovieActions {
  const submit = useOptimisticWrite();
  const queryClient = useQueryClient();
  const runtime = useRuntime();
  const haptics = useHaptics();
  const [undo, setUndo] = useState<MarkUndo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The play added this session whose mark op may not have landed yet, tracked in a
  // ref so a concurrent unmark can observe it synchronously (a live-plays read can't
  // see an in-flight write). Set before the paced write, cleared once it lands
  // ("done"), is reversed, or hard-fails; kept while "deferred" (still un-landed).
  const pendingMark = useRef<MarkUndo | null>(null);
  // Synchronous in-flight lock keyed by movie id, mirroring useMarkWatched: the
  // optimistic `watched: true` patch only guards a re-tap AFTER it re-renders, so two
  // activations on the same stale entry (a fast double-tap / Enter key-repeat) both fire
  // a duplicate `POST /sync/history` and a second haptic. Checked-and-set before the
  // patch drops the second in a synchronous burst; released when the write settles.
  const inFlight = useRef<Set<number>>(new Set());

  const revalidate = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: queryKeys.movieLibrary() }),
    [queryClient],
  );

  // Reverse a play added this session by its item-scoped inverse, which coalesces
  // against the still-queued mark: cancelling it outright if it hasn't dispatched,
  // or landing behind it if it has. Because the mark ran from an unwatched entry
  // (zero prior plays), removing by item can't wipe a pre-existing rewatch. Shared by
  // the inline Undo and the fast unmark of a not-yet-settled mark.
  // TODO(stale-multi-device-cache): this safety rests on `mark.before` being a
  // truthful unwatched entry. A stale cross-device cache could show watched=false
  // while another device has since added a real play; the remove-by-item inverse
  // would then wipe that play. Inherited/bounded today (the mark only fires from an
  // apparently-unwatched entry), but surface it if the cache-freshness model changes.
  const reverseSessionMark = useCallback(
    (mark: MarkUndo) => {
      writeMovieEntry(queryClient, mark.before);
      const op = buildUnmarkMovieOp({
        opId: crypto.randomUUID(),
        ids: mark.before.ids,
        watchedAt: mark.watchedAt,
        inversePatch: { kind: "movie", movieId: mark.before.movieId },
      });
      return submit([op], {
        rollback: () =>
          writeMovieEntry(queryClient, {
            ...mark.before,
            watched: true,
            watchedAt: mark.watchedAt,
          }),
        revalidate,
      });
    },
    [queryClient, revalidate, submit],
  );

  const markOn = useCallback(
    async (entry: MovieEntry) => {
      // Second synchronous activation in the same burst: its optimistic tick hasn't
      // re-rendered yet, so drop it before it can enqueue a duplicate play + second buzz.
      if (inFlight.current.has(entry.movieId)) return;
      inFlight.current.add(entry.movieId);
      const watchedAt = new Date().toISOString();
      const mark: MarkUndo = { title: entry.title, before: entry, watchedAt };
      // Claim the pending-mark slot synchronously and surface Undo at the point of
      // action: both must be readable by a concurrent unmark before the paced write settles.
      pendingMark.current = mark;
      setUndo(mark);
      writeMovieEntry(queryClient, { ...entry, watched: true, watchedAt });
      // One buzz at the point of action, once per committed mark: with the
      // optimistic tick, never on the rollback path.
      haptics.markCommitted();
      const op = buildMarkMovieOp({
        opId: crypto.randomUUID(),
        ids: entry.ids,
        watchedAt,
        inversePatch: { kind: "movie", movieId: entry.movieId },
      });
      let outcome: SubmitOutcome;
      try {
        outcome = await submit([op], {
          rollback: () => writeMovieEntry(queryClient, entry),
          revalidate,
        });
      } finally {
        // Settled (done | failed | deferred) or submit threw: release the lock either
        // way so a deliberate later re-mark of the movie is never wedged behind it.
        inFlight.current.delete(entry.movieId);
      }
      // A concurrent unmark (or a newer mark) may have already consumed this slot,
      // only settle the outcome if it's still ours.
      if (pendingMark.current !== mark) return;
      if (outcome === "failed") {
        pendingMark.current = null;
        setUndo(null);
        setError(`Couldn't update ${entry.title}. Please try again.`);
        return;
      }
      // Landed: the play is now on the server, so a later unmark can safely resolve
      // real plays. A "deferred" (still-queued) mark keeps the slot so its unmark
      // reverses the exact op instead.
      if (outcome === "done") pendingMark.current = null;
    },
    [queryClient, revalidate, submit, haptics],
  );

  const markOff = useCallback(
    async (entry: MovieEntry) => {
      // A prior mark's inline Undo is stale once we unmark: drop it.
      setUndo(null);
      // TODO(cross-unmount-deferred-mark): `pendingMark` is a per-MOUNT ref, but a
      // deferred (offline) mark lives in the DURABLE queue, which outlives the mount.
      // Mark offline → navigate away (ref lost) → return → unmark reads live plays=0
      // → "none" → un-ticks; the queue later flushes the mark and the movie flips back
      // to watched. Non-destructive (no history loss) but wrong UX. A clean fix routes
      // through the durable queue (consult a pending un-landed mark by itemKey), not
      // only this ref: deferred as out of scope for broader safety hardening.
      const pending = pendingMark.current;
      const route = routeMovieUnmark(pending?.before.movieId ?? null, entry.movieId);
      if (route === "reverse-session-mark" && pending !== null) {
        // The play was added this session and may not have landed: reverse the exact
        // op (coalesces against the queued mark) rather than reading live plays, which
        // could return 0 for an in-flight mark and silently retain the play.
        pendingMark.current = null;
        const outcome = await reverseSessionMark(pending);
        if (outcome === "failed") setError(`Couldn't update ${entry.title}. Please try again.`);
        return;
      }
      // Optimistic un-tick first; the durable per-play removal (or its refusal) settles behind.
      writeMovieEntry(queryClient, { ...entry, watched: false, watchedAt: null });
      const restoreTick = (): void => writeMovieEntry(queryClient, entry);
      const resolution = await resolveMovieUnmark(runtime, entry.movieId);
      if (resolution.kind === "error") {
        restoreTick();
        setError("Couldn't reach your history to unmark this. Please try again.");
        return;
      }
      if (resolution.kind === "rewatch") {
        // More than one play: refuse the wipe and keep the tick; per-play removal
        // is the watch history's job (identical to the rewatched-episode path).
        restoreTick();
        setNotice(
          `This movie has ${resolution.count} plays. Remove a specific play in your watch history.`,
        );
        return;
      }
      if (resolution.kind === "none") {
        // The server already holds no play; the optimistic un-tick is correct: reconcile.
        revalidate();
        return;
      }
      const op = buildRemoveHistoryPlayOp({
        opId: crypto.randomUUID(),
        ids: [resolution.historyId],
        restore: { section: "movies", ids: entry.ids, watchedAt: resolution.watchedAt },
        inversePatch: { kind: "movie", movieId: entry.movieId },
      });
      const outcome = await submit([op], { rollback: restoreTick, revalidate });
      if (outcome === "failed") setError(`Couldn't update ${entry.title}. Please try again.`);
    },
    [queryClient, revalidate, runtime, submit, reverseSessionMark],
  );

  const markWatched = useCallback(
    async (entry: MovieEntry) => {
      setError(null);
      setNotice(null);
      if (entry.watched) await markOff(entry);
      else await markOn(entry);
    },
    [markOff, markOn],
  );

  const toggleWatchlist = useCallback(
    async (entry: MovieEntry) => {
      const next = !entry.inWatchlist;
      writeMovieEntry(queryClient, { ...entry, inWatchlist: next });
      const build = next ? buildAddWatchlistOp : buildRemoveWatchlistOp;
      const op = build({ opId: crypto.randomUUID(), section: "movies", ids: entry.ids });
      const outcome = await submit([op], {
        rollback: () => writeMovieEntry(queryClient, entry),
        revalidate,
      });
      if (outcome === "failed") setError("Couldn't update your watchlist. Please try again.");
    },
    [queryClient, revalidate, submit],
  );

  const undoMark = useCallback(async () => {
    const pending = undo;
    if (pending === null) return;
    setUndo(null);
    pendingMark.current = null;
    inFlight.current.delete(pending.before.movieId);
    // The distinct take-back tick, once, with the optimistic reversal.
    haptics.markUndone();
    const outcome = await reverseSessionMark(pending);
    if (outcome === "failed") setError(`Couldn't undo ${pending.title}. Please try again.`);
  }, [undo, reverseSessionMark, haptics]);

  return {
    markWatched,
    toggleWatchlist,
    undoMark,
    dismissUndo: () => {
      if (undo !== null) inFlight.current.delete(undo.before.movieId);
      setUndo(null);
    },
    clearError: () => setError(null),
    notice,
    dismissNotice: () => setNotice(null),
    undoable: undo === null ? null : { title: undo.title },
    error,
  };
}
