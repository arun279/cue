import { queryKeys } from "@data/query-keys";
import type { Progress } from "@data/trakt/schemas";
import { useQuery } from "@tanstack/react-query";
import { USER_STATE_STALE_TIME } from "@ui/hooks/query-freshness";
import { useRuntime } from "@ui/runtime/runtime";

export interface ShowProgressView {
  readonly data: Progress | undefined;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly isFetchedAfterMount: boolean;
  refetch(): void;
}

/** Deferred progress for one budget-tail row, enabled only while that row is visible. */
export function useShowProgress(showId: number, enabled: boolean): ShowProgressView {
  const runtime = useRuntime();
  const query = useQuery({
    queryKey: queryKeys.showProgress(showId),
    queryFn: ({ signal }) => runtime.loadShowProgress(showId, signal),
    enabled,
    staleTime: USER_STATE_STALE_TIME,
  });
  return {
    data: query.data,
    isFetching: query.isFetching,
    isError: query.isError,
    isFetchedAfterMount: query.isFetchedAfterMount,
    refetch: () => void query.refetch(),
  };
}
