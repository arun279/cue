import type { LibraryEntry } from "../../domain/model/library";
import { healsOnRetry, type TraktFailure } from "../../domain/read-failure";
import { toMs } from "../../domain/time";
import { jitteredBackoffMs } from "../../domain/write-queue/classify";
import { type TraktClient, type TraktResult, unwrapRead } from "./client";
import {
  getCollectionShows,
  getDropped,
  getHidden,
  getShowProgress,
  getWatchedShows,
  getWatchlist,
} from "./endpoints";
import { assembleLibrary, showIdSet, watchedEpisodeCount } from "./library";
import { DEFAULT_TRAKT_POLICY, type TraktPolicy } from "./policy";
import type { Progress, WatchedShow } from "./schemas";

// Trakt's rate limits apply per window, and its 429 guidance is to pause all requests for Retry-After.
let resumeReadsAt = 0;
const pauseListeners = new Set<() => void>();

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

export function resetReadPause(): void {
  resumeReadsAt = 0;
  pauseListeners.clear();
  retrying.clear();
  retryListeners.clear();
}

// The library load retries its own reads, so the failure it is retrying past is published
// the same way the pause is, for the screens waiting on it.
const retrying = new Map<symbol, TraktFailure>();
const retryListeners = new Set<() => void>();
let retryFailure: TraktFailure | null = null;

export function readRetryFailure(): TraktFailure | null {
  return retryFailure;
}

export function subscribeReadRetry(listener: () => void): () => void {
  retryListeners.add(listener);
  return () => {
    retryListeners.delete(listener);
  };
}

function setRetrying(read: symbol, failure: TraktFailure | null): void {
  if (failure === null) retrying.delete(read);
  else retrying.set(read, failure);
  const latest = [...retrying.values()].at(-1) ?? null;
  if (latest === retryFailure) return;
  retryFailure = latest;
  for (const listener of retryListeners) listener();
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitingForSlot: (() => void)[] = [];
let readsInFlight = 0;

async function acquireReadSlot(concurrency: number): Promise<void> {
  if (readsInFlight < concurrency) {
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

export async function withReadRateRetry<T>(
  read: () => Promise<TraktResult<T>>,
  policy: TraktPolicy = DEFAULT_TRAKT_POLICY,
): Promise<TraktResult<T>> {
  const { retries, backoffMs } = policy.rateLimit;
  await acquireReadSlot(policy.readConcurrency);
  try {
    for (let attempt = 0; ; attempt += 1) {
      const pause = resumeReadsAt - Date.now();
      if (pause > 0) await sleep(pause);
      const result = await read();
      if (result.ok || result.error.kind !== "rate-limited") return result;
      const { retryAfterMs } = result.error;
      // Trakt's guidance: pause everything for Retry-After, and without it back off with jitter,
      // which a shared pause would undo by releasing every waiting read at once.
      if (retryAfterMs !== null) pauseReadsUntil(Date.now() + retryAfterMs);
      if (attempt >= retries) return result;
      if (retryAfterMs === null) await sleep(jitteredBackoffMs(attempt, backoffMs));
    }
  } finally {
    releaseReadSlot();
  }
}

/** Retries one read that failed in transit or on Trakt's side, so a single failure costs that
 * read again rather than the whole library. */
async function withReadRetry<T>(
  read: () => Promise<TraktResult<T>>,
  policy: TraktPolicy,
): Promise<TraktResult<T>> {
  const id = Symbol("read");
  try {
    for (let attempt = 1; ; attempt += 1) {
      const result = await withReadRateRetry(read, policy);
      if (result.ok || !healsOnRetry(result.error) || attempt >= policy.readAttempts) return result;
      setRetrying(id, result.error);
      await sleep(jitteredBackoffMs(attempt - 1, policy.retryDelayMs));
    }
  } finally {
    setRetrying(id, null);
  }
}

const ABANDONED = Symbol("abandoned read");

async function readProgressHead(
  client: TraktClient,
  head: readonly WatchedShow[],
): Promise<Map<number, Progress>> {
  let failure: unknown = null;
  const entries = await Promise.all(
    head.map(async (show) => {
      const id = show.show.ids.trakt;
      try {
        const read = await withReadRetry(async () => {
          if (failure !== null) throw ABANDONED;
          return getShowProgress(client, id);
        }, client.policy);
        return [id, unwrapRead(read, "show progress")] as const;
      } catch (error) {
        if (error !== ABANDONED) failure ??= error;
        return null;
      }
    }),
  );
  if (failure !== null) throw failure;
  return new Map(entries.filter((entry) => entry !== null));
}

function byLastWatchedDesc(a: WatchedShow, b: WatchedShow): number {
  return (toMs(b.last_watched_at) ?? 0) - (toMs(a.last_watched_at) ?? 0);
}

export async function loadUpNextEntries(client: TraktClient): Promise<LibraryEntry[]> {
  const watched = unwrapRead(
    await withReadRetry(() => getWatchedShows(client), client.policy),
    "watched shows",
  );

  const head = watched
    .filter((show) => watchedEpisodeCount(show) !== show.show.aired_episodes)
    .sort(byLastWatchedDesc)
    .slice(0, client.policy.progressBudget);
  const progress = await readProgressHead(client, head);

  const [hidden, dropped, watchlist, collection] = await Promise.all([
    withReadRetry(() => getHidden(client), client.policy),
    withReadRetry(() => getDropped(client), client.policy),
    withReadRetry(() => getWatchlist(client, "shows"), client.policy),
    withReadRetry(() => getCollectionShows(client), client.policy),
  ]);
  return assembleLibrary({
    watchedShows: watched,
    progress,
    hiddenShowIds: showIdSet([
      ...unwrapRead(hidden, "hidden shows"),
      ...unwrapRead(dropped, "dropped shows"),
    ]),
    watchlistShows: unwrapRead(watchlist, "watchlist"),
    collectionShows: unwrapRead(collection, "show collection"),
  });
}
