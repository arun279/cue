import { useQuery } from "@tanstack/react-query";
import type { TraktFailure } from "../data/trakt/client";
import { readFailureOf } from "../sync-contract";
import { CONTENT_STALE_TIME_MS } from "./query-freshness";

export interface DetailHeaderView<T> {
  readonly header: T | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly hasData: boolean;
  /** Why the read failed, so the screen's error body names it rather than guessing. */
  readonly failure: TraktFailure | null;
  refetch(): void;
}

/**
 * The Movie detail hero read: a standalone query on the content staleTime so the
 * hero paints from cache, retries on its own, and, being content, not user state,
 * refreshes on a time window rather than the last_activities gate. Show detail
 * reports the same {@link DetailHeaderView} but composes it from two keys,
 * because its `/shows/:id` half is shared with the per-card art read.
 */
export function useDetailHeader<T>(
  queryKey: readonly unknown[],
  queryFn: () => Promise<T>,
): DetailHeaderView<T> {
  const query = useQuery({ queryKey, queryFn, staleTime: CONTENT_STALE_TIME_MS });
  return {
    header: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    hasData: query.data !== undefined,
    failure: readFailureOf(query.error),
    refetch: () => void query.refetch(),
  };
}
