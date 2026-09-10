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

/**
 * A `LibraryShow` (what the selectors read) plus the one thing the Up Next card
 * needs and the pure domain type omits: the show's TMDB id, an alternate
 * `/sync/*` write identifier for hide/watchlist.
 *
 * Art is deliberately absent. `/sync/watched/shows` carries no `images` block,
 * so a poster here could only ever be null; every card reads its own from the
 * deferred `/shows/:id` query instead (`useShowArt`).
 */
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
  for (const item of input.watchlistShows) {
    if (item.show !== undefined && !watchlistById.has(item.show.ids.trakt)) {
      watchlistById.set(item.show.ids.trakt, item.show);
    }
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

/**
 * Watched-episode count from the bulk `/sync/watched/shows` breakdown, paired with
 * the row's `aired_episodes` to give every show its real progress without a second
 * GET, so a per-show progress read buys only the next episode's identity. The
 * breakdown lists each watched episode once (rewatches carry `plays`, not
 * duplicate rows), so this counts distinct episodes.
 *
 * Two cuts make it agree with `/progress/watched`:
 *   • Specials (season 0) are excluded, because `aired_episodes` is the season sum
 *     EXCLUDING season 0. Counting them would read a show with watched specials as
 *     past its own aired count and silently drop it from the queue.
 *   • Plays before a "restart show" `reset_at` are excluded, which is the only
 *     thing the progress read would have done differently, so a reset show is
 *     resolved here rather than by spending a GET. An episode with no stamp on a
 *     reset show counts as pre-reset: understating `completed` leaves the show in
 *     the queue, which is the harmless direction.
 */
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
  let last: EpisodeKey | null = null;
  const seasons = progress === undefined ? watched.seasons : progress.seasons;
  for (const season of seasons ?? []) {
    if (progress === undefined && season.number === 0) continue;
    for (const episode of season.episodes) {
      const key = { season: season.number, number: episode.number };
      if (last === null || compareEpisodeKeys(key, last) > 0) last = key;
    }
  }
  return last;
}

export function showIdSet(items: readonly (HiddenItem | WatchlistItem)[]): Set<number> {
  const ids = new Set<number>();
  for (const item of items) {
    const trakt = item.show?.ids.trakt;
    if (trakt !== undefined) ids.add(trakt);
  }
  return ids;
}

/**
 * Optimistically advance an entry one episode past its current next (the
 * mark-watched hot path): bump `completed`, freeze `lastWatchedAt`, and project
 * the following episode (`number + 1`, title + air date unknown until refetch).
 * The projection carries `firstAired: null`: inheriting the just-watched
 * episode's air date would fabricate a season-finale phantom (S0xE(last+1)) with
 * a real recent date and cling it to the lead slot.
 *
 * It is projected ONLY inside the season the snapshot's own `lastAired` frontier
 * ends in, and only below that frontier's number. A client cannot infer where a
 * season boundary falls or what comes after the aired run, so past either one
 * there is no coordinate to carry and the row advances with none. Which episode
 * is really next is then Trakt's answer alone.
 *
 * `pendingAdvance` marks the row provisional, which is what keeps it in the queue
 * mid-binge until the authoritative progress refetch lands, and `ids.trakt: 0`
 * says the coordinate is a guess rather than an episode anything may be read for.
 */
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

/**
 * Whether a surface may offer to mark this show's next episode right now. The
 * accelerator rides the exact queue pipeline, so it only offers itself when the
 * next episode is known and has aired, never a guessed coordinate: a mark
 * against a post-mark projection would write a play for an episode that may not
 * exist yet.
 */
export function quickMarkable(entry: LibraryEntry, now: number): boolean {
  return (
    !entry.pendingAdvance &&
    entry.nextEpisode !== null &&
    isAired(entry.nextEpisode.firstAired, now)
  );
}
