import { queryKeys } from "@data/query-keys";
import type { UserStats } from "@data/trakt/schemas";
import { useQuery } from "@tanstack/react-query";
import { USER_STATE_STALE_TIME } from "@ui/hooks/query-freshness";
import { useRuntime } from "@ui/runtime/runtime";

export interface StatsView {
  readonly stats: UserStats | undefined;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly hasData: boolean;
  /** Epoch ms of the last successful stats read (drives the pill's recency). */
  readonly syncedAt: number;
  refetch(): void;
}

/**
 * The Profile read: the signed-in user's lifetime `/users/me/stats`. A
 * standalone query: the numbers change only when a mark syncs, so it holds its
 * own cache key rather than riding the library snapshot.
 */
export function useStats(): StatsView {
  const runtime = useRuntime();
  const query = useQuery({
    queryKey: queryKeys.userStats(),
    queryFn: () => runtime.loadStats(),
    staleTime: USER_STATE_STALE_TIME,
  });
  return {
    stats: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    hasData: query.data !== undefined,
    syncedAt: query.dataUpdatedAt,
    refetch: () => void query.refetch(),
  };
}
