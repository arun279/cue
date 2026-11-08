import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { queryKeys } from "../data/query-keys";
import type { EpisodeIds, ShowIds } from "../domain/model/ids";
import type { Stopped } from "../domain/model/library";
import { planSeasonUnmark, type UnmarkPlan } from "../domain/reversal";
import type { EpisodeMatch, SeasonView } from "../domain/show-detail";
import { buildBulkMarkOps, type SeasonTree } from "../domain/write-queue/bulk";
import {
  buildAddEpisodePlayOp,
  buildMarkEpisodeOp,
  buildRemovePlaysOp,
  buildUndoAddOp,
  buildUnmarkEpisodeOp,
  episodeItemKey,
  markedEpisodesOf,
} from "../domain/write-queue/ops";
import type { WriteState } from "../domain/write-queue/queue";
import { replacedPlays } from "../domain/write-queue/receipt";
import type { QueuedOp } from "../domain/write-queue/types";
import { type CueRuntime, type SubmitOutcome, useRuntime } from "../runtime/runtime";
import { dismissSnack, showSnack, showUndoable, useSnackbar } from "../stores/snackbar-store";
import {
  claimWriteLock,
  episodeWriteLock,
  hasPendingMark,
  pendingMark,
  pendingMarkLock,
  releaseWriteLock,
  seasonWriteLock,
} from "../stores/write-locks";
import {
  mayHavePlaysOutsideProgress,
  patchEpisodeDetail,
  patchShowSeasons,
  refreshShowProgress,
  stoppedIn,
} from "./library-cache";
import type { OptimisticChange } from "./optimistic-write";
import { REPLACED_COPY } from "./replaced-copy";
import {
  canRemoveOwnPlays,
  type EpisodeUnmarkResolution,
  resolveEpisodeUnmark,
  takeBack,
  waitUntilSettled,
} from "./resolve-unmark";
import { useOptimisticWrite, writeTarget } from "./useOptimisticWrite";
import { useResumeOnMark } from "./useResumeOnMark";

interface MarkContextTarget {
  readonly showId: number;
  readonly ids: ShowIds;
  readonly includeSpecials: boolean;
}

interface EpisodeBound {
  readonly season: number;
  readonly number: number;
}

interface MarkableEpisode {
  readonly season: number;
  readonly number: number;
  readonly ids: EpisodeIds;
  readonly watched: boolean;
  readonly watchedAt: string | null;
}

interface ToggleEpisodeOptions {
  readonly undoLabel?: string;
  readonly knownPlays?: number;
}

interface MarkUpToHereOptions {
  readonly label?: string;
  readonly absorbUndo?: boolean;
}

interface UndoState {
  readonly showId: number;
  readonly ids: ShowIds;
  readonly label: string;
  readonly ops: readonly QueuedOp[];
  /** How the show was stopped when this write resumed it. */
  readonly stopped: Stopped | null;
  /** Whether a marked episode may have had a play before its mark. */
  readonly priorPlay: boolean;
  readonly markedEpisode?: {
    readonly episode: MarkableEpisode;
    readonly watchedAt: string;
  };
}

export interface MarkSeasonController {
  markSeason(target: MarkContextTarget, season: SeasonView): Promise<void>;
  unmarkSeason(target: MarkContextTarget, season: SeasonView): Promise<void>;
  rewatchSeason(target: MarkContextTarget, season: SeasonView): Promise<void>;
  markUpToHere(
    target: MarkContextTarget,
    seasons: readonly SeasonView[],
    bound: EpisodeBound,
    options?: MarkUpToHereOptions,
  ): Promise<void>;
  toggleEpisode(
    target: MarkContextTarget,
    episode: MarkableEpisode,
    options?: ToggleEpisodeOptions,
  ): Promise<void>;
  addEpisodePlay(target: MarkContextTarget, episode: MarkableEpisode): Promise<void>;
  removeAllPlays(target: MarkContextTarget, episode: MarkableEpisode): Promise<void>;
}

function toSeasonTrees(seasons: readonly SeasonView[]): SeasonTree[] {
  return seasons.map((season) => ({
    number: season.number,
    episodes: season.episodes.map((episode) => ({
      number: episode.number,
      firstAired: episode.firstAired,
      watched: episode.watched,
    })),
  }));
}

