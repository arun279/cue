import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
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
import { type Haptics, useHaptics } from "../ports/haptics";
import { type CueRuntime, type SubmitOutcome, useRuntime } from "../runtime/runtime";
import {
  isReversalRequested,
  type MarkRecord,
  ownsSnack,
  requestReversal,
  setOwnedSnackSeq,
  settleReversal,
  useMarkStore,
} from "../stores/mark-store";
import { dismissSnack, type SnackMessage, showSnack, useSnackbar } from "../stores/snackbar-store";
import {
  claimWriteLock,
  hasPendingMark,
  pendingMarkLock,
  releaseWriteLock,
  showWriteLock,
} from "../stores/write-locks";
import { appendToBatch } from "../sync-contract";
import {
  ensureLibraryEntry,
  patchEpisodeDetail,
  patchLibraryEntry,
  patchShowSeasons,
  refreshShowProgress,
} from "./library-cache";
import { findMarkPlay } from "./resolve-unmark";
import { useOptimisticWrite } from "./useOptimisticWrite";
import { useResumeOnMark } from "./useResumeOnMark";

export interface MarkWatched {
  mark(entry: LibraryEntry): Promise<void>;
  reverse(showId: number): Promise<void>;
  reArm(showId: number): void;
  justMarkedAt(showId: number): number | null;
}

const IN_FLIGHT_POLL_MS = 200;
const IN_FLIGHT_POLL_TRIES = 50;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitWhileInFlight(runtime: CueRuntime, opId: string): Promise<boolean> {
  for (let attempt = 0; attempt < IN_FLIGHT_POLL_TRIES; attempt += 1) {
    if (runtime.inFlightOpId() !== opId) return true;
    await sleep(IN_FLIGHT_POLL_MS);
  }
  return false;
}

function showUndoFailed(haptics: Haptics, title: string): void {
  haptics.failure();
  showSnack({
    message: `Couldn't undo ${title}. Please try again.`,
    actions: [{ label: "Dismiss", onPress: dismissSnack }],
  });
}

