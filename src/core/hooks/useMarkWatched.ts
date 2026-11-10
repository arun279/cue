import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { queryKeys } from "../data/query-keys";
import {
  advancePastNext,
  epCode,
  type LibraryEntry,
  playsOnlyInProgress,
  withMarkFields,
} from "../domain/model/library";
import {
  buildMarkEpisodeOp,
  buildUndoAddOp,
  buildUnmarkEpisodeOp,
  episodeItemKey,
} from "../domain/write-queue/ops";
import { replacedPlays } from "../domain/write-queue/receipt";
import type { QueuedOp } from "../domain/write-queue/types";
import { middleTruncate } from "../format";
import { type Haptics, useHaptics } from "../ports/haptics";
import { type SubmitOutcome, useRuntime } from "../runtime/runtime";
import {
  isReversalRequested,
  type MarkRecord,
  ownsSnack,
  requestReversal,
  setOwnedSnackSeq,
  settleReversal,
  useMarkStore,
} from "../stores/mark-store";
import { forgetOwnMark, keepOwnMark, type OwnMark } from "../stores/own-marks";
import {
  dismissSnack,
  type SnackMessage,
  showSnack,
  snackText,
  useSnackbar,
} from "../stores/snackbar-store";
import {
  claimWriteLock,
  hasPendingMark,
  latestWrite,
  pendingMarkLock,
  releaseWriteLock,
  showWriteLock,
  writesBegun,
} from "../stores/write-locks";
import { appendToBatch } from "../sync-contract";
import {
  ensureLibraryEntry,
  patchEpisodeDetail,
  patchLibraryEntry,
  patchShowSeasons,
  patchStopped,
  refreshShowProgress,
  stoppedIn,
} from "./library-cache";
import { REPLACED_COPY } from "./replaced-copy";
import { canRemoveOwnPlays, takeBack, waitUntilSettled } from "./resolve-unmark";
import { useOptimisticWrite, writeTarget } from "./useOptimisticWrite";
import { useResumeOnMark } from "./useResumeOnMark";

export interface MarkWatched {
  mark(entry: LibraryEntry): Promise<void>;
  reverse(showId: number): Promise<void>;
  reArm(showId: number): void;
  justMarkedAt(showId: number): number | null;
}

function retire(record: MarkRecord): boolean {
  const store = useMarkStore.getState();
  const inBatch = store.batch.some((r) => r.opId === record.opId);
  store.setBatch(store.batch.filter((r) => r.opId !== record.opId));
  return store.close(record.showId, record.opId) || inBatch;
}

