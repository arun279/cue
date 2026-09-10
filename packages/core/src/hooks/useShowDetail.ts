import { useQuery } from "@tanstack/react-query";
import type { ShowHeader } from "../data/trakt/show-detail";
import { type DetailHeaderView, queryStatus } from "../queries/freshness";
import { showInfoQuery, showProgressQuery } from "../queries/shows";
import { useRuntime } from "../runtime/runtime";

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
  const info = useQuery(showInfoQuery(runtime, showId));
  const progress = useQuery(showProgressQuery(runtime, showId));
  const header =
    info.data === undefined || progress.data === undefined
      ? undefined
      : { ...info.data, ...progress.data };
  return {
    header,
    ...queryStatus(
      {
        isLoading: info.isLoading || progress.isLoading,
        isFetching: info.isFetching || progress.isFetching,
        isError: info.isError || progress.isError,
        dataUpdatedAt: Math.min(info.dataUpdatedAt, progress.dataUpdatedAt),
        error: info.error ?? progress.error,
        failureReason: info.failureReason ?? progress.failureReason,
      },
      header !== undefined,
    ),
    refetch: () => {
      void info.refetch();
      void progress.refetch();
    },
  };
}
