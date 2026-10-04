import { invalidationKeys } from "../data/query-invalidation";
import { createAuthorizedFetch } from "../data/trakt/authorized-fetch";
import { assembleCalendarEntries } from "../data/trakt/calendar";
import { type ReadReporter, TraktClient, unwrapRead } from "../data/trakt/client";
import { parseIncidents, type ReadIncident, recordIncident } from "../data/trakt/diagnostics";
import { assembleEpisodeDetail } from "../data/trakt/episode-detail";
import {
  assembleEpisodePlays,
  assembleHistoryEntries,
  assembleMoviePlays,
} from "../data/trakt/history";
import { additiveLanded, markLanded, showIdSet } from "../data/trakt/library";
import { assembleMovieHeader, assembleMovieLibrary } from "../data/trakt/movie-library";
import type { TraktPolicy } from "../data/trakt/policy";
import {
  getEpisode,
  getHidden,
  getHistory,
  getItemPlays,
  getMovie,
  getMyShowsCalendar,
  getPopularMovies,
  getPopularShows,
  getRelatedMovies,
  getRelatedShows,
  getShow,
  getShowProgress,
  getShowSeasons,
  getTrendingMovies,
  getTrendingShows,
  getUserSettings,
  getWatchedMovies,
  getWatchlist,
  searchTrakt,
} from "../data/trakt/pooled-endpoints";
import { loadUpNextEntries } from "../data/trakt/read-budget";
import { createLastActivitiesRepository } from "../data/trakt/repositories";
import {
  assembleMovieHits,
  assembleSearchHits,
  assembleShowHits,
  rankSearchHits,
} from "../data/trakt/search";
import { assembleSeasons, assembleShowInfo, assembleShowProgress } from "../data/trakt/show-detail";
import { createTraktTransport } from "../data/trakt/transport";
import { assembleUserProfile, type UserProfile } from "../data/trakt/user-profile";
import type { Token } from "../domain/model/token";
import type { LastActivities } from "../domain/sync-activities";
import { WriteQueue } from "../domain/write-queue/queue";
import type { QueuedOp } from "../domain/write-queue/types";
import { createJsonStore } from "../ports/json-store";
import type { KeyValueStore } from "../ports/kv";
import { INCIDENTS_KEY, OP_LOG_KEY } from "../ports/storage-keys";
import type { TokenStore } from "../ports/token-store";
import type {
  ActivitiesReconcile,
  BrowseData,
  CalendarData,
  CueRuntime,
  HistoryPageData,
  MovieLibraryData,
  SubmitOutcome,
  UpNextData,
} from "../runtime/runtime";
import { useReadIncidents } from "../stores/read-incidents-store";
import { PendingWritesError, type TeardownOptions } from "./session";

const ACTIVITIES_KEY = "cue.last-activities";

type ReconcileContext =
  | { readonly kind?: "mark"; readonly showId: number; readonly preCompleted: number }
  | { readonly kind: "hidden"; readonly showId: number }
  | { readonly kind: "movie"; readonly movieId: number }
  | { readonly kind: "additive-episode"; readonly episodeTrakt: number }
  | {
      readonly kind: "additive-season";
      readonly showId: number;
      readonly probe: { readonly season: number; readonly number: number };
    };

