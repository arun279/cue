import { showProgressKeys } from "@data/query-invalidation";
import { queryKeys } from "@data/query-keys";
import type { EpisodeView, SeasonView, ShowHeader } from "@data/trakt/show-detail";
import type { ShowIds } from "@domain/model/ids";
import { buildBulkMarkOps, buildBulkUnmarkOps, type SeasonTree } from "@domain/write-queue/bulk";
import { buildMarkEpisodeOp, buildUnmarkEpisodeOp } from "@domain/write-queue/ops";
import type { QueuedOp } from "@domain/write-queue/types";
import { useQueryClient } from "@tanstack/react-query";
import { useOptimisticWrite } from "@ui/hooks/useOptimisticWrite";
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
  /** Delta-safe unmark of a completed season: removes only the aired, currently-
   * watched episodes, enumerated per episode (never a whole-season token that could
   * delete plays this client never enumerated). Undo re-adds exactly that set. */
  unmarkSeason(target: MarkContextTarget, season: SeasonView): Promise<void>;
  markUpToHere(
    target: MarkContextTarget,
    seasons: readonly SeasonView[],
    bound: EpisodeBound,
  ): Promise<void>;
  toggleEpisode(target: MarkContextTarget, episode: EpisodeView): Promise<void>;
  undo(): Promise<void>;
  dismissUndo(): void;
  clearError(): void;
  /** True while a mark/unmark write for this season number is in flight — the season
   * button locks so a second activation can't race a duplicate bulk write. */
  isSeasonPending(seasonNumber: number): boolean;
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
      watched: episode.watched,
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
 * only the aired, still-unwatched delta — never a whole-season token, never
 * unaired episodes, and never specials unless opted in. Bulk marks expose an Undo
 * that re-sends the stored inverse `/sync/history/remove`, scoped to that same
 * delta so it can't remove plays that predate the mark.
 */
