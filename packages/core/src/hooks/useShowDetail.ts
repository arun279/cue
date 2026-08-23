import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../data/query-keys";
import type { ShowHeader } from "../data/trakt/show-detail";
import { useRuntime } from "../runtime/runtime";
import { CONTENT_STALE_TIME_MS } from "./query-freshness";
import type { DetailHeaderView } from "./useDetailHeader";

export type ShowDetailView = DetailHeaderView<ShowHeader>;

/**
 * The Show detail hero read: the show's `/shows/:id` facts and the viewer's
 * progress, each on its own cache key because each has its own lifetime. The
 * facts key is the one a settled card already filled, so arriving from Up Next or
 * Library costs only the progress GET; the progress key is what a mark
 * invalidates, so a mark never re-reads airdates and genres to redraw `X/Y`.
 * Both stay separate from the season stream so the hero paints before the heavier
 * tree resolves and each retries independently.
 */
export function useShowDetail(showId: number): ShowDetailView {
  const runtime = useRuntime();
  const info = useQuery({
    queryKey: queryKeys.showInfo(showId),
    queryFn: () => runtime.loadShowInfo(showId),
    staleTime: CONTENT_STALE_TIME_MS,
  });
  const progress = useQuery({
    queryKey: queryKeys.showProgress(showId),
    queryFn: () => runtime.loadShowProgress(showId),
    staleTime: CONTENT_STALE_TIME_MS,
  });
  const header =
    info.data === undefined || progress.data === undefined
      ? undefined
      : { ...info.data, ...progress.data };
  return {
    header,
    isLoading: info.isLoading || progress.isLoading,
    isError: info.isError || progress.isError,
    hasData: header !== undefined,
    refetch: () => {
      void info.refetch();
      void progress.refetch();
    },
  };
}
