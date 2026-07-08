import { TMDB_KEY, TRAKT_CLIENT_ID } from "@app/config";
import { queryClient, queryPersister } from "@app/query-client";
import { PendingWritesError, type TeardownOptions } from "@app/session";
import type { TmdbImageConfig } from "@data/image-source";
import { invalidationKeys } from "@data/query-invalidation";
import { TmdbClient } from "@data/tmdb/client";
import { createAuthorizedFetch } from "@data/trakt/authorized-fetch";
import { assembleCalendarEntries } from "@data/trakt/calendar";
import { TraktClient, type TraktResult } from "@data/trakt/client";
import {
  getEpisode,
  getEpisodePlays,
  getHidden,
  getHistory,
  getMovie,
  getMyShowsCalendar,
  getPopularMovies,
  getPopularShows,
  getRatings,
  getRelatedMovies,
  getShow,
  getShowPlays,
  getShowProgress,
  getShowSeasons,
  getTrendingMovies,
  getTrendingShows,
  getUserStats,
  getWatchedMovies,
  getWatchedShows,
  getWatchlist,
  searchTrakt,
} from "@data/trakt/endpoints";
import { assembleEpisodeDetail } from "@data/trakt/episode-detail";
import { assembleEpisodePlays, assembleHistoryEntries } from "@data/trakt/history";
import { assembleLibrary, markLanded, type ShowArt, showIdSet } from "@data/trakt/library";
import { assembleMovieHeader, assembleMovieLibrary } from "@data/trakt/movie-library";
import { createLastActivitiesRepository } from "@data/trakt/repositories";
import type { Progress, UserStats } from "@data/trakt/schemas";
import {
  assembleMovieHits,
  assembleSearchHits,
  assembleShowHits,
  rankSearchHits,
} from "@data/trakt/search";
import { assembleHeader, assembleSeasons } from "@data/trakt/show-detail";
import { createTraktTransport } from "@data/trakt/transport";
import type { Token } from "@domain/model/token";
import type { LastActivities } from "@domain/sync-activities";
import { WriteQueue } from "@domain/write-queue/queue";
import type { QueuedOp } from "@domain/write-queue/types";
import type { KeyValueStore } from "@platform/kv";
import type { TokenStore } from "@platform/token-store";
import type {
  ActivitiesReconcile,
  CalendarData,
  CueRuntime,
  DiscoverData,
  HistoryPageData,
  MovieLibraryData,
  RatingMap,
  SubmitOutcome,
  UpNextData,
} from "@ui/runtime/runtime";

const OP_LOG_KEY = "cue.write-queue";
/** The persisted `/sync/last_activities` baseline the freshness gate diffs against. */
const ACTIVITIES_KEY = "cue.last-activities";

/**
 * Read fan-out concurrency cap. Each in-flight show issues its progress + detail
 * GET in parallel, so capping at 6 shows holds concurrent GETs at ≤12 — the top
 * of the sync analysis's recommended 8–12 window — a >40× cut from the uncapped
 * 2N burst a 250-show library would otherwise fire, which is what tripped Trakt's
 * 1000-GET/5min ceiling into a 429.
 */
const READ_CONCURRENCY = 6;
/**
 * Bounded 429 retries per read before it surfaces. A transient rate-limit mid
 * fan-out is absorbed (honoring Retry-After) instead of failing the whole load
 * into Offline; after the budget the failure surfaces so cached data + the retry
 * banner take over rather than spinning forever.
 */
const MAX_READ_RATE_RETRIES = 3;
const DEFAULT_RATE_BACKOFF_MS = 1000;

/** Run `fn` over `items` with at most `limit` in flight, preserving order. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Retry a read only on a 429, honoring `Retry-After`, within a bounded budget. */
async function withReadRateRetry<T>(read: () => Promise<TraktResult<T>>): Promise<TraktResult<T>> {
  for (let attempt = 0; ; attempt += 1) {
    const result = await read();
    if (result.ok || result.error.kind !== "rate-limited" || attempt >= MAX_READ_RATE_RETRIES) {
      return result;
    }
    await sleep(result.error.retryAfterMs ?? DEFAULT_RATE_BACKOFF_MS);
  }
}

