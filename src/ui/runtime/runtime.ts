import type { InvalidationKey } from "@data/query-invalidation";
import type { EpisodeDetail } from "@data/trakt/episode-detail";
import type { LibraryEntry, ShowArt } from "@data/trakt/library";
import type { MovieEntry, MovieHeader } from "@data/trakt/movie-library";
import type { UserStats } from "@data/trakt/schemas";
import type { SearchHit } from "@data/trakt/search";
import type { SeasonView, ShowHeader } from "@data/trakt/show-detail";
import type { UserProfile } from "@data/trakt/user-profile";
import type { CalendarEntry } from "@domain/calendar";
import type { HistoryEntry, HistoryRange } from "@domain/history";
import type { EpisodePlay, MoviePlay } from "@domain/reversal";
import type { QueuedOp } from "@domain/write-queue/types";
import { createContext, useContext } from "react";

/** The read side of the home surface: the assembled active queue. */
export interface UpNextData {
  readonly entries: readonly LibraryEntry[];
  /**
   * True when the watched library exceeds the cold-sync progress budget
   * so entries beyond the most-recently-watched head carry a
   * caught-up baseline rather than fetched progress. The sync pill surfaces this as
   * an honest "recent shows synced" state instead of implying full completeness.
   */
  readonly isPartial: boolean;
}

/** The read side of the My Shows movie library: watched + watchlist movies. */
export interface MovieLibraryData {
  readonly entries: readonly MovieEntry[];
}

/** The read side of Discover browse: trending + popular poster rails for
 * shows AND movies. Movies reuse the show-rail `SearchHit`
 * pipeline (DiscoverCard → `/movie/:id` + inline watchlist add). */
export interface DiscoverData {
  readonly trending: readonly SearchHit[];
  readonly popular: readonly SearchHit[];
  readonly trendingMovies: readonly SearchHit[];
  readonly popularMovies: readonly SearchHit[];
}

/** The read side of the calendar: flattened air-dated episodes + the hidden set to exclude. */
export interface CalendarData {
  readonly entries: readonly CalendarEntry[];
  readonly hiddenShowIds: readonly number[];
}

/** Which slice of history a Diary type filter reads (TV → episode plays). */
export type HistorySection = "all" | "episodes" | "movies";

/**
 * One page of the Diary: flattened plays newest-first, plus the paging
 * position so the infinite query knows whether an earlier page exists. History is
 * unbounded, so this is always a single page: never a full walk.
 */
export interface HistoryPageData {
  readonly entries: readonly HistoryEntry[];
  readonly page: number;
  readonly pageCount: number;
}

/** How a submitted write settled: applied, definitively rejected, or still durable-pending. */
export type SubmitOutcome = "done" | "failed" | "deferred";

/**
 * The result of one `/sync/last_activities` reconcile: the exact composite query
 * keys a diffed change touches (empty when nothing changed, or on the first poll
 * where there is no baseline to diff against), plus a `commit` that persists the
 * fresh snapshot as the next baseline. Callers MUST call `commit` only AFTER the
 * invalidated queries have refetched, so a crash mid-sync re-pulls the change on
 * the next boot rather than silently skipping it.
 */
export interface ActivitiesReconcile {
  readonly keys: readonly InvalidationKey[];
  commit(): Promise<void>;
}

/**
 * The composition-root services the UI runs on, injected so `@ui` stays free of
 * `@app`/`@platform` (dependency-cruiser). `loadUpNext` is the persisted-SWR
 * read; `submit` enqueues a write onto the durable queue, persists the op-log,
 * flushes (paced, 429/network aware), and reports how the head op settled.
 */
