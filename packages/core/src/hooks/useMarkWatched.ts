import { useQueryClient } from "@tanstack/react-query";
import { createElement, Fragment, useCallback } from "react";
import { invalidateShowProgress } from "../data/query-invalidation";
import { queryKeys } from "../data/query-keys";
import { advancePastNext, type LibraryEntry, type MarkContext } from "../data/trakt/library";
import { epCode } from "../domain/model/library";
import {
  buildMarkEpisodeOp,
  buildRemovePlaysOp,
  buildUnmarkEpisodeOp,
  episodeItemKey,
} from "../domain/write-queue/ops";
import { middleTruncate } from "../format";
import { useHaptics } from "../runtime/haptics";
import { type CueRuntime, type SubmitOutcome, useRuntime } from "../runtime/runtime";
import {
  hasPendingMark,
  isReversalRequested,
  lockShow,
  type MarkRecord,
  ownsSnack,
  registerPendingMark,
  releasePendingMark,
  requestReversal,
  setOwnedSnackSeq,
  settleReversal,
  unlockShow,
  useMarkStore,
} from "../stores/mark-store";
import { dismissSnack, showSnack, useSnackbar } from "../stores/snackbar-store";
import { patchEpisodeDetail, patchLibraryEntry, patchShowSeasons } from "./library-cache";
import { appendToBatch } from "./mark-undo-window";
import { findMarkPlay } from "./resolveUnmark";
import { useOptimisticWrite } from "./useOptimisticWrite";

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

/** Reversal of a mark that is mid-delivery waits for the queue to settle it in
 * these steps: it can be neither cancelled (its POST may land) nor resolved
 * per-play (its play isn't in history yet). Bounded: a retry storm must not
 * wedge the undo forever. */
const IN_FLIGHT_POLL_MS = 200;
const IN_FLIGHT_POLL_TRIES = 50;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolve true once the op is no longer being delivered; false = wait budget spent. */
async function waitWhileInFlight(runtime: CueRuntime, opId: string): Promise<boolean> {
  for (let attempt = 0; attempt < IN_FLIGHT_POLL_TRIES; attempt += 1) {
    if (runtime.inFlightOpId() !== opId) return true;
    await sleep(IN_FLIGHT_POLL_MS);
  }
  return false;
}

function showUndoFailed(title: string): void {
  showSnack({
    message: `Couldn't undo ${title}. Please try again.`,
    actions: [{ label: "Dismiss", onPress: dismissSnack }],
  });
}

/**
 * The mark-watched hot path: advance the entry optimistically in the Query
 * cache BEFORE the network write, enqueue a durable, paced `POST /sync/history`
 * (frozen `watched_at`) through the injected runtime, and feed the app snackbar
 * a rolling batch whose Undo reverses every mark in it. Until the authoritative
 * next episode lands the filled check stays a live undo toggle (`reverse`);
 * reversal cancels a still-queued op via write-queue coalescing, and per-play
 * reverses one that already landed (never a remove-by-item, which would wipe
 * plays predating the mark). A hard failure rolls the cache back; a success
 * revalidates for the authoritative next episode. All window/batch state lives
 * in the module-level mark store, so every mounted surface shares one truth and
 * unmount during the window keeps the op AND the reverse affordance. 429 and
 * network handling live in the queue behind `runtime.submit`.
 */
