import { toMs } from "../../domain/time";
import { type TraktClient, type TraktResult, unwrapRead } from "./client";
import { getHidden, getShowProgress, getWatchedShows, getWatchlist } from "./endpoints";
import { assembleLibrary, type LibraryEntry, showIdSet, watchedEpisodeCount } from "./library";
import type { Progress, WatchedShow } from "./schemas";

/**
 * Concurrency cap on authed GETs, shared by EVERY read: the cold-sync progress
 * head, the movie library, and the lazy per-card art reads a scrolling list
 * issues. Capping the pool rather than each caller is what holds the TOTAL at ≤6,
 * inside the sync analysis's 8-12 window with margin; a per-caller cap leaves the
 * sum unbounded, which is how a scrolled library stampedes the window on its own.
 */
export const READ_CONCURRENCY = 6;

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
 *
 * It is also the app's answer to "what is happening and when does it retry", so
 * it is observable: the sync strip subscribes rather than inferring a rate limit
 * from a query that happens to be failing.
 */
let resumeReadsAt = 0;
const pauseListeners = new Set<() => void>();

/** Epoch ms reads resume; at or before now means nothing is paused. */
export function readsPausedUntil(): number {
  return resumeReadsAt;
}

export function subscribeReadPause(listener: () => void): () => void {
  pauseListeners.add(listener);
  return () => {
    pauseListeners.delete(listener);
  };
}

function pauseReadsUntil(at: number): void {
  if (at <= resumeReadsAt) return;
  resumeReadsAt = at;
  for (const listener of pauseListeners) listener();
}

/** Test-only: drop the shared pause so one case's rate limit can't leak into the next. */
export function resetReadPause(): void {
  resumeReadsAt = 0;
  pauseListeners.clear();
}

/**
 * The cold-sync per-show progress budget: at most this many `/shows/:id/progress`
 * GETs fire up front.
 *
 * Every show's counts already arrive in bulk (`aired_episodes` + the watched
 * breakdown), so a per-show read buys exactly one thing: the IDENTITY of the next
 * episode. Only a show whose bulk counts leave that open has one to name, so only
 * those spend the budget, most-recently-watched first. A caught-up library now
 * costs zero progress GETs.
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

/** Reads waiting for one of the {@link READ_CONCURRENCY} slots, in request order. */
const waitingForSlot: (() => void)[] = [];
let readsInFlight = 0;

async function acquireReadSlot(): Promise<void> {
  if (readsInFlight < READ_CONCURRENCY) {
    readsInFlight += 1;
    return;
  }
  await new Promise<void>((resolve) => waitingForSlot.push(resolve));
}

function releaseReadSlot(): void {
  const next = waitingForSlot.shift();
  if (next === undefined) readsInFlight -= 1;
  else next();
}

/**
 * Run a read inside the shared concurrency pool, retrying only on a 429, honoring
 * `Retry-After` within a bounded budget, and holding every other read behind the
 * same pause while it waits. Every authed read goes through here, so the pool is
 * the app's single ceiling on concurrent GETs and the pause is global.
 */
export async function withReadRateRetry<T>(
  read: () => Promise<TraktResult<T>>,
): Promise<TraktResult<T>> {
  await acquireReadSlot();
  try {
    for (let attempt = 0; ; attempt += 1) {
      const pause = resumeReadsAt - Date.now();
      if (pause > 0) await sleep(pause);
      const result = await read();
      if (result.ok || result.error.kind !== "rate-limited") return result;
      // Trakt closed the window: hold every read back for as long as it asked,
      // whether or not THIS read has budget left to wait it out. The pause is
      // what the caller above retries against, and what the strip reads.
      pauseReadsUntil(Date.now() + (result.error.retryAfterMs ?? DEFAULT_RATE_BACKOFF_MS));
      if (attempt >= MAX_READ_RATE_RETRIES) return result;
    }
  } finally {
    releaseReadSlot();
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
  const watched = unwrapRead(
    await withReadRateRetry(() => getWatchedShows(client)),
    "watched shows",
  );

  // Anything whose local count DISAGREES with `aired_episodes`, either way.
  // Under-count is the ordinary backlog; over-count means plays exist on episodes
  // Trakt does not count as aired, so the two numbers cannot both be right and
  // only `/progress/watched` can settle it. A `<` here would read those as caught
  // up, and an ended show's `aired_episodes` never grows again to reopen them.
  const head = watched
    .filter((show) => watchedEpisodeCount(show) !== show.show.aired_episodes)
    .sort(byLastWatchedDesc)
    .slice(0, WATCHED_PROGRESS_BUDGET);
  const perShow = await Promise.all(
    head.map(async (show) => {
      const id = show.show.ids.trakt;
      const read = await withReadRateRetry(() => getShowProgress(client, id));
      return { id, progress: unwrapRead(read, "show progress") };
    }),
  );
  const progress = new Map<number, Progress>(perShow.map((s) => [s.id, s.progress]));

  const [hidden, watchlist] = await Promise.all([
    withReadRateRetry(() => getHidden(client)),
    withReadRateRetry(() => getWatchlist(client, "shows")),
  ]);
  return assembleLibrary({
    watchedShows: watched,
    progress,
    hiddenShowIds: showIdSet(unwrapRead(hidden, "hidden shows")),
    watchlistShows: unwrapRead(watchlist, "watchlist"),
  });
}
