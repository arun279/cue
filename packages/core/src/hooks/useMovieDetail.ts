import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../data/query-keys";
import type { MovieHeader } from "../data/trakt/movie-library";
import { useRuntime } from "../runtime/runtime";
import { CONTENT_STALE_TIME_MS, type DetailHeaderView, queryStatus } from "./query-freshness";

export type MovieDetailView = DetailHeaderView<MovieHeader>;

/**
 * The Movie detail hero read: the editorial `/movies/:id` payload (title, year,
 * overview, runtime, release, genres, poster + fanart). Watched/watchlist state
 * is read separately from the shared movie-library cache, so this query stays a
 * pure content fetch that retries on its own.
 */
export function useMovieDetail(movieId: number): MovieDetailView {
  const runtime = useRuntime();
  const query = useQuery({
    queryKey: queryKeys.movieHeader(movieId),
    queryFn: () => runtime.loadMovieHeader(movieId),
    staleTime: CONTENT_STALE_TIME_MS,
  });
  return {
    header: query.data,
    ...queryStatus(query, query.data !== undefined),
    refetch: () => void query.refetch(),
  };
}
