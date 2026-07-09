/**
 * Freshness horizons for the read hooks.
 *
 * User-state reads are gated ENTIRELY by the `/sync/last_activities` reconciler:
 * they never expire on a timer, so navigation never refetches them — only a
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
 * Discover rails — trending / popular / related — are editorial lists that shift
 * slowly. A 5-minute horizon keeps them warm across a session so returning to a
 * browse surface (Search, the movie home, a detail's related rail) doesn't refetch
 * on every revisit.
 */
export const DISCOVER_STALE_TIME_MS = 5 * 60 * 1000;

/**
 * The status fields a persisted-SWR read hook forwards to its screen's
 * {@link SyncStatusPill}. The read hooks wired for the pill's recency share this
 * mapper rather than each inlining the identical `query → status` spread — the
 * duplication gate (jscpd, 0% threshold) rejects the copy-pasted block. `hasData`
 * is the caller's own has-data predicate (each hook derives it from its own selected
 * slice); `syncedAt` is the query's last successful update, which the pill renders
 * as the "· <time ago>" recency.
 */
export interface QueryStatus {
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly hasData: boolean;
  readonly syncedAt: number;
}

export function queryStatus(
  query: {
    readonly isLoading: boolean;
    readonly isFetching: boolean;
    readonly isError: boolean;
    readonly dataUpdatedAt: number;
  },
  hasData: boolean,
): QueryStatus {
  return {
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    hasData,
    syncedAt: query.dataUpdatedAt,
  };
}
