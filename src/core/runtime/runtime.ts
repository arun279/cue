import { createContext, useContext } from "react";
import type { InvalidationKey } from "../data/query-invalidation";
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
import type { WriteOutcome, WriteState } from "../domain/write-queue/queue";
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

/**
 * "deferred": still to be sent, with how it ends told by `settled`. "cancelled": an opposite write
 * undid it before either was sent.
 */
export type SubmitOutcome = "done" | "failed" | "deferred" | "cancelled";

export interface ActivitiesReconcile {
  readonly keys: readonly InvalidationKey[];
  commit(): Promise<void>;
}

export interface CueRuntime {
  /** Aborts when this session ends. */
  readonly session: AbortSignal;
  newId(): string;
  loadUpNext(): Promise<UpNextData>;
  loadShowInfo(showId: number): Promise<ShowInfo>;
  loadShowRelated(showId: number): Promise<readonly SearchHit[]>;
  loadMovieLibrary(watchlist: Promise<readonly MovieEntry[]>): Promise<MovieLibraryData>;
  loadMovieHeader(movieId: number): Promise<MovieHeader>;
  loadMovieRelated(movieId: number): Promise<readonly SearchHit[]>;
  loadShowProgress(showId: number): Promise<ShowProgress>;
  loadShowSeasons(showId: number): Promise<readonly SeasonView[]>;
  loadEpisode(showId: number, season: number, number: number): Promise<EpisodeDetail>;
  loadMovieWatchlist(): Promise<readonly MovieEntry[]>;
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
  /** How a submitted write ends, however long it waits to be sent. */
  settled(opId: string): Promise<WriteOutcome>;
  writeState(opId: string): WriteState;
  writeReceipt(opId: string): WriteReceipt | null;
  /** Hands `readBack` every write Trakt refused; each is kept on the device until it resolves. */
  onRefused(readBack: (op: QueuedOp) => Promise<void>): () => void;
  readsPausedUntil(): number;
  subscribeReadPause(listener: () => void): () => void;
  readRetryFailure(): TraktFailure | null;
  subscribeReadRetry(listener: () => void): () => void;
  pendingWrites(): number;
  pendingOps(): readonly QueuedOp[];
  flushWrites(): Promise<number>;
  pollActivities(): Promise<ActivitiesReconcile | null>;
  endLocalSession(): Promise<void>;
}

/**
 * The runtime as screens see it. Once its session has ended nothing it answers reaches them,
 * reads included: those screens belonged to that session and are unmounted with it.
 */
export function forScreens(runtime: CueRuntime): CueRuntime {
  const quiet =
    <A extends unknown[], T>(call: (...args: A) => Promise<T>) =>
    (...args: A): Promise<T> =>
      call(...args).then(
        (value) => (runtime.session.aborted ? new Promise<T>(() => {}) : value),
        (error: unknown) =>
          runtime.session.aborted ? new Promise<T>(() => {}) : Promise.reject(error),
      );
  return {
    session: runtime.session,
    newId: runtime.newId,
    loadUpNext: quiet(runtime.loadUpNext),
    loadShowInfo: quiet(runtime.loadShowInfo),
    loadShowRelated: quiet(runtime.loadShowRelated),
    loadMovieLibrary: quiet(runtime.loadMovieLibrary),
    loadMovieHeader: quiet(runtime.loadMovieHeader),
    loadMovieRelated: quiet(runtime.loadMovieRelated),
    loadShowProgress: quiet(runtime.loadShowProgress),
    loadShowSeasons: quiet(runtime.loadShowSeasons),
    loadEpisode: quiet(runtime.loadEpisode),
    loadMovieWatchlist: quiet(runtime.loadMovieWatchlist),
    loadCalendar: quiet(runtime.loadCalendar),
    loadHistory: quiet(runtime.loadHistory),
    loadFirstPlayAt: quiet(runtime.loadFirstPlayAt),
    loadShowPlays: quiet(runtime.loadShowPlays),
    loadEpisodePlays: quiet(runtime.loadEpisodePlays),
    loadMoviePlays: quiet(runtime.loadMoviePlays),
    search: quiet(runtime.search),
    loadBrowse: quiet(runtime.loadBrowse),
    loadGenreNames: quiet(runtime.loadGenreNames),
    loadUserProfile: quiet(runtime.loadUserProfile),
    submit: quiet(runtime.submit),
    settled: quiet(runtime.settled),
    writeState: runtime.writeState,
    writeReceipt: runtime.writeReceipt,
    onRefused: runtime.onRefused,
    readsPausedUntil: runtime.readsPausedUntil,
    subscribeReadPause: runtime.subscribeReadPause,
    readRetryFailure: runtime.readRetryFailure,
    subscribeReadRetry: runtime.subscribeReadRetry,
    pendingWrites: runtime.pendingWrites,
    pendingOps: runtime.pendingOps,
    flushWrites: quiet(runtime.flushWrites),
    pollActivities: quiet(runtime.pollActivities),
    endLocalSession: runtime.endLocalSession,
  };
}

const RuntimeContext = createContext<CueRuntime | null>(null);

export const RuntimeProvider = RuntimeContext.Provider;

export function useRuntime(): CueRuntime {
  const runtime = useContext(RuntimeContext);
  if (runtime === null) throw new Error("useRuntime must be used within a RuntimeProvider.");
  return runtime;
}
