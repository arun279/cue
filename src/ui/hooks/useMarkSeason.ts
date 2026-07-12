import { invalidateShowProgress } from "@data/query-invalidation";
import { queryKeys } from "@data/query-keys";
import type { EpisodeDetail } from "@data/trakt/episode-detail";
import type { SeasonView, ShowHeader } from "@data/trakt/show-detail";
import type { EpisodeIds, ShowIds } from "@domain/model/ids";
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

/** The minimal episode shape every per-episode action needs: satisfied by both
 * the season tree's `EpisodeView` and the episode sheet's `EpisodeDetail`. */
interface MarkableEpisode {
  readonly season: number;
  readonly number: number;
  readonly ids: EpisodeIds;
  readonly watched: boolean;
  /** The last play's timestamp when known: restores the detail read verbatim
   * if an uncheck has to roll back. */
  readonly watchedAt?: string | null;
}

interface ToggleEpisodeOptions {
  /** Snackbar message for a mark; present = the surface wants point-of-action Undo. */
  readonly undoLabel?: string;
  /** The episode's known play count, when the surface has resolved it (the sheet):
   * a rewatch uncheck then skips the optimistic un-tick so the filled check never
   * flickers while the latest play is removed. */
  readonly knownPlays?: number;
}

interface MarkUpToHereOptions {
  /** Snackbar message; defaults to the catch-up phrasing. */
  readonly label?: string;
  /** Fold the previous undoable's ops (same show) into this one, so the backfill
   * snackbar's Undo reverses the single mark AND the gap as one delta. */
  readonly absorbUndo?: boolean;
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
   * mark: once the toast has undone it there is nothing left to durably reverse). */
  readonly reversibleSeason: number | null;
  /** Monotonic per-hook counter so a snackbar effect can key on "a new undoable
   * arrived" even when two consecutive actions share a label. */
  readonly seq: number;
}

export interface MarkSeasonController {
  markSeason(target: MarkContextTarget, season: SeasonView): Promise<void>;
  /**
   * The durable, per-play-safe season unmark. When a `Mark season watched` from
   * this session completed the season, it reverses exactly that mark's delta by
   * exact history id (a play that predates the mark is never touched). Without a
   * session mark on record (the user confirmed "Unmark Season N?" on a genuinely
   * watched season) it spans every aired episode instead — still per-play-safe:
   * only single plays are removed, by exact id, and every rewatched episode is
   * kept intact and surfaced in the snackbar label.
   */
  unmarkSeason(target: MarkContextTarget, season: SeasonView): Promise<void>;
  /** Add one more play to EVERY aired episode of the season (the confirm sheet's
   * "Mark all N again (rewatch)"). Deliberately carries no Undo: the fresh plays
   * have no history ids until Trakt mints them, and the mark op's item-scoped
   * inverse would wipe the pre-existing plays a rewatch exists to keep. */
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
   * filled and `Removed 1 play — N remain` carries the Undo), so no tap here can
   * ever destroy plays it didn't target.
   */
  toggleEpisode(
    target: MarkContextTarget,
    episode: MarkableEpisode,
    options?: ToggleEpisodeOptions,
  ): Promise<void>;
  /** One deliberate extra play for an already-watched episode (long-press "Add
   * another play"). No Undo, same reasoning as {@link rewatchSeason}. */
  addEpisodePlay(target: MarkContextTarget, episode: MarkableEpisode): Promise<void>;
  /** Remove EVERY play of one episode by exact history ids (the long-press
   * "Remove all N plays…" behind its ConfirmSheet). Undo re-adds them all. */
  removeAllPlays(target: MarkContextTarget, episode: MarkableEpisode): Promise<void>;
  undo(): Promise<void>;
  dismissUndo(): void;
  clearError(): void;
  /** A non-error advisory (e.g. a rewatch season marked again, or an unmark that
   * found nothing safe to remove) for a message-only snackbar. */
  dismissNotice(): void;
  /** True while a mark/unmark write for this season number is in flight: the season
   * control locks so a second activation can't race a duplicate bulk write. */
  isSeasonPending(seasonNumber: number): boolean;
  readonly undoable: { readonly label: string; readonly seq: number } | null;
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