export interface CueRuntime {
  loadUpNext(): Promise<UpNextData>;
  /**
   * Deferred per-card show art (poster/backdrop/network/genres) from `/shows/:id`.
   * The cold-sync read omits art to stay within the GET budget; a visible show row
   * lazily fetches its own via this, cached by trakt id.
   */
  loadShowArt(showId: number): Promise<ShowArt>;
  /** The My Shows movie library: watched movies + watchlist movies as poster shelves. */
  loadMovieLibrary(): Promise<MovieLibraryData>;
  /** Movie detail hero from `/movies/:id?extended=full,images` (title, year, overview, art). */
  loadMovieHeader(movieId: number): Promise<MovieHeader>;
  /** "More like this" for a movie: `/movies/:id/related` as poster `SearchHit`s. */
  loadMovieRelated(movieId: number): Promise<readonly SearchHit[]>;
  /** Show detail hero + overall progress; paints before the season stream resolves. */
  loadShowHeader(showId: number): Promise<ShowHeader>;
  /** The season/episode tree merged with per-episode watched flags (streams in after the hero). */
  loadShowSeasons(showId: number): Promise<readonly SeasonView[]>;
  /** Episode detail: content + still + watched state + prev/next nav. */
  loadEpisode(showId: number, season: number, number: number): Promise<EpisodeDetail>;
  /** Trakt ids currently on the watchlist for a section. */
  loadWatchlistIds(section: "shows" | "movies"): Promise<readonly number[]>;
  /** Personalized calendar window: `/calendars/my/shows/{start}/{days}` + the hidden set. */
  loadCalendar(startDate: string, days: number): Promise<CalendarData>;
  /** One page of the reverse-chronological watch history. An optional
   * `range` bounds the read to a year/month (the decade jump). */
  loadHistory(
    section: HistorySection,
    page: number,
    range?: HistoryRange,
  ): Promise<HistoryPageData>;
  /**
   * Every episode play of one show, from `/sync/history/shows/:id`:
   * the scoped resolver a durable "Unmark season" reads so it can remove exactly
   * the season's plays by history id and leave rewatches intact.
   */
  loadShowPlays(showId: number): Promise<readonly EpisodePlay[]>;
  /** Every play of one episode, from `/sync/history/episodes/:id`: the
   * resolver behind a per-play-safe single-episode uncheck. */
  loadEpisodePlays(episodeId: number): Promise<readonly EpisodePlay[]>;
  /** Every play of one movie, from `/sync/history/movies/:id`: the
   * resolver behind a per-play-safe movie unmark: a single play reverses by its
   * exact history id, a rewatch is refused and routed to the Diary (never wiped). */
  loadMoviePlays(movieId: number): Promise<readonly MoviePlay[]>;
  /** Debounced show+movie search: one `/search/show,movie` per settled query, title-ranked. */
  search(query: string): Promise<readonly SearchHit[]>;
  /** Browse rails for empty-query Discover: trending + popular shows with poster art. */
  loadDiscover(): Promise<DiscoverData>;
  /** The signed-in user's lifetime watch stats for the Profile theatre. */
  loadStats(): Promise<UserStats>;
  /** The signed-in user's Trakt identity (username + avatar) for the Profile header. */
  loadUserProfile(): Promise<UserProfile>;
  submit(op: QueuedOp): Promise<SubmitOutcome>;
  /**
   * The single freshness gate: fetch `/sync/last_activities`, diff it
   * against the persisted baseline, and report the exact keys to invalidate.
   * Resolves `null` when the check itself failed (offline / rate-limited) so the
   * caller stays silent rather than flipping to an error. Page-Visibility-gated
   * polling drives it; navigation never does.
   */
  pollActivities(): Promise<ActivitiesReconcile | null>;
  /**
   * Tear down this device's session on user disconnect: flush any pending writes
   * (best-effort, while the token is still valid), then clear the durable op-log,
   * the last-activities baseline, and the persisted query cache so the next
   * account starts clean. The caller revokes + clears the token afterwards. A
   * normal disconnect rejects with `PendingWritesError` when the flush couldn't
   * drain the queue (so those writes aren't lost); `{ force: true }` (the
   * dead-token path) clears regardless.
   */
  endLocalSession(options?: { readonly force?: boolean }): Promise<void>;
}

const RuntimeContext = createContext<CueRuntime | null>(null);

export const RuntimeProvider = RuntimeContext.Provider;

export function useRuntime(): CueRuntime {
  const runtime = useContext(RuntimeContext);
  if (runtime === null) throw new Error("useRuntime must be used within a RuntimeProvider.");
  return runtime;
}

/**
 * The runtime when a session is mounted, else `null`: for the app shell, which
 * renders (without a RuntimeProvider) during the pre-token `/auth/callback` return
 * where no runtime exists yet. Feature hooks must use {@link useRuntime}.
 */
export function useOptionalRuntime(): CueRuntime | null {
  return useContext(RuntimeContext);
}