export function useMarkWatched(): MarkWatched {
  const submit = useOptimisticWrite();
  const queryClient = useQueryClient();
  const runtime = useRuntime();
  const haptics = useHaptics();
  // Reactive view of the shared reverse windows: `justMarkedAt` re-renders every
  // consumer, whichever surface opened the window.
  const records = useMarkStore((s) => s.records);

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

  // A queue mark must tick the show-detail surfaces in the same frame as the
  // library advance: the season tree and the marked episode's detail read
  // otherwise lag until the op lands and revalidates, and a season row still
  // showing unwatched for that window is a second tap → duplicate play. Cancels
  // in-flight refetches on those keys first, same defense `patch` runs.
  const patchProgress = useCallback(
    (
      showId: number,
      episode: { readonly season: number; readonly number: number },
      watched: boolean,
      watchedAt: string | null,
    ) => {
      void queryClient.cancelQueries({ queryKey: queryKeys.showSeasons(showId) });
      void queryClient.cancelQueries({
        queryKey: queryKeys.episode(showId, episode.season, episode.number),
      });
      patchShowSeasons(
        queryClient,
        showId,
        (s, n) => s === episode.season && n === episode.number,
        watched,
      );
      patchEpisodeDetail(queryClient, showId, episode, watched, watchedAt);
    },
    [queryClient],
  );

  /** Restore every cache the mark touched to its pre-mark state. */
  const restorePreMark = useCallback(
    (record: MarkRecord) => {
      patch(record.showId, () => record.beforeMark);
      patchProgress(record.showId, { season: record.season, number: record.number }, false, null);
    },
    [patch, patchProgress],
  );

  /** Re-apply the mark's optimistic state (a failed reversal: Trakt still holds the play). */
  const reapplyMark = useCallback(
    (record: MarkRecord) => {
      patch(record.showId, () => advancePastNext(record.beforeMark, record.watchedAt));
      patchProgress(
        record.showId,
        { season: record.season, number: record.number },
        true,
        record.watchedAt,
      );
    },
    [patch, patchProgress],
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

  /**
   * Enqueue the durable reversal of one record. The forward (undone) patch has
   * already run. Routing by the durable queue: a STILL-QUEUED mark is reversed
   * by its coalescing inverse (the pair vanishes, nothing was ever sent); a
   * LANDED mark is reversed per-play: resolve the episode's real plays and
   * remove only the play this mark created, by exact history id, so plays that
   * predate the mark ("restart show" rewatchers) are untouchable. When the play
   * can't be identified (offline), the undo fails honestly: the marked row is
   * restored and the snackbar says so: never a silent remove-by-item.
   */
  const runReversal = useCallback(
    async (record: MarkRecord): Promise<SubmitOutcome | null> => {
      const effects = {
        // A hard failure means Trakt still holds the play: re-advance to the
        // marked state; a deferred removal keeps the undone state (revalidating
        // before it lands would refetch pre-undo server state).
        rollback: () => reapplyMark(record),
        revalidate: () =>
          revalidate(record.showId, { season: record.season, number: record.number }),
      };
      if (!(await waitWhileInFlight(runtime, record.opId))) {
        reapplyMark(record);
        showUndoFailed(record.title);
        return null;
      }
      if (runtime.pendingOps().some((op) => op.id === record.opId)) {
        // Still queued, undelivered: the inverse coalesce-cancels the pair.
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
        return submit([op], effects);
      }
      // The mark left the queue: it landed (or hard-failed, in which case no
      // play matches below and nothing is removed). Reverse per-play.
      let plays: Awaited<ReturnType<CueRuntime["loadEpisodePlays"]>>;
      try {
        plays = await runtime.loadEpisodePlays(record.episodeIds.trakt);
      } catch {
        reapplyMark(record);
        showUndoFailed(record.title);
        return null;
      }
      const target = findMarkPlay(plays, record.episodeIds.trakt, record.watchedAt);
      if (target === undefined) {
        // The mark's play isn't on the server (never landed, or already removed
        // elsewhere): the undo intent is already satisfied; reconcile the row.
        effects.revalidate();
        return null;
      }
      return submit(
        [
          buildRemovePlaysOp({
            opId: crypto.randomUUID(),
            ids: [target.historyId],
            restore: [{ trakt: record.episodeIds.trakt, watchedAt: target.watchedAt }],
          }),
        ],
        effects,
      );
    },
    [runtime, submit, reapplyMark, revalidate],
  );

  const submitReversal = useCallback(
    async (record: MarkRecord) => {
      requestReversal(record.opId);
      let outcome: SubmitOutcome | null;
      try {
        outcome = await runReversal(record);
      } finally {
        // The queue is ordered, so the mark op settled before its reversal did:
        // the suppression entry is spent and must not accumulate.
        settleReversal(record.opId);
      }
      if (outcome === "failed") showUndoFailed(record.title);
    },
    [runReversal],
  );

  const undoBatch = useCallback(async () => {
    const store = useMarkStore.getState();
    // Newest first, so a binge on one show settles at its EARLIEST beforeMark.
    const pending = [...store.batch].reverse();
    store.setBatch([]);
    dismissSnack();
    if (pending.length === 0) return;
    haptics.success();
    for (const record of pending) {
      store.close(record.showId, record.opId);
      unlockShow(record.showId);
      releasePendingMark(episodeItemKey(record.episodeIds.trakt), record.opId);
      restorePreMark(record);
    }
    await Promise.all(pending.map((record) => submitReversal(record)));
  }, [haptics, restorePreMark, submitReversal]);

  /** Show (or update) the snack for the current batch; empty batch retracts it. */
  const presentBatch = useCallback(() => {
    const current = useMarkStore.getState().batch;
    const head = current[current.length - 1];
    if (head === undefined) {
      dismissSnack();
      return;
    }
    const message =
      current.length === 1
        ? createElement(
            Fragment,
            null,
            createElement("strong", null, middleTruncate(head.title)),
            ` ${head.code} marked`,
          )
        : `${current.length} episodes marked`;
    showSnack({
      message,
      actions: [{ label: "Undo", testId: "snackbar-undo", onPress: () => void undoBatch() }],
    });
    setOwnedSnackSeq(useSnackbar.getState().snack?.seq ?? 0);
  }, [undoBatch]);

  const mark = useCallback(
    async (entry: LibraryEntry) => {
      const episode = entry.nextEpisode;
      if (episode === null || entry.pendingAdvance) return;
      // Second synchronous activation in the same burst: its optimistic advance
      // hasn't re-rendered yet, so drop it before it can enqueue a duplicate play.
      if (!lockShow(entry.showId)) return;
      const itemKey = episodeItemKey(episode.ids.trakt);
      // A mark for this exact episode is already pending from ANOTHER path (a
      // season-row/sheet toggle, or an op restored from a previous session):
      // drop it exactly like the same-path lock above.
      if (hasPendingMark(runtime, itemKey)) {
        unlockShow(entry.showId);
        return;
      }
      const watchedAt = new Date().toISOString();
      const opId = crypto.randomUUID();
      registerPendingMark(itemKey, opId);
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

      // Optimistic first: the row advances (and the show's own season tree +
      // episode detail tick) before we ever touch the network, and the snackbar
      // + reverse window mount synchronously with it.
      patch(entry.showId, (e) => advancePastNext(e, watchedAt));
      patchProgress(
        entry.showId,
        { season: episode.season, number: episode.number },
        true,
        watchedAt,
      );
      const store = useMarkStore.getState();
      store.open(record);
      store.setBatch(appendToBatch(store.batch, record));
      presentBatch();
      // One tap at the point of action, once per committed mark: fired with the
      // optimistic advance, never on the rollback path below.
      haptics.success();

      const context: MarkContext = { showId: entry.showId, preCompleted: entry.completed };
      const op = buildMarkEpisodeOp({ opId, ids: episode.ids, watchedAt, inversePatch: context });

      // The seam rolls the optimistic advance back on a hard failure and revalidates
      // only once the write lands ("deferred" keeps the advance: a refetch would
      // read pre-mark server state and bounce the row back).
      let outcome: SubmitOutcome;
      try {
        outcome = await submit([op], {
          rollback: () => restorePreMark(record),
          revalidate: () => {
            if (isReversalRequested(opId)) return;
            revalidate(entry.showId, { season: episode.season, number: episode.number });
          },
        });
      } finally {
        // The write has settled (done | failed | deferred): or submit threw
        // (a persistence fault): release the locks either way so a deliberate later
        // mark of the show's next episode is never wedged behind a stuck lock.
        unlockShow(entry.showId);
        releasePendingMark(itemKey, opId);
      }
      if (outcome !== "failed") return;
      // Rollback already ran; retire this op's window + batch entry. Only surface
      // the error if the user hadn't already reversed it (a reversal against a
      // never-landed mark resolves to a no-op, so silence is correct there).
      const after = useMarkStore.getState();
      const ownedWindow = after.close(entry.showId, opId);
      const inBatch = after.batch.some((r) => r.opId === opId);
      after.setBatch(after.batch.filter((r) => r.opId !== opId));
      if (ownedWindow || inBatch) {
        showSnack({
          message: `Couldn't mark ${entry.title} watched. Please try again.`,
          actions: [{ label: "Dismiss", onPress: dismissSnack }],
        });
      }
    },
    [runtime, patch, patchProgress, presentBatch, restorePreMark, revalidate, submit, haptics],
  );

  const reverse = useCallback(
    async (showId: number) => {
      const store = useMarkStore.getState();
      const record = store.records.get(showId);
      if (record === undefined) return;
      store.close(showId);
      unlockShow(showId);
      // The mark no longer stands: free the episode for a deliberate re-mark.
      releasePendingMark(episodeItemKey(record.episodeIds.trakt), record.opId);
      store.setBatch(store.batch.filter((r) => r.opId !== record.opId));
      // Retract (or recount) the mark snack, but never a snack that replaced it.
      if (ownsSnack(useSnackbar.getState().snack?.seq)) presentBatch();
      restorePreMark(record);
      // The take-back is a completed action too, so it reports the same way.
      haptics.success();
      await submitReversal(record);
    },
    [presentBatch, restorePreMark, haptics, submitReversal],
  );

  return {
    mark,
    reverse,
    reArm: useCallback((showId: number) => void useMarkStore.getState().close(showId), []),
    justMarkedAt: (showId) => records.get(showId)?.at ?? null,
  };
}
