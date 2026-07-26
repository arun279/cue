import { toMs } from "@domain/time";
import type { TraktClient, TraktResult } from "./client";
import { getHidden, getShowProgress, getWatchedShows, getWatchlist } from "./endpoints";
import { assembleLibrary, type LibraryEntry, showIdSet, watchedEpisodeCount } from "./library";
import type { Progress, WatchedShow } from "./schemas";

/**
 * Read fan-out concurrency cap. Each in-flight show issues a single progress GET,
 * so capping at 6 holds concurrent authed GETs at ≤6: inside the sync analysis's
 * 8-12 window with margin: instead of firing the whole bounded head at once.
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
 * The instant reads may resume, shared by all of them. Trakt's limits are per
 * WINDOW rather than per connection, and its guidance on a 429 is to pause
 * requests for `Retry-After`, so one read's 429 holds the rest of the fan-out back
 * too: otherwise each sleeps alone while its neighbours keep firing into the same
 * closed window and burn their own retry budgets on it.
 */
let resumeReadsAt = 0;

/**
 * The cold-sync per-show progress budget: at most this many `/shows/:id/progress`
 * GETs fire up front.
 *
 * Every show's counts already arrive in bulk (`aired_episodes` + the watched
 * breakdown), so a per-show read buys exactly one thing: the IDENTITY of the next
 * episode. Only a show with unwatched aired episodes has a next episode to name,
 * so only those spend the budget, most-recently-watched first. A caught-up
 * library now costs zero progress GETs.
 *
 * Why 60: power-user behavior tops out around 20-50 shows watched concurrently; 60
 * covers that with headroom while staying a hard ceiling. It also holds the
 * worst-case cold-sync GET count far under Trakt's authed 1000-GET / 5-min budget:
 * a 1000-show library costs ceil(1000/100)=10 watched pages + at most 60 progress +
 * ~1 hidden + ~1 watchlist ≈ 72 GETs (~7% of the ceiling, a >13× margin), versus
 * the previous ~2000 (2 GETs × 1000 shows) that blew straight through it. Per-row
 * art is deferred to a separate lazy per-card read, so it never rides the cold-sync
 * burst.
 *
 * The cost: a user with more than 60 shows carrying a backlog gets the 61st-most-
 * recent onward with real counts but no next episode, so Up Next cannot queue a
 * card for it (there is no episode to name and one must never be guessed). It is
 * neither fabricated caught-up nor dropped: Library shows it under Watching with
 * its real progress, and opening it reads its progress for real.
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

/**
 * Retry a read only on a 429, honoring `Retry-After`, within a bounded budget, and
 * hold every other read behind the same pause while it waits.
 */
export async function withReadRateRetry<T>(
  read: () => Promise<TraktResult<T>>,
): Promise<TraktResult<T>> {
  for (let attempt = 0; ; attempt += 1) {
    const pause = resumeReadsAt - Date.now();
    if (pause > 0) await sleep(pause);
    const result = await read();
    if (result.ok || result.error.kind !== "rate-limited" || attempt >= MAX_READ_RATE_RETRIES) {
      return result;
    }
    const backoff = result.error.retryAfterMs ?? DEFAULT_RATE_BACKOFF_MS;
    resumeReadsAt = Math.max(resumeReadsAt, Date.now() + backoff);
  }
}

/** Most-recently-watched first (unknown last-watched sorts oldest). */
function byLastWatchedDesc(a: WatchedShow, b: WatchedShow): number {
  return (toMs(b.last_watched_at) ?? 0) - (toMs(a.last_watched_at) ?? 0);
}

/**
 * Paint the shared library snapshot (Up Next + Library) from bounded bulk reads:
 * the paginated watched list (which carries every show's aired + watched counts),
 * per-show progress for the {@link WATCHED_PROGRESS_BUDGET} most-recently-watched
 * shows with a backlog, plus the hidden set and watchlist.
 * Per-show ART/detail is NOT fetched here: it is deferred to a lazy per-visible-card
 * read: so the cold-sync GET count is bounded and does not scale ~2×
 * with library size. Progress failure throws (the whole read fails so React Query
 * keeps the prior cached queue + retry banner instead of erasing a known show); a
 * transient 429 on any read is absorbed within a bounded budget.
 */
export async function loadUpNextEntries(client: TraktClient): Promise<LibraryEntry[]> {
  const watched = await withReadRateRetry(() => getWatchedShows(client));
  if (!watched.ok) throw new Error("Failed to load watched shows");

  const head = watched.data
    .filter((show) => watchedEpisodeCount(show) < show.show.aired_episodes)
    .sort(byLastWatchedDesc)
    .slice(0, WATCHED_PROGRESS_BUDGET);
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

  return assembleLibrary({
    watchedShows: watched.data,
    progress,
    hiddenShowIds: showIdSet(hidden.data),
    watchlistShows: watchlist.data,
  });
}
