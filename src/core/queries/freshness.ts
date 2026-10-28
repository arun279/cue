import type { TraktFailure } from "../domain/read-failure";
import { readFailureOf } from "../sync-contract";

export const USER_STATE_STALE_TIME = Number.POSITIVE_INFINITY;

export const CONTENT_STALE_TIME_MS = 60 * 60 * 1000;

export interface QueryStatus {
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly hasData: boolean;
  readonly syncedAt: number;
  readonly failure: TraktFailure | null;
  readonly retrying: boolean;
}

interface QueryResultStatus {
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isPaused: boolean;
  readonly isError: boolean;
  readonly dataUpdatedAt: number;
  readonly error: unknown;
  readonly failureReason: unknown;
}

export function queryStatus(query: QueryResultStatus, hasData: boolean): QueryStatus {
  return {
    isLoading: query.isLoading || (query.isPaused && !hasData),
    isFetching: query.isFetching,
    isError: query.isError,
    hasData,
    syncedAt: query.dataUpdatedAt,
    failure: readFailureOf(query.error ?? query.failureReason),
    // TanStack Query keeps error set across every refetch once a query has data.
    retrying: query.isFetching && (query.isError || query.failureReason !== null),
  };
}

/** A load that retries its own reads keeps fetching through a failure: say so while it does. */
export function retryingPast(status: QueryStatus, failure: TraktFailure | null): QueryStatus {
  if (failure === null || !status.isFetching) return status;
  return { ...status, failure, retrying: true };
}

export function combineStatus(
  queries: readonly QueryResultStatus[],
  hasData: boolean,
): QueryStatus {
  return queryStatus(
    {
      isLoading: queries.some((query) => query.isLoading),
      isFetching: queries.some((query) => query.isFetching),
      isPaused: queries.some((query) => query.isPaused),
      isError: queries.some((query) => query.isError),
      dataUpdatedAt: Math.min(...queries.map((query) => query.dataUpdatedAt)),
      error: queries.find((query) => query.error !== null)?.error ?? null,
      failureReason: queries.find((query) => query.failureReason !== null)?.failureReason ?? null,
    },
    hasData,
  );
}
