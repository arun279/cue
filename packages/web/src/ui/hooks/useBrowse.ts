import { queryKeys } from "@data/query-keys";
import type { SearchHit } from "@data/trakt/search";
import { useQuery } from "@tanstack/react-query";
import { BROWSE_STALE_TIME_MS } from "@ui/hooks/query-freshness";
import { useRuntime } from "@ui/runtime/runtime";

export interface BrowseView {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly trending: readonly SearchHit[];
  readonly popular: readonly SearchHit[];
  readonly trendingMovies: readonly SearchHit[];
  readonly popularMovies: readonly SearchHit[];
  refetch(): void;
}

/**
 * The Search browse rails: trending + popular shows AND movies as poster
 * hits, loaded once and cached so an empty query paints a real browse surface
 * instead of a bare prompt. Reuses the same `SearchHit` shape as search, so the
 * inline watchlist add and poster tiles are shared across every rail and the
 * results grid: movie hits route to `/movie/:id` through the same browse tile.
 *
 * TODO(movie-gating): this shared Search read loads all four show+movie rails
 * regardless of which media a single-medium user has on (the Search screen then
 * UI-filters). Each rail is rendered as a bounded browse rail,
 * so the over-fetch is a rail-count concern, not a page-height one.
 */
export function useBrowse(): BrowseView {
  const runtime = useRuntime();
  const query = useQuery({
    queryKey: queryKeys.browse(),
    queryFn: () => runtime.loadBrowse(),
    staleTime: BROWSE_STALE_TIME_MS,
  });
  return {
    isLoading: query.isLoading,
    isError: query.isError,
    trending: query.data?.trending ?? [],
    popular: query.data?.popular ?? [],
    trendingMovies: query.data?.trendingMovies ?? [],
    popularMovies: query.data?.popularMovies ?? [],
    refetch: () => void query.refetch(),
  };
}
