import type { TmdbImageConfig } from "@data/image-source";
import type { EpisodeDetail } from "@data/trakt/episode-detail";
import type { LibraryEntry } from "@data/trakt/library";
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
 * The composition-root services the UI runs on, injected so `@ui` stays free of
 * `@app`/`@platform` (dependency-cruiser). `loadUpNext` is the persisted-SWR
 * read; `submit` enqueues a write onto the durable queue, persists the op-log,
 * flushes (paced, 429/network aware), and reports how the head op settled.
 */
export interface CueRuntime {
  loadUpNext(): Promise<UpNextData>;
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
}

const RuntimeContext = createContext<CueRuntime | null>(null);

export const RuntimeProvider = RuntimeContext.Provider;

export function useRuntime(): CueRuntime {
  const runtime = useContext(RuntimeContext);
  if (runtime === null) throw new Error("useRuntime must be used within a RuntimeProvider.");
  return runtime;
}
