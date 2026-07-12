import { invalidateShowProgress } from "@data/query-invalidation";
import { queryKeys } from "@data/query-keys";
import { advancePastNext, type LibraryEntry, type MarkContext } from "@data/trakt/library";
import { buildMarkEpisodeOp, buildUnmarkEpisodeOp } from "@domain/write-queue/ops";
import { useQueryClient } from "@tanstack/react-query";
import { dismissSnack, showSnack, useSnackbar } from "@ui/components/snackbar-store";
import { epCode, middleTruncate } from "@ui/format";
import { patchLibraryEntry } from "@ui/hooks/library-cache";
import { appendToBatch } from "@ui/hooks/mark-undo-window";
import { useOptimisticWrite } from "@ui/hooks/useOptimisticWrite";
import { useHaptics } from "@ui/runtime/haptics";
import type { SubmitOutcome } from "@ui/runtime/runtime";
import { useCallback, useRef, useState } from "react";

/**
 * One committed mark, held for the two reversal affordances: the live-toggle
 * window on the row's check (until re-arm) and the snackbar batch (5s rolling
 * window). `beforeMark` is the verbatim pre-mark cache entry, so a reversal
 * restores exactly what the tap replaced.
 */
interface MarkRecord {
  readonly opId: string;
  readonly showId: number;
  readonly title: string;
  readonly code: string;
  /** Epoch ms of the tap: the batch window + re-arm floor pivot. */
  readonly at: number;
  readonly episodeIds: NonNullable<LibraryEntry["nextEpisode"]>["ids"];
  readonly season: number;
  readonly number: number;
  readonly watchedAt: string;
  readonly preCompleted: number;
  readonly beforeMark: LibraryEntry;
}

export interface MarkWatched {
  /** Optimistically mark `entry`'s next episode; the op submits at t=0. */
  mark(entry: LibraryEntry): Promise<void>;
  /** Live-toggle reverse of the show's just-marked play: silent (no snackbar of
   * its own; it retracts the mark's), the "oops, wrong row" reflex path. */
  reverse(showId: number): Promise<void>;
  /** Close the show's reverse window: the check re-arms for the next episode.
   * Callers gate this on the authoritative next episode having landed
   * (`pendingAdvance` cleared) plus the minimum visual window. */
  reArm(showId: number): void;
  /** Epoch ms of the show's open reverse window, or null when re-armed. */
  justMarkedAt(showId: number): number | null;
}

/**
 * The mark-watched hot path: advance the entry optimistically in the Query
 * cache BEFORE the network write, enqueue a durable, paced `POST /sync/history`
 * (frozen `watched_at`) through the injected runtime, and feed the app snackbar
 * a rolling batch whose Undo reverses every mark in it. Until the authoritative
 * next episode lands the filled check stays a live undo toggle (`reverse`);
 * reversal cancels the queued op via write-queue coalescing, or enqueues the
 * inverse once flushed. A hard failure rolls the cache back; a success
 * revalidates for the authoritative next episode. Unmount during the window
 * keeps the op — only the visuals are windowed. 429/network handling lives in
 * the queue behind `runtime.submit`.
 */
