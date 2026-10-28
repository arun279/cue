import { resolveStill } from "../../domain/image-source";
import {
  compareEpisodeKeys,
  type EpisodeKey,
  type EpisodeRef,
  type LibraryShow,
} from "../../domain/model/library";
import { type EpisodePlay, isOwnPlay } from "../../domain/reversal";
import { isAired, laterOf, toMs } from "../../domain/time";
import type { CollectionShow, HiddenItem, Progress, WatchedShow, WatchlistItem } from "./schemas";
import { progressLeft, toEpisodeIds } from "./show-detail";

export interface LibraryEntry extends LibraryShow {
  readonly tmdbId: number | null;
  readonly runtime: number | null;
  readonly posters: readonly string[];
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
  readonly collectionShows: readonly CollectionShow[];
}

type SchemaEpisode = NonNullable<Progress["next_episode"]>;
type SchemaShow = NonNullable<WatchlistItem["show"]>;

interface Saved {
  readonly show: SchemaShow;
  readonly addedAt: string | null;
  readonly inWatchlist: boolean;
}

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
  saved: Saved | undefined,
): LibraryEntry {
  const { show } = watched;
  return {
    showId: show.ids.trakt,
    title: show.title,
    year: show.year ?? null,
    status: show.status ?? "",
    hidden,
    ...savedFields(saved),
    lastWatchedAt: watched.last_watched_at ?? null,
    plays: watched.plays ?? null,
    ...progressOf(watched, progress),
    lastAired: lastAiredKey(progress, watched),
    tmdbId: show.ids.tmdb ?? null,
    runtime: show.runtime ?? null,
    pendingAdvance: false,
  };
}

function progressOf(
  watched: WatchedShow,
  progress: Progress | undefined,
): Pick<LibraryEntry, "aired" | "completed" | "left" | "nextEpisode"> {
  if (progress === undefined) {
    const completed = watchedEpisodeCount(watched);
    return {
      aired: watched.show.aired_episodes,
      completed,
      left: Math.max(0, watched.show.aired_episodes - completed),
      nextEpisode: null,
    };
  }
  return {
    aired: progress.aired,
    completed: progress.completed,
    left: progressLeft(progress),
    nextEpisode: progress.next_episode == null ? null : toEpisodeRef(progress.next_episode),
  };
}

// Trakt's watched list carries no images, so a title's poster comes from the watchlist or collection.
function savedFields(
  saved: Saved | undefined,
): Pick<LibraryEntry, "inWatchlist" | "addedAt" | "posters"> {
  if (saved === undefined) return { inWatchlist: false, addedAt: null, posters: [] };
  return {
    inWatchlist: saved.inWatchlist,
    addedAt: saved.addedAt,
    posters: saved.show.images?.poster ?? [],
  };
}

function toNotStartedEntry(saved: Saved, hidden: boolean): LibraryEntry {
  const { show } = saved;
  return {
    showId: show.ids.trakt,
    title: show.title,
    year: show.year ?? null,
    status: show.status ?? "",
    hidden,
    ...savedFields(saved),
    lastWatchedAt: null,
    plays: 0,
    aired: 0,
    completed: 0,
    left: 0,
    nextEpisode: null,
    lastAired: null,
    tmdbId: show.ids.tmdb ?? null,
    runtime: null,
    pendingAdvance: false,
  };
}

function savedShows(input: LibraryInput): Map<number, Saved> {
  const saved = new Map<number, Saved>();
  const add = (show: SchemaShow | undefined, addedAt: string | null, inWatchlist: boolean) => {
    if (show === undefined) return;
    const known = saved.get(show.ids.trakt) ?? { show, addedAt: null, inWatchlist: false };
    saved.set(show.ids.trakt, {
      show: known.show,
      addedAt: laterOf(known.addedAt, addedAt),
      inWatchlist: known.inWatchlist || inWatchlist,
    });
  };
  for (const item of input.watchlistShows) add(item.show, item.listed_at ?? null, true);
  for (const item of input.collectionShows) add(item.show, item.last_collected_at ?? null, false);
  return saved;
}

export function assembleLibrary(input: LibraryInput): LibraryEntry[] {
  const saved = savedShows(input);
  const watchedIds = new Set(input.watchedShows.map(({ show }) => show.ids.trakt));
  const watchedEntries = input.watchedShows.map((watched) => {
    const trakt = watched.show.ids.trakt;
    return toWatchedEntry(
      watched,
      input.progress.get(trakt),
      input.hiddenShowIds.has(trakt),
      saved.get(trakt),
    );
  });
  const notStartedEntries = [...saved]
    .filter(([trakt]) => !watchedIds.has(trakt))
    .map(([trakt, entry]) => toNotStartedEntry(entry, input.hiddenShowIds.has(trakt)));
  return [...watchedEntries, ...notStartedEntries];
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

// Without a progress read, the last watched episode is the last aired one only for a show with nothing left.
function lastAiredKey(progress: Progress | undefined, watched: WatchedShow): EpisodeKey | null {
  if (progress === undefined && watchedEpisodeCount(watched) < watched.show.aired_episodes) {
    return null;
  }
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
    left: Math.max(0, entry.left - 1),
    lastWatchedAt: watchedAt,
    plays: entry.plays === null ? null : entry.plays + 1,
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
  return plays.some((play) => {
    const matches =
      "episodeTrakt" in match
        ? play.episodeTrakt === match.episodeTrakt
        : play.season === match.season && play.number === match.number;
    return matches && isOwnPlay(play.watchedAt, watchedAt);
  });
}

export function quickMarkable(entry: LibraryEntry, now: number): boolean {
  return (
    !entry.pendingAdvance &&
    entry.nextEpisode !== null &&
    isAired(entry.nextEpisode.firstAired, now)
  );
}
