import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { queryKeys } from "../data/query-keys";
import type { SeasonView, ShowProgress } from "../data/trakt/show-detail";
import type { EpisodeIds, ShowIds } from "../domain/model/ids";
import { planSeasonUnmark, type UnmarkPlan } from "../domain/reversal";
import { buildBulkMarkOps, type SeasonTree } from "../domain/write-queue/bulk";
import {
  buildAddEpisodePlayOp,
  buildMarkEpisodeOp,
  buildRemovePlaysOp,
  buildUnmarkEpisodeOp,
  episodeItemKey,
} from "../domain/write-queue/ops";
import type { QueuedOp } from "../domain/write-queue/types";
import { useRuntime } from "../runtime/runtime";
import { hasPendingMark, registerPendingMark, releasePendingMark } from "../stores/mark-store";
import {
  type EpisodeMatch,
  patchEpisodeDetail,
  patchShowSeasons,
  refreshShowProgress,
} from "./library-cache";
import { type EpisodeUnmarkResolution, resolveEpisodeUnmark } from "./resolveUnmark";
import { useOptimisticWrite } from "./useOptimisticWrite";
import { useResumeOnMark } from "./useResumeOnMark";
import { forgetSeasonMark, getSeasonMarkDelta, rememberSeasonMark } from "./useSeasonReversal";

export interface MarkContextTarget {
  readonly showId: number;
  readonly ids: ShowIds;
  readonly includeSpecials: boolean;
}

export interface EpisodeBound {
  readonly season: number;
  readonly number: number;
}

interface MarkableEpisode {
  readonly season: number;
  readonly number: number;
  readonly ids: EpisodeIds;
  readonly watched: boolean;
  readonly watchedAt?: string | null;
}

interface ToggleEpisodeOptions {
  readonly undoLabel?: string;
  /** The episode's resolved play count, when the surface knows it: a rewatch
   * uncheck then skips the optimistic un-tick, so the filled check never
   * flickers while only the latest play is removed. */
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
  readonly resumed: boolean;
  readonly reversibleSeason: number | null;
  /** Monotonic per-hook counter, so a snackbar effect can key on "a new
   * undoable arrived" even when two consecutive actions share a label. */
  readonly seq: number;
}

