export interface EpisodePlay {
  readonly historyId: number;
  readonly episodeTrakt: number;
  readonly season: number;
  readonly number: number;
  readonly watchedAt: string;
}

export interface MoviePlay {
  readonly historyId: number;
  readonly watchedAt: string;
}

// Trakt truncates a stored watched_at to the whole minute.
export const MARK_MATCH_TOLERANCE_MS = 60_000;

interface UnmarkRestore {
  readonly trakt: number;
  readonly season: number;
  readonly number: number;
  readonly watchedAt: string;
}

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

export function planEpisodeUnmark(plays: readonly EpisodePlay[], episodeTrakt: number): UnmarkPlan {
  const own = plays.filter((play) => play.episodeTrakt === episodeTrakt);
  if (own.length === 0) return EMPTY_PLAN;
  return planFrom([own]);
}

export interface MarkedEpisodes {
  readonly watchedAt: string;
  readonly traktIds: ReadonlySet<number>;
  readonly positions: ReadonlySet<string>;
}

export type MarkUndoPlan =
  | {
      readonly kind: "remove";
      readonly removeIds: readonly number[];
      readonly restore: readonly { readonly trakt: number; readonly watchedAt: string }[];
    }
  | { readonly kind: "none" };

function markedBy(play: EpisodePlay, marks: readonly MarkedEpisodes[]): boolean {
  return marks.some(
    (mark) =>
      (mark.traktIds.has(play.episodeTrakt) ||
        mark.positions.has(`${play.season}:${play.number}`)) &&
      Math.abs(Date.parse(play.watchedAt) - Date.parse(mark.watchedAt)) <= MARK_MATCH_TOLERANCE_MS,
  );
}

function newestFirst(a: EpisodePlay, b: EpisodePlay): number {
  return Date.parse(b.watchedAt) - Date.parse(a.watchedAt) || b.historyId - a.historyId;
}

export function planMarkUndo(
  marks: readonly MarkedEpisodes[],
  plays: readonly EpisodePlay[],
): MarkUndoPlan {
  const newest = new Map<number, EpisodePlay>();
  for (const play of plays) {
    const kept = newest.get(play.episodeTrakt);
    if (markedBy(play, marks) && (kept === undefined || newestFirst(play, kept) < 0)) {
      newest.set(play.episodeTrakt, play);
    }
  }
  const own = plays.filter((play) => newest.get(play.episodeTrakt) === play);
  if (own.length === 0) return { kind: "none" };
  return {
    kind: "remove",
    removeIds: own.map((play) => play.historyId),
    restore: own.map((play) => ({ trakt: play.episodeTrakt, watchedAt: play.watchedAt })),
  };
}