export function useMarkWatched(): MarkWatched {
  const submit = useOptimisticWrite();
  const queryClient = useQueryClient();
  const runtime = useRuntime();
  const haptics = useHaptics();
  const resume = useResumeOnMark();
  const patch = useCallback(
    (showId: number, next: (entry: LibraryEntry) => LibraryEntry) => {
      void queryClient.cancelQueries({ queryKey: queryKeys.library() });
      patchLibraryEntry(queryClient, showId, next);
    },
    [queryClient],
  );

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

  const restorePreMark = useCallback(
    (record: MarkRecord) => {
      patch(record.showId, () => record.beforeMark);
      patchProgress(record.showId, { season: record.season, number: record.number }, false, null);
    },
    [patch, patchProgress],
  );

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

  const revalidate = useCallback(
    (showId: number, episode: { readonly season: number; readonly number: number }) => {
      refreshShowProgress(queryClient, showId, () => runtime.loadShowProgress(showId), episode);
      void queryClient.invalidateQueries({ queryKey: queryKeys.historyPrefix() });
    },
    [queryClient, runtime],
  );

  const runReversal = useCallback(
    async (record: MarkRecord): Promise<SubmitOutcome | null> => {
      const effects = {
        onKept: record.beforeMark.hidden
          ? () => resume.reStop(record.showId, { trakt: record.showId })
          : undefined,
        rollback: () => reapplyMark(record),
        revalidate: () =>
          revalidate(record.showId, { season: record.season, number: record.number }),
      };
      if (!(await waitWhileInFlight(runtime, record.opId))) {
        reapplyMark(record);
        showUndoFailed(haptics, record.title);
        return null;
      }
      if (runtime.pendingOps().some((op) => op.id === record.opId)) {
        const context: MarkContext = {
          showId: record.showId,
          preCompleted: record.preCompleted + 1,
        };
        const op = buildUnmarkEpisodeOp({
          opId: runtime.newId(),
          ids: record.episodeIds,
          watchedAt: record.watchedAt,
          inversePatch: context,
        });
        return submit([op], effects);
      }
      let plays: Awaited<ReturnType<CueRuntime["loadEpisodePlays"]>>;
      try {
        plays = await runtime.loadEpisodePlays(record.episodeIds.trakt);
      } catch {
        reapplyMark(record);
        showUndoFailed(haptics, record.title);
        return null;
      }
      const target = findMarkPlay(plays, record.episodeIds.trakt, record.watchedAt);
      if (target === undefined) {
        effects.revalidate();
        return null;
      }
      return submit(
        [
          buildRemovePlaysOp({
            opId: runtime.newId(),
            ids: [target.historyId],
            restore: [{ trakt: record.episodeIds.trakt, watchedAt: target.watchedAt }],
          }),
        ],
        effects,
      );
    },
    [runtime, submit, reapplyMark, revalidate, haptics, resume],
  );

  const submitReversal = useCallback(
    async (record: MarkRecord) => {
      requestReversal(record.opId);
      let outcome: SubmitOutcome | null;
      try {
        outcome = await runReversal(record);
      } finally {
        settleReversal(record.opId);
      }
      if (outcome === "failed") showUndoFailed(haptics, record.title);
    },
    [runReversal, haptics],
  );

  const undoBatch = useCallback(async () => {
    const store = useMarkStore.getState();
    const pending = [...store.batch].reverse();
    store.setBatch([]);
    dismissSnack();
    if (pending.length === 0) return;
    haptics.success();
    for (const record of pending) {
      store.close(record.showId, record.opId);
      releaseWriteLock(showWriteLock(record.showId), record.opId);
      releaseWriteLock(pendingMarkLock(episodeItemKey(record.episodeIds.trakt)), record.opId);
      restorePreMark(record);
    }
    await Promise.all(pending.map((record) => submitReversal(record)));
  }, [haptics, restorePreMark, submitReversal]);

  const presentBatch = useCallback(() => {
    const current = useMarkStore.getState().batch;
    const head = current[current.length - 1];
    if (head === undefined) {
      dismissSnack();
      return;
    }
    const message: SnackMessage =
      current.length === 1
        ? { subject: middleTruncate(head.title), predicate: ` ${head.code} marked` }
        : `${current.length} episodes marked`;
    setOwnedSnackSeq(
      showSnack({
        message,
        actions: [{ label: "Undo", testId: "snackbar-undo", onPress: () => void undoBatch() }],
      }),
    );
  }, [undoBatch]);

  const mark = useCallback(
    async (entry: LibraryEntry) => {
      const episode = entry.nextEpisode;
      if (episode === null || entry.pendingAdvance) return;
      const opId = runtime.newId();
      const showLock = showWriteLock(entry.showId);
      if (!claimWriteLock(showLock, opId)) return;
      const itemKey = episodeItemKey(episode.ids.trakt);
      if (hasPendingMark(runtime, itemKey)) {
        releaseWriteLock(showLock, opId);
        return;
      }
      const pendingLock = pendingMarkLock(itemKey);
      claimWriteLock(pendingLock, opId);
      const watchedAt = new Date().toISOString();
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

      ensureLibraryEntry(queryClient, entry);
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
      haptics.success();

      const context: MarkContext = { showId: entry.showId, preCompleted: entry.completed };
      const op = buildMarkEpisodeOp({ opId, ids: episode.ids, watchedAt, inversePatch: context });

      let outcome: SubmitOutcome;
      try {
        outcome = await submit([op], {
          rollback: () => restorePreMark(record),
          onKept: () => resume.resumeIfStopped(entry.showId, { trakt: entry.showId }),
          revalidate: () => {
            if (isReversalRequested(opId)) return;
            revalidate(entry.showId, { season: episode.season, number: episode.number });
          },
        });
      } finally {
        releaseWriteLock(showLock, opId);
        releaseWriteLock(pendingLock, opId);
      }
      if (outcome !== "failed") return;
      const after = useMarkStore.getState();
      const ownedWindow = after.close(entry.showId, opId);
      const inBatch = after.batch.some((r) => r.opId === opId);
      after.setBatch(after.batch.filter((r) => r.opId !== opId));
      if (ownedWindow || inBatch) {
        haptics.failure();
        showSnack({
          message: `Couldn't mark ${entry.title} watched. Please try again.`,
          actions: [{ label: "Dismiss", onPress: dismissSnack }],
        });
      }
    },
    [
      runtime,
      patch,
      patchProgress,
      presentBatch,
      restorePreMark,
      revalidate,
      submit,
      haptics,
      queryClient,
      resume,
    ],
  );

  const reverse = useCallback(
    async (showId: number) => {
      const store = useMarkStore.getState();
      const record = store.records.get(showId);
      if (record === undefined) return;
      store.close(showId);
      releaseWriteLock(showWriteLock(showId), record.opId);
      releaseWriteLock(pendingMarkLock(episodeItemKey(record.episodeIds.trakt)), record.opId);
      store.setBatch(store.batch.filter((r) => r.opId !== record.opId));
      if (ownsSnack(useSnackbar.getState().snack?.seq)) presentBatch();
      restorePreMark(record);
      haptics.success();
      await submitReversal(record);
    },
    [presentBatch, restorePreMark, haptics, submitReversal],
  );

  return {
    mark,
    reverse,
    reArm: useCallback((showId: number) => void useMarkStore.getState().close(showId), []),
    justMarkedAt: (showId) => useMarkStore.getState().records.get(showId)?.at ?? null,
  };
}
