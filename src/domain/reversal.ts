/**
 * Durable, per-play-safe reversal planning. A settled watch is undone
 * by removing its EXACT Trakt history-event ids — never an item/season token wipe.
 * The planners here take the plays resolved from `/sync/history/{shows|episodes}/:id`
 * and decide which history ids to remove, how to restore them (the Undo re-add),
 * and — crucially — which episodes to KEEP untouched because they carry more than
 * one play (a rewatch). Removing a rewatched episode's plays would destroy watch
 * history the user did not ask to lose, so those episodes are deliberately skipped
 * and surfaced back to the caller, who routes the user to the Diary for per-play
 * removal. This is the guarantee that an unmark can never wipe a rewatch. The
 * season planner is additionally scoped to the mark's own delta, so a play that
 * predates the mark is never in the removal set either — a durable "Unmark" reverses
 * exactly what the mark added, never a genuine watch it did not create.
 */

/**
 * One resolved watch-history play of an episode. `historyId` is Trakt's per-play
 * event id — the handle that removes THIS play and nothing else. An episode with
 * two entries here has been watched twice (a rewatch).
 */
export interface EpisodePlay {
  readonly historyId: number;
  readonly episodeTrakt: number;
  readonly season: number;
  readonly number: number;
  readonly watchedAt: string;
}

/**
 * One resolved watch-history play of a movie. `historyId` is Trakt's per-play
 * event id — the handle that removes THIS play and nothing else. A movie with two
 * entries here has been watched twice (a rewatch), so a blunt item-scoped unmark
 * would wipe history the user never asked to lose; the resolver refuses it and
 * routes to the Diary, exactly as the episode path does.
 */
export interface MoviePlay {
  readonly historyId: number;
  readonly watchedAt: string;
}

/** The per-episode data a removed play needs to be re-added by the Undo. */
interface UnmarkRestore {
  readonly trakt: number;
  readonly season: number;
  readonly number: number;
  readonly watchedAt: string;
}

/**
 * A resolved unmark: the exact history ids to remove, the per-episode restore for
 * the Undo re-add, and the rewatched episodes it left intact (never removed). An
 * empty `removeIds` with a non-empty `keptRewatch` means every candidate play was
 * a rewatch, so there was nothing safe to remove.
 */
export interface UnmarkPlan {
  readonly removeIds: readonly number[];
  readonly restore: readonly UnmarkRestore[];
  readonly keptRewatch: readonly { readonly season: number; readonly number: number }[];
}

const EMPTY_PLAN: UnmarkPlan = { removeIds: [], restore: [], keptRewatch: [] };

function groupByEpisode(plays: readonly EpisodePlay[]): Map<number, EpisodePlay[]> {
  const byEpisode = new Map<number, EpisodePlay[]>();
  for (const play of plays) {
    const list = byEpisode.get(play.episodeTrakt) ?? [];
    list.push(play);
    byEpisode.set(play.episodeTrakt, list);
  }
  return byEpisode;
}

/**
 * Reduce grouped plays to a plan: an episode with EXACTLY ONE play is removed by
 * that play's id (safe — no rewatch to lose); an episode with two or more plays is
 * kept intact and reported as a rewatch. Sorted by (season, number) so the removal
 * body and the restore are deterministic (stable e2e assertions, byte-stable retry).
 */
function planFrom(groups: Iterable<EpisodePlay[]>): UnmarkPlan {
  const removeIds: number[] = [];
  const restore: UnmarkRestore[] = [];
  const keptRewatch: { season: number; number: number }[] = [];
  const ordered = [...groups]
    .filter((group) => group.length > 0)
    .sort((a, b) => {
      const first = a[0] as EpisodePlay;
      const second = b[0] as EpisodePlay;
      return first.season - second.season || first.number - second.number;
    });
  for (const group of ordered) {
    const head = group[0] as EpisodePlay;
    if (group.length >= 2) {
      keptRewatch.push({ season: head.season, number: head.number });
      continue;
    }
    removeIds.push(head.historyId);
    restore.push({
      trakt: head.episodeTrakt,
      season: head.season,
      number: head.number,
      watchedAt: head.watchedAt,
    });
  }
  return { removeIds, restore, keptRewatch };
}

/**
 * Plan a durable season unmark scoped to a MARK'S OWN DELTA — the aired,
 * previously-unwatched episodes a `Mark season watched` added a play to. Only those
 * episodes are considered, so a play that PREDATES the mark (a genuine watch the
 * user never asked to lose) is never removed: "Unmark" reverses the mark, it does
 * not clear the season. Specials (season 0) are skipped unless opted in. A delta
 * episode that gained a SECOND play after the mark (a rewatch) is kept intact and
 * reported; every other delta episode's single play is removed by its exact id.
 */
export function planSeasonUnmark(
  plays: readonly EpisodePlay[],
  season: number,
  includeSpecials: boolean,
  deltaEpisodes: ReadonlySet<number>,
): UnmarkPlan {
  if (season === 0 && !includeSpecials) return EMPTY_PLAN;
  const inDelta = plays.filter((play) => play.season === season && deltaEpisodes.has(play.number));
  return planFrom(groupByEpisode(inDelta).values());
}

/**
 * Plan a durable single-episode unmark. One play → remove it by id; a rewatch (two
 * or more plays) → keep it and report so the caller can refuse the destructive wipe
 * and point the user at the Diary; no plays → an empty no-op plan.
 */
export function planEpisodeUnmark(plays: readonly EpisodePlay[], episodeTrakt: number): UnmarkPlan {
  const own = plays.filter((play) => play.episodeTrakt === episodeTrakt);
  if (own.length === 0) return EMPTY_PLAN;
  return planFrom([own]);
}