export function useMarkWatched(): MarkWatched {
  const submit = useOptimisticWrite();
  const queryClient = useQueryClient();
  const haptics = useHaptics();
  // The open reverse windows, mirrored two ways: the ref feeds async closures
  // (which must survive re-renders and unmount), the stamp map drives rendering.
  const records = useRef(new Map<number, MarkRecord>());
  const [stamps, setStamps] = useState<ReadonlyMap<number, number>>(new Map());
  // The rolling snackbar batch (chronological) + the seq of the snack it owns,
  // so a retraction never clobbers an unrelated snack that replaced it.
  const batch = useRef<readonly MarkRecord[]>([]);
  const ownedSnackSeq = useRef(0);
  // Synchronous in-flight lock keyed by show id. `entry.pendingAdvance` only guards
  // AFTER the optimistic cache patch re-renders, so two activations on the same
  // stale `entry` (a fast double-click / Enter key-repeat) both clear it and enqueue
  // a duplicate `POST /sync/history`. This ref is checked-and-set before the patch,
  // dropping the second activation in a synchronous burst, and released when the
  // write settles (done | failed | deferred) or the mark is reversed.
  const inFlight = useRef<Set<number>>(new Set());

  // Ops whose reversal has been requested: their mark-side revalidate is
  // suppressed, else a landed mark's refetch would clobber the undone UI with
  // post-mark server state until the unmark lands (the reversal's own
  // revalidate reconciles once it does).
  const reversedOps = useRef<Set<string>>(new Set());

  // Abort any in-flight library refetch before an optimistic patch, so a
  // response already on the wire can't land after the patch and flicker the
  // entry back to its pre-patch server state.
  const patch = useCallback(
    (showId: number, next: (entry: LibraryEntry) => LibraryEntry) => {
      void queryClient.cancelQueries({ queryKey: queryKeys.library() });
      patchLibraryEntry(queryClient, showId, next);
    },
    [queryClient],
  );

  // A mark from Up Next advances the library entry, but the marked show's detail
  // views (header X/Y + next-up, season ticks, the marked episode) live on
  // separate cache keys the last-activities gate never re-syncs for a local write.
  // Invalidate them alongside `library` so they refetch on next visit: durably,
  // since the invalidated flag persists across a reload. History rides along so
  // the fresh play surfaces in the home "Previously" section without waiting for
  // the next activities poll.
  const revalidate = useCallback(
    (showId: number, episode: { readonly season: number; readonly number: number }) => {
      invalidateShowProgress(queryClient, showId, episode);
      void queryClient.invalidateQueries({ queryKey: queryKeys.historyPrefix() });
    },
    [queryClient],
  );

  const openWindow = useCallback((record: MarkRecord) => {
    records.current.set(record.showId, record);
    setStamps((prev) => new Map(prev).set(record.showId, record.at));
  }, []);

  /** Close the show's window; with `opId`, only if that op still owns it (a
   * later hard failure of an earlier mark can't clear a newer window). */
  const closeWindow = useCallback((showId: number, opId?: string): boolean => {
    const current = records.current.get(showId);
    if (current === undefined || (opId !== undefined && current.opId !== opId)) return false;
    records.current.delete(showId);
    setStamps((prev) => {
      const next = new Map(prev);
      next.delete(showId);
      return next;
    });
    return true;
  }, []);

  /** Enqueue the inverse of one record. The forward (undone) patch has already
   * run, so a hard failure must re-advance to the marked state Trakt still
   * holds; a deferred removal keeps the undone state (revalidating before it
   * lands would refetch pre-undo server state). */
  const submitReversal = useCallback(
    async (record: MarkRecord) => {
      reversedOps.current.add(record.opId);
      const context: MarkContext = {
        showId: record.showId,
        preCompleted: record.preCompleted + 1,
      };
      const op = buildUnmarkEpisodeOp({
        opId: crypto.randomUUID(),
        ids: record.episodeIds,
        watchedAt: record.watchedAt,
        inversePatch: context,
      });
      let outcome: SubmitOutcome;
      try {
        outcome = await submit([op], {
          rollback: () =>
            patch(record.showId, () => advancePastNext(record.beforeMark, record.watchedAt)),
          revalidate: () =>
            revalidate(record.showId, { season: record.season, number: record.number }),
        });
      } finally {
        // The queue is ordered, so the mark op settled before its reversal did:
        // the suppression entry is spent and must not accumulate.
        reversedOps.current.delete(record.opId);
      }
      if (outcome === "failed") {
        showSnack({
          message: `Couldn't undo ${record.title}. Please try again.`,
          actions: [{ label: "Dismiss", onPress: dismissSnack }],
        });
      }
    },
    [submit, patch, revalidate],
  );

  const undoBatch = useCallback(async () => {
    // Newest first, so a binge on one show settles at its EARLIEST beforeMark.
    const pending = [...batch.current].reverse();
    batch.current = [];
    dismissSnack();
    if (pending.length === 0) return;
    haptics.markUndone();
    for (const record of pending) {
      closeWindow(record.showId, record.opId);
      inFlight.current.delete(record.showId);
      patch(record.showId, () => record.beforeMark);
    }
    await Promise.all(pending.map((record) => submitReversal(record)));
  }, [haptics, closeWindow, patch, submitReversal]);

  /** Show (or update) the snack for the current batch; empty batch retracts it. */
  const presentBatch = useCallback(() => {
    const current = batch.current;
    const head = current[current.length - 1];
    if (head === undefined) {
      dismissSnack();
      return;
    }
    const message =
      current.length === 1
        ? `${middleTruncate(head.title)} ${head.code} marked`
        : `${current.length} episodes marked`;
    showSnack({
      message,
      actions: [{ label: "Undo", testId: "snackbar-undo", onPress: () => void undoBatch() }],
    });
    ownedSnackSeq.current = useSnackbar.getState().snack?.seq ?? 0;
  }, [undoBatch]);

  const mark = useCallback(
    async (entry: LibraryEntry) => {
      const episode = entry.nextEpisode;
      if (episode === null || entry.pendingAdvance) return;
      // Second synchronous activation in the same burst: its optimistic advance
      // hasn't re-rendered yet, so drop it before it can enqueue a duplicate play.
      if (inFlight.current.has(entry.showId)) return;
      inFlight.current.add(entry.showId);
      const watchedAt = new Date().toISOString();
      const opId = crypto.randomUUID();
      const record: MarkRecord = {
        opId,
        showId: entry.showId,
        title: entry.title,
        code: epCode(episode.season, episode.number),
        at: Date.now(),
        episodeIds: episode.ids,
        season: episode.season,
        number: episode.number,
        watchedAt,
        preCompleted: entry.completed,
        beforeMark: entry,
      };

      // Optimistic first: the row advances before we ever touch the network, and
      // the snackbar + reverse window mount synchronously with it.
      patch(entry.showId, (e) => advancePastNext(e, watchedAt));
      openWindow(record);
      batch.current = appendToBatch(batch.current, record);
      presentBatch();
      // One buzz at the point of action, once per committed mark: fired with the
      // optimistic advance, never on the rollback path below.
      haptics.markCommitted();

      const context: MarkContext = { showId: entry.showId, preCompleted: entry.completed };
      const op = buildMarkEpisodeOp({ opId, ids: episode.ids, watchedAt, inversePatch: context });

      // The seam rolls the optimistic advance back on a hard failure and revalidates
      // only once the write lands ("deferred" keeps the advance: a refetch would
      // read pre-mark server state and bounce the row back).
      let outcome: SubmitOutcome;
      try {
        outcome = await submit([op], {
          rollback: () => patch(entry.showId, () => record.beforeMark),
          revalidate: () => {
            if (reversedOps.current.has(opId)) return;
            revalidate(entry.showId, { season: episode.season, number: episode.number });
          },
        });
      } finally {
        // The write has settled (done | failed | deferred): or submit threw
        // (a persistence fault): release the lock either way so a deliberate later
        // mark of the show's next episode is never wedged behind a stuck lock.
        inFlight.current.delete(entry.showId);
      }
      if (outcome !== "failed") return;
      // Rollback already ran; retire this op's window + batch entry. Only surface
      // the error if the user hadn't already reversed it (a reversal against a
      // never-landed mark coalesces to a no-op, so silence is correct there).
      const ownedWindow = closeWindow(entry.showId, opId);
      const inBatch = batch.current.some((r) => r.opId === opId);
      batch.current = batch.current.filter((r) => r.opId !== opId);
      if (ownedWindow || inBatch) {
        showSnack({
          message: `Couldn't mark ${entry.title} watched. Please try again.`,
          actions: [{ label: "Dismiss", onPress: dismissSnack }],
        });
      }
    },
    [patch, openWindow, presentBatch, closeWindow, revalidate, submit, haptics],
  );

  const reverse = useCallback(
    async (showId: number) => {
      const record = records.current.get(showId);
      if (record === undefined) return;
      closeWindow(showId);
      inFlight.current.delete(showId);
      batch.current = batch.current.filter((r) => r.opId !== record.opId);
      // Retract (or recount) the mark snack — but never a snack that replaced it.
      if (useSnackbar.getState().snack?.seq === ownedSnackSeq.current) presentBatch();
      patch(showId, () => record.beforeMark);
      // The distinct take-back tick, once, with the optimistic reversal.
      haptics.markUndone();
      await submitReversal(record);
    },
    [closeWindow, presentBatch, patch, haptics, submitReversal],
  );

  return {
    mark,
    reverse,
    reArm: useCallback((showId: number) => void closeWindow(showId), [closeWindow]),
    justMarkedAt: (showId) => stamps.get(showId) ?? null,
  };
}
