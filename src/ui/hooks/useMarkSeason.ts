import { invalidateShowProgress } from "@data/query-invalidation";
import { queryKeys } from "@data/query-keys";
import type { EpisodeView, SeasonView, ShowHeader } from "@data/trakt/show-detail";
import type { ShowIds } from "@domain/model/ids";
import { planSeasonUnmark } from "@domain/reversal";
import { buildBulkMarkOps, type SeasonTree } from "@domain/write-queue/bulk";
import { buildMarkEpisodeOp, buildRemovePlaysOp } from "@domain/write-queue/ops";
import type { QueuedOp } from "@domain/write-queue/types";
import { useQueryClient } from "@tanstack/react-query";
import { useOptimisticWrite } from "@ui/hooks/useOptimisticWrite";
import { useRuntime } from "@ui/runtime/runtime";
import { useCallback, useRef, useState } from "react";
import { resolveEpisodeUnmark } from "./resolveUnmark";
import { useResumeOnMark } from "./useResumeOnMark";
import { forgetSeasonMark, getSeasonMarkDelta, rememberSeasonMark } from "./useSeasonReversal";

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
  /** The season number a whole-season mark reverses, so its point-of-action Undo
   * also drops the retained mark delta (the durable "Unmark" reverses the same
   * mark — once the toast has undone it there is nothing left to durably reverse). */
  readonly reversibleSeason: number | null;
}