export function useMarkSeason(): MarkSeasonController {
  const submit = useOptimisticWrite();
  const queryClient = useQueryClient();
  const resume = useResumeOnMark();
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which season numbers currently have a bulk mark/unmark write in flight, so the
  // season button locks (a second activation can't enqueue a duplicate bulk write).
  const [pendingSeasons, setPendingSeasons] = useState<ReadonlySet<number>>(() => new Set());
  const withSeasonLock = useCallback(
    async (seasonNumber: number, run: () => Promise<void>): Promise<void> => {
      setPendingSeasons((prev) => new Set(prev).add(seasonNumber));
      try {
        await run();
      } finally {
        setPendingSeasons((prev) => {
          const next = new Set(prev);
          next.delete(seasonNumber);
          return next;
        });
      }
    },
    [],
  );

  const patch = useCallback(
    (showId: number, match: EpisodeMatch, watched: boolean) => {
      queryClient.setQueryData<readonly SeasonView[]>(queryKeys.showSeasons(showId), (old) =>
        old === undefined ? old : patchEpisodes(old, match, watched),
      );
    },
    [queryClient],
  );

  // A single-episode toggle passes its coordinate so that episode's own detail read
  // is invalidated too; a bulk mark/unmark spans an unknown set of episodes, so it
  // passes "all" to invalidate the whole-show episode prefix — else a pre-cached
  // standalone episode page is left reading pre-mark progress.
  const revalidate = useCallback(
    (showId: number, episode?: { readonly season: number; readonly number: number } | "all") => {
      for (const queryKey of showProgressKeys(showId, episode)) {
        void queryClient.invalidateQueries({ queryKey });
      }
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
      watched: boolean,
      label: string,
    ) => {
      if (ops.length === 0) return;
      // Snapshot the season tree before the optimistic write so a hard failure can
      // restore it verbatim — `match` spans episodes on the other side of the write
      // too, so a naive un-patch would wrongly flip pre-existing ticks.
      const key = queryKeys.showSeasons(target.showId);
      const before = queryClient.getQueryData<readonly SeasonView[]>(key);
      patch(target.showId, match, watched);
      // The batch settles to its worst op: any hard failure rolls the whole mark
      // back; a "deferred" chunk keeps the optimistic tick without revalidating (a
      // refetch would read pre-mark progress and un-tick the episodes). A watch on a
      // Stopped show un-stops it (onKept) — that unhide must land before revalidate
      // so the library re-read doesn't refile the show back under Stopped.
      let resumed = false;
      const outcome = await submit(ops, {
        rollback: () => queryClient.setQueryData(key, before),
        onKept: async () => {
          if (!watched) return null;
          const kept = await resume.resumeIfStopped(target.showId, target.ids);
          resumed = kept !== null;
          return kept;
        },
        revalidate: () => revalidate(target.showId, "all"),
      });
      if (outcome === "failed") {
        setError("Couldn't save that change. It'll retry — check your connection.");
        return;
      }
      setUndoState({ showId: target.showId, ids: target.ids, label, ops, resumed });
    },
    [patch, queryClient, revalidate, submit, resume],
  );

  const buildOps = useCallback(
    (
      build: typeof buildBulkMarkOps,
      target: MarkContextTarget,
      seasons: readonly SeasonView[],
      upTo?: EpisodeBound,
    ): readonly QueuedOp[] =>
      build(
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
        const ops = buildOps(buildBulkMarkOps, target, [season]);
        await submitBulk(
          target,
          ops,
          seasonMatch(season, target.includeSpecials),
          true,
          `Marked ${seasonLabel(season.number)} watched.`,
        );
      });
    },
    [submitBulk, buildOps, seasonMatch, withSeasonLock],
  );

  const unmarkSeason = useCallback(
    async (target: MarkContextTarget, season: SeasonView) => {
      await withSeasonLock(season.number, async () => {
        const ops = buildOps(buildBulkUnmarkOps, target, [season]);
        await submitBulk(
          target,
          ops,
          seasonMatch(season, target.includeSpecials),
          false,
          `Unmarked ${seasonLabel(season.number)}.`,
        );
      });
    },
    [submitBulk, buildOps, seasonMatch, withSeasonLock],
  );

  const markUpToHere = useCallback(
    async (target: MarkContextTarget, seasons: readonly SeasonView[], bound: EpisodeBound) => {
      const ops = buildOps(buildBulkMarkOps, target, seasons, bound);
      const includeSpecials = target.includeSpecials;
      await submitBulk(
        target,
        ops,
        (s, n, aired) =>
          aired &&
          (s !== 0 || includeSpecials) &&
          (s < bound.season || (s === bound.season && n <= bound.number)),
        true,
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
      const matchEpisode: EpisodeMatch = (s, n) => s === episode.season && n === episode.number;
      patch(target.showId, matchEpisode, next);
      // A watch on a Stopped show un-stops it (onKept): the unhide must land before
      // revalidate so the library re-read doesn't refile the show under Stopped.
      const outcome = await submit([op], {
        rollback: () => patch(target.showId, matchEpisode, !next),
        onKept: next ? () => resume.resumeIfStopped(target.showId, target.ids) : undefined,
        revalidate: () =>
          revalidate(target.showId, { season: episode.season, number: episode.number }),
      });
      if (outcome === "failed") setError("Couldn't update that episode. Please try again.");
    },
    [patch, revalidate, submit, reconcileAnchor, resume],
  );

  const undo = useCallback(async () => {
    const pending = undoState;
    if (pending === null) return;
    setUndoState(null);
    // If the mark auto-resumed the show, its Undo must re-stop it (onKept) — the
    // re-hide has to land before revalidate so the library re-read stays Stopped.
    await submit(pending.ops.map(invert), {
      rollback: () => {},
      onKept: pending.resumed ? () => resume.reStop(pending.showId, pending.ids) : undefined,
      revalidate: () => revalidate(pending.showId, "all"),
    });
  }, [undoState, revalidate, submit, resume]);

  return {
    markSeason,
    unmarkSeason,
    markUpToHere,
    toggleEpisode,
    undo,
    dismissUndo: () => setUndoState(null),
    clearError: () => setError(null),
    isSeasonPending: (seasonNumber) => pendingSeasons.has(seasonNumber),
    undoable: undoState === null ? null : { label: undoState.label },
    error,
  };
}