function invertOp(op: QueuedOp, newId: () => string): QueuedOp {
  return {
    ...op,
    id: newId(),
    request: op.inverse,
    inverse: op.request,
    fromState: op.toState,
    toState: op.fromState,
  };
}

function seasonLabel(season: number): string {
  return season === 0 ? "Specials" : `Season ${season}`;
}

function plural(count: number): string {
  return count === 1 ? "episode" : "episodes";
}

function receiptTotals(
  runtime: Pick<CueRuntime, "writeReceipt">,
  ops: readonly QueuedOp[],
): { readonly added: number; readonly replaced: number } {
  let added = 0;
  let replaced = 0;
  for (const op of ops) {
    const receipt = runtime.writeReceipt(op.id);
    added += receipt?.added ?? 0;
    replaced += replacedPlays(receipt);
  }
  return { added, replaced };
}

function showError(message: string): void {
  showSnack({ message, actions: [{ label: "Dismiss", onPress: dismissSnack }] });
}

/** The Undo of a write, taking in the earlier Undo it absorbs. */
function folded(absorb: UndoState | null, undo: UndoState): UndoState {
  return absorb === null
    ? undo
    : {
        ...undo,
        ops: [...absorb.ops, ...undo.ops],
        stopped: absorb.stopped ?? undo.stopped,
        priorPlay: absorb.priorPlay || undo.priorPlay,
      };
}

/** The Undo the snack on screen offers, while it is on screen. */
let offer: { readonly seq: number; readonly undo: UndoState } | null = null;

function offered(): UndoState | null {
  return offer?.seq === useSnackbar.getState().snack?.seq ? (offer?.undo ?? null) : null;
}

/** Takes the Undo of an episode's mark off the screen once the episode is unmarked another way. */
function retireOfferOf(episode: MarkableEpisode): void {
  if (offered()?.markedEpisode?.episode.ids.trakt === episode.ids.trakt) dismissSnack();
}

const positionOf = (season: number, number: number): string => `${season}:${number}`;

type UndoPlan = readonly QueuedOp[] | { readonly replaced: number } | null;

async function planUndo(runtime: CueRuntime, pending: UndoState): Promise<UndoPlan> {
  const marks = pending.ops.filter((op) => markedEpisodesOf(op) !== null);
  if (!canRemoveOwnPlays(pending.priorPlay)) {
    await waitUntilSettled(
      runtime,
      marks.map((op) => op.id),
    );
  }
  const state = (op: QueuedOp): WriteState => runtime.writeState(op.id);
  const onTrakt = marks.filter((op) => state(op) === "sent" || state(op) === "done");
  const verdict = takeBack(
    runtime,
    onTrakt.map((op) => op.id),
    pending.priorPlay,
  );
  if (verdict === "replaced") return { replaced: receiptTotals(runtime, onTrakt).replaced };
  if (verdict === "unknown") return null;
  return pending.ops.flatMap((op) => {
    if (onTrakt.includes(op)) return [buildUndoAddOp(runtime.newId(), op)];
    return state(op) === "failed" || state(op) === "cancelled" ? [] : [invertOp(op, runtime.newId)];
  });
}

