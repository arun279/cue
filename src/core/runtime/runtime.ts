import { createContext, useContext } from "react";
import type { InvalidationKey } from "../data/query-invalidation";
import type { WatchlistItem } from "../data/trakt/schemas";
import type { CalendarEntry } from "../domain/calendar";
import type { SearchHit } from "../domain/discover";
import type { EpisodeDetail } from "../domain/episode-detail";
import type { HistoryEntry, HistoryRange } from "../domain/history";
import type { LibraryEntry } from "../domain/model/library";
import type { MovieEntry, MovieHeader } from "../domain/model/movie";
import type { UserProfile } from "../domain/model/user";
import type { TraktFailure } from "../domain/read-failure";
import type { EpisodePlay, MoviePlay } from "../domain/reversal";
import type { SeasonView, ShowInfo, ShowProgress } from "../domain/show-detail";
import type { WriteReceipt } from "../domain/write-queue/receipt";
import type { QueuedOp } from "../domain/write-queue/types";

export interface UpNextData {
  readonly entries: readonly LibraryEntry[];
}

export interface MovieLibraryData {
  readonly entries: readonly MovieEntry[];
}

export interface BrowseData {
  readonly trending: readonly SearchHit[];
  readonly popular: readonly SearchHit[];
  readonly trendingMovies: readonly SearchHit[];
  readonly popularMovies: readonly SearchHit[];
}

export interface CalendarData {
  readonly entries: readonly CalendarEntry[];
}

export type HistorySection = "all" | "episodes" | "movies";

export interface HistoryPageData {
  readonly entries: readonly HistoryEntry[];
  readonly page: number;
  readonly pageCount: number;
}

export type SubmitOutcome = "done" | "failed" | "deferred";

export interface ActivitiesReconcile {
  readonly keys: readonly InvalidationKey[];
  commit(): Promise<void>;
}

export interface CueRuntime {
  newId(): string;
  loadUpNext(): Promise<UpNextData>;
  loadShowInfo(showId: number): Promise<ShowInfo>;
  loadShowRelated(showId: number): Promise<readonly SearchHit[]>;
  loadMovieLibrary(watchlist: Promise<readonly WatchlistItem[]>): Promise<MovieLibraryData>;
  loadMovieHeader(movieId: number): Promise<MovieHeader>;
  loadMovieRelated(movieId: number): Promise<readonly SearchHit[]>;
  loadShowProgress(showId: number): Promise<ShowProgress>;
  loadShowSeasons(showId: number): Promise<readonly SeasonView[]>;
  loadEpisode(showId: number, season: number, number: number): Promise<EpisodeDetail>;
  loadMovieWatchlist(): Promise<readonly WatchlistItem[]>;
  loadCalendar(startDate: string, days: number): Promise<CalendarData>;
  loadHistory(
    section: HistorySection,
    page: number,
    range?: HistoryRange,
  ): Promise<HistoryPageData>;
  loadFirstPlayAt(): Promise<string | null>;
  loadShowPlays(showId: number): Promise<readonly EpisodePlay[]>;
  loadEpisodePlays(episodeId: number): Promise<readonly EpisodePlay[]>;
  loadMoviePlays(movieId: number): Promise<readonly MoviePlay[]>;
  search(query: string): Promise<readonly SearchHit[]>;
  loadBrowse(): Promise<BrowseData>;
  loadGenreNames(): Promise<Readonly<Record<string, string>>>;
  loadUserProfile(): Promise<UserProfile>;
  submit(op: QueuedOp): Promise<SubmitOutcome>;
  writeReceipt(opId: string): WriteReceipt | null;
  readsPausedUntil(): number;
  subscribeReadPause(listener: () => void): () => void;
  readRetryFailure(): TraktFailure | null;
  subscribeReadRetry(listener: () => void): () => void;
  pendingWrites(): number;
  pendingOps(): readonly QueuedOp[];
  inFlightOpId(): string | null;
  flushWrites(): Promise<number>;
  pollActivities(): Promise<ActivitiesReconcile | null>;
  endLocalSession(options?: { readonly force?: boolean }): Promise<void>;
}

const RuntimeContext = createContext<CueRuntime | null>(null);

export const RuntimeProvider = RuntimeContext.Provider;

export function useRuntime(): CueRuntime {
  const runtime = useContext(RuntimeContext);
  if (runtime === null) throw new Error("useRuntime must be used within a RuntimeProvider.");
  return runtime;
}
