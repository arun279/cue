import { queryKeys } from "@data/query-keys";
import type { ShowHeader } from "@data/trakt/show-detail";
import { type DetailHeaderView, useDetailHeader } from "@ui/hooks/useDetailHeader";
import { useRuntime } from "@ui/runtime/runtime";

export type ShowDetailView = DetailHeaderView<ShowHeader>;

/**
 * The Show detail hero read: a standalone query so the hero paints
 * before the heavier season tree resolves (progressive load). Separate cache key
 * from the season stream so each retries independently.
 */
export function useShowDetail(showId: number): ShowDetailView {
  const runtime = useRuntime();
  return useDetailHeader(queryKeys.showHeader(showId), () => runtime.loadShowHeader(showId));
}