/**
 * The op's `inversePatch` read as a reconcile anchor: a `mark`/bulk write pivots
 * on Trakt's `completed` (default `kind`, as the `MarkContext` serializes); a
 * `hidden` write pivots on hidden-set membership.
 */
type ReconcileContext =
  | { readonly kind?: "mark"; readonly showId: number; readonly preCompleted: number }
  | { readonly kind: "hidden"; readonly showId: number }
  | { readonly kind: "movie"; readonly movieId: number };

export interface RuntimeDeps {
  readonly token: Token;
  readonly kv: KeyValueStore;
  /** Where a rotated token is persisted so it survives reload. */
  readonly tokenStore: TokenStore;
  /** `${origin}/auth/callback` — the PKCE refresh grant echoes it back. */
  readonly redirectUri: string;
  /** Called when the refresh token is dead: clears the session → onboarding. */
  readonly endSession: () => Promise<void>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function loadOpLog(kv: KeyValueStore): Promise<QueuedOp[]> {
  const raw = await kv.read(OP_LOG_KEY);
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as QueuedOp[]) : [];
  } catch {
    return [];
  }
}

async function resolveTmdbConfig(tmdbKey: string): Promise<TmdbImageConfig | null> {
  if (tmdbKey.trim().length === 0) return null;
  try {
    return await new TmdbClient({ credential: tmdbKey }).getImageConfig();
  } catch {
    return null;
  }
}

/**
 * Build the composition-root services the UI runs on. Wires an
 * authenticated Trakt client, the durable write-queue (dispatch = transport, reconcile = a progress re-read, never a blind re-POST), restores
 * and replays the persisted op-log on boot, and exposes the persisted-SWR read.
 */
