import type { TmdbImageConfig } from "@data/image-source";
import { queryKeys } from "@data/query-keys";
import type { SearchHit } from "@data/trakt/search";
import { useQuery } from "@tanstack/react-query";
import { DISCOVER_STALE_TIME_MS } from "@ui/hooks/query-freshness";
import { useRuntime } from "@ui/runtime/runtime";

export interface MovieDiscoverView {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly trending: readonly SearchHit[];
  readonly popular: readonly SearchHit[];
  readonly tmdbConfig: TmdbImageConfig | null;
  refetch(): void;
}

/**
 * The movie home's Discover zone read: trending + popular movies as poster rails,
 * fetched ONLY when the Movies home is the active surface (`enabled`), so a TV
 * session — or a both-user sitting on the Shows tab — never loads it (the
 * gated-by-active-medium rule). Movie-scoped, so it never pulls the show charts the
 * way the shared Search `useBrowse` does. Reuses the same `SearchHit` pipeline as
 * search results and the related rail, so its tiles route to `/movie/:id` and add
 * to the watchlist inline through the shared DiscoverCard.
 */
export function useMovieDiscover(enabled: boolean): MovieDiscoverView {
  const runtime = useRuntime();
  const query = useQuery({
    queryKey: queryKeys.movieDiscover(),
    queryFn: () => runtime.loadMovieDiscover(),
    staleTime: DISCOVER_STALE_TIME_MS,
    enabled,
  });
  return {
    isLoading: query.isLoading,
    isError: query.isError,
    trending: query.data?.trending ?? [],
    popular: query.data?.popular ?? [],
    tmdbConfig: query.data?.tmdbConfig ?? null,
    refetch: () => void query.refetch(),
  };
}
