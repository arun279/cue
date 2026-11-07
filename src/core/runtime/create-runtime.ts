import { changedActivityKeys } from "../data/query-invalidation";
import { createAuthorizedFetch } from "../data/trakt/authorized-fetch";
import { assembleCalendarEntries } from "../data/trakt/calendar";
import {
  fetchWithoutCookies,
  type ReadReporter,
  TraktClient,
  unwrapRead,
} from "../data/trakt/client";
import { assembleEpisodeDetail } from "../data/trakt/episode-detail";
import {
  assembleEpisodePlays,
  assembleHistoryEntries,
  assembleMoviePlays,
} from "../data/trakt/history";
import {
  assembleMovieHeader,
  assembleMovieLibrary,
  assembleMovieWatchlist,
} from "../data/trakt/movie-library";
import type { TraktPolicy } from "../data/trakt/policy";
import {
  getCollectionMovies,
  getEpisode,
  getGenres,
  getHistory,
  getHistoryPlay,
  getItemPlays,
  getLastActivities,
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
import {
  assembleMovieHits,
  assembleSearchHits,
  assembleShowHits,
  rankSearchHits,
} from "../data/trakt/search";
import { assembleSeasons, assembleShowInfo, assembleShowProgress } from "../data/trakt/show-detail";
import { createTraktTransport } from "../data/trakt/transport";
import { loadUpNextEntries } from "../data/trakt/up-next";
import { assembleUserProfile } from "../data/trakt/user-profile";
import { sleep } from "../domain/abortable";
import { parseIncidents, type ReadIncident, recordIncident } from "../domain/diagnostics";
import type { Token } from "../domain/model/token";
import type { UserProfile } from "../domain/model/user";
import { markedAt, ownPlays } from "../domain/reversal";
import type { LastActivities } from "../domain/sync-activities";
import { historiesOf, markedEpisodesIn } from "../domain/write-queue/ops";
import { WriteQueue } from "../domain/write-queue/queue";
import { replacedPlays, type WriteReceipt } from "../domain/write-queue/receipt";
import type { QueuedOp } from "../domain/write-queue/types";
import { createJsonStore } from "../ports/json-store";
import type { KeyValueStore } from "../ports/kv";
import type { Reminders } from "../ports/reminders";
import { INCIDENTS_KEY, OP_LOG_KEY, PLAY_POLICY_KEY } from "../ports/storage-keys";
import type { TokenStore } from "../ports/token-store";
import { resetMarkStore } from "../stores/mark-store";
import { usePlayPolicy } from "../stores/play-policy-store";
import { useReadIncidents } from "../stores/read-incidents-store";
import { resetSeasonMarks } from "../stores/season-reversal";
import { dismissSnack } from "../stores/snackbar-store";
import { useSyncActivity } from "../stores/sync-activity-store";
import type {
  ActivitiesReconcile,
  BrowseData,
  CalendarData,
  CueRuntime,
  HistoryPageData,
  MovieLibraryData,
  SubmitOutcome,
  UpNextData,
} from "./runtime";
import { PendingWritesError } from "./session";
import { createWriteReceipts } from "./write-receipts";

const ACTIVITIES_KEY = "cue.last-activities";

export interface RuntimeDeps {
  readonly newId: () => string;
  readonly token: Token;
  readonly kv: KeyValueStore;
  readonly tokenStore: TokenStore;
  // Trakt's refresh grant requires the redirect_uri, so it travels on every refresh.
  readonly redirectUri: string;
  readonly clientId: string;
  readonly apiBaseUrl?: string | undefined;
  readonly userAgent?: string;
  readonly policy?: TraktPolicy;
  /** The session ended on its own, because Trakt no longer knows its refresh token. */
  readonly endSession: () => void;
  readonly clearPersistedCaches: () => Promise<void>;
  readonly clearLocalPreferences: () => void;
  readonly reminders: Pick<Reminders, "cancelAll">;
}

/**
 * The history rows made by the add `undo` takes back: in each item it names, the newest play at its
 * watched_at. Null when Trakt said the add replaced an earlier play.
 */
async function ownPlayIds(
  client: TraktClient,
  { inverse: add, watchedAt }: QueuedOp,
  receipt: WriteReceipt | null,
): Promise<number[] | null> {
  if (replacedPlays(receipt) > 0 || watchedAt === null) return null;
  const marked = markedEpisodesIn(add, watchedAt);
  const rows = await Promise.all(
    historiesOf(add).map(async ({ kind, trakt }) => {
      const history = unwrapRead(await getItemPlays.fresh(client, kind, trakt), "history");
      return kind === "movies"
        ? ownPlays(
            assembleMoviePlays(history),
            () => watchedAt,
            () => trakt,
          )
        : ownPlays(
            assembleEpisodePlays(history),
            markedAt(marked === null ? [] : [marked]),
            (play) => play.episodeTrakt,
          );
    }),
  );
  return rows.flat().map((play) => play.historyId);
}

/** Every client store that holds something of one account. */
const ACCOUNT_STORES: readonly (() => void)[] = [
  resetMarkStore,
  resetSeasonMarks,
  dismissSnack,
  () => useReadIncidents.setState({ incidents: [] }),
  () => usePlayPolicy.setState({ policy: "unknown" }),
  () => useSyncActivity.setState(useSyncActivity.getInitialState()),
];

/** Removes everything the device keeps for an account, so the next one starts without it. */
export async function clearAccount(
  deps: Pick<RuntimeDeps, "kv" | "clearPersistedCaches" | "clearLocalPreferences" | "reminders">,
): Promise<void> {
  await Promise.all(
    [OP_LOG_KEY, ACTIVITIES_KEY, INCIDENTS_KEY, PLAY_POLICY_KEY].map((key) => deps.kv.remove(key)),
  );
  for (const reset of ACCOUNT_STORES) reset();
  await deps.reminders.cancelAll();
  await deps.clearPersistedCaches();
  deps.clearLocalPreferences();
}

export async function createCueRuntime(deps: RuntimeDeps): Promise<CueRuntime> {
  const session = new AbortController();
  const { signal } = session;
  const whileLive = (effect: () => Promise<void>): Promise<void> =>
    signal.aborted ? Promise.resolve() : effect();
  const kv: KeyValueStore = {
    read: (key) => deps.kv.read(key),
    write: (key, value) => whileLive(() => deps.kv.write(key, value)),
    remove: (key) => deps.kv.remove(key),
  };

  const incidentStore = createJsonStore<readonly ReadIncident[]>(kv, INCIDENTS_KEY, parseIncidents);
  useReadIncidents.setState({ incidents: (await incidentStore.read()) ?? [] });
  const report: ReadReporter = (endpoint, problem) => {
    const { incidents } = useReadIncidents.getState();
    const next = recordIncident(incidents, endpoint, problem, Date.now());
    useReadIncidents.setState({ incidents: next });
    void incidentStore.write(next);
  };
  const opLogStore = createJsonStore<QueuedOp[]>(kv, OP_LOG_KEY, (value) =>
    Array.isArray(value) ? (value as QueuedOp[]) : [],
  );
  const activitiesStore = createJsonStore<LastActivities>(kv, ACTIVITIES_KEY);
  const receipts = await createWriteReceipts(kv);

  let ending: Promise<void> | null = null;
  function end(): Promise<void> {
    session.abort();
    ending ??= clearAccount(deps).catch((error: unknown) => {
      ending = null;
      throw error;
    });
    return ending;
  }

  const authorized = createAuthorizedFetch({
    inner: fetchWithoutCookies,
    token: deps.token,
    config: {
      clientId: deps.clientId,
      redirectUri: deps.redirectUri,
      apiBaseUrl: deps.apiBaseUrl,
    },
    signal,
    persist: (token) => void deps.tokenStore.write(token),
    endSession: () =>
      void whileLive(() =>
        end()
          .catch(() => undefined)
          .then(deps.endSession),
      ),
  });
  const client = new TraktClient({
    clientId: deps.clientId,
    getToken: () => authorized.accessToken(),
    fetch: authorized.fetch,
    baseUrl: deps.apiBaseUrl,
    userAgent: deps.userAgent,
    policy: deps.policy,
    report,
    signal,
  });

  const queue = new WriteQueue(
    {
      dispatch: createTraktTransport(client),
      sleep: (ms) => sleep(ms, signal),
      now: Date.now,
      settle: receipts.settle,
      ownPlays: (undo, undoes) => ownPlayIds(client, undo, receipts.receiptOf(undoes)),
      save: (ops) => opLogStore.write([...ops]),
    },
    (await opLogStore.read()) ?? [],
  );

  const persistLog = (): Promise<void> => opLogStore.write(queue.snapshot());
  void queue.flush().then(persistLog);

  const { readsPausedUntil, subscribeReadPause, readRetryFailure, subscribeReadRetry } =
    client.reads;

  return {
    session: signal,
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

    async loadMovieLibrary(watchlist): Promise<MovieLibraryData> {
      const [watched, listed, collection] = await Promise.all([
        getWatchedMovies(client),
        watchlist,
        getCollectionMovies(client),
      ]);
      const entries = assembleMovieLibrary({
        watchedMovies: unwrapRead(watched, "watched movies"),
        watchlist: listed,
        collectionMovies: unwrapRead(collection, "movie collection"),
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

    async loadMovieWatchlist() {
      return assembleMovieWatchlist(
        unwrapRead(await getWatchlist(client, "movies"), "movie watchlist"),
      );
    },

    async loadCalendar(startDate, days): Promise<CalendarData> {
      const calendar = await getMyShowsCalendar(client, startDate, days);
      return { entries: assembleCalendarEntries(unwrapRead(calendar, "calendar")) };
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

    async loadFirstPlayAt() {
      const newest = await getHistoryPlay(client, 1);
      const plays = (newest.ok && newest.pagination?.pageCount) || 1;
      const oldest = plays > 1 ? await getHistoryPlay(client, plays) : newest;
      return unwrapRead(oldest, "history")[0]?.watched_at ?? null;
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

    loadGenreNames: () =>
      Promise.all([getGenres(client, "shows"), getGenres(client, "movies")]).then(
        ([shows, movies]) =>
          Object.fromEntries(
            [...unwrapRead(shows, "show genres"), ...unwrapRead(movies, "movie genres")].map(
              (genre) => [genre.slug, genre.name],
            ),
          ),
      ),

    async loadUserProfile(): Promise<UserProfile> {
      return assembleUserProfile(unwrapRead(await getUserSettings(client), "user settings"));
    },

    async submit(op: QueuedOp): Promise<SubmitOutcome> {
      queue.enqueue(op);
      await persistLog();
      await queue.flush();
      await persistLog();
      const state = queue.stateOf(op.id);
      return state === "unsent" || state === "sent" ? "deferred" : state;
    },

    settled: (opId) => queue.settled(opId),
    writeState: (opId) => queue.stateOf(opId),
    writeReceipt: receipts.receiptOf,
    readsPausedUntil,
    subscribeReadPause,
    readRetryFailure,
    subscribeReadRetry,

    pendingWrites(): number {
      return queue.size;
    },

    pendingOps(): readonly QueuedOp[] {
      return queue.snapshot();
    },

    async flushWrites(): Promise<number> {
      await queue.flush();
      await persistLog();
      return queue.snapshot().length;
    },

    async pollActivities(): Promise<ActivitiesReconcile | null> {
      const stored = await activitiesStore.read();
      const poll = await getLastActivities(client);
      if (!poll.ok) return null;
      return {
        keys: stored === null ? [] : changedActivityKeys(stored, poll.data),
        commit: () => activitiesStore.write(poll.data),
      };
    },

    async endLocalSession(): Promise<void> {
      if (!signal.aborted) {
        await queue.flush();
        await persistLog();
        if (!signal.aborted && queue.size > 0) throw new PendingWritesError();
      }
      return end();
    },
  };
}
