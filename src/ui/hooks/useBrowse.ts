import type { TmdbImageConfig } from "@data/image-source";
import { queryKeys } from "@data/query-keys";
import type { SearchHit } from "@data/trakt/search";
import { useQuery } from "@tanstack/react-query";
import { useRuntime } from "@ui/runtime/runtime";

/** Trending + popular shift slowly; a 5-minute stale window spares Discover a
 * refetch every time the query clears back to the browse rails. */
const STALE_MS = 5 * 60 * 1000;

export interface BrowseView {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly trending: readonly SearchHit[];
  readonly popular: readonly SearchHit[];
  readonly trendingMovies: readonly SearchHit[];
  readonly popularMovies: readonly SearchHit[];
  readonly tmdbConfig: TmdbImageConfig | null;
  refetch(): void;
}

/**
 * The Discover browse rails: trending + popular shows AND movies as poster
 * hits, loaded once and cached so an empty query paints a real browse surface
 * instead of a bare prompt. Reuses the same `SearchHit` shape as search, so the
 * inline watchlist add and poster tiles are shared across every rail and the
 * results grid — movie hits route to `/movie/:id` through the same DiscoverCard.
 */
export function useBrowse(): BrowseView {
  const runtime = useRuntime();
  const query = useQuery({
    queryKey: queryKeys.discover(),
    queryFn: () => runtime.loadDiscover(),
    staleTime: STALE_MS,
  });
  return {
    isLoading: query.isLoading,
    isError: query.isError,
    trending: query.data?.trending ?? [],
    popular: query.data?.popular ?? [],
    trendingMovies: query.data?.trendingMovies ?? [],
    popularMovies: query.data?.popularMovies ?? [],
    tmdbConfig: query.data?.tmdbConfig ?? null,
    refetch: () => void query.refetch(),
  };
}
