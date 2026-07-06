import { queryKeys } from "@data/query-keys";
import type { EpisodeView, SeasonView, ShowHeader } from "@data/trakt/show-detail";
import type { ShowIds } from "@domain/model/ids";
import { buildBulkMarkOps, type SeasonTree } from "@domain/write-queue/bulk";
import { buildMarkEpisodeOp, buildUnmarkEpisodeOp } from "@domain/write-queue/ops";
import type { QueuedOp } from "@domain/write-queue/types";
import { useQueryClient } from "@tanstack/react-query";
import { useRuntime } from "@ui/runtime/runtime";
import { useCallback, useState } from "react";
import { useResumeOnMark } from "./useResumeOnMark";

/** Which show + specials preference the mark actions apply to. */
export interface MarkContextTarget {
  readonly showId: number;
  readonly ids: ShowIds;
  readonly includeSpecials: boolean;
}

export interface EpisodeBound {
  readonly season: number;
  readonly number: number;
}

interface UndoState {
  readonly showId: number;
  readonly ids: ShowIds;
  readonly label: string;
  readonly ops: readonly QueuedOp[];
  /** The mark auto-resumed a Stopped show, so Undo must re-stop it too. */
  readonly resumed: boolean;
}

export interface MarkSeasonController {
  markSeason(target: MarkContextTarget, season: SeasonView): Promise<void>;
  markUpToHere(
    target: MarkContextTarget,
    seasons: readonly SeasonView[],
    bound: EpisodeBound,
  ): Promise<void>;
  toggleEpisode(target: MarkContextTarget, episode: EpisodeView): Promise<void>;
  undo(): Promise<void>;
  dismissUndo(): void;
  clearError(): void;
  readonly undoable: { readonly label: string } | null;
  readonly error: string | null;
}

type EpisodeMatch = (season: number, number: number, aired: boolean) => boolean;

function patchEpisodes(
  seasons: readonly SeasonView[],
  match: EpisodeMatch,
  watched: boolean,
): SeasonView[] {
  return seasons.map((season) => {
    let changed = false;
    const episodes = season.episodes.map((episode) => {
      if (match(season.number, episode.number, episode.aired) && episode.watched !== watched) {
        changed = true;
        return { ...episode, watched };
      }
      return episode;
    });
    if (!changed) return season;
    return { ...season, episodes, completedCount: episodes.filter((e) => e.watched).length };
  });
}

function toSeasonTrees(seasons: readonly SeasonView[]): SeasonTree[] {
  return seasons.map((season) => ({
    number: season.number,
    episodes: season.episodes.map((episode) => ({
      number: episode.number,
      firstAired: episode.firstAired,
    })),
  }));
}

