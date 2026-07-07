import { queryKeys } from "@data/query-keys";
import type { SearchHit } from "@data/trakt/search";
import { useQuery } from "@tanstack/react-query";
import { useRuntime } from "@ui/runtime/runtime";

/** Related films shift slowly; a 5-minute stale window spares detail re-mounts a
 * refetch, matching the browse rails. */
const STALE_MS = 5 * 60 * 1000;

export interface MovieRelatedView {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly hits: readonly SearchHit[];
}

/**
 * The Movie-detail "More like this" rail (`/movies/:id/related`): a read-only
 * discovery rail of related films as poster `SearchHit`s, reusing the DiscoverCard
 * idiom (route to `/movie/:id` + inline watchlist add). Quiet and additive — the
 * caller renders the rail only when hits resolve, so a loading/empty/error state
 * simply shows nothing rather than intruding on the detail controls.
 */
export function useMovieRelated(movieId: number): MovieRelatedView {
  const runtime = useRuntime();
  const query = useQuery({
    queryKey: queryKeys.movieRelated(movieId),
    queryFn: () => runtime.loadMovieRelated(movieId),
    staleTime: STALE_MS,
  });
  return {
    isLoading: query.isLoading,
    isError: query.isError,
    hits: query.data ?? [],
  };
}
