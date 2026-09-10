import { useQuery } from "@tanstack/react-query";
import type { UserStats } from "../data/trakt/schemas";
import { type QueryStatus, queryStatus } from "../queries/freshness";
import { userStatsQuery } from "../queries/user";
import { useRuntime } from "../runtime/runtime";

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
  const query = useQuery(userStatsQuery(runtime));
  return {
    stats: query.data,
    ...queryStatus(query, query.data !== undefined),
    refetch: () => void query.refetch(),
  };
}
