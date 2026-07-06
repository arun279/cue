import type { TmdbImageConfig } from "@data/image-source";
import { TmdbClient } from "@data/tmdb/client";
import { assembleCalendarEntries } from "@data/trakt/calendar";
import { TraktClient } from "@data/trakt/client";
import {
  getEpisode,
  getHidden,
  getMyShowsCalendar,
  getPopularShows,
  getRatings,
  getShow,
  getShowProgress,
  getShowSeasons,
  getTrendingShows,
  getUserStats,
  getWatchedShows,
  getWatchlist,
  searchTrakt,
} from "@data/trakt/endpoints";
import { assembleEpisodeDetail } from "@data/trakt/episode-detail";
import { assembleLibrary, markLanded, type ShowArt, showIdSet } from "@data/trakt/library";
import type { Progress, UserStats } from "@data/trakt/schemas";
import { assembleSearchHits, assembleShowHits, rankSearchHits } from "@data/trakt/search";
import { assembleHeader, assembleSeasons } from "@data/trakt/show-detail";
import { createTraktTransport } from "@data/trakt/transport";
import type { Credentials } from "@domain/model/credentials";
import type { Token } from "@domain/model/token";
import { WriteQueue } from "@domain/write-queue/queue";
import type { QueuedOp } from "@domain/write-queue/types";
import type { KeyValueStore } from "@platform/kv";
import type {
  CalendarData,
  CueRuntime,
  DiscoverData,
  RatingMap,
  SubmitOutcome,
  UpNextData,
} from "@ui/runtime/runtime";

const OP_LOG_KEY = "cue.write-queue";

/**
 * The op's `inversePatch` read as a reconcile anchor: a `mark`/bulk write pivots
 * on Trakt's `completed` (default `kind`, as the `MarkContext` serializes); a
 * `hidden` write pivots on hidden-set membership.
 */
type ReconcileContext =
  | { readonly kind?: "mark"; readonly showId: number; readonly preCompleted: number }
  | { readonly kind: "hidden"; readonly showId: number };

export interface RuntimeDeps {
  readonly token: Token;
  readonly creds: Credentials;
  readonly kv: KeyValueStore;
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

async function resolveTmdbConfig(creds: Credentials): Promise<TmdbImageConfig | null> {
  if (creds.tmdbKey.trim().length === 0) return null;
  try {
    return await new TmdbClient({ credential: creds.tmdbKey }).getImageConfig();
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
  const client = new TraktClient({
    clientId: deps.creds.clientId,
    getToken: () => deps.token.access_token,
  });
  const tmdbConfig = await resolveTmdbConfig(deps.creds);

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

  // Replay durable work from a prior session before accepting new writes: retire
  // ops Trakt already reflects, then flush the rest. This is the reload-survival
  // path the hermetic e2e exercises.
  await queue.startupReconcile();
  await persistLog();
  void queue.flush().then(persistLog);

  return {
    async loadUpNext(): Promise<UpNextData> {
      const watched = await getWatchedShows(client);
      if (!watched.ok) throw new Error("Failed to load watched shows");

      // Per show: strict progress (a failure must fail the whole read so React
      // Query keeps the prior cached queue + retry banner instead of erasing a
      // known show as "all caught up") plus best-effort show-detail art — the
      // `/sync/watched/shows` list carries no `images`, so the real poster,
      // backdrop, network and genres come from `/shows/:id`. Art that can't load
      // simply degrades to the text fallback; it never fails the queue.
      const perShow = await Promise.all(
        watched.data.map(async (show) => {
          const id = show.show.ids.trakt;
          const [progress, detail] = await Promise.all([
            getShowProgress(client, id),
            getShow(client, id),
          ]);
          if (!progress.ok) throw new Error("Failed to load show progress");
          return { id, progress: progress.data, detail: detail.ok ? detail.data : null };
        }),
      );

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
        getHidden(client),
        getWatchlist(client, "shows"),
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

    async search(query) {
      const result = await searchTrakt(client, query);
      if (!result.ok) throw new Error("Failed to search");
      return rankSearchHits(assembleSearchHits(result.data), query);
    },

    async loadDiscover(): Promise<DiscoverData> {
      const [trending, popular] = await Promise.all([
        getTrendingShows(client),
        getPopularShows(client),
      ]);
      if (!trending.ok) throw new Error("Failed to load trending shows");
      if (!popular.ok) throw new Error("Failed to load popular shows");
      return {
        trending: assembleShowHits(trending.data.map((row) => row.show)),
        popular: assembleShowHits(popular.data),
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
  };
}