export function useMarkSeason(): MarkSeasonController {
  const submit = useOptimisticWrite();
  const queryClient = useQueryClient();
  const runtime = useRuntime();
  const resume = useResumeOnMark();
  const settleWrite = useCallback(
    (
      outcome: SubmitOutcome,
      ops: readonly QueuedOp[],
      undoOps: readonly QueuedOp[] | null,
      failure: string,
      replacedMessage: (replaced: number) => string,
    ): void => {
      if (outcome === "failed") {
        showError(failure);
        return;
      }
      const { replaced } = receiptTotals(runtime, ops);
      if (outcome !== "done" || replaced === 0) return;
      if (undoOps !== null && offered()?.ops !== undoOps) return;
      showSnack({ message: replacedMessage(replaced) });
    },
    [runtime],
  );
  const withSeasonLock = useCallback(
    async (target: MarkContextTarget, seasonNumber: number, run: () => Promise<void>) => {
      const key = seasonWriteLock(target.showId, seasonNumber);
      const owner = {};
      if (!claimWriteLock(key, owner)) return;
      try {
        await run();
      } finally {
        releaseWriteLock(key, owner);
      }
    },
    [],
  );
  const withEpisodeLock = useCallback(
    async (target: MarkContextTarget, episode: MarkableEpisode, run: () => Promise<void>) => {
      const key = episodeWriteLock(target.showId, episode.season, episode.number);
      const owner = {};
      if (!claimWriteLock(key, owner)) return;
      try {
        await run();
      } finally {
        releaseWriteLock(key, owner);
      }
    },
    [],
  );

  const revalidate = useCallback(
    (showId: number, episode?: { readonly season: number; readonly number: number } | "all") =>
      refreshShowProgress(queryClient, showId, () => runtime.loadShowProgress(showId), episode),
    [queryClient, runtime],
  );

  const setEpisodeWatched = useCallback(
    (
      target: Pick<MarkContextTarget, "showId">,
      episode: MarkableEpisode,
      watched: boolean,
      watchedAt: string | null,
    ) => {
      void queryClient.cancelQueries({ queryKey: queryKeys.showSeasons(target.showId) });
      void queryClient.cancelQueries({
        queryKey: queryKeys.episode(target.showId, episode.season, episode.number),
      });
      patchShowSeasons(
        queryClient,
        target.showId,
        (season, number) => season === episode.season && number === episode.number,
        watched,
      );
      patchEpisodeDetail(queryClient, target.showId, episode, watched, watchedAt);
    },
    [queryClient],
  );

  const undo = useCallback(
    async (pending: UndoState) => {
      const marked = pending.markedEpisode;
      const keepMarked = (): void => {
        if (marked !== undefined)
          setEpisodeWatched(pending, marked.episode, true, marked.watchedAt);
      };
      if (marked !== undefined) setEpisodeWatched(pending, marked.episode, false, null);
      const plan = await planUndo(runtime, pending);
      if (plan === null) {
        keepMarked();
        showError("Couldn't undo that. Please try again.");
        return;
      }
      if ("replaced" in plan) {
        keepMarked();
        showSnack({
          message: `${REPLACED_COPY.bulk(pending.label, plan.replaced)} ${REPLACED_COPY.undoNote}`,
          actions: [{ label: "Dismiss", onPress: dismissSnack }],
        });
        return;
      }
      const undoing = submit(
        writeTarget("show", pending.showId),
        [{ ops: plan, revert: keepMarked }],
        () => revalidate(pending.showId, marked === undefined ? "all" : undefined),
      );
      if (pending.stopped !== null) {
        resume.stopAgain(pending.showId, pending.ids, pending.stopped, plan);
      }
      if ((await undoing) === "failed") showError("Couldn't undo that. Please try again.");
    },
    [revalidate, setEpisodeWatched, submit, resume, runtime],
  );

  const offerUndo = useCallback(
    (pending: UndoState): void => {
      offer = { seq: showUndoable(pending.label, () => undo(pending)), undo: pending };
    },
    [undo],
  );

  /**
   * Marks the matching episodes at once and sends `ops`, resuming the show if it is stopped. Each
   * write Trakt refuses unmarks again only the episodes it marked.
   */
  const submitSeasonWrite = useCallback(
    (
      target: MarkContextTarget,
      ops: readonly QueuedOp[],
      match: EpisodeMatch,
      stopped: Stopped | null,
    ): Promise<SubmitOutcome> => {
      const changed = patchShowSeasons(queryClient, target.showId, match, true);
      const changes = ops.map((op): OptimisticChange => {
        const marked = markedEpisodesOf(op)?.positions;
        return {
          ops: [op],
          revert: () =>
            patchShowSeasons(
              queryClient,
              target.showId,
              (s, n) => changed.has(positionOf(s, n)) && marked?.has(positionOf(s, n)) === true,
              false,
            ),
        };
      });
      const writing = submit(writeTarget("show", target.showId), changes, () =>
        revalidate(target.showId, "all"),
      );
      if (stopped !== null) resume.resume(target.showId, target.ids);
      return writing;
    },
    [submit, queryClient, resume, revalidate],
  );

  const submitBulk = useCallback(
    async (
      target: MarkContextTarget,
      ops: readonly QueuedOp[],
      match: EpisodeMatch,
      label: string,
      absorb: UndoState | null = null,
    ): Promise<void> => {
      if (ops.length === 0) return;
      const stopped = stoppedIn(queryClient, target.showId);
      const undo = folded(absorb, {
        showId: target.showId,
        ids: target.ids,
        label,
        ops,
        stopped,
        priorPlay: mayHavePlaysOutsideProgress(queryClient, target.showId),
      });
      const writing = submitSeasonWrite(target, ops, match, stopped);
      offerUndo(undo);
      settleWrite(
        await writing,
        ops,
        undo.ops,
        "Couldn't save that change. Please try again.",
        (n) => REPLACED_COPY.bulk(label, n),
      );
    },
    [offerUndo, queryClient, submitSeasonWrite, settleWrite],
  );

  const buildOps = useCallback(
    (
      target: MarkContextTarget,
      seasons: readonly SeasonView[],
      upTo?: EpisodeBound,
    ): readonly QueuedOp[] =>
      buildBulkMarkOps(
        {
          showIds: target.ids,
          seasons: toSeasonTrees(seasons),
          includeSpecials: target.includeSpecials,
          ...(upTo === undefined ? {} : { upTo }),
        },
        Date.now(),
        new Date().toISOString(),
        () => runtime.newId(),
      ),
    [runtime.newId],
  );

  const seasonMatch = useCallback(
    (season: SeasonView, includeSpecials: boolean): EpisodeMatch =>
      (s, _n, aired) =>
        s === season.number && aired && (s !== 0 || includeSpecials),
    [],
  );

  const markSeason = useCallback(
    async (target: MarkContextTarget, season: SeasonView) => {
      await withSeasonLock(target, season.number, async () => {
        const ops = buildOps(target, [season]);
        const count = season.episodes.filter(
          (episode) =>
            episode.aired && !episode.watched && (season.number !== 0 || target.includeSpecials),
        ).length;
        await submitBulk(
          target,
          ops,
          seasonMatch(season, target.includeSpecials),
          `${seasonLabel(season.number)} marked · ${count} ${plural(count)}`,
        );
      });
    },
    [submitBulk, buildOps, seasonMatch, withSeasonLock],
  );

  const resolveSeasonUnmark = useCallback(
    async (
      target: MarkContextTarget,
      season: SeasonView,
      aired: ReadonlySet<number>,
    ): Promise<UnmarkPlan | null> => {
      try {
        return planSeasonUnmark(
          await runtime.loadShowPlays(target.showId),
          season.number,
          target.includeSpecials,
          aired,
        );
      } catch {
        showError("Couldn't reach your history to unmark this season. Please try again.");
        return null;
      }
    },
    [runtime],
  );

  const submitSeasonUnmark = useCallback(
    async (target: MarkContextTarget, season: SeasonView, plan: UnmarkPlan) => {
      const removed = new Set(plan.restore.map((play) => positionOf(play.season, play.number)));
      const unmarked = patchShowSeasons(
        queryClient,
        target.showId,
        (season, number) => removed.has(positionOf(season, number)),
        false,
      );
      const ops = [
        buildRemovePlaysOp({
          opId: runtime.newId(),
          ids: plan.removeIds,
          restore: plan.restore.map((play) => ({
            trakt: play.trakt,
            watchedAt: play.watchedAt,
          })),
        }),
      ];
      const kept = plan.keptRewatch.length;
      const keptSuffix = kept > 0 ? ` · kept ${kept} rewatched ${plural(kept)}` : "";
      const count = plan.removeIds.length;
      const writing = submit(
        writeTarget("show", target.showId),
        [
          {
            ops,
            revert: () =>
              patchShowSeasons(
                queryClient,
                target.showId,
                (season, number) => unmarked.has(positionOf(season, number)),
                true,
              ),
          },
        ],
        () => revalidate(target.showId, "all"),
      );
      offerUndo({
        showId: target.showId,
        ids: target.ids,
        label: `${seasonLabel(season.number)} unmarked · ${count} ${plural(count)}${keptSuffix}`,
        ops,
        stopped: null,
        priorPlay: false,
      });
      if ((await writing) === "failed") showError("Couldn't unmark that season. Please try again.");
    },
    [offerUndo, queryClient, revalidate, submit, runtime.newId],
  );

  const unmarkSeason = useCallback(
    async (target: MarkContextTarget, season: SeasonView) => {
      const aired = new Set(
        season.episodes.filter((e) => e.aired).map((episode) => episode.number),
      );
      if (aired.size === 0) return;
      await withSeasonLock(target, season.number, async () => {
        const plan = await resolveSeasonUnmark(target, season, aired);
        if (plan === null) return;
        if (plan.removeIds.length === 0) {
          showSnack({
            message:
              plan.keptRewatch.length > 0
                ? "These plays are rewatches. Remove specific ones in your watch history."
                : "No plays to unmark for this season.",
          });
          return;
        }
        await submitSeasonUnmark(target, season, plan);
      });
    },
    [resolveSeasonUnmark, submitSeasonUnmark, withSeasonLock],
  );

  const rewatchSeason = useCallback(
    async (target: MarkContextTarget, season: SeasonView) => {
      await withSeasonLock(target, season.number, async () => {
        const aired = season.episodes.filter(
          (episode) => episode.aired && (season.number !== 0 || target.includeSpecials),
        );
        if (aired.length === 0) return;
        const ops = buildBulkMarkOps(
          {
            showIds: target.ids,
            seasons: [
              {
                number: season.number,
                episodes: aired.map((e) => ({
                  number: e.number,
                  firstAired: e.firstAired,
                  watched: false,
                })),
              },
            ],
            includeSpecials: target.includeSpecials,
            additive: true,
          },
          Date.now(),
          new Date().toISOString(),
          () => runtime.newId(),
        );
        const label = `${seasonLabel(season.number)} marked again`;
        const writing = submitSeasonWrite(
          target,
          ops,
          seasonMatch(season, target.includeSpecials),
          stoppedIn(queryClient, target.showId),
        );
        showSnack({ message: `${label} · ${aired.length} ${plural(aired.length)}` });
        const outcome = await writing;
        if (outcome === "failed") {
          showError("Couldn't save that change. Please try again.");
        }
        const { added, replaced } = receiptTotals(runtime, ops);
        if (outcome === "done" && replaced > 0) {
          showSnack({ message: REPLACED_COPY.rewatch(label, added, replaced) });
        }
      });
    },
    [withSeasonLock, queryClient, seasonMatch, submitSeasonWrite, runtime],
  );

  const markUpToHere = useCallback(
    async (
      target: MarkContextTarget,
      seasons: readonly SeasonView[],
      bound: EpisodeBound,
      options?: MarkUpToHereOptions,
    ) => {
      const ops = buildOps(target, seasons, bound);
      const includeSpecials = target.includeSpecials;
      const previous = offered();
      const absorb =
        options?.absorbUndo === true && previous?.showId === target.showId ? previous : null;
      await submitBulk(
        target,
        ops,
        (s, n, aired) =>
          aired &&
          (s !== 0 || includeSpecials) &&
          (s < bound.season || (s === bound.season && n <= bound.number)),
        options?.label ?? `Caught up through S${bound.season} E${bound.number}`,
        absorb,
      );
    },
    [submitBulk, buildOps],
  );

  const submitQueuedEpisodeUnmark = useCallback(
    async (target: MarkContextTarget, episode: MarkableEpisode, queuedMark: QueuedOp) => {
      setEpisodeWatched(target, episode, false, null);
      const takeBack =
        runtime.writeState(queuedMark.id) === "unsent"
          ? buildUnmarkEpisodeOp({
              opId: runtime.newId(),
              ids: episode.ids,
              watchedAt: queuedMark.watchedAt ?? new Date().toISOString(),
            })
          : buildUndoAddOp(runtime.newId(), queuedMark);
      const outcome = await submit(
        writeTarget("show", target.showId),
        [
          {
            ops: [takeBack],
            revert: () => setEpisodeWatched(target, episode, true, episode.watchedAt),
          },
        ],
        () => revalidate(target.showId, episode),
      );
      if (outcome === "failed") showError("Couldn't update that episode. Please try again.");
    },
    [revalidate, setEpisodeWatched, submit, runtime],
  );

  const submitEpisodePlayRemoval = useCallback(
    async (
      target: MarkContextTarget,
      episode: MarkableEpisode,
      resolution: Exclude<EpisodeUnmarkResolution, { readonly kind: "error" | "none" }>,
      knownRewatch: boolean,
    ) => {
      const rewatch = resolution.kind === "rewatch";
      if (rewatch) {
        setEpisodeWatched(target, episode, true, resolution.previous.watchedAt);
      } else if (knownRewatch) {
        setEpisodeWatched(target, episode, false, null);
      }
      const op = rewatch
        ? buildRemovePlaysOp({
            opId: runtime.newId(),
            ids: [resolution.latest.historyId],
            restore: [{ trakt: episode.ids.trakt, watchedAt: resolution.latest.watchedAt }],
          })
        : buildRemovePlaysOp({
            opId: runtime.newId(),
            ids: resolution.plan.removeIds,
            restore: resolution.plan.restore.map((play) => ({
              trakt: play.trakt,
              watchedAt: play.watchedAt,
            })),
          });
      const ops = [op];
      const writing = submit(
        writeTarget("show", target.showId),
        [
          {
            ops,
            revert: () =>
              setEpisodeWatched(
                target,
                episode,
                true,
                rewatch ? resolution.latest.watchedAt : episode.watchedAt,
              ),
          },
        ],
        () => revalidate(target.showId, episode),
      );
      offerUndo({
        showId: target.showId,
        ids: target.ids,
        label: rewatch ? `Removed 1 play · ${resolution.count - 1} remain` : "Removed play",
        ops,
        stopped: null,
        priorPlay: false,
      });
      if ((await writing) === "failed")
        showError("Couldn't update that episode. Please try again.");
    },
    [offerUndo, revalidate, setEpisodeWatched, submit, runtime.newId],
  );

  const submitLiveEpisodeUnmark = useCallback(
    async (target: MarkContextTarget, episode: MarkableEpisode, knownRewatch: boolean) => {
      if (!knownRewatch) setEpisodeWatched(target, episode, false, null);
      const resolution = await resolveEpisodeUnmark(runtime, episode.ids.trakt);
      if (resolution.kind === "error") {
        if (!knownRewatch) {
          setEpisodeWatched(target, episode, true, episode.watchedAt);
        }
        showError("Couldn't reach your history to unmark this. Please try again.");
        return;
      }
      if (resolution.kind === "none") {
        if (knownRewatch) setEpisodeWatched(target, episode, false, null);
        revalidate(target.showId, episode);
        return;
      }
      await submitEpisodePlayRemoval(target, episode, resolution, knownRewatch);
    },
    [revalidate, runtime, setEpisodeWatched, submitEpisodePlayRemoval],
  );

  const unmarkEpisode = useCallback(
    async (target: MarkContextTarget, episode: MarkableEpisode, knownPlays?: number) => {
      retireOfferOf(episode);
      const queuedMark = pendingMark(runtime, episodeItemKey(episode.ids.trakt));
      if (queuedMark === undefined) {
        await submitLiveEpisodeUnmark(target, episode, (knownPlays ?? 0) >= 2);
        return;
      }
      const ownPlays = canRemoveOwnPlays(mayHavePlaysOutsideProgress(queryClient, target.showId));
      const sent = runtime.writeState(queuedMark.id) === "sent";
      if (sent && !ownPlays && !(await waitUntilSettled(runtime, [queuedMark.id]))) {
        showError("Couldn't update that episode. Please try again.");
        return;
      }
      const state = runtime.writeState(queuedMark.id);
      if (state === "unsent" || state === "sent") {
        await submitQueuedEpisodeUnmark(target, episode, queuedMark);
        return;
      }
      await submitLiveEpisodeUnmark(target, episode, (knownPlays ?? 0) >= 2);
    },
    [queryClient, runtime, submitLiveEpisodeUnmark, submitQueuedEpisodeUnmark],
  );

  const markEpisode = useCallback(
    async (target: MarkContextTarget, episode: MarkableEpisode, undoLabel?: string) => {
      const itemKey = episodeItemKey(episode.ids.trakt);
      if (hasPendingMark(runtime, itemKey)) return;
      const watchedAt = new Date().toISOString();
      const opId = runtime.newId();
      const lockKey = pendingMarkLock(itemKey);
      claimWriteLock(lockKey, opId);
      try {
        const ops = [buildMarkEpisodeOp({ opId, ids: episode.ids, watchedAt })];
        const stopped = stoppedIn(queryClient, target.showId);
        setEpisodeWatched(target, episode, true, watchedAt);
        const writing = submit(
          writeTarget("show", target.showId),
          [{ ops, revert: () => setEpisodeWatched(target, episode, false, null) }],
          () => revalidate(target.showId, episode),
        );
        if (stopped !== null) resume.resume(target.showId, target.ids);
        if (undoLabel !== undefined) {
          offerUndo({
            showId: target.showId,
            ids: target.ids,
            label: undoLabel,
            ops,
            stopped,
            priorPlay: mayHavePlaysOutsideProgress(queryClient, target.showId),
            markedEpisode: { episode, watchedAt },
          });
        }
        settleWrite(
          await writing,
          ops,
          undoLabel === undefined ? null : ops,
          "Couldn't update that episode. Please try again.",
          () => REPLACED_COPY.episode,
        );
      } finally {
        releaseWriteLock(lockKey, opId);
      }
    },
    [offerUndo, queryClient, revalidate, resume, runtime, setEpisodeWatched, settleWrite, submit],
  );

  const toggleEpisode = useCallback(
    async (target: MarkContextTarget, episode: MarkableEpisode, options?: ToggleEpisodeOptions) => {
      await withEpisodeLock(target, episode, async () => {
        if (episode.watched) {
          await unmarkEpisode(target, episode, options?.knownPlays);
          return;
        }
        await markEpisode(target, episode, options?.undoLabel);
      });
    },
    [markEpisode, unmarkEpisode, withEpisodeLock],
  );

  const addEpisodePlay = useCallback(
    async (target: MarkContextTarget, episode: MarkableEpisode) => {
      await withEpisodeLock(target, episode, async () => {
        const op = buildAddEpisodePlayOp({
          opId: runtime.newId(),
          ids: episode.ids,
          watchedAt: new Date().toISOString(),
        });
        const stopped = stoppedIn(queryClient, target.showId);
        const writing = submit(
          writeTarget("show", target.showId),
          [{ ops: [op], revert: () => {} }],
          () => revalidate(target.showId, { season: episode.season, number: episode.number }),
        );
        if (stopped !== null) resume.resume(target.showId, target.ids);
        showSnack({ message: "Play added" });
        settleWrite(
          await writing,
          [op],
          null,
          "Couldn't add that play. Please try again.",
          () => REPLACED_COPY.play,
        );
      });
    },
    [withEpisodeLock, queryClient, submit, resume, revalidate, runtime, settleWrite],
  );

  const removeAllPlays = useCallback(
    async (target: MarkContextTarget, episode: MarkableEpisode) => {
      await withEpisodeLock(target, episode, async () => {
        let plays: Awaited<ReturnType<typeof runtime.loadEpisodePlays>>;
        try {
          plays = await runtime.loadEpisodePlays(episode.ids.trakt);
        } catch {
          showError("Couldn't reach your history. Please try again.");
          return;
        }
        const own = plays
          .filter((play) => play.episodeTrakt === episode.ids.trakt)
          .sort((a, b) => Date.parse(b.watchedAt) - Date.parse(a.watchedAt));
        const bound: EpisodeBound = { season: episode.season, number: episode.number };
        const [latest] = own;
        if (latest === undefined) {
          revalidate(target.showId, bound);
          return;
        }
        const matchEpisode: EpisodeMatch = (s, n) => s === episode.season && n === episode.number;
        patchShowSeasons(queryClient, target.showId, matchEpisode, false);
        patchEpisodeDetail(queryClient, target.showId, bound, false, null);
        const op = buildRemovePlaysOp({
          opId: runtime.newId(),
          ids: own.map((play) => play.historyId),
          restore: own.map((play) => ({ trakt: play.episodeTrakt, watchedAt: play.watchedAt })),
        });
        const ops = [op];
        const writing = submit(
          writeTarget("show", target.showId),
          [
            {
              ops,
              revert: () => {
                patchShowSeasons(queryClient, target.showId, matchEpisode, true);
                patchEpisodeDetail(queryClient, target.showId, bound, true, latest.watchedAt);
              },
            },
          ],
          () => revalidate(target.showId, bound),
        );
        offerUndo({
          showId: target.showId,
          ids: target.ids,
          label: `Removed ${own.length} plays`,
          ops,
          stopped: null,
          priorPlay: false,
        });
        if ((await writing) === "failed") {
          showError("Couldn't remove those plays. Please try again.");
        }
      });
    },
    [withEpisodeLock, runtime, queryClient, offerUndo, submit, revalidate],
  );

  return useMemo(
    () => ({
      markSeason,
      unmarkSeason,
      rewatchSeason,
      markUpToHere,
      toggleEpisode,
      addEpisodePlay,
      removeAllPlays,
    }),
    [
      markSeason,
      unmarkSeason,
      rewatchSeason,
      markUpToHere,
      toggleEpisode,
      addEpisodePlay,
      removeAllPlays,
    ],
  );
}
