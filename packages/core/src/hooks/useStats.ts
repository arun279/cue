import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../data/query-keys";
import type { UserStats } from "../data/trakt/schemas";
import { useRuntime } from "../runtime/runtime";
import { type QueryStatus, queryStatus, USER_STATE_STALE_TIME } from "./query-freshness";

export interface StatsView extends QueryStatus {
  readonly stats: UserStats | undefined;
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
    ...queryStatus(query, query.data !== undefined),
    refetch: () => void query.refetch(),
  };
}
