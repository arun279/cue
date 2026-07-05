import { queryKeys } from "@data/query-keys";
import type { ShowHeader } from "@data/trakt/show-detail";
import { useQuery } from "@tanstack/react-query";
import { useRuntime } from "@ui/runtime/runtime";

export interface ShowDetailView {
  readonly header: ShowHeader | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly hasData: boolean;
  refetch(): void;
}

/**
 * The Show detail hero read: a standalone query so the hero paints
 * before the heavier season tree resolves (progressive load). Separate cache key
 * from the season stream so each retries independently.
 */
export function useShowDetail(showId: number): ShowDetailView {
  const runtime = useRuntime();
  const query = useQuery({
    queryKey: queryKeys.showHeader(showId),
    queryFn: () => runtime.loadShowHeader(showId),
  });
  return {
    header: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    hasData: query.data !== undefined,
    refetch: () => void query.refetch(),
  };
}