function showReplaced(record: MarkRecord, undoPressed: boolean): void {
  const message = REPLACED_COPY.mark(`${record.title} ${record.code}`);
  showSnack({
    message: undoPressed ? `${snackText(message)} ${REPLACED_COPY.undoNote}` : message,
    actions: [{ label: "Dismiss", onPress: dismissSnack }],
  });
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

  const reapplyMark = useCallback(
    (record: MarkRecord) => {
      keepOwnMark(record.showId, record);
      patch(record.showId, (entry) =>
        withMarkFields(entry, advancePastNext(record.beforeMark, record.watchedAt)),
      );
      patchProgress(
        record.showId,
        { season: record.season, number: record.number },
        true,
        record.watchedAt,
      );
    },
    [patch, patchProgress],
  );

  /** Shows the mark undone at once, with the show stopped again if the mark resumed it. */
  const showUndone = useCallback(
    (record: MarkRecord) => {
      forgetOwnMark(record.showId);
      patch(record.showId, (entry) => withMarkFields(entry, record.beforeMark));
      patchProgress(record.showId, { season: record.season, number: record.number }, false, null);
      if (record.stopped !== null) patchStopped(queryClient, record.showId, record.stopped);
    },
    [queryClient, patch, patchProgress],
  );

  const showKept = useCallback(
    (record: MarkRecord) => {
      reapplyMark(record);
      if (record.stopped !== null) patchStopped(queryClient, record.showId, null);
    },
    [queryClient, reapplyMark],
  );

  const revalidate = useCallback(
    (
      showId: number,
      episode: { readonly season: number; readonly number: number },
      ownMark?: OwnMark,
    ) => {
      void refreshShowProgress(
        queryClient,
        showId,
        () => runtime.loadShowProgress(showId),
        episode,
        ownMark,
      ).catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: queryKeys.historyPrefix() });
    },
    [queryClient, runtime],
  );

  /** The write that takes the mark back, none when it never reached Trakt, or why it cannot be. */
  const takeBackMark = useCallback(
    (record: MarkRecord, priorPlay: boolean): QueuedOp | null | "replaced" | "unknown" => {
      const state = runtime.writeState(record.opId);
      const write = { opId: record.opId, ids: record.episodeIds, watchedAt: record.watchedAt };
      if (state === "unsent") return buildUnmarkEpisodeOp({ ...write, opId: runtime.newId() });
      if (state !== "sent" && state !== "done") return null;
      const verdict = takeBack(runtime, [record.opId], priorPlay);
      return verdict === "plays"
        ? buildUndoAddOp(runtime.newId(), buildMarkEpisodeOp(write))
        : verdict;
    },
    [runtime],
  );

  /** Keeps a mark its Undo cannot take back, says why, and reads the show back from Trakt. */
  const keepMark = useCallback(
    (record: MarkRecord, why: "replaced" | "unknown") => {
      showKept(record);
      if (why === "replaced") showReplaced(record, true);
      else showUndoFailed(haptics, record.title);
      const at = { season: record.season, number: record.number };
      revalidate(record.showId, at, why === "unknown" ? record : undefined);
    },
    [showKept, haptics, revalidate],
  );

  const runReversal = useCallback(
    async (record: MarkRecord): Promise<SubmitOutcome | null> => {
      const pressed = writesBegun();
      const priorPlay = !playsOnlyInProgress(record.beforeMark);
      if (runtime.writeState(record.opId) === "sent" && !canRemoveOwnPlays(priorPlay)) {
        await waitUntilSettled(runtime, [record.opId]);
      }
      const mark = takeBackMark(record, priorPlay);
      if (mark === "replaced" || mark === "unknown") {
        keepMark(record, mark);
        return null;
      }
      const target = writeTarget("show", record.showId);
      const undoIsLatest = latestWrite(target) <= pressed;
      const reversal =
        mark === null
          ? null
          : submit(target, [mark], () =>
              revalidate(record.showId, { season: record.season, number: record.number }),
            );
      if (record.stopped !== null && undoIsLatest) {
        resume.stopAgain(
          record.showId,
          { trakt: record.showId },
          record.stopped,
          mark === null ? [] : [mark],
        );
      }
      return reversal;
    },
    [runtime, takeBackMark, submit, keepMark, revalidate, resume],
  );

  const submitReversal = useCallback(
    async (record: MarkRecord) => {
      requestReversal(record.opId);
      try {
        await runReversal(record);
      } finally {
        settleReversal(record.opId);
      }
    },
    [runReversal],
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
      showUndone(record);
    }
    await Promise.all(pending.map((record) => submitReversal(record)));
  }, [haptics, showUndone, submitReversal]);

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

  const settleMark = useCallback(
    (record: MarkRecord, outcome: SubmitOutcome) => {
      const replaced = outcome === "done" && replacedPlays(runtime.writeReceipt(record.opId)) > 0;
      if ((replaced || outcome === "failed") && retire(record) && replaced) {
        showReplaced(record, false);
      }
    },
    [runtime],
  );

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
        stopped: stoppedIn(queryClient, entry.showId),
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

      const op = buildMarkEpisodeOp({ opId, ids: episode.ids, watchedAt });

      let outcome: SubmitOutcome;
      try {
        const marking = submit(writeTarget("show", entry.showId), [op], () => {
          if (isReversalRequested(opId)) return;
          const replaced = replacedPlays(runtime.writeReceipt(opId)) > 0;
          const at = { season: episode.season, number: episode.number };
          revalidate(entry.showId, at, replaced ? undefined : record);
        });
        if (record.stopped !== null) resume.resume(entry.showId, { trakt: entry.showId });
        outcome = await marking;
      } finally {
        releaseWriteLock(showLock, opId);
        releaseWriteLock(pendingLock, opId);
      }
      settleMark(record, outcome);
    },
    [
      runtime,
      patch,
      patchProgress,
      presentBatch,
      revalidate,
      submit,
      haptics,
      queryClient,
      resume,
      settleMark,
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
      showUndone(record);
      haptics.success();
      await submitReversal(record);
    },
    [presentBatch, showUndone, haptics, submitReversal],
  );

  return useMemo(() => ({ mark, reverse, reArm, justMarkedAt }), [mark, reverse]);
}

const reArm = (showId: number): void => void useMarkStore.getState().close(showId);

const justMarkedAt = (showId: number): number | null =>
  useMarkStore.getState().records.get(showId)?.at ?? null;
