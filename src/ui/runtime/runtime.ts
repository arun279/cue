import type { TmdbImageConfig } from "@data/image-source";
import type { InvalidationKey } from "@data/query-invalidation";
import type { EpisodeDetail } from "@data/trakt/episode-detail";
import type { LibraryEntry } from "@data/trakt/library";
import type { MovieEntry, MovieHeader } from "@data/trakt/movie-library";
import type { UserStats } from "@data/trakt/schemas";
import type { SearchHit } from "@data/trakt/search";
import type { SeasonView, ShowHeader } from "@data/trakt/show-detail";
import type { CalendarEntry } from "@domain/calendar";
import type { QueuedOp } from "@domain/write-queue/types";
import { createContext, useContext } from "react";

/** trakt id → 1–10 rating, for the currently-rated items of one section. */
export type RatingMap = Readonly<Record<number, number>>;

/** The read side of the home surface: the assembled queue + the image resolver config. */
export interface UpNextData {
  readonly entries: readonly LibraryEntry[];
  readonly tmdbConfig: TmdbImageConfig | null;
}

/** The read side of the My Shows movie library: watched + watchlist movies + the image config. */
export interface MovieLibraryData {
  readonly entries: readonly MovieEntry[];
  readonly tmdbConfig: TmdbImageConfig | null;
}

/** The read side of Discover browse: trending + popular poster rails + the image config. */
export interface DiscoverData {
  readonly trending: readonly SearchHit[];
  readonly popular: readonly SearchHit[];
  readonly tmdbConfig: TmdbImageConfig | null;
}

/** The read side of the calendar: flattened air-dated episodes + the hidden set to exclude. */
export interface CalendarData {
  readonly entries: readonly CalendarEntry[];
  readonly hiddenShowIds: readonly number[];
  readonly tmdbConfig: TmdbImageConfig | null;
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
  /** The My Shows movie library: watched movies + watchlist movies as poster shelves. */
  loadMovieLibrary(): Promise<MovieLibraryData>;
  /** Movie detail hero from `/movies/:id?extended=full,images` (title, year, overview, art). */
  loadMovieHeader(movieId: number): Promise<MovieHeader>;
  /** Show detail hero + overall progress; paints before the season stream resolves. */
  loadShowHeader(showId: number): Promise<ShowHeader>;
  /** The season/episode tree merged with per-episode watched flags (streams in after the hero). */
  loadShowSeasons(showId: number): Promise<readonly SeasonView[]>;
  /** Episode detail: content + still + watched state + prev/next nav. */
  loadEpisode(showId: number, season: number, number: number): Promise<EpisodeDetail>;
  /** Current 1–10 ratings for a section, keyed by trakt id. */
  loadRatings(section: "shows" | "episodes" | "movies"): Promise<RatingMap>;
  /** Trakt ids currently on the watchlist for a section. */
  loadWatchlistIds(section: "shows" | "movies"): Promise<readonly number[]>;
  /** Personalized calendar window: `/calendars/my/shows/{start}/{days}` + the hidden set. */
  loadCalendar(startDate: string, days: number): Promise<CalendarData>;
  /** Debounced show+movie search: one `/search/show,movie` per settled query, title-ranked. */
  search(query: string): Promise<readonly SearchHit[]>;
  /** Browse rails for empty-query Discover: trending + popular shows with poster art. */
  loadDiscover(): Promise<DiscoverData>;
  /** The signed-in user's lifetime watch stats for the Profile theatre. */
  loadStats(): Promise<UserStats>;
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
 * The runtime when a session is mounted, else `null` — for the app shell, which
 * renders (without a RuntimeProvider) during the pre-token `/auth/callback` return
 * where no runtime exists yet. Feature hooks must use {@link useRuntime}.
 */
export function useOptionalRuntime(): CueRuntime | null {
  return useContext(RuntimeContext);
}
