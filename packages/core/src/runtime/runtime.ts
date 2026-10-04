import { createContext, useContext } from "react";
import type { InvalidationKey } from "../data/query-invalidation";
import type { EpisodeDetail } from "../data/trakt/episode-detail";
import type { LibraryEntry } from "../data/trakt/library";
import type { MovieEntry, MovieHeader } from "../data/trakt/movie-library";
import type { UserStats } from "../data/trakt/schemas";
import type { SearchHit } from "../data/trakt/search";
import type { SeasonView, ShowInfo, ShowProgress } from "../data/trakt/show-detail";
import type { UserProfile } from "../data/trakt/user-profile";
import type { CalendarEntry } from "../domain/calendar";
import type { HistoryEntry, HistoryRange } from "../domain/history";
import type { EpisodePlay, MoviePlay } from "../domain/reversal";
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
  readonly hiddenShowIds: readonly number[];
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
  loadMovieLibrary(): Promise<MovieLibraryData>;
  loadMovieHeader(movieId: number): Promise<MovieHeader>;
  loadMovieRelated(movieId: number): Promise<readonly SearchHit[]>;
  loadShowProgress(showId: number): Promise<ShowProgress>;
  loadShowSeasons(showId: number): Promise<readonly SeasonView[]>;
  loadEpisode(showId: number, season: number, number: number): Promise<EpisodeDetail>;
  loadWatchlistIds(section: "shows" | "movies"): Promise<readonly number[]>;
  loadCalendar(startDate: string, days: number): Promise<CalendarData>;
  loadHistory(
    section: HistorySection,
    page: number,
    range?: HistoryRange,
  ): Promise<HistoryPageData>;
  loadShowPlays(showId: number): Promise<readonly EpisodePlay[]>;
  loadEpisodePlays(episodeId: number): Promise<readonly EpisodePlay[]>;
  loadMoviePlays(movieId: number): Promise<readonly MoviePlay[]>;
  search(query: string): Promise<readonly SearchHit[]>;
  loadBrowse(): Promise<BrowseData>;
  loadStats(): Promise<UserStats>;
  loadUserProfile(): Promise<UserProfile>;
  submit(op: QueuedOp): Promise<SubmitOutcome>;
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

export function useOptionalRuntime(): CueRuntime | null {
  return useContext(RuntimeContext);
}
