import { queryKeys } from "@data/query-keys";
import type { MovieHeader } from "@data/trakt/movie-library";
import { useQuery } from "@tanstack/react-query";
import { useRuntime } from "@ui/runtime/runtime";

export interface MovieDetailView {
  readonly header: MovieHeader | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly hasData: boolean;
  refetch(): void;
}

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
  });
  return {
    header: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    hasData: query.data !== undefined,
    refetch: () => void query.refetch(),
  };
}
