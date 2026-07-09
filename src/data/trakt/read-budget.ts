import type { TraktClient, TraktResult } from "./client";
import { getHidden, getShowProgress, getWatchedShows, getWatchlist } from "./endpoints";
import { assembleLibrary, type LibraryEntry, showIdSet } from "./library";
import type { Progress, WatchedShow } from "./schemas";

/**
 * Read fan-out concurrency cap. Each in-flight show issues a single progress GET,
 * so capping at 6 holds concurrent authed GETs at ≤6 — inside the sync analysis's
 * 8–12 window with margin — instead of firing the whole bounded head at once.
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

/**
 * The cold-sync per-show progress budget: at most this many `/shows/:id/progress`
 * GETs fire up front, for the most-recently-watched shows only.
 *
 * Why a cap at all: Up Next and the Library "Watching" pile are the only surfaces
 * that need live per-show progress (aired vs. completed + the next episode), and a
 * show can only be in either if it was watched recently — the ranking is by
 * `last_watched_at`. The idle tail (finished / long-abandoned shows) is bucketed
 * from the bulk watched breakdown as caught-up, no per-show GET. So the fan-out is
 * bounded by *how many shows one person actively has in flight*, not by library
 * size.
 *
 * Why 60: power-user behavior tops out around 20–50 shows watched
 * concurrently; 60 covers that with headroom while staying a hard ceiling. It also
 * holds the worst-case cold-sync GET count far under Trakt's authed 1000-GET / 5-min
 * budget — for a 1000-show library: ceil(1000/100)=10 watched pages + 60 progress +
 * ~1 hidden + ~1 watchlist ≈ 72 GETs (~7% of the ceiling, a >13× margin), versus the
 * previous ~2000 (2 GETs × 1000 shows) that blew straight through it. Per-row art is
 * deferred to a separate lazy per-card read, so it never rides the
 * cold-sync burst.
 *
 * The cost: a user actively juggling more than 60 shows carries the 61st-most-recent
 * onward at the caught-up baseline — by construction the least-recently-touched of
 * their in-flight shows. This is not silently presented as complete: the read reports
 * `partial`, the sync pill rests on "Recent shows synced" rather than "Synced · <when>"
 * and Up Next never claims "all caught up" while partial.
 * A show carried at the baseline gains real progress on the next cold sync once it
 * re-enters the fetched head — e.g. after it is watched again, which is when its queue position
 * would matter. (Opening its detail fetches fresh progress for that screen but does
 * not yet write it back into this library snapshot.)
 */
export const WATCHED_PROGRESS_BUDGET = 60;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
export async function withReadRateRetry<T>(
  read: () => Promise<TraktResult<T>>,
): Promise<TraktResult<T>> {
  for (let attempt = 0; ; attempt += 1) {
    const result = await read();
    if (result.ok || result.error.kind !== "rate-limited" || attempt >= MAX_READ_RATE_RETRIES) {
      return result;
    }
    await sleep(result.error.retryAfterMs ?? DEFAULT_RATE_BACKOFF_MS);
  }
}

/** The bounded cold-sync read: the assembled library plus whether it is partial. */
interface ColdSyncRead {
  readonly entries: LibraryEntry[];
  /**
   * True when the watched library is larger than the progress budget, so the shows
   * beyond the most-recently-watched head carry the caught-up baseline rather than
   * fetched progress — the honest "recent-only" signal the sync pill surfaces.
   */
  readonly partial: boolean;
}

const parseInstant = (iso: string | null | undefined): number =>
  iso === null || iso === undefined ? 0 : Date.parse(iso) || 0;

/** Most-recently-watched first (unknown last-watched sorts oldest). */
function byLastWatchedDesc(a: WatchedShow, b: WatchedShow): number {
  return parseInstant(b.last_watched_at) - parseInstant(a.last_watched_at);
}

/**
 * Paint the shared library snapshot (Up Next + My Shows) from bounded bulk reads:
 * the paginated watched list, per-show progress for the most-recently-watched
 * {@link WATCHED_PROGRESS_BUDGET} shows only, plus the hidden set and watchlist.
 * Per-show ART/detail is NOT fetched here — it is deferred to a lazy per-visible-card
 * read — so the cold-sync GET count is bounded and does not scale ~2×
 * with library size. Progress failure throws (the whole read fails so React Query
 * keeps the prior cached queue + retry banner instead of erasing a known show); a
 * transient 429 on any read is absorbed within a bounded budget.
 */
export async function loadUpNextEntries(client: TraktClient): Promise<ColdSyncRead> {
  const watched = await withReadRateRetry(() => getWatchedShows(client));
  if (!watched.ok) throw new Error("Failed to load watched shows");

  const head = [...watched.data].sort(byLastWatchedDesc).slice(0, WATCHED_PROGRESS_BUDGET);
  const perShow = await mapWithConcurrency(head, READ_CONCURRENCY, async (show) => {
    const id = show.show.ids.trakt;
    const progress = await withReadRateRetry(() => getShowProgress(client, id));
    if (!progress.ok) throw new Error("Failed to load show progress");
    return { id, progress: progress.data };
  });
  const progress = new Map<number, Progress>(perShow.map((s) => [s.id, s.progress]));

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
  });
  return { entries, partial: watched.data.length > WATCHED_PROGRESS_BUDGET };
}
