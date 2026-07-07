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
