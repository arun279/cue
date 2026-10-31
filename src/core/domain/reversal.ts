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
const MARK_MATCH_TOLERANCE_MS = 60_000;

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

export interface PlayRef {
  readonly historyId: number;
  readonly watchedAt: string;
}

export function isOwnPlay(storedAt: string, sentAt: string): boolean {
  const lag = Date.parse(sentAt) - Date.parse(storedAt);
  return lag >= 0 && lag < MARK_MATCH_TOLERANCE_MS;
}

function newestFirst(a: PlayRef, b: PlayRef): number {
  return Date.parse(b.watchedAt) - Date.parse(a.watchedAt) || b.historyId - a.historyId;
}

export function ownPlays<P extends PlayRef>(
  plays: readonly P[],
  sentAt: (play: P) => string | null,
  itemOf: (play: P) => number,
): P[] {
  const newest = new Map<number, P>();
  for (const play of plays) {
    const sent = sentAt(play);
    const kept = newest.get(itemOf(play));
    if (sent === null || !isOwnPlay(play.watchedAt, sent)) continue;
    if (kept === undefined || newestFirst(play, kept) < 0) newest.set(itemOf(play), play);
  }
  return plays.filter((play) => newest.get(itemOf(play)) === play);
}

export function markedAt(marks: readonly MarkedEpisodes[]): (play: EpisodePlay) => string | null {
  return (play) =>
    marks.find(
      (mark) =>
        mark.traktIds.has(play.episodeTrakt) || mark.positions.has(`${play.season}:${play.number}`),
    )?.watchedAt ?? null;
}

export function markLanded(
  toState: "present" | "absent",
  preCompleted: number,
  freshCompleted: number,
): boolean {
  return toState === "present" ? freshCompleted > preCompleted : freshCompleted < preCompleted;
}

export type AdditiveMatch =
  | { readonly episodeTrakt: number }
  | { readonly season: number; readonly number: number };

export function additiveLanded(
  plays: readonly EpisodePlay[],
  match: AdditiveMatch,
  watchedAt: string,
): boolean {
  return plays.some((play) => {
    const matches =
      "episodeTrakt" in match
        ? play.episodeTrakt === match.episodeTrakt
        : play.season === match.season && play.number === match.number;
    return matches && isOwnPlay(play.watchedAt, watchedAt);
  });
}