/**
 * Show-surface marking: whole-season, mark-up-to-here (also the "+N earlier"
 * backfill), rewatch increments, and the single episode toggle, each optimistic
 * (episodes check instantly, before the write settles) and funnelled through the
 * bulk builder so a batched mark carries only the aired, still-unwatched delta:
 * never a whole-season token, never unaired episodes, and never specials unless
 * opted in. Bulk marks expose a point-of-action Undo that re-sends the stored
 * inverse `/sync/history/remove`, scoped to that same delta so it reverts EXACTLY
 * the episodes this mark added and never touches plays that predate it (a partial
 * season un-does to its original count, never to zero). A completed season also
 * carries the durable `unmarkSeason` reversal: it re-resolves the show's real
 * Trakt plays and removes, by exact history id, only plays it can prove safe,
 * deliberately KEEPING a pre-existing play or a rewatched episode intact. Every
 * uncheck here (single episode or whole season) is per-play-safe and id-scoped,
 * so a reversal can never silently destroy a rewatch or a genuine watch the mark
 * never created. Rewatch ADDITIONS (`rewatchSeason`, `addEpisodePlay`) carry no
 * Undo at all — their only inverse would be an item-scoped wipe.
 */
export function useMarkSeason(): MarkSeasonController {
  const submit = useOptimisticWrite();
  const queryClient = useQueryClient();
  const runtime = useRuntime();
  const resume = useResumeOnMark();
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The state's synchronous mirror + seq source: async settle paths compare op
  // identity against the CURRENT undoable (not a stale closure), and the backfill
  // absorb path reads the previous undoable it folds into its own.
  const undoRef = useRef<UndoState | null>(null);
  const undoSeq = useRef(0);
  const putUndo = useCallback((next: Omit<UndoState, "seq"> | null): void => {
    undoSeq.current += 1;
    const state = next === null ? null : { ...next, seq: undoSeq.current };
    undoRef.current = state;
    setUndoState(state);
  }, []);
  /** Retract the current undoable only if `ops` still owns it (a later hard
   * failure of an earlier action can't clear a newer window). */
  const retractUndo = useCallback(
    (ops: readonly QueuedOp[]): void => {
      if (undoRef.current?.ops === ops) putUndo(null);
    },
    [putUndo],
  );
  // Which season numbers currently have a bulk mark write in flight, so the season
  // control locks (a second activation can't enqueue a duplicate bulk write). The ref
  // is the SYNCHRONOUS gate: checked-and-set before the async op so a double-tap in
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

  const patch = useCallback(
    (showId: number, match: EpisodeMatch, watched: boolean) => {
      queryClient.setQueryData<readonly SeasonView[]>(queryKeys.showSeasons(showId), (old) =>
        old === undefined ? old : patchEpisodes(old, match, watched),
      );
    },
    [queryClient],
  );

  // A per-episode action also patches that episode's own detail read (the sheet
  // renders from it), so a mark made on either surface ticks both instantly.
  const patchEpisodeDetail = useCallback(
    (showId: number, episode: EpisodeBound, watched: boolean, watchedAt: string | null) => {
      queryClient.setQueryData<EpisodeDetail>(
        queryKeys.episode(showId, episode.season, episode.number),
        (old) => (old === undefined ? old : { ...old, watched, watchedAt }),
      );
    },
    [queryClient],
  );

  // A single-episode toggle passes its coordinate so that episode's own detail read
  // is invalidated too; a bulk mark/unmark spans an unknown set of episodes, so it
  // passes "all" to invalidate the whole-show episode prefix: else a pre-cached
  // standalone episode page is left reading pre-mark progress.
  const revalidate = useCallback(
    (showId: number, episode?: { readonly season: number; readonly number: number } | "all") =>
      invalidateShowProgress(queryClient, showId, episode),
    [queryClient],
  );

  // The one settle wiring for a season-tree write: a hard failure restores the
  // pre-write snapshot verbatim, a kept watch un-stops a Stopped show (onKept:
  // that unhide must land before revalidate so the library re-read doesn't
  // refile the show back under Stopped), and settling revalidates whole-show
  // progress.
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
      absorb: UndoState | null = null,
    ): Promise<"done" | "failed" | "deferred"> => {
      if (ops.length === 0) return "done";
      // Snapshot the season tree before the optimistic write so a hard failure can
      // restore it verbatim: `match` spans episodes on the other side of the write
      // too, so a naive un-patch would wrongly flip pre-existing ticks.
      const before = queryClient.getQueryData<readonly SeasonView[]>(
        queryKeys.showSeasons(target.showId),
      );
      patch(target.showId, match, true);
      // Confirmation + Undo AT THE POINT OF ACTION: mount the toast synchronously with
      // the optimistic tick, BEFORE the paced/throttled write settles: mirroring the
      // Up Next mark. Otherwise the season shows its non-interactive "Watched"
      // done-state for the whole network flush with no way to reverse it, the exact
      // silent-commit this Undo exists to prevent. `resumed` is captured synchronously
      // from the mark-time Stopped state so this mark's Undo re-stops the show even
      // when the (paced) auto-resume write hasn't landed yet. `ops` identity tags the
      // slot so a later settle only ever touches the toast THIS mark put up. A
      // backfill absorbs the single mark it follows, so one Undo reverses the whole
      // combined delta.
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
      // The batch settles to its worst op: any hard failure rolls the whole mark
      // back; a "deferred" chunk keeps the optimistic tick without revalidating (a
      // refetch would read pre-mark progress and un-tick the episodes).
      const outcome = await submitSeasonWrite(target, before, ops);
      if (outcome === "failed") {
        // The mark didn't land and the seam already rolled the ticks back: retract
        // this mark's toast (if it's still the one showing) so there's no Undo for a
        // change that never happened, and surface the retry copy.
        retractUndo(undoOps);
        setError("Couldn't save that change. It'll retry, check your connection.");
      }
      return outcome;
    },
    [patch, putUndo, retractUndo, queryClient, submitSeasonWrite, resume],
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
        // the durable Unmark reverses exactly this set, never a pre-existing play,
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
          `${seasonLabel(season.number)} marked · ${delta.length} ${plural(delta.length)}`,
          season.number,
        );
        if (outcome === "failed") forgetSeasonMark(target.showId, season.number);
      });
    },
    [submitBulk, buildOps, seasonMatch, withSeasonLock],
  );

  const unmarkSeason = useCallback(
    async (target: MarkContextTarget, season: SeasonView) => {
      // Prefer the delta of a mark THIS session made, so the unmark reverses exactly
      // that mark. Without one (a genuinely watched season, behind its own danger
      // ConfirmSheet) span every aired episode: the planner still keeps rewatches
      // and removes only single plays by exact id, so nothing unprovable is lost.
      const remembered = getSeasonMarkDelta(target.showId, season.number);
      const delta =
        remembered ??
        new Set(season.episodes.filter((e) => e.aired).map((episode) => episode.number));
      if (delta.size === 0) return;
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
          // Nothing safe to remove: the plays are gone (already unchecked) or every
          // one is a rewatch: drop any retained mark (there is nothing left to
          // durably reverse) and route per-play removal to the watch history.
          forgetSeasonMark(target.showId, season.number);
          setNotice(
            plan.keptRewatch.length > 0
              ? "These plays are rewatches. Remove specific ones in your watch history."
              : "No plays to unmark for this season.",
          );
          return;
        }
        // Snapshot the season tree so a hard failure restores it verbatim, then
        // optimistically un-tick exactly the episodes whose single play we remove:
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
        const keptSuffix = kept > 0 ? ` · kept ${kept} rewatched ${plural(kept)}` : "";
        // Any remembered mark is consumed by this reversal: drop it so the durable
        // Unmark isn't offered again for the same (now reversed) mark.
        forgetSeasonMark(target.showId, season.number);
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
          setError("Couldn't unmark that season. It'll retry, check your connection.");
        }
      });
    },
    [withSeasonLock, runtime, queryClient, patch, putUndo, retractUndo, submit, revalidate],
  );

  const rewatchSeason = useCallback(
    async (target: MarkContextTarget, season: SeasonView) => {
      await withSeasonLock(season.number, async () => {
        const aired = season.episodes.filter(
          (episode) => episode.aired && (season.number !== 0 || target.includeSpecials),
        );
        if (aired.length === 0) return;
        // Feed the bulk builder a tree that presents every aired episode as
        // unwatched, so the chunked `/sync/history` POST adds one fresh play per
        // episode: the rewatch. `preCompleted: -1` makes a startup reconcile of a
        // lost response read as "landed" (completed can never be < 0): duplicating
        // an unverifiable rewatch play would be worse than dropping it.
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
            inversePatch: { showId: target.showId, preCompleted: -1 },
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
        patch(target.showId, seasonMatch(season, target.includeSpecials), true);
        setNotice(
          `${seasonLabel(season.number)} marked again · ${aired.length} ${plural(aired.length)}`,
        );
        const outcome = await submitSeasonWrite(target, before, ops);
        if (outcome === "failed") {
          setNotice(null);
          setError("Couldn't save that change. It'll retry, check your connection.");
        }
      });
    },
    [withSeasonLock, queryClient, patch, seasonMatch, submitSeasonWrite],
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

  const toggleEpisode = useCallback(
    async (target: MarkContextTarget, episode: MarkableEpisode, options?: ToggleEpisodeOptions) => {
      await withEpisodeLock(target, episode, async () => {
        const matchEpisode: EpisodeMatch = (s, n) => s === episode.season && n === episode.number;
        const bound: EpisodeBound = { season: episode.season, number: episode.number };
        if (episode.watched) {
          // OFF: the DURABLE, per-play-safe uncheck. Resolve the episode's real
          // plays; a single play is removed by its exact history id, a rewatch
          // loses only its NEWEST play (the check stays filled): never an
          // item-scoped wipe that could destroy plays this tap didn't target.
          const knownRewatch = (options?.knownPlays ?? 0) >= 2;
          const unTick = (): void => {
            patch(target.showId, matchEpisode, false);
            patchEpisodeDetail(target.showId, bound, false, null);
          };
          const restoreTick = (): void => {
            patch(target.showId, matchEpisode, true);
            patchEpisodeDetail(target.showId, bound, true, episode.watchedAt ?? null);
          };
          if (!knownRewatch) unTick();
          const resolution = await resolveEpisodeUnmark(runtime, episode.ids.trakt);
          if (resolution.kind === "error") {
            if (!knownRewatch) restoreTick();
            setError("Couldn't reach your history to unmark this. Please try again.");
            return;
          }
          if (resolution.kind === "none") {
            if (knownRewatch) unTick();
            revalidate(target.showId, bound);
            return;
          }
          const rewatch = resolution.kind === "rewatch";
          if (rewatch) {
            // Rewatch: the check stays filled, only the newest play goes; the
            // surviving (earlier) play is now the episode's latest.
            patch(target.showId, matchEpisode, true);
            patchEpisodeDetail(target.showId, bound, true, resolution.previous.watchedAt);
          } else if (knownRewatch) {
            // The known count was stale — resolution proved a single play.
            unTick();
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
                restore: resolution.plan.restore.map((r) => ({
                  trakt: r.trakt,
                  watchedAt: r.watchedAt,
                })),
              });
          const ops = [op];
          putUndo({
            showId: target.showId,
            ids: target.ids,
            label: rewatch ? `Removed 1 play — ${resolution.count - 1} remain` : "Removed play",
            ops,
            resumed: false,
            reversibleSeason: null,
          });
          const outcome = await submit(ops, {
            rollback: () => {
              if (rewatch) {
                patchEpisodeDetail(target.showId, bound, true, resolution.latest.watchedAt);
              } else {
                restoreTick();
              }
            },
            revalidate: () => revalidate(target.showId, bound),
          });
          if (outcome === "failed") {
            retractUndo(ops);
            setError("Couldn't update that episode. Please try again.");
          }
          return;
        }
        // ON: mark the single episode. A lost response reconciles against the show's
        // pre-op `completed` (a progress re-read) rather than blind-retrying → never a
        // duplicate play, matching the bulk path and the sibling mark hooks.
        const watchedAt = new Date().toISOString();
        const op = buildMarkEpisodeOp({
          opId: crypto.randomUUID(),
          ids: episode.ids,
          watchedAt,
          inversePatch: reconcileAnchor(target.showId),
        });
        const ops = [op];
        patch(target.showId, matchEpisode, true);
        patchEpisodeDetail(target.showId, bound, true, watchedAt);
        // A one-tap mark surface mounts the same point-of-action Undo the bulk path
        // does: synchronously with the optimistic tick, tagged by `ops` identity:
        // reusing the shared undo/invert machinery so the reversal safety net is
        // consistent with the Up Next list mark. `resumed` is captured synchronously
        // from the mark-time Stopped state so this mark's Undo re-stops the show even
        // before the (paced) auto-resume write has settled.
        const withUndo = options?.undoLabel !== undefined;
        if (withUndo) {
          setError(null);
          putUndo({
            showId: target.showId,
            ids: target.ids,
            label: options?.undoLabel ?? "",
            ops,
            resumed: resume.willResume(target.showId),
            reversibleSeason: null,
          });
        }
        // A watch on a Stopped show un-stops it (onKept): the unhide must land before
        // revalidate so the library re-read doesn't refile the show under Stopped.
        const outcome = await submit(ops, {
          rollback: () => {
            patch(target.showId, matchEpisode, false);
            patchEpisodeDetail(target.showId, bound, false, null);
          },
          onKept: () => resume.resumeIfStopped(target.showId, target.ids),
          revalidate: () => revalidate(target.showId, bound),
        });
        if (outcome === "failed") {
          if (withUndo) retractUndo(ops);
          setError("Couldn't update that episode. Please try again.");
        }
      });
    },
    [
      withEpisodeLock,
      patch,
      patchEpisodeDetail,
      putUndo,
      retractUndo,
      revalidate,
      submit,
      reconcileAnchor,
      resume,
      runtime,
    ],
  );

  const addEpisodePlay = useCallback(
    async (target: MarkContextTarget, episode: MarkableEpisode) => {
      await withEpisodeLock(target, episode, async () => {
        // `preCompleted: -1`: a lost response must reconcile as "landed" (see
        // rewatchSeason) — re-POSTing an unverifiable rewatch play would duplicate it.
        const op = buildMarkEpisodeOp({
          opId: crypto.randomUUID(),
          ids: episode.ids,
          watchedAt: new Date().toISOString(),
          inversePatch: { showId: target.showId, preCompleted: -1 },
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
        patch(target.showId, matchEpisode, false);
        patchEpisodeDetail(target.showId, bound, false, null);
        // Every play by its exact history id; the restore list re-adds each one,
        // so this removal's Undo is complete, not just the newest play.
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
            patch(target.showId, matchEpisode, true);
            patchEpisodeDetail(target.showId, bound, true, latest?.watchedAt ?? null);
          },
          revalidate: () => revalidate(target.showId, bound),
        });
        if (outcome === "failed") {
          retractUndo(ops);
          setError("Couldn't remove those plays. Please try again.");
        }
      });
    },
    [withEpisodeLock, runtime, patch, patchEpisodeDetail, putUndo, retractUndo, submit, revalidate],
  );

  const undo = useCallback(async () => {
    const pending = undoState;
    if (pending === null) return;
    putUndo(null);
    // A whole-season mark's toast Undo reverses the same mark the durable Unmark
    // would: once it has, drop the retained delta so no stale Unmark lingers.
    if (pending.reversibleSeason !== null) {
      forgetSeasonMark(pending.showId, pending.reversibleSeason);
    }
    // If the mark auto-resumed the show, its Undo must re-stop it (onKept): the
    // re-hide has to land before revalidate so the library re-read stays Stopped.
    await submit(pending.ops.map(invertOp), {
      rollback: () => {},
      onKept: pending.resumed ? () => resume.reStop(pending.showId, pending.ids) : undefined,
      revalidate: () => revalidate(pending.showId, "all"),
    });
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
    isSeasonPending: (seasonNumber) => pendingSeasons.has(seasonNumber),
    undoable: undoState === null ? null : { label: undoState.label, seq: undoState.seq },
    notice,
    error,
  };
}
