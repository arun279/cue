import { useQuery } from "@tanstack/react-query";
import { CONTENT_STALE_TIME_MS } from "@ui/hooks/query-freshness";

export interface DetailHeaderView<T> {
  readonly header: T | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly hasData: boolean;
  refetch(): void;
}

/**
 * The shared content-detail hero read (show + movie): a standalone query on the
 * content staleTime so the hero paints from cache, retries on its own, and, being
 * content, not user state, refreshes on a time window rather than the
 * last_activities gate. One seam so both detail heroes stay in lock-step.
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
    refetch: () => void query.refetch(),
  };
}