export interface MarkSeasonController {
  markSeason(target: MarkContextTarget, season: SeasonView): Promise<void>;
  /**
   * The durable, per-play-safe reversal of a `Mark season watched`:
   * resolve the show's real Trakt plays and remove ONLY the plays of that mark's own
   * delta by exact history id — a play that predates the mark is never touched, and a
   * delta episode rewatched afterwards keeps its extra play. Outlives the transient
   * toast (the delta is remembered for the session), so the mark can be reversed
   * minutes later, not only in the 6-second Undo window. Rewatched episodes it kept
   * are surfaced via `notice`.
   */
  unmarkSeason(target: MarkContextTarget, season: SeasonView): Promise<void>;
  markUpToHere(
    target: MarkContextTarget,
    seasons: readonly SeasonView[],
    bound: EpisodeBound,
  ): Promise<void>;
  /**
   * Toggle a single episode's watched flag. Marking ON: a one-tap "Mark watched"
   * surface (the hero + Up-next strip) passes `undoLabel` for the same point-of-action
   * Undo as the Up Next list mark; a granular episode-row checkbox passes none.
   * Unchecking is a DURABLE, per-play-safe reversal: it removes the
   * episode's single play by exact history id and refuses to wipe a rewatch (routing
   * that to the Diary via `notice`).
   */
  toggleEpisode(target: MarkContextTarget, episode: EpisodeView, undoLabel?: string): Promise<void>;
  undo(): Promise<void>;
  dismissUndo(): void;
  clearError(): void;
  /** A non-error advisory (e.g. an uncheck refused because the episode is a rewatch,
   * or a season unmark that kept rewatched episodes) pointing the user at the Diary. */
  dismissNotice(): void;
  /** True while a mark/unmark write for this season number is in flight — the season
   * button locks so a second activation can't race a duplicate bulk write. */
  isSeasonPending(seasonNumber: number): boolean;
  readonly undoable: { readonly label: string } | null;
  readonly notice: string | null;
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
 * unaired episodes, and never specials unless opted in. Bulk marks expose a
 * point-of-action Undo that re-sends the stored inverse `/sync/history/remove`,
 * scoped to that same delta so it reverts EXACTLY the episodes this mark added and
 * never touches plays that predate it (a partial season un-does to its original
 * count, never to zero). A completed season also carries a DURABLE reversal —
 * `unmarkSeason` — that outlives the transient Undo: it re-resolves the show's real
 * Trakt plays and removes, by exact history id, ONLY the plays of that mark's own
 * delta (remembered for the session), deliberately KEEPING a pre-existing play or a
 * rewatched episode intact. Every uncheck here (single episode or whole season) is
 * per-play-safe and delta-scoped, so a reversal can never silently destroy a rewatch
 * or a genuine watch the mark never created.
 */
export function useMarkSeason(): MarkSeasonController {
  const submit = useOptimisticWrite();
  const queryClient = useQueryClient();
  const runtime = useRuntime();
  const resume = useResumeOnMark();
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Which season numbers currently have a bulk mark write in flight, so the season
  // button locks (a second activation can't enqueue a duplicate bulk write). The ref
  // is the SYNCHRONOUS gate — checked-and-set before the async op so a double-tap in
  // one task (before React re-renders the disabled/aria-busy state) is dropped, not
  // double-fired; the state mirror only drives the visual lock. Mirrors the Up Next
  // mark's ref guard.
  const pendingSeasonsRef = useRef<Set<number>>(new Set());
  const [pendingSeasons, setPendingSeasons] = useState<ReadonlySet<number>>(() => new Set());
  // Single-episode marks/unmarks in flight, keyed by `showId:season:number`. Like the
  // season lock (and the Up Next list mark's `inFlight` ref) this is the SYNCHRONOUS
  // gate: a fast double-tap fires a second `toggleEpisode` before React re-renders the
  // ticked state, so without it the same episode would enqueue a duplicate play. Set
  // before the async write and released when it settles.
  const pendingEpisodesRef = useRef<Set<string>>(new Set());
  const withSeasonLock = useCallback(
    async (seasonNumber: number, run: () => Promise<void>): Promise<void> => {
      if (pendingSeasonsRef.current.has(seasonNumber)) return;
      pendingSeasonsRef.current.add(seasonNumber);
      setPendingSeasons((prev) => new Set(prev).add(seasonNumber));
      try {
        await run();
      } finally {
        pendingSeasonsRef.current.delete(seasonNumber);
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
    (showId: number, episode?: { readonly season: number; readonly number: number } | "all") =>
      invalidateShowProgress(queryClient, showId, episode),
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
      reversibleSeason: number | null = null,
    ): Promise<"done" | "failed" | "deferred"> => {
      if (ops.length === 0) return "done";
      // Snapshot the season tree before the optimistic write so a hard failure can
      // restore it verbatim — `match` spans episodes on the other side of the write
      // too, so a naive un-patch would wrongly flip pre-existing ticks.
      const key = queryKeys.showSeasons(target.showId);
      const before = queryClient.getQueryData<readonly SeasonView[]>(key);
      patch(target.showId, match, true);
      // Confirmation + Undo AT THE POINT OF ACTION: mount the toast synchronously with
      // the optimistic tick, BEFORE the paced/throttled write settles — mirroring the
      // Up Next mark. Otherwise the season shows its non-interactive "Watched"
      // done-state for the whole network flush with no way to reverse it, the exact
      // silent-commit this Undo exists to prevent. `resumed` is captured synchronously
      // from the mark-time Stopped state so this mark's Undo re-stops the show even
      // when the (paced) auto-resume write hasn't landed yet. `ops` identity tags the
      // slot so a later settle only ever touches the toast THIS mark put up.
      setError(null);
      setUndoState({
        showId: target.showId,
        ids: target.ids,
        label,
        ops,
        resumed: resume.willResume(target.showId),
        reversibleSeason,
      });
      // The batch settles to its worst op: any hard failure rolls the whole mark
      // back; a "deferred" chunk keeps the optimistic tick without revalidating (a
      // refetch would read pre-mark progress and un-tick the episodes). A watch on a
      // Stopped show un-stops it (onKept) — that unhide must land before revalidate
      // so the library re-read doesn't refile the show back under Stopped.
      const outcome = await submit(ops, {
        rollback: () => queryClient.setQueryData(key, before),
        onKept: () => resume.resumeIfStopped(target.showId, target.ids),
        revalidate: () => revalidate(target.showId, "all"),
      });
      if (outcome === "failed") {
        // The mark didn't land and the seam already rolled the ticks back — retract
        // this mark's toast (if it's still the one showing) so there's no Undo for a
        // change that never happened, and surface the retry copy.
        setUndoState((prev) => (prev?.ops === ops ? null : prev));
        setError("Couldn't save that change. It'll retry — check your connection.");
      }
      return outcome;
    },
    [patch, queryClient, revalidate, submit, resume],
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
        // This mark's OWN delta: the aired, previously-unwatched episodes it adds a
        // play to (the same predicate the bulk builder scopes on). Remembered so
        // the durable Unmark reverses exactly this set — never a pre-existing play —
        // once the transient toast is gone.
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
          `Marked ${seasonLabel(season.number)} watched.`,
          season.number,
        );
        if (outcome === "failed") forgetSeasonMark(target.showId, season.number);
      });
    },
    [submitBulk, buildOps, seasonMatch, withSeasonLock],
  );

  const unmarkSeason = useCallback(
    async (target: MarkContextTarget, season: SeasonView) => {
      // Only reverse a mark THIS session made: the durable Unmark is scoped to that
      // mark's remembered delta, so it can never remove a play the mark did not create.
      // The affordance is only shown when a delta is on record, so this is defensive.
      const delta = getSeasonMarkDelta(target.showId, season.number);
      if (delta === undefined || delta.size === 0) return;
      await withSeasonLock(season.number, async () => {
        setError(null);
        setNotice(null);
        let plays: Awaited<ReturnType<typeof runtime.loadShowPlays>>;
        try {
          plays = await runtime.loadShowPlays(target.showId);
        } catch {
          setError("Couldn't reach your history to unmark this season. Please try again.");
          return;
        }
        const plan = planSeasonUnmark(plays, season.number, target.includeSpecials, delta);
        if (plan.removeIds.length === 0) {
          // Nothing safe to remove: the mark's delta plays are gone (already unchecked)
          // or every one became a rewatch — drop the retained mark (there is nothing
          // left to durably reverse) and route per-play removal to the Diary.
          forgetSeasonMark(target.showId, season.number);
          setNotice(
            plan.keptRewatch.length > 0
              ? "These plays are rewatches — remove specific ones in your watch history."
              : "No plays to unmark for this season.",
          );
          return;
        }
        // Snapshot the season tree so a hard failure restores it verbatim, then
        // optimistically un-tick exactly the episodes whose single play we remove —
        // rewatched episodes stay ticked (their extra play survives).
        const key = queryKeys.showSeasons(target.showId);
        const before = queryClient.getQueryData<readonly SeasonView[]>(key);
        const removed = new Set(plan.restore.map((r) => `${r.season}:${r.number}`));
        patch(target.showId, (s, n) => removed.has(`${s}:${n}`), false);
        const op = buildRemovePlaysOp({
          opId: crypto.randomUUID(),
          ids: plan.removeIds,
          restore: plan.restore.map((r) => ({ trakt: r.trakt, watchedAt: r.watchedAt })),
        });
        const ops = [op];
        // Confirmation + Undo at the point of action; a kept rewatch is folded into the
        // label so a single snackbar carries the whole honest outcome.
        const kept = plan.keptRewatch.length;
        const keptSuffix =
          kept > 0 ? ` · kept ${kept} rewatched episode${kept === 1 ? "" : "s"}` : "";
        // The mark is being reversed — drop it from the reversible record so the
        // durable Unmark isn't offered again for the same (now consumed) mark.
        forgetSeasonMark(target.showId, season.number);
        setUndoState({
          showId: target.showId,
          ids: target.ids,
          label: `Unmarked ${seasonLabel(season.number)}${keptSuffix}.`,
          ops,
          resumed: false,
          reversibleSeason: null,
        });
        const outcome = await submit(ops, {
          rollback: () => queryClient.setQueryData(key, before),
          revalidate: () => revalidate(target.showId, "all"),
        });
        if (outcome === "failed") {
          setUndoState((prev) => (prev?.ops === ops ? null : prev));
          setError("Couldn't unmark that season. It'll retry — check your connection.");
        }
      });
    },
    [withSeasonLock, runtime, queryClient, patch, submit, revalidate],
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
    async (target: MarkContextTarget, episode: EpisodeView, undoLabel?: string) => {
      // Drop a second synchronous activation on the SAME episode (a fast double-tap):
      // its optimistic tick hasn't re-rendered yet, so without this it would enqueue a
      // duplicate play. Released in `finally` once the write settles.
      const epKey = `${target.showId}:${episode.season}:${episode.number}`;
      if (pendingEpisodesRef.current.has(epKey)) return;
      pendingEpisodesRef.current.add(epKey);
      const matchEpisode: EpisodeMatch = (s, n) => s === episode.season && n === episode.number;
      try {
        if (episode.watched) {
          // OFF: a DURABLE, per-play-safe uncheck. Optimistically un-tick,
          // then resolve the episode's real plays and remove the single play by its
          // exact history id — never an item-scoped wipe. A rewatch (two or more plays)
          // is refused and pointed at the Diary, so it can never be destroyed here.
          patch(target.showId, matchEpisode, false);
          const resolution = await resolveEpisodeUnmark(runtime, episode.ids.trakt);
          if (resolution.kind === "error") {
            patch(target.showId, matchEpisode, true);
            setError("Couldn't reach your history to unmark this. Please try again.");
            return;
          }
          if (resolution.kind === "rewatch") {
            patch(target.showId, matchEpisode, true);
            setNotice(
              `This episode has ${resolution.count} plays — remove a specific one in your watch history.`,
            );
            return;
          }
          if (resolution.kind === "none") {
            revalidate(target.showId, { season: episode.season, number: episode.number });
            return;
          }
          const removeOp = buildRemovePlaysOp({
            opId: crypto.randomUUID(),
            ids: resolution.plan.removeIds,
            restore: resolution.plan.restore.map((r) => ({
              trakt: r.trakt,
              watchedAt: r.watchedAt,
            })),
          });
          const removeOutcome = await submit([removeOp], {
            rollback: () => patch(target.showId, matchEpisode, true),
            revalidate: () =>
              revalidate(target.showId, { season: episode.season, number: episode.number }),
          });
          if (removeOutcome === "failed") {
            setError("Couldn't update that episode. Please try again.");
          }
          return;
        }
        // ON: mark the single episode. A lost response reconciles against the show's
        // pre-op `completed` (a progress re-read) rather than blind-retrying → never a
        // duplicate play, matching the bulk path and the sibling mark hooks.
        const op = buildMarkEpisodeOp({
          opId: crypto.randomUUID(),
          ids: episode.ids,
          watchedAt: new Date().toISOString(),
          inversePatch: reconcileAnchor(target.showId),
        });
        const ops = [op];
        patch(target.showId, matchEpisode, true);
        // A one-tap "Mark watched" surface (hero / Up-next strip) mounts the same
        // point-of-action Undo the bulk path does — synchronously with the optimistic
        // tick, tagged by `ops` identity — reusing the shared undo/invert machinery so
        // the reversal safety net is consistent with the Up Next list mark. `resumed`
        // is captured synchronously from the mark-time Stopped state so this mark's Undo
        // re-stops the show even before the (paced) auto-resume write has settled.
        const withUndo = undoLabel !== undefined;
        if (withUndo) {
          setError(null);
          setUndoState({
            showId: target.showId,
            ids: target.ids,
            label: undoLabel,
            ops,
            resumed: resume.willResume(target.showId),
            reversibleSeason: null,
          });
        }
        // A watch on a Stopped show un-stops it (onKept): the unhide must land before
        // revalidate so the library re-read doesn't refile the show under Stopped.
        const outcome = await submit(ops, {
          rollback: () => patch(target.showId, matchEpisode, false),
          onKept: () => resume.resumeIfStopped(target.showId, target.ids),
          revalidate: () =>
            revalidate(target.showId, { season: episode.season, number: episode.number }),
        });
        if (outcome === "failed") {
          if (withUndo) setUndoState((prev) => (prev?.ops === ops ? null : prev));
          setError("Couldn't update that episode. Please try again.");
        }
      } finally {
        pendingEpisodesRef.current.delete(epKey);
      }
    },
    [patch, revalidate, submit, reconcileAnchor, resume, runtime],
  );

  const undo = useCallback(async () => {
    const pending = undoState;
    if (pending === null) return;
    setUndoState(null);
    // A whole-season mark's toast Undo reverses the same mark the durable Unmark
    // would — once it has, drop the retained delta so no stale Unmark lingers.
    if (pending.reversibleSeason !== null) {
      forgetSeasonMark(pending.showId, pending.reversibleSeason);
    }
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
    dismissNotice: () => setNotice(null),
    isSeasonPending: (seasonNumber) => pendingSeasons.has(seasonNumber),
    undoable: undoState === null ? null : { label: undoState.label },
    notice,
    error,
  };
}
