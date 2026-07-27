import type { EpisodeRef, LibraryShow } from "@domain/model/library";
import { type EpisodePlay, MARK_MATCH_TOLERANCE_MS } from "@domain/reversal";
import { toMs } from "@domain/time";
import { resolveStill } from "../image-source";
import type { HiddenItem, Progress, WatchedShow, WatchlistItem } from "./schemas";
import { toEpisodeIds } from "./show-detail";

/**
 * A `LibraryShow` (what the selectors read) plus the two things the Up Next card
 * needs and the pure domain type omits: the show's TMDB id (an alternate
 * `/sync/*` write identifier for hide/watchlist), and `pendingAdvance`: set
 * while an optimistic mark's next episode is a client guess awaiting the
 * authoritative progress refetch, so the card can lock its action until then.
 *
 * Art is deliberately absent. `/sync/watched/shows` carries no `images` block,
 * so a poster here could only ever be null; every card reads its own from the
 * deferred `/shows/:id` query instead (`useShowArt`).
 */
export interface LibraryEntry extends LibraryShow {
  readonly tmdbId: number | null;
  readonly pendingAdvance: boolean;
}

/** What the write-queue op carries (as its opaque `inversePatch`) to reconcile a mark. */
export interface MarkContext {
  readonly showId: number;
  /** Trakt's `completed` count before this op: the reconcile pivot. Rollback lives
   * in the mark hook's closure (the pre-op cache snapshot), not in the durable op. */
  readonly preCompleted: number;
}

export interface LibraryInput {
  readonly watchedShows: readonly WatchedShow[];
  readonly progress: ReadonlyMap<number, Progress>;
  readonly hiddenShowIds: ReadonlySet<number>;
  /** Full watchlist items: the source of both membership flags and watchlist-only entries. */
  readonly watchlistShows: readonly WatchlistItem[];
}

type SchemaEpisode = NonNullable<Progress["next_episode"]>;

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

/**
 * Merge the watched-shows list with per-show progress, the hidden set, and
 * watchlist membership into the `LibraryEntry[]` every home surface derives from.
 * Every watched show carries real counts: `aired` from the bulk row's
 * `aired_episodes` and `completed` from its watched breakdown, both present on
 * `/sync/watched/shows`. A fetched per-show progress overrides both (it is the
 * authority on the user's hidden seasons) and is the only source of the NEXT
 * episode's identity. A never-watched show that is on the watchlist has no
 * `/sync/watched/shows` row, so it is materialized here as a zero-progress
 * `to-watch` entry: otherwise it would vanish from "To watch" after a refetch.
 */
export function assembleLibrary(input: LibraryInput): LibraryEntry[] {
  const watchlistShowIds = new Set<number>();
  for (const item of input.watchlistShows) {
    if (item.show !== undefined) watchlistShowIds.add(item.show.ids.trakt);
  }

  const entries: LibraryEntry[] = [];
  const seen = new Set<number>();
  for (const watched of input.watchedShows) {
    const { show } = watched;
    const trakt = show.ids.trakt;
    seen.add(trakt);
    const progress = input.progress.get(trakt);
    const next = progress?.next_episode ?? null;
    entries.push({
      showId: trakt,
      title: show.title,
      status: show.status ?? "",
      hidden: input.hiddenShowIds.has(trakt),
      inWatchlist: watchlistShowIds.has(trakt),
      lastWatchedAt: watched.last_watched_at ?? null,
      aired: progress?.aired ?? show.aired_episodes,
      completed: progress?.completed ?? watchedEpisodeCount(watched),
      nextEpisode: next === null ? null : toEpisodeRef(next),
      tmdbId: show.ids.tmdb ?? null,
      pendingAdvance: false,
    });
  }

  for (const item of input.watchlistShows) {
    const show = item.show;
    if (show === undefined || seen.has(show.ids.trakt)) continue;
    const trakt = show.ids.trakt;
    seen.add(trakt);
    entries.push({
      showId: trakt,
      title: show.title,
      status: show.status ?? "",
      hidden: input.hiddenShowIds.has(trakt),
      inWatchlist: true,
      lastWatchedAt: null,
      aired: 0,
      completed: 0,
      nextEpisode: null,
      tmdbId: show.ids.tmdb ?? null,
      pendingAdvance: false,
    });
  }
  return entries;
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

/** Extract the set of Trakt show ids from a hidden / watchlist list (movies ignored). */
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
 * a real recent date and cling it to the "New"/lead slot. `ids.trakt: 0` +
 * `pendingAdvance` mark it provisional: the Up Next grouping reads a zero-id next
 * as unknown-air and keeps it visible mid-binge but never ranks it as this week's
 * fresh drop until the authoritative progress refetch lands.
 */
export function advancePastNext(entry: LibraryEntry, watchedAt: string): LibraryEntry {
  const current = entry.nextEpisode;
  const nextEpisode: EpisodeRef | null =
    current === null
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

/**
 * Did a write land on Trakt, read from a fresh progress `completed`? A mark
 * (`toState: present`) lands when `completed` advanced past the pre-op count; an
 * unmark (`absent`) lands when it fell below it. This is the reconcile verdict
 * the write-queue consults instead of a blind re-POST after a network reject.
 */
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

/** Did an additive write create its probed play at the frozen watched-at time? */
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