/** Invert a built op so Undo re-sends its stored compensating request as a fresh op. */
function invert(op: QueuedOp): QueuedOp {
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

/**
 * Show-detail marking: whole-season, mark-up-to-here, and single
 * episode toggle, each optimistic (episodes check instantly, before the write
 * settles) and funnelled through the bulk builder so a batched mark carries
 * only aired episodes / season tokens — never unaired episodes and never
 * specials unless opted in. Bulk marks expose an Undo that re-sends the stored
 * inverse `/sync/history/remove`.
 */
export function useMarkSeason(): MarkSeasonController {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const resume = useResumeOnMark();
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const patch = useCallback(
    (showId: number, match: EpisodeMatch, watched: boolean) => {
      queryClient.setQueryData<readonly SeasonView[]>(queryKeys.showSeasons(showId), (old) =>
        old === undefined ? old : patchEpisodes(old, match, watched),
      );
    },
    [queryClient],
  );

  const revalidate = useCallback(
    (showId: number) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.showSeasons(showId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.showHeader(showId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.library() });
    },
    [queryClient],
  );

  // The show's specials-excluded `completed` before the bulk write, stamped on
  // every chunk so startup reconcile can retire an applied-but-lost bulk POST
  // (against a fresh progress re-read) instead of re-POSTing → duplicate plays.
  const reconcileAnchor = useCallback(
    (showId: number): { readonly showId: number; readonly preCompleted: number } => {
      const header = queryClient.getQueryData<ShowHeader>(queryKeys.showHeader(showId));
      return { showId, preCompleted: header?.completed ?? 0 };
    },
    [queryClient],
  );

  const submitBulk = useCallback(
    async (
      target: MarkContextTarget,
      ops: readonly QueuedOp[],
      match: EpisodeMatch,
      label: string,
    ) => {
      if (ops.length === 0) return;
      patch(target.showId, match, true);
      let ok = true;
      for (const op of ops) {
        if ((await runtime.submit(op)) === "failed") ok = false;
      }
      // A watch on a Stopped show un-stops it — the derived state must follow the
      // new progress rather than stay filed under Stopped.
      const resumed = ok ? await resume.resumeIfStopped(target.showId, target.ids) : false;
      revalidate(target.showId);
      if (!ok) {
        setError("Couldn't save that mark. It'll retry — check your connection.");
        return;
      }
      setUndoState({ showId: target.showId, ids: target.ids, label, ops, resumed });
    },
    [patch, revalidate, runtime, resume],
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

  const markSeason = useCallback(
    async (target: MarkContextTarget, season: SeasonView) => {
      const ops = buildOps(target, [season]);
      const includeSpecials = target.includeSpecials;
      await submitBulk(
        target,
        ops,
        (s, _n, aired) => s === season.number && aired && (s !== 0 || includeSpecials),
        `Marked ${seasonLabel(season.number)} watched.`,
      );
    },
    [submitBulk, buildOps],
  );

  const markUpToHere = useCallback(
    async (target: MarkContextTarget, seasons: readonly SeasonView[], bound: EpisodeBound) => {
      const ops = buildOps(target, seasons, bound);
      const includeSpecials = target.includeSpecials;
      await submitBulk(
        target,
        ops,
        (s, n, aired) =>
          aired &&
          (s !== 0 || includeSpecials) &&
          (s < bound.season || (s === bound.season && n <= bound.number)),
        `Caught up through S${bound.season}E${bound.number}.`,
      );
    },
    [submitBulk, buildOps],
  );

  const toggleEpisode = useCallback(
    async (target: MarkContextTarget, episode: EpisodeView) => {
      const next = !episode.watched;
      // A lost response reconciles against the show's pre-op `completed` (via a
      // progress re-read) rather than blind-retrying → never a duplicate play,
      // matching the bulk path and the sibling episode/Up-Next mark hooks.
      const params = {
        opId: crypto.randomUUID(),
        ids: episode.ids,
        watchedAt: new Date().toISOString(),
        inversePatch: reconcileAnchor(target.showId),
      };
      const op = next ? buildMarkEpisodeOp(params) : buildUnmarkEpisodeOp(params);
      patch(target.showId, (s, n) => s === episode.season && n === episode.number, next);
      const outcome = await runtime.submit(op);
      if (outcome === "failed") {
        patch(target.showId, (s, n) => s === episode.season && n === episode.number, !next);
        setError("Couldn't update that episode. Please try again.");
        return;
      }
      if (next) await resume.resumeIfStopped(target.showId, target.ids);
      revalidate(target.showId);
    },
    [patch, revalidate, runtime, reconcileAnchor, resume],
  );

  const undo = useCallback(async () => {
    const pending = undoState;
    if (pending === null) return;
    setUndoState(null);
    for (const op of pending.ops) await runtime.submit(invert(op));
    if (pending.resumed) await resume.reStop(pending.showId, pending.ids);
    revalidate(pending.showId);
  }, [undoState, revalidate, runtime, resume]);

  return {
    markSeason,
    markUpToHere,
    toggleEpisode,
    undo,
    dismissUndo: () => setUndoState(null),
    clearError: () => setError(null),
    undoable: undoState === null ? null : { label: undoState.label },
    error,
  };
}
