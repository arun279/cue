import type { TraktFailure } from "../data/trakt/client";
import { readFailureOf } from "../sync-contract";

/**
 * Freshness horizons for the read hooks.
 *
 * User-state reads are gated ENTIRELY by the `/sync/last_activities` reconciler:
 * they never expire on a timer, so navigation never refetches them: only a
 * diffed change invalidates them.
 */
export const USER_STATE_STALE_TIME = Number.POSITIVE_INFINITY;

/**
 * Content reads (show header/seasons/episode, calendar) carry Trakt airdates and
 * newly-announced episodes that don't always bump user activity, so they are NOT
 * gated on last_activities. Episodes air/announce on a sub-daily cadence, so a
 * 1-hour horizon catches a same-day change on the next visit while sparing rapid
 * back-and-forth navigation a refetch.
 */
export const CONTENT_STALE_TIME_MS = 60 * 60 * 1000;

/**
 * Search browse rails, trending / popular / related, are editorial lists that shift
 * slowly. A 5-minute horizon keeps them warm across a session so returning to a
 * browse surface (Search, the movie home, a detail's related rail) doesn't refetch
 * on every revisit.
 */
export const BROWSE_STALE_TIME_MS = 5 * 60 * 1000;

/**
 * The status fields a persisted-SWR read hook forwards to its screen. The read
 * hooks wired for the sync strip share this mapper rather than each inlining the
 * identical `query → status` spread: the duplication gate (jscpd, 0% threshold)
 * rejects the copy-pasted block. `hasData` is the caller's own has-data predicate
 * (each hook derives it from its own selected slice); `syncedAt` is the query's
 * last successful update, which Settings renders as its recency.
 *
 * `failure` and `retrying` are what let a screen tell the truth about a failed
 * read: WHICH failure (a rate limit is not an outage) and whether the app is
 * still trying (in which case there is nothing for the user to retry). A read
 * between attempts reports through `failureReason`, so a mid-retry read is
 * visible before `error` is ever set.
 */
export interface QueryStatus {
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly hasData: boolean;
  readonly syncedAt: number;
  readonly failure: TraktFailure | null;
  /** The read failed but has attempts left: the app is retrying on its own. */
  readonly retrying: boolean;
}

export function queryStatus(
  query: {
    readonly isLoading: boolean;
    readonly isFetching: boolean;
    readonly isError: boolean;
    readonly dataUpdatedAt: number;
    readonly error: unknown;
    readonly failureReason: unknown;
  },
  hasData: boolean,
): QueryStatus {
  return {
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    hasData,
    syncedAt: query.dataUpdatedAt,
    failure: readFailureOf(query.error ?? query.failureReason),
    retrying: !query.isError && query.failureReason !== null,
  };
}
