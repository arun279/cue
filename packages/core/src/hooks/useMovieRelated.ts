import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../data/query-keys";
import type { SearchHit } from "../data/trakt/search";
import { useRuntime } from "../runtime/runtime";
import { BROWSE_STALE_TIME_MS } from "./query-freshness";

export interface MovieRelatedView {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly hits: readonly SearchHit[];
}

/**
 * The Movie-detail "More like this" rail (`/movies/:id/related`): a read-only
 * related-film rail as poster `SearchHit`s, reusing the browse tile
 * idiom (route to `/movie/:id` + inline watchlist add). Quiet and additive: the
 * caller renders the rail only when hits resolve, so a loading/empty/error state
 * simply shows nothing rather than intruding on the detail controls.
 */
export function useMovieRelated(movieId: number): MovieRelatedView {
  const runtime = useRuntime();
  const query = useQuery({
    queryKey: queryKeys.movieRelated(movieId),
    queryFn: () => runtime.loadMovieRelated(movieId),
    staleTime: BROWSE_STALE_TIME_MS,
  });
  return {
    isLoading: query.isLoading,
    isError: query.isError,
    hits: query.data ?? [],
  };
}
