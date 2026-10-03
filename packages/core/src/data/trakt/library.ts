import {
  compareEpisodeKeys,
  type EpisodeKey,
  type EpisodeRef,
  type LibraryShow,
} from "../../domain/model/library";
import { type EpisodePlay, MARK_MATCH_TOLERANCE_MS } from "../../domain/reversal";
import { isAired, toMs } from "../../domain/time";
import { resolveStill } from "../image-source";
import type { HiddenItem, Progress, WatchedShow, WatchlistItem } from "./schemas";
import { toEpisodeIds } from "./show-detail";

export interface LibraryEntry extends LibraryShow {
  readonly tmdbId: number | null;
}

export interface MarkContext {
  readonly showId: number;
  readonly preCompleted: number;
}

export interface LibraryInput {
  readonly watchedShows: readonly WatchedShow[];
  readonly progress: ReadonlyMap<number, Progress>;
  readonly hiddenShowIds: ReadonlySet<number>;
  readonly watchlistShows: readonly WatchlistItem[];
}

type SchemaEpisode = NonNullable<Progress["next_episode"]>;
type SchemaShow = NonNullable<WatchlistItem["show"]>;

function toEpisodeRef(ep: SchemaEpisode): EpisodeRef {
  return {
    season: ep.season,
    number: ep.number,
    title: ep.title ?? null,
    firstAired: ep.first_aired ?? null,
    still: resolveStill(ep.images?.screenshot),
    ids: toEpisodeIds(ep.ids),
  };
}

function toWatchedEntry(
  watched: WatchedShow,
  progress: Progress | undefined,
  hidden: boolean,
  inWatchlist: boolean,
): LibraryEntry {
  const { show } = watched;
  return {
    showId: show.ids.trakt,
    title: show.title,
    status: show.status ?? "",
    hidden,
    inWatchlist,
    lastWatchedAt: watched.last_watched_at ?? null,
    aired: progress?.aired ?? show.aired_episodes,
    completed: progress?.completed ?? watchedEpisodeCount(watched),
    nextEpisode: progress?.next_episode == null ? null : toEpisodeRef(progress.next_episode),
    lastAired: lastAiredKey(progress, watched),
    tmdbId: show.ids.tmdb ?? null,
    pendingAdvance: false,
  };
}

function toWatchlistEntry(show: SchemaShow, hidden: boolean): LibraryEntry {
  return {
    showId: show.ids.trakt,
    title: show.title,
    status: show.status ?? "",
    hidden,
    inWatchlist: true,
    lastWatchedAt: null,
    aired: 0,
    completed: 0,
    nextEpisode: null,
    lastAired: null,
    tmdbId: show.ids.tmdb ?? null,
    pendingAdvance: false,
  };
}

export function assembleLibrary(input: LibraryInput): LibraryEntry[] {
  const watchlistById = new Map<number, SchemaShow>();
  for (const { show } of input.watchlistShows) {
    if (show !== undefined) watchlistById.set(show.ids.trakt, show);
  }

  const watchedIds = new Set(input.watchedShows.map(({ show }) => show.ids.trakt));
  const watchedEntries = input.watchedShows.map((watched) => {
    const trakt = watched.show.ids.trakt;
    return toWatchedEntry(
      watched,
      input.progress.get(trakt),
      input.hiddenShowIds.has(trakt),
      watchlistById.has(trakt),
    );
  });
  const watchlistEntries = [...watchlistById]
    .filter(([trakt]) => !watchedIds.has(trakt))
    .map(([trakt, show]) => toWatchlistEntry(show, input.hiddenShowIds.has(trakt)));
  return [...watchedEntries, ...watchlistEntries];
}

// Trakt's aired_episodes excludes specials (season 0).
export function watchedEpisodeCount(watched: WatchedShow): number {
  const resetAt = toMs(watched.reset_at);
  let count = 0;
  for (const season of watched.seasons ?? []) {
    if (season.number === 0) continue;
    for (const episode of season.episodes) {
      if (resetAt === null || (toMs(episode.last_watched_at) ?? 0) >= resetAt) count += 1;
    }
  }
  return count;
}

function lastAiredKey(progress: Progress | undefined, watched: WatchedShow): EpisodeKey | null {
  const seasons =
    progress === undefined
      ? watched.seasons?.filter((season) => season.number !== 0)
      : progress.seasons;
  const keys = (seasons ?? []).flatMap((season) =>
    season.episodes.map((episode) => ({ season: season.number, number: episode.number })),
  );
  return keys.sort(compareEpisodeKeys).at(-1) ?? null;
}

export function showIdSet(items: readonly (HiddenItem | WatchlistItem)[]): Set<number> {
  const ids = new Set<number>();
  for (const item of items) {
    const trakt = item.show?.ids.trakt;
    if (trakt !== undefined) ids.add(trakt);
  }
  return ids;
}

export function advancePastNext(entry: LibraryEntry, watchedAt: string): LibraryEntry {
  const current = entry.nextEpisode;
  const nextEpisode: EpisodeRef | null =
    current === null ||
    entry.lastAired === null ||
    current.season !== entry.lastAired.season ||
    current.number >= entry.lastAired.number
      ? null
      : {
          season: current.season,
          number: current.number + 1,
          title: null,
          firstAired: null,
          still: null,
          ids: { trakt: 0 },
        };
  return {
    ...entry,
    completed: entry.completed + 1,
    lastWatchedAt: watchedAt,
    nextEpisode,
    pendingAdvance: true,
  };
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
  const markedAt = Date.parse(watchedAt);
  return plays.some((play) => {
    const matches =
      "episodeTrakt" in match
        ? play.episodeTrakt === match.episodeTrakt
        : play.season === match.season && play.number === match.number;
    return matches && Math.abs(Date.parse(play.watchedAt) - markedAt) <= MARK_MATCH_TOLERANCE_MS;
  });
}

export function quickMarkable(entry: LibraryEntry, now: number): boolean {
  return (
    !entry.pendingAdvance &&
    entry.nextEpisode !== null &&
    isAired(entry.nextEpisode.firstAired, now)
  );
}