export interface RuntimeDeps {
  readonly newId: () => string;
  readonly token: Token;
  readonly kv: KeyValueStore;
  readonly tokenStore: TokenStore;
  // Trakt's refresh grant requires the redirect_uri, so it travels on every refresh.
  readonly redirectUri: string;
  readonly clientId: string;
  readonly apiBaseUrl?: string | undefined;
  readonly browser: boolean;
  readonly userAgent?: string;
  readonly policy?: TraktPolicy;
  readonly endSession: () => Promise<void>;
  readonly clearPersistedCaches: () => Promise<void>;
  readonly clearLocalPreferences: () => void;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function reconcileHidden(
  client: TraktClient,
  op: QueuedOp,
  context: Extract<ReconcileContext, { readonly kind: "hidden" }>,
): Promise<boolean> {
  const hidden = await getHidden(client);
  if (!hidden.ok) throw new Error("reconcile read failed");
  const isHidden = showIdSet(hidden.data).has(context.showId);
  return op.toState === "present" ? isHidden : !isHidden;
}

async function reconcileMovie(
  client: TraktClient,
  op: QueuedOp,
  context: Extract<ReconcileContext, { readonly kind: "movie" }>,
): Promise<boolean> {
  const watched = await getWatchedMovies(client);
  if (!watched.ok) throw new Error("reconcile read failed");
  const isWatched = watched.data.some((row) => row.movie.ids.trakt === context.movieId);
  return op.toState === "present" ? isWatched : !isWatched;
}

async function reconcileAdditiveEpisode(
  client: TraktClient,
  op: QueuedOp,
  context: Extract<ReconcileContext, { readonly kind: "additive-episode" }>,
): Promise<boolean> {
  if (op.watchedAt === null) return false;
  const result = await getItemPlays(client, "episodes", context.episodeTrakt);
  if (!result.ok) throw new Error("reconcile read failed");
  return additiveLanded(
    assembleEpisodePlays(result.data),
    { episodeTrakt: context.episodeTrakt },
    op.watchedAt,
  );
}

async function reconcileAdditiveSeason(
  client: TraktClient,
  op: QueuedOp,
  context: Extract<ReconcileContext, { readonly kind: "additive-season" }>,
): Promise<boolean> {
  if (op.watchedAt === null) return false;
  const result = await getItemPlays(client, "shows", context.showId);
  if (!result.ok) throw new Error("reconcile read failed");
  return additiveLanded(assembleEpisodePlays(result.data), context.probe, op.watchedAt);
}

async function reconcileMark(
  client: TraktClient,
  op: QueuedOp,
  context: Extract<ReconcileContext, { readonly kind?: "mark" }>,
): Promise<boolean> {
  const result = await getShowProgress(client, context.showId);
  if (!result.ok) throw new Error("reconcile read failed");
  return markLanded(op.toState, context.preCompleted, result.data.completed);
}

function createReconcile(client: TraktClient): (op: QueuedOp) => Promise<boolean> {
  return async (op) => {
    const context = op.inversePatch as ReconcileContext | null;
    if (context === null || typeof context !== "object") return false;
    switch (context.kind) {
      case "hidden":
        return reconcileHidden(client, op, context);
      case "movie":
        return reconcileMovie(client, op, context);
      case "additive-episode":
        return reconcileAdditiveEpisode(client, op, context);
      case "additive-season":
        return reconcileAdditiveSeason(client, op, context);
      default:
        return reconcileMark(client, op, context);
    }
  };
}

export async function createCueRuntime(deps: RuntimeDeps): Promise<CueRuntime> {
  const incidentStore = createJsonStore<readonly ReadIncident[]>(
    deps.kv,
    INCIDENTS_KEY,
    parseIncidents,
  );
  useReadIncidents.setState({ incidents: (await incidentStore.read()) ?? [] });
  const report: ReadReporter = (endpoint, problem) => {
    const { incidents } = useReadIncidents.getState();
    const next = recordIncident(incidents, endpoint, problem, Date.now());
    useReadIncidents.setState({ incidents: next });
    void incidentStore.write(next);
  };

  const authorized = createAuthorizedFetch({
    inner: (input, init) => globalThis.fetch(input, init),
    token: deps.token,
    config: {
      clientId: deps.clientId,
      redirectUri: deps.redirectUri,
      apiBaseUrl: deps.apiBaseUrl,
    },
    persist: (token) => deps.tokenStore.write(token),
    endSession: deps.endSession,
  });
  const client = new TraktClient({
    clientId: deps.clientId,
    getToken: () => authorized.accessToken(),
    fetch: authorized.fetch,
    baseUrl: deps.apiBaseUrl,
    browser: deps.browser,
    userAgent: deps.userAgent,
    policy: deps.policy,
    report,
  });

  const opLogStore = createJsonStore<QueuedOp[]>(deps.kv, OP_LOG_KEY, (value) =>
    Array.isArray(value) ? (value as QueuedOp[]) : [],
  );
  const activitiesStore = createJsonStore<LastActivities>(deps.kv, ACTIVITIES_KEY);

  const queue = new WriteQueue(
    {
      dispatch: createTraktTransport(client),
      sleep,
      now: Date.now,
      reconcile: createReconcile(client),
    },
    (await opLogStore.read()) ?? [],
  );

  const persistLog = (): Promise<void> => opLogStore.write(queue.snapshot());

  const activitiesRepo = createLastActivitiesRepository(client);
  const readActivitiesSnapshot = async (): Promise<LastActivities | undefined> =>
    (await activitiesStore.read()) ?? undefined;

  await queue.startupReconcile();
  await persistLog();
  void queue.flush().then(persistLog);

  let tearingDown = false;

  return {
    newId: deps.newId,
    async loadUpNext(): Promise<UpNextData> {
      return { entries: await loadUpNextEntries(client) };
    },

    async loadShowInfo(showId) {
      return assembleShowInfo(unwrapRead(await getShow(client, showId), "show"));
    },

    async loadShowRelated(showId) {
      return assembleShowHits(unwrapRead(await getRelatedShows(client, showId), "related shows"));
    },

    async loadMovieLibrary(): Promise<MovieLibraryData> {
      const [watched, watchlist] = await Promise.all([
        getWatchedMovies(client),
        getWatchlist(client, "movies"),
      ]);
      const entries = assembleMovieLibrary({
        watchedMovies: unwrapRead(watched, "watched movies"),
        watchlistMovies: unwrapRead(watchlist, "movie watchlist"),
      });
      return { entries };
    },

    async loadMovieHeader(movieId) {
      return assembleMovieHeader(unwrapRead(await getMovie(client, movieId), "movie"));
    },

    async loadMovieRelated(movieId) {
      const related = await getRelatedMovies(client, movieId);
      return assembleMovieHits(unwrapRead(related, "related movies"));
    },

    async loadShowProgress(showId) {
      const progress = await getShowProgress(client, showId);
      return assembleShowProgress(unwrapRead(progress, "show progress"), Date.now());
    },

    async loadShowSeasons(showId) {
      const [seasons, progress] = await Promise.all([
        getShowSeasons(client, showId),
        getShowProgress(client, showId, true),
      ]);
      return assembleSeasons(
        unwrapRead(seasons, "seasons"),
        unwrapRead(progress, "show progress"),
        Date.now(),
      );
    },

    async loadEpisode(showId, season, number) {
      const [episode, progress] = await Promise.all([
        getEpisode(client, showId, season, number),
        getShowProgress(client, showId, true),
      ]);
      return assembleEpisodeDetail(
        showId,
        unwrapRead(episode, "episode"),
        unwrapRead(progress, "show progress"),
        Date.now(),
      );
    },

    async loadWatchlistIds(section) {
      const items = unwrapRead(await getWatchlist(client, section), "watchlist");
      const ids: number[] = [];
      for (const item of items) {
        const trakt = (section === "shows" ? item.show : item.movie)?.ids.trakt;
        if (trakt !== undefined) ids.push(trakt);
      }
      return ids;
    },

    async loadCalendar(startDate, days): Promise<CalendarData> {
      const [calendar, hidden] = await Promise.all([
        getMyShowsCalendar(client, startDate, days),
        getHidden(client),
      ]);
      return {
        entries: assembleCalendarEntries(unwrapRead(calendar, "calendar")),
        hiddenShowIds: [...showIdSet(unwrapRead(hidden, "hidden shows"))],
      };
    },

    async loadHistory(section, page, range): Promise<HistoryPageData> {
      const result = await getHistory(client, section, page, range);
      const entries = assembleHistoryEntries(unwrapRead(result, "history"));
      const pagination = result.ok ? result.pagination : null;
      return {
        entries,
        page: pagination?.page ?? page,
        pageCount: pagination?.pageCount ?? page,
      };
    },

    async loadShowPlays(showId) {
      const result = await getItemPlays(client, "shows", showId);
      return assembleEpisodePlays(unwrapRead(result, "show history"));
    },

    async loadEpisodePlays(episodeId) {
      const result = await getItemPlays(client, "episodes", episodeId);
      return assembleEpisodePlays(unwrapRead(result, "episode history"));
    },

    async loadMoviePlays(movieId) {
      const result = await getItemPlays(client, "movies", movieId);
      return assembleMoviePlays(unwrapRead(result, "movie history"));
    },

    async search(query) {
      const result = await searchTrakt(client, query);
      return rankSearchHits(assembleSearchHits(unwrapRead(result, "search results")), query);
    },

    async loadBrowse(): Promise<BrowseData> {
      const [trending, popular, trendingMovies, popularMovies] = await Promise.all([
        getTrendingShows(client),
        getPopularShows(client),
        getTrendingMovies(client),
        getPopularMovies(client),
      ]);
      return {
        trending: assembleShowHits(unwrapRead(trending, "trending shows").map((row) => row.show)),
        popular: assembleShowHits(unwrapRead(popular, "popular shows")),
        trendingMovies: assembleMovieHits(
          unwrapRead(trendingMovies, "trending movies").map((row) => row.movie),
        ),
        popularMovies: assembleMovieHits(unwrapRead(popularMovies, "popular movies")),
      };
    },

    async loadUserProfile(): Promise<UserProfile> {
      return assembleUserProfile(unwrapRead(await getUserSettings(client), "user settings"));
    },

    async submit(op: QueuedOp): Promise<SubmitOutcome> {
      queue.enqueue(op);
      await persistLog();
      const result = await queue.flush();
      await persistLog();
      if (result.completed.some((done) => done.id === op.id)) return "done";
      if (result.failed.some((failure) => failure.op.id === op.id)) return "failed";
      return "deferred";
    },

    pendingWrites(): number {
      return queue.snapshot().length;
    },

    pendingOps(): readonly QueuedOp[] {
      return queue.snapshot();
    },

    inFlightOpId(): string | null {
      return queue.inFlightId;
    },

    async flushWrites(): Promise<number> {
      await queue.flush();
      await persistLog();
      return queue.snapshot().length;
    },

    async pollActivities(): Promise<ActivitiesReconcile | null> {
      const stored = await readActivitiesSnapshot();
      let poll: Awaited<ReturnType<typeof activitiesRepo.poll>>;
      try {
        poll = await activitiesRepo.poll(stored);
      } catch {
        return null;
      }
      if (!poll.ok) return null;
      const fresh = poll.activities;
      const keys = stored === undefined ? [] : invalidationKeys(poll.targets);
      return {
        keys,
        commit: () => activitiesStore.write(fresh),
      };
    },

    async endLocalSession(options: TeardownOptions = {}): Promise<void> {
      if (tearingDown) return;
      tearingDown = true;
      try {
        await queue.flush().catch(() => undefined);
        await persistLog();
        if (options.force !== true && queue.size > 0) throw new PendingWritesError();
        await opLogStore.clear();
        await activitiesStore.clear();
        await incidentStore.clear();
        useReadIncidents.setState({ incidents: [] });
        await deps.clearPersistedCaches();
        deps.clearLocalPreferences();
      } finally {
        tearingDown = false;
      }
    },
  };
}
