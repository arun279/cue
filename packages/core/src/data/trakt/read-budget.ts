import { toMs } from "../../domain/time";
import { type TraktClient, TraktReadError, type TraktResult, unwrapRead } from "./client";
import { getHidden, getShowProgress, getWatchedShows, getWatchlist } from "./endpoints";
import { assembleLibrary, type LibraryEntry, showIdSet, watchedEpisodeCount } from "./library";
import type { Progress, WatchedShow } from "./schemas";

export const READ_CONCURRENCY = 6;

export const MAX_READ_RATE_RETRIES = 3;
const DEFAULT_RATE_BACKOFF_MS = 1000;

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
}

// Trakt allows 1000 authed GETs per 5 minutes.
export const WATCHED_PROGRESS_BUDGET = 60;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
      pauseReadsUntil(Date.now() + (result.error.retryAfterMs ?? DEFAULT_RATE_BACKOFF_MS));
      if (attempt >= MAX_READ_RATE_RETRIES) return result;
    }
  } finally {
    releaseReadSlot();
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
        const read = await withReadRateRetry(async () => {
          if (failure !== null) throw ABANDONED;
          const attempt = await getShowProgress(client, id);
          if (!attempt.ok && attempt.error.kind !== "rate-limited") {
            failure = new TraktReadError(attempt.error, "show progress");
          }
          return attempt;
        });
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
    await withReadRateRetry(() => getWatchedShows(client)),
    "watched shows",
  );

  const head = watched
    .filter((show) => watchedEpisodeCount(show) !== show.show.aired_episodes)
    .sort(byLastWatchedDesc)
    .slice(0, WATCHED_PROGRESS_BUDGET);
  const progress = await readProgressHead(client, head);

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
