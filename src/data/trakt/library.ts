import type { EpisodeRef, LibraryShow } from "@domain/model/library";
import { type EpisodePlay, MARK_MATCH_TOLERANCE_MS } from "@domain/reversal";
import { resolveStill } from "../image-source";
import type { HiddenItem, Progress, WatchedShow, WatchlistItem } from "./schemas";
import { toEpisodeIds } from "./show-detail";

/**
 * A `LibraryShow` (what the selectors read) enriched with the presentation
 * data the Up Next card needs but the pure domain type omits: the Trakt inline
 * poster candidates for the image resolver, the show's TMDB id (an alternate
 * `/sync/*` write identifier for hide/watchlist), and `pendingAdvance`: set
 * while an optimistic mark's next episode is a client guess awaiting the
 * authoritative progress refetch, so the card can lock its action until then.
 */
export interface LibraryEntry extends LibraryShow {
  readonly posters: readonly string[];
  readonly backdrops: readonly string[];
  readonly network: string | null;
  readonly genres: readonly string[];
  readonly runtime: number | null;
  readonly tmdbId: number | null;
  readonly pendingAdvance: boolean;
}

/**
 * Presentation art + broadcast metadata for one show, sourced from
 * `/shows/:id?extended=full,images`: the `/sync/watched/shows` list omits the
 * `images` block, so the poster/backdrop the hero and cards render come from
 * here, keyed by trakt id and merged in `assembleLibrary`.
 */
export interface ShowArt {
  readonly posters: readonly string[];
  readonly backdrops: readonly string[];
  readonly network: string | null;
  readonly genres: readonly string[];
  readonly runtime: number | null;
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
  /** Per-show art + broadcast metadata (poster/backdrop/network/genres/runtime), keyed by trakt id. */
  readonly details?: ReadonlyMap<number, ShowArt>;
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
 * The art + broadcast fields for one entry: prefer the fetched show-detail art
 * (the only source that carries images), falling back to whatever inline posters
 * the source list itself provided and empty metadata otherwise.
 */
function artFields(
  details: ReadonlyMap<number, ShowArt> | undefined,
  showId: number,
  inlinePosters: readonly string[] | undefined,
): ShowArt {
  const art = details?.get(showId);
  return {
    posters: art?.posters ?? inlinePosters ?? [],
    backdrops: art?.backdrops ?? [],
    network: art?.network ?? null,
    genres: art?.genres ?? [],
    runtime: art?.runtime ?? null,
  };
}

/**
 * Merge the watched-shows list with per-show progress, the hidden set, and
 * watchlist membership into the `LibraryEntry[]` every home surface derives from.
 * Every watched show carries real counts: `aired` from the bulk row's
 * `aired_episodes` and `completed` from its watched breakdown, both present on
 * `/sync/watched/shows`. A fetched per-show progress overrides both (it is the
 * authority on hidden seasons, specials, and a restarted show) and is the only
 * source of the NEXT episode's identity. A never-watched show that is on the
 * watchlist has no `/sync/watched/shows` row, so it is materialized here as a
 * zero-progress `to-watch` entry: otherwise it would vanish from "To watch" after
 * a refetch.
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
      ...artFields(input.details, trakt, show.images?.poster),
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
      ...artFields(input.details, trakt, show.images?.poster),
      tmdbId: show.ids.tmdb ?? null,
      pendingAdvance: false,
    });
  }
  return entries;
}

/**
 * Watched-episode count from the bulk `/sync/watched/shows` breakdown, specials
 * (season 0) excluded to match progress semantics. Paired with the row's
 * `aired_episodes` this is every show's real progress without a second GET, so a
 * per-show progress read buys only the next episode's identity. The breakdown
 * lists each watched episode once (rewatches carry `plays`, not duplicate rows),
 * so this counts distinct episodes.
 */
export function watchedEpisodeCount(watched: WatchedShow): number {
  let count = 0;
  for (const season of watched.seasons ?? []) {
    if (season.number === 0) continue;
    count += season.episodes.length;
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