export async function createCueRuntime(deps: RuntimeDeps): Promise<CueRuntime> {
  // One authenticated transport for every Trakt call: refreshes proactively past
  // expiry, refresh-and-retries a 401'd read, persists the rotation, and ends the
  // session on a dead refresh token. A single-flight refresh means a burst
  // of 401s shares one `/oauth/token` exchange.
  const authorized = createAuthorizedFetch({
    inner: (input, init) => globalThis.fetch(input, init),
    token: deps.token,
    config: { clientId: TRAKT_CLIENT_ID, redirectUri: deps.redirectUri },
    persist: (token) => deps.tokenStore.write(token),
    endSession: deps.endSession,
  });
  const client = new TraktClient({
    clientId: TRAKT_CLIENT_ID,
    getToken: () => authorized.accessToken(),
    fetch: authorized.fetch,
  });
  const tmdbConfig = await resolveTmdbConfig(TMDB_KEY);

  const reconcile = async (op: QueuedOp): Promise<boolean> => {
    const context = op.inversePatch as ReconcileContext | null;
    if (context === null || typeof context !== "object") return false;
    // Hide/unhide land in the hidden set; a mark or bulk-season write advances
    // Trakt's `completed`. Either lets reconcile retire an already-applied op
    // whose response was lost, instead of a duplicate-play re-POST.
    if (context.kind === "hidden") {
      const hidden = await getHidden(client);
      if (!hidden.ok) throw new Error("reconcile read failed");
      const isHidden = showIdSet(hidden.data).has(context.showId);
      return op.toState === "present" ? isHidden : !isHidden;
    }
    // A movie mark/unwatch pivots on watched-movie membership, read fresh from
    // `/sync/watched/movies` — the movie analogue of the hidden-set reconcile.
    if (context.kind === "movie") {
      const watched = await getWatchedMovies(client);
      if (!watched.ok) throw new Error("reconcile read failed");
      const isWatched = watched.data.some((row) => row.movie.ids.trakt === context.movieId);
      return op.toState === "present" ? isWatched : !isWatched;
    }
    const result = await getShowProgress(client, context.showId);
    if (!result.ok) throw new Error("reconcile read failed");
    return markLanded(op.toState, context.preCompleted, result.data.completed);
  };

  const queue = new WriteQueue(
    { dispatch: createTraktTransport(client), sleep, now: Date.now, reconcile },
    await loadOpLog(deps.kv),
  );

  const persistLog = (): Promise<void> =>
    deps.kv.write(OP_LOG_KEY, JSON.stringify(queue.snapshot()));

  const activitiesRepo = createLastActivitiesRepository(client);
  const readActivitiesSnapshot = async (): Promise<LastActivities | undefined> => {
    const raw = await deps.kv.read(ACTIVITIES_KEY);
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as LastActivities;
    } catch {
      return undefined;
    }
  };

  // Replay durable work from a prior session before accepting new writes: retire
  // ops Trakt already reflects, then flush the rest. This is the reload-survival
  // path the hermetic e2e exercises.
  await queue.startupReconcile();
  await persistLog();
  void queue.flush().then(persistLog);

  // Re-entry guard for teardown: a dead-token flush inside `endLocalSession` can
  // 401 → refresh → `endSession` → back into teardown; short-circuit the nested
  // call so it can never await its own in-flight flush (a deadlock).
  let tearingDown = false;

  return {
    async loadUpNext(): Promise<UpNextData> {
      // Every gating read absorbs a transient 429 (Retry-After) within a bounded
      // budget so one rate-limit — on this list read or the per-show fan-out or
      // the hidden/watchlist reads below — no longer throws the whole load to
      // Offline; the persisted cache keeps showing while the retry rides it out.
      const watched = await withReadRateRetry(() => getWatchedShows(client));
      if (!watched.ok) throw new Error("Failed to load watched shows");

      // Per show: strict progress (a failure must fail the whole read so React
      // Query keeps the prior cached queue + retry banner instead of erasing a
      // known show as "all caught up") plus best-effort show-detail art — the
      // `/sync/watched/shows` list carries no `images`, so the real poster,
      // backdrop, network and genres come from `/shows/:id`. Art that can't load
      // simply degrades to the text fallback; it never fails the queue. The
      // fan-out is concurrency-capped and each read absorbs a transient 429
      // (Retry-After) so one rate-limit no longer fails the whole Promise.all.
      const perShow = await mapWithConcurrency(watched.data, READ_CONCURRENCY, async (show) => {
        const id = show.show.ids.trakt;
        const [progress, detail] = await Promise.all([
          withReadRateRetry(() => getShowProgress(client, id)),
          withReadRateRetry(() => getShow(client, id)),
        ]);
        if (!progress.ok) throw new Error("Failed to load show progress");
        return { id, progress: progress.data, detail: detail.ok ? detail.data : null };
      });

      const progress = new Map<number, Progress>(perShow.map((s) => [s.id, s.progress]));
      const details = new Map<number, ShowArt>();
      for (const s of perShow) {
        if (s.detail === null) continue;
        details.set(s.id, {
          posters: s.detail.images?.poster ?? [],
          backdrops: s.detail.images?.fanart ?? [],
          network: s.detail.network ?? null,
          genres: s.detail.genres ?? [],
          runtime: s.detail.runtime ?? null,
        });
      }

      const [hidden, watchlist] = await Promise.all([
        withReadRateRetry(() => getHidden(client)),
        withReadRateRetry(() => getWatchlist(client, "shows")),
      ]);
      if (!hidden.ok) throw new Error("Failed to load hidden shows");
      if (!watchlist.ok) throw new Error("Failed to load watchlist");

      const entries = assembleLibrary({
        watchedShows: watched.data,
        progress,
        hiddenShowIds: showIdSet(hidden.data),
        watchlistShows: watchlist.data,
        details,
      });
      return { entries, tmdbConfig };
    },

    async loadMovieLibrary(): Promise<MovieLibraryData> {
      // Both reads carry `images` (watched via `getWatchedMovies`, watchlist via
      // `getWatchlist`), so watched + watchlist movies supply their own poster art
      // — no per-movie detail fetch needed. Each absorbs a transient 429 so a
      // rate-limit doesn't flip the library to Offline over its cached posters.
      const [watched, watchlist] = await Promise.all([
        withReadRateRetry(() => getWatchedMovies(client)),
        withReadRateRetry(() => getWatchlist(client, "movies")),
      ]);
      if (!watched.ok) throw new Error("Failed to load watched movies");
      if (!watchlist.ok) throw new Error("Failed to load movie watchlist");
      const entries = assembleMovieLibrary({
        watchedMovies: watched.data,
        watchlistMovies: watchlist.data,
      });
      return { entries, tmdbConfig };
    },

    async loadMovieHeader(movieId) {
      const movie = await getMovie(client, movieId);
      if (!movie.ok) throw new Error("Failed to load movie");
      return assembleMovieHeader(movie.data);
    },

    async loadMovieRelated(movieId) {
      const related = await getRelatedMovies(client, movieId);
      if (!related.ok) throw new Error("Failed to load related movies");
      return assembleMovieHits(related.data);
    },

    async loadShowHeader(showId) {
      const [show, progress] = await Promise.all([
        getShow(client, showId),
        getShowProgress(client, showId),
      ]);
      if (!show.ok) throw new Error("Failed to load show");
      if (!progress.ok) throw new Error("Failed to load show progress");
      return assembleHeader(show.data, progress.data, Date.now());
    },

    async loadShowSeasons(showId) {
      const [seasons, progress] = await Promise.all([
        getShowSeasons(client, showId),
        getShowProgress(client, showId, true),
      ]);
      if (!seasons.ok) throw new Error("Failed to load seasons");
      if (!progress.ok) throw new Error("Failed to load show progress");
      return assembleSeasons(seasons.data, progress.data, Date.now());
    },

    async loadEpisode(showId, season, number) {
      const [episode, progress] = await Promise.all([
        getEpisode(client, showId, season, number),
        getShowProgress(client, showId, true),
      ]);
      if (!episode.ok) throw new Error("Failed to load episode");
      if (!progress.ok) throw new Error("Failed to load show progress");
      return assembleEpisodeDetail(showId, episode.data, progress.data, Date.now());
    },

    async loadRatings(section): Promise<RatingMap> {
      const result = await getRatings(client, section);
      if (!result.ok) throw new Error("Failed to load ratings");
      const map: Record<number, number> = {};
      for (const item of result.data) {
        const trakt = item.show?.ids.trakt ?? item.movie?.ids.trakt ?? item.episode?.ids.trakt;
        if (trakt !== undefined) map[trakt] = item.rating;
      }
      return map;
    },

    async loadWatchlistIds(section) {
      const result = await getWatchlist(client, section);
      if (!result.ok) throw new Error("Failed to load watchlist");
      const ids: number[] = [];
      for (const item of result.data) {
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
      if (!calendar.ok) throw new Error("Failed to load calendar");
      if (!hidden.ok) throw new Error("Failed to load hidden shows");
      return {
        entries: assembleCalendarEntries(calendar.data),
        hiddenShowIds: [...showIdSet(hidden.data)],
        tmdbConfig,
      };
    },

    async loadHistory(section, page): Promise<HistoryPageData> {
      // A single page only — history is unbounded, so the infinite query walks it
      // one page at a time. A transient 429 is absorbed so a rate-limit mid-scroll
      // doesn't flip the Diary to error over its cached pages.
      const result = await withReadRateRetry(() => getHistory(client, section, page));
      if (!result.ok) throw new Error("Failed to load history");
      return {
        entries: assembleHistoryEntries(result.data),
        page: result.pagination?.page ?? page,
        pageCount: result.pagination?.pageCount ?? page,
        tmdbConfig,
      };
    },

    async loadShowPlays(showId) {
      // On-demand, user-initiated (a durable Unmark) so a full paged walk of the
      // show's plays is acceptable; a transient 429 is absorbed rather than failing
      // the unmark outright.
      const result = await withReadRateRetry(() => getShowPlays(client, showId));
      if (!result.ok) throw new Error("Failed to load show history");
      return assembleEpisodePlays(result.data);
    },

    async loadEpisodePlays(episodeId) {
      const result = await withReadRateRetry(() => getEpisodePlays(client, episodeId));
      if (!result.ok) throw new Error("Failed to load episode history");
      return assembleEpisodePlays(result.data);
    },

    async search(query) {
      const result = await searchTrakt(client, query);
      if (!result.ok) throw new Error("Failed to search");
      return rankSearchHits(assembleSearchHits(result.data), query);
    },

    async loadDiscover(): Promise<DiscoverData> {
      const [trending, popular, trendingMovies, popularMovies] = await Promise.all([
        getTrendingShows(client),
        getPopularShows(client),
        getTrendingMovies(client),
        getPopularMovies(client),
      ]);
      if (!trending.ok) throw new Error("Failed to load trending shows");
      if (!popular.ok) throw new Error("Failed to load popular shows");
      if (!trendingMovies.ok) throw new Error("Failed to load trending movies");
      if (!popularMovies.ok) throw new Error("Failed to load popular movies");
      return {
        trending: assembleShowHits(trending.data.map((row) => row.show)),
        popular: assembleShowHits(popular.data),
        trendingMovies: assembleMovieHits(trendingMovies.data.map((row) => row.movie)),
        popularMovies: assembleMovieHits(popularMovies.data),
        tmdbConfig,
      };
    },

    async loadStats(): Promise<UserStats> {
      const result = await getUserStats(client);
      if (!result.ok) throw new Error("Failed to load user stats");
      return result.data;
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

    async pollActivities(): Promise<ActivitiesReconcile | null> {
      const stored = await readActivitiesSnapshot();
      let poll: Awaited<ReturnType<typeof activitiesRepo.poll>>;
      try {
        poll = await activitiesRepo.poll(stored);
      } catch {
        // A malformed/absent body (schema throw) is a failed freshness check —
        // stay silent rather than surface it. The next poll retries.
        return null;
      }
      // Offline / rate-limited: the check itself failed, so report nothing to
      // invalidate and don't advance the baseline. Cached data keeps showing.
      if (!poll.ok) return null;
      const fresh = poll.activities;
      // First poll (no baseline): establish the baseline WITHOUT invalidating.
      // Cold-boot queries load naturally and a restored cache is trusted until a
      // real diffed change; the snapshot persists alongside the query cache in
      // normal operation, so a genuine warm reload always has a baseline to diff.
      const keys = stored === undefined ? [] : invalidationKeys(poll.targets);
      return {
        keys,
        commit: () => deps.kv.write(ACTIVITIES_KEY, JSON.stringify(fresh)),
      };
    },

    async endLocalSession(options: TeardownOptions = {}): Promise<void> {
      if (tearingDown) return;
      tearingDown = true;
      try {
        // Flush best-effort while the token is still valid so pending writes land
        // before we drop the durable log; a flush failure (offline) falls through
        // to the drain check below rather than stranding the disconnect.
        try {
          await queue.flush();
        } catch {
          // offline / transient — the size check decides whether we may clear
        }
        await persistLog();
        // A normal disconnect that couldn't drain the queue must NOT drop the
        // op-log (that loses the user's writes) nor keep it across sign-out (it
        // could replay under a different account) — so refuse and let the user
        // reconnect + retry. The dead-token path forces past this: those writes
        // can never be sent, and clearing is what prevents the cross-account
        // replay.
        if (options.force !== true && queue.size > 0) throw new PendingWritesError();
        // Clear this device's per-account state so the next account never paints
        // stale data or dispatches a leftover op.
        await deps.kv.remove(OP_LOG_KEY);
        await deps.kv.remove(ACTIVITIES_KEY);
        queryClient.clear();
        await queryPersister.removeClient();
      } finally {
        tearingDown = false;
      }
    },
  };
}