export interface MarkSeasonController {
  markSeason(target: MarkContextTarget, season: SeasonView): Promise<void>;
  /**
   * The durable, per-play-safe season unmark. When a `Mark season watched` from
   * this session completed the season, it reverses exactly that mark's delta by
   * exact history id (a play that predates the mark is never touched). Without a
   * session mark on record (the user confirmed "Unmark Season N?" on a genuinely
   * watched season) it spans every aired episode instead, still per-play-safe:
   * only single plays are removed, by exact id, and every rewatched episode is
   * kept intact and surfaced in the snackbar label.
   */
  unmarkSeason(target: MarkContextTarget, season: SeasonView): Promise<void>;
  rewatchSeason(target: MarkContextTarget, season: SeasonView): Promise<void>;
  markUpToHere(
    target: MarkContextTarget,
    seasons: readonly SeasonView[],
    bound: EpisodeBound,
    options?: MarkUpToHereOptions,
  ): Promise<void>;
  /**
   * Toggle a single episode's watched flag. Marking ON enqueues a durable play;
   * `undoLabel` mounts the same point-of-action Undo as the bulk paths. Marking
   * OFF is the silent, per-play-safe removal: a single play is removed by its
   * exact history id; a rewatch loses only its NEWEST play (the check stays
   * filled and `Removed 1 play · N remain` carries the Undo), so no tap here can
   * ever destroy plays it didn't target.
   */
  toggleEpisode(
    target: MarkContextTarget,
    episode: MarkableEpisode,
    options?: ToggleEpisodeOptions,
  ): Promise<void>;
  addEpisodePlay(target: MarkContextTarget, episode: MarkableEpisode): Promise<void>;
  removeAllPlays(target: MarkContextTarget, episode: MarkableEpisode): Promise<void>;
  undo(): Promise<void>;
  dismissUndo(): void;
  clearError(): void;
  dismissNotice(): void;
  readonly undoable: { readonly label: string; readonly seq: number } | null;
  readonly notice: string | null;
  readonly error: string | null;
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

export function invertOp(op: QueuedOp): QueuedOp {
  return {
    ...op,
    id: crypto.randomUUID(),
    request: op.inverse,
    inverse: op.request,
    fromState: op.toState,
    toState: op.fromState,
    inversePatch: null,
  };
}

function seasonLabel(season: number): string {
  return season === 0 ? "Specials" : `Season ${season}`;
}

function plural(count: number): string {
  return count === 1 ? "episode" : "episodes";
}

export function useMarkSeason(): MarkSeasonController {
  const submit = useOptimisticWrite();
  const queryClient = useQueryClient();
  const runtime = useRuntime();
  const resume = useResumeOnMark();
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const undoRef = useRef<UndoState | null>(null);
  const undoSeq = useRef(0);
  const putUndo = useCallback((next: Omit<UndoState, "seq"> | null): void => {
    undoSeq.current += 1;
    const state = next === null ? null : { ...next, seq: undoSeq.current };
    undoRef.current = state;
    setUndoState(state);
  }, []);
  const retractUndo = useCallback(
    (ops: readonly QueuedOp[]): void => {
      if (undoRef.current?.ops === ops) putUndo(null);
    },
    [putUndo],
  );
  // The synchronous gates, refs rather than state: a fast double-tap fires the
  // second call before React re-renders the ticked episode, so a duplicate write
  // is dropped here rather than enqueued.
  const pendingSeasonsRef = useRef<Set<number>>(new Set());
  const pendingEpisodesRef = useRef<Set<string>>(new Set());
  const withSeasonLock = useCallback(
    async (seasonNumber: number, run: () => Promise<void>): Promise<void> => {
      if (pendingSeasonsRef.current.has(seasonNumber)) return;
      pendingSeasonsRef.current.add(seasonNumber);
      try {
        await run();
      } finally {
        pendingSeasonsRef.current.delete(seasonNumber);
      }
    },
    [],
  );
  const withEpisodeLock = useCallback(
    async (target: MarkContextTarget, episode: MarkableEpisode, run: () => Promise<void>) => {
      const epKey = `${target.showId}:${episode.season}:${episode.number}`;
      if (pendingEpisodesRef.current.has(epKey)) return;
      pendingEpisodesRef.current.add(epKey);
      try {
        await run();
      } finally {
        pendingEpisodesRef.current.delete(epKey);
      }
    },
    [],
  );

  const revalidate = useCallback(
    (showId: number, episode?: { readonly season: number; readonly number: number } | "all") =>
      refreshShowProgress(queryClient, showId, () => runtime.loadShowProgress(showId), episode),
    [queryClient, runtime],
  );

  // The one settle wiring for a season-tree write: a hard failure restores the
  // pre-write snapshot verbatim, a kept watch un-stops a Stopped show (onKept,
  // so the unhide lands before the row is reconciled), and settling revalidates
  // whole-show progress.
  const submitSeasonWrite = useCallback(
    (
      target: MarkContextTarget,
      before: readonly SeasonView[] | undefined,
      ops: readonly QueuedOp[],
    ): Promise<"done" | "failed" | "deferred"> =>
      submit(ops, {
        rollback: () => queryClient.setQueryData(queryKeys.showSeasons(target.showId), before),
        onKept: () => resume.resumeIfStopped(target.showId, target.ids),
        revalidate: () => revalidate(target.showId, "all"),
      }),
    [submit, queryClient, resume, revalidate],
  );

  // The show's specials-excluded `completed` before the write, stamped on every
  // chunk so startup reconcile can retire an applied-but-lost POST against a
  // fresh progress read instead of re-POSTing into duplicate plays.
  const reconcileAnchor = useCallback(
    (showId: number): { readonly showId: number; readonly preCompleted: number } => {
      const progress = queryClient.getQueryData<ShowProgress>(queryKeys.showProgress(showId));
      return { showId, preCompleted: progress?.completed ?? 0 };
    },
    [queryClient],
  );

  const submitBulk = useCallback(
    async (
      target: MarkContextTarget,
      ops: readonly QueuedOp[],
      match: EpisodeMatch,
      label: string,
      reversibleSeason: number | null = null,
      absorb: UndoState | null = null,
    ): Promise<"done" | "failed" | "deferred"> => {
      if (ops.length === 0) return "done";
      // `match` spans episodes on the other side of this write too, so a hard
      // failure restores the snapshot rather than un-patching the match, which
      // would flip pre-existing ticks.
      const before = queryClient.getQueryData<readonly SeasonView[]>(
        queryKeys.showSeasons(target.showId),
      );
      patchShowSeasons(queryClient, target.showId, match, true);
      setError(null);
      const undoOps = absorb === null ? ops : [...absorb.ops, ...ops];
      putUndo({
        showId: target.showId,
        ids: target.ids,
        label,
        ops: undoOps,
        resumed: (absorb?.resumed ?? false) || resume.willResume(target.showId),
        reversibleSeason,
      });
      const outcome = await submitSeasonWrite(target, before, ops);
      if (outcome === "failed") {
        retractUndo(undoOps);
        setError("Couldn't save that change. Please try again.");
      }
      return outcome;
    },
    [putUndo, retractUndo, queryClient, submitSeasonWrite, resume],
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
          inversePatch: reconcileAnchor(target.showId),
          ...(upTo === undefined ? {} : { upTo }),
        },
        Date.now(),
        new Date().toISOString(),
        () => crypto.randomUUID(),
      ),
    [reconcileAnchor],
  );

  const seasonMatch = useCallback(
    (season: SeasonView, includeSpecials: boolean): EpisodeMatch =>
      (s, _n, aired) =>
        s === season.number && aired && (s !== 0 || includeSpecials),
    [],
  );

  const markSeason = useCallback(
    async (target: MarkContextTarget, season: SeasonView) => {
      await withSeasonLock(season.number, async () => {
        const ops = buildOps(target, [season]);
        if (ops.length === 0) return;
        const delta = season.episodes
          .filter(
            (episode) =>
              episode.aired && !episode.watched && (season.number !== 0 || target.includeSpecials),
          )
          .map((episode) => episode.number);
        rememberSeasonMark(target.showId, season.number, delta);
        const outcome = await submitBulk(
          target,
          ops,
          seasonMatch(season, target.includeSpecials),
          `${seasonLabel(season.number)} marked · ${delta.length} ${plural(delta.length)}`,
          season.number,
        );
        if (outcome === "failed") forgetSeasonMark(target.showId, season.number);
      });
    },
    [submitBulk, buildOps, seasonMatch, withSeasonLock],
  );

  const resolveSeasonUnmark = useCallback(
    async (
      target: MarkContextTarget,
      season: SeasonView,
      delta: ReadonlySet<number>,
    ): Promise<UnmarkPlan | null> => {
      try {
        return planSeasonUnmark(
          await runtime.loadShowPlays(target.showId),
          season.number,
          target.includeSpecials,
          delta,
        );
      } catch {
        setError("Couldn't reach your history to unmark this season. Please try again.");
        return null;
      }
    },
    [runtime],
  );

  const submitSeasonUnmark = useCallback(
    async (target: MarkContextTarget, season: SeasonView, plan: UnmarkPlan) => {
      const key = queryKeys.showSeasons(target.showId);
      const before = queryClient.getQueryData<readonly SeasonView[]>(key);
      const removed = new Set(plan.restore.map((play) => `${play.season}:${play.number}`));
      patchShowSeasons(
        queryClient,
        target.showId,
        (season, number) => removed.has(`${season}:${number}`),
        false,
      );
      const ops = [
        buildRemovePlaysOp({
          opId: crypto.randomUUID(),
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
      putUndo({
        showId: target.showId,
        ids: target.ids,
        label: `${seasonLabel(season.number)} unmarked · ${count} ${plural(count)}${keptSuffix}`,
        ops,
        resumed: false,
        reversibleSeason: null,
      });
      const outcome = await submit(ops, {
        rollback: () => queryClient.setQueryData(key, before),
        revalidate: () => revalidate(target.showId, "all"),
      });
      if (outcome === "failed") {
        retractUndo(ops);
        setError("Couldn't unmark that season. Please try again.");
        return;
      }
      forgetSeasonMark(target.showId, season.number);
    },
    [putUndo, queryClient, retractUndo, revalidate, submit],
  );

  const unmarkSeason = useCallback(
    async (target: MarkContextTarget, season: SeasonView) => {
      const remembered = getSeasonMarkDelta(target.showId, season.number);
      const delta =
        remembered ??
        new Set(season.episodes.filter((e) => e.aired).map((episode) => episode.number));
      if (delta.size === 0) return;
      await withSeasonLock(season.number, async () => {
        setError(null);
        setNotice(null);
        const plan = await resolveSeasonUnmark(target, season, delta);
        if (plan === null) return;
        if (plan.removeIds.length === 0) {
          forgetSeasonMark(target.showId, season.number);
          setNotice(
            plan.keptRewatch.length > 0
              ? "These plays are rewatches. Remove specific ones in your watch history."
              : "No plays to unmark for this season.",
          );
          return;
        }
        await submitSeasonUnmark(target, season, plan);
      });
    },
    [resolveSeasonUnmark, submitSeasonUnmark, withSeasonLock],
  );

  /** Deliberately carries no Undo: Trakt mints the history ids only once the
   * plays land, and the mark op's item-scoped inverse would wipe the
   * pre-existing plays a rewatch exists to keep. */
  const rewatchSeason = useCallback(
    async (target: MarkContextTarget, season: SeasonView) => {
      await withSeasonLock(season.number, async () => {
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
            inversePatchForChunk: (probe) => ({
              kind: "additive-season",
              showId: target.showId,
              probe,
            }),
            additive: true,
          },
          Date.now(),
          new Date().toISOString(),
          () => crypto.randomUUID(),
        );
        if (ops.length === 0) return;
        setError(null);
        const before = queryClient.getQueryData<readonly SeasonView[]>(
          queryKeys.showSeasons(target.showId),
        );
        patchShowSeasons(
          queryClient,
          target.showId,
          seasonMatch(season, target.includeSpecials),
          true,
        );
        setNotice(
          `${seasonLabel(season.number)} marked again · ${aired.length} ${plural(aired.length)}`,
        );
        const outcome = await submitSeasonWrite(target, before, ops);
        if (outcome === "failed") {
          setNotice(null);
          setError("Couldn't save that change. Please try again.");
        }
      });
    },
    [withSeasonLock, queryClient, seasonMatch, submitSeasonWrite],
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
      const previous = undoRef.current;
      const absorb =
        options?.absorbUndo === true && previous !== null && previous.showId === target.showId
          ? previous
          : null;
      await submitBulk(
        target,
        ops,
        (s, n, aired) =>
          aired &&
          (s !== 0 || includeSpecials) &&
          (s < bound.season || (s === bound.season && n <= bound.number)),
        options?.label ?? `Caught up through S${bound.season} E${bound.number}`,
        null,
        absorb,
      );
    },
    [submitBulk, buildOps],
  );

  const setEpisodeWatched = useCallback(
    (
      target: MarkContextTarget,
      episode: MarkableEpisode,
      watched: boolean,
      watchedAt: string | null,
    ) => {
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

  const submitQueuedEpisodeUnmark = useCallback(
    async (target: MarkContextTarget, episode: MarkableEpisode, queuedMark: QueuedOp) => {
      setEpisodeWatched(target, episode, false, null);
      const outcome = await submit(
        [
          buildUnmarkEpisodeOp({
            opId: crypto.randomUUID(),
            ids: episode.ids,
            watchedAt: queuedMark.watchedAt ?? new Date().toISOString(),
          }),
        ],
        {
          rollback: () => setEpisodeWatched(target, episode, true, episode.watchedAt ?? null),
          revalidate: () => revalidate(target.showId, episode),
        },
      );
      if (outcome === "failed") setError("Couldn't update that episode. Please try again.");
    },
    [revalidate, setEpisodeWatched, submit],
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
            opId: crypto.randomUUID(),
            ids: [resolution.latest.historyId],
            restore: [{ trakt: episode.ids.trakt, watchedAt: resolution.latest.watchedAt }],
          })
        : buildRemovePlaysOp({
            opId: crypto.randomUUID(),
            ids: resolution.plan.removeIds,
            restore: resolution.plan.restore.map((play) => ({
              trakt: play.trakt,
              watchedAt: play.watchedAt,
            })),
          });
      const ops = [op];
      putUndo({
        showId: target.showId,
        ids: target.ids,
        label: rewatch ? `Removed 1 play · ${resolution.count - 1} remain` : "Removed play",
        ops,
        resumed: false,
        reversibleSeason: null,
      });
      const outcome = await submit(ops, {
        rollback: () =>
          setEpisodeWatched(
            target,
            episode,
            true,
            rewatch ? resolution.latest.watchedAt : (episode.watchedAt ?? null),
          ),
        revalidate: () => revalidate(target.showId, episode),
      });
      if (outcome === "failed") {
        retractUndo(ops);
        setError("Couldn't update that episode. Please try again.");
      }
    },
    [putUndo, retractUndo, revalidate, setEpisodeWatched, submit],
  );

  const submitLiveEpisodeUnmark = useCallback(
    async (target: MarkContextTarget, episode: MarkableEpisode, knownRewatch: boolean) => {
      if (!knownRewatch) setEpisodeWatched(target, episode, false, null);
      const resolution = await resolveEpisodeUnmark(runtime, episode.ids.trakt);
      if (resolution.kind === "error") {
        if (!knownRewatch) {
          setEpisodeWatched(target, episode, true, episode.watchedAt ?? null);
        }
        setError("Couldn't reach your history to unmark this. Please try again.");
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
      // A mark for this episode may still sit in the durable queue. Live plays
      // cannot see it, so resolving now would report none and leave the queued
      // mark to flip the episode back once it flushes: enqueue the inverse
      // instead, and coalescing settles the pair.
      const queuedMark = runtime
        .pendingOps()
        .find((op) => op.itemKey === episodeItemKey(episode.ids.trakt) && op.toState === "present");
      if (queuedMark !== undefined) {
        await submitQueuedEpisodeUnmark(target, episode, queuedMark);
        return;
      }
      await submitLiveEpisodeUnmark(target, episode, (knownPlays ?? 0) >= 2);
    },
    [runtime, submitLiveEpisodeUnmark, submitQueuedEpisodeUnmark],
  );

  const markEpisode = useCallback(
    async (target: MarkContextTarget, episode: MarkableEpisode, undoLabel?: string) => {
      const itemKey = episodeItemKey(episode.ids.trakt);
      if (hasPendingMark(runtime, itemKey)) return;
      const watchedAt = new Date().toISOString();
      const opId = crypto.randomUUID();
      registerPendingMark(itemKey, opId);
      try {
        const ops = [
          buildMarkEpisodeOp({
            opId,
            ids: episode.ids,
            watchedAt,
            inversePatch: reconcileAnchor(target.showId),
          }),
        ];
        setEpisodeWatched(target, episode, true, watchedAt);
        if (undoLabel !== undefined) {
          setError(null);
          putUndo({
            showId: target.showId,
            ids: target.ids,
            label: undoLabel,
            ops,
            resumed: resume.willResume(target.showId),
            reversibleSeason: null,
          });
        }
        // A watch on a Stopped show un-stops it (onKept), which lands before the
        // row is reconciled.
        const outcome = await submit(ops, {
          rollback: () => setEpisodeWatched(target, episode, false, null),
          onKept: () => resume.resumeIfStopped(target.showId, target.ids),
          revalidate: () => revalidate(target.showId, episode),
        });
        if (outcome === "failed") {
          if (undoLabel !== undefined) retractUndo(ops);
          setError("Couldn't update that episode. Please try again.");
        }
      } finally {
        releasePendingMark(itemKey, opId);
      }
    },
    [putUndo, reconcileAnchor, retractUndo, revalidate, resume, runtime, setEpisodeWatched, submit],
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

  /** No Undo, for the same reason as {@link rewatchSeason}. */
  const addEpisodePlay = useCallback(
    async (target: MarkContextTarget, episode: MarkableEpisode) => {
      await withEpisodeLock(target, episode, async () => {
        const op = buildAddEpisodePlayOp({
          opId: crypto.randomUUID(),
          ids: episode.ids,
          watchedAt: new Date().toISOString(),
          inversePatch: { kind: "additive-episode", episodeTrakt: episode.ids.trakt },
        });
        setError(null);
        setNotice("Play added");
        const outcome = await submit([op], {
          rollback: () => {},
          onKept: () => resume.resumeIfStopped(target.showId, target.ids),
          revalidate: () =>
            revalidate(target.showId, { season: episode.season, number: episode.number }),
        });
        if (outcome === "failed") {
          setNotice(null);
          setError("Couldn't add that play. Please try again.");
        }
      });
    },
    [withEpisodeLock, submit, resume, revalidate],
  );

  const removeAllPlays = useCallback(
    async (target: MarkContextTarget, episode: MarkableEpisode) => {
      await withEpisodeLock(target, episode, async () => {
        setError(null);
        setNotice(null);
        let plays: Awaited<ReturnType<typeof runtime.loadEpisodePlays>>;
        try {
          plays = await runtime.loadEpisodePlays(episode.ids.trakt);
        } catch {
          setError("Couldn't reach your history. Please try again.");
          return;
        }
        const own = plays
          .filter((play) => play.episodeTrakt === episode.ids.trakt)
          .sort((a, b) => Date.parse(b.watchedAt) - Date.parse(a.watchedAt));
        const bound: EpisodeBound = { season: episode.season, number: episode.number };
        if (own.length === 0) {
          revalidate(target.showId, bound);
          return;
        }
        const matchEpisode: EpisodeMatch = (s, n) => s === episode.season && n === episode.number;
        patchShowSeasons(queryClient, target.showId, matchEpisode, false);
        patchEpisodeDetail(queryClient, target.showId, bound, false, null);
        const op = buildRemovePlaysOp({
          opId: crypto.randomUUID(),
          ids: own.map((play) => play.historyId),
          restore: own.map((play) => ({ trakt: play.episodeTrakt, watchedAt: play.watchedAt })),
        });
        const ops = [op];
        const latest = own[0];
        putUndo({
          showId: target.showId,
          ids: target.ids,
          label: `Removed ${own.length} plays`,
          ops,
          resumed: false,
          reversibleSeason: null,
        });
        const outcome = await submit(ops, {
          rollback: () => {
            patchShowSeasons(queryClient, target.showId, matchEpisode, true);
            patchEpisodeDetail(queryClient, target.showId, bound, true, latest?.watchedAt ?? null);
          },
          revalidate: () => revalidate(target.showId, bound),
        });
        if (outcome === "failed") {
          retractUndo(ops);
          setError("Couldn't remove those plays. Please try again.");
        }
      });
    },
    [withEpisodeLock, runtime, queryClient, putUndo, retractUndo, submit, revalidate],
  );

  const undo = useCallback(async () => {
    const pending = undoState;
    if (pending === null) return;
    putUndo(null);
    if (pending.reversibleSeason !== null) {
      forgetSeasonMark(pending.showId, pending.reversibleSeason);
    }
    const outcome = await submit(pending.ops.map(invertOp), {
      rollback: () => {},
      onKept: pending.resumed ? () => resume.reStop(pending.showId, pending.ids) : undefined,
      revalidate: () => revalidate(pending.showId, "all"),
    });
    if (outcome === "failed") setError("Couldn't undo that. Please try again.");
  }, [undoState, putUndo, revalidate, submit, resume]);

  return {
    markSeason,
    unmarkSeason,
    rewatchSeason,
    markUpToHere,
    toggleEpisode,
    addEpisodePlay,
    removeAllPlays,
    undo,
    dismissUndo: () => putUndo(null),
    clearError: () => setError(null),
    dismissNotice: () => setNotice(null),
    undoable: undoState === null ? null : { label: undoState.label, seq: undoState.seq },
    notice,
    error,
  };
}
