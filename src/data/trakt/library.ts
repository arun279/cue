import type { EpisodeIds } from "@domain/model/ids";
import type { EpisodeRef, LibraryShow } from "@domain/model/library";
import type { HiddenItem, Progress, WatchedShow, WatchlistItem } from "./schemas";

/**
 * A `LibraryShow` (what the selectors read) enriched with the presentation
 * data the Up Next card needs but the pure domain type omits: the Trakt inline
 * poster candidates + a TMDB id for the image resolver, and `pendingAdvance` —
 * set while an optimistic mark's next episode is a client guess awaiting the
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
 * `/shows/:id?extended=full,images` — the `/sync/watched/shows` list omits the
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
  /** Trakt's `completed` count before this op — the reconcile pivot. Rollback lives
   * in the mark hook's closure (the pre-op cache snapshot), not in the durable op. */
  readonly preCompleted: number;
}

export interface LibraryInput {
  readonly watchedShows: readonly WatchedShow[];
  readonly progress: ReadonlyMap<number, Progress>;
  readonly hiddenShowIds: ReadonlySet<number>;
  /** Full watchlist items — the source of both membership flags and watchlist-only entries. */
  readonly watchlistShows: readonly WatchlistItem[];
  /** Per-show art + broadcast metadata (poster/backdrop/network/genres/runtime), keyed by trakt id. */
  readonly details?: ReadonlyMap<number, ShowArt>;
}

type SchemaEpisode = NonNullable<Progress["next_episode"]>;

function episodeIds(ids: SchemaEpisode["ids"]): EpisodeIds {
  return {
    trakt: ids.trakt,
    tvdb: ids.tvdb ?? undefined,
    imdb: ids.imdb ?? undefined,
    tmdb: ids.tmdb ?? undefined,
  };
}

function toEpisodeRef(ep: SchemaEpisode): EpisodeRef {
  return {
    season: ep.season,
    number: ep.number,
    title: ep.title ?? null,
    firstAired: ep.first_aired ?? null,
    ids: episodeIds(ep.ids),
  };
}

/**
 * Merge the watched-shows list with per-show progress, the hidden set, and
 * watchlist membership into the `LibraryEntry[]` every home surface derives
 * from. A show with no fetched progress degrades to
 * zero-progress + no next episode rather than being dropped. A never-watched
 * show that is on the watchlist has no `/sync/watched/shows` row, so it is
 * materialized here as a zero-progress `to-watch` entry — otherwise it would
 * vanish from "To watch" after a refetch.
 */
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
      aired: progress?.aired ?? 0,
      completed: progress?.completed ?? 0,
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
 * the following episode (`number + 1`, title unknown until refetch). The
 * projected episode keeps an aired date so the card stays in the queue, and
 * `pendingAdvance` flags that its ids are provisional.
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
          firstAired: current.firstAired ?? watchedAt,
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
