import type { TraktFailure } from "../data/trakt/client";
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
  readonly isError: boolean;
  readonly dataUpdatedAt: number;
  readonly error: unknown;
  readonly failureReason: unknown;
}

export function queryStatus(query: QueryResultStatus, hasData: boolean): QueryStatus {
  return {
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    hasData,
    syncedAt: query.dataUpdatedAt,
    failure: readFailureOf(query.error ?? query.failureReason),
    // TanStack Query keeps error set across every refetch once a query has data.
    retrying: query.isFetching && (query.isError || query.failureReason !== null),
  };
}

export function combineStatus(
  queries: readonly QueryResultStatus[],
  hasData: boolean,
): QueryStatus {
  return queryStatus(
    {
      isLoading: queries.some((query) => query.isLoading),
      isFetching: queries.some((query) => query.isFetching),
      isError: queries.some((query) => query.isError),
      dataUpdatedAt: Math.min(...queries.map((query) => query.dataUpdatedAt)),
      error: queries.find((query) => query.error !== null)?.error ?? null,
      failureReason: queries.find((query) => query.failureReason !== null)?.failureReason ?? null,
    },
    hasData,
  );
}
