import { useQuery } from "@tanstack/react-query";
import type { MovieHeader } from "../data/trakt/movie-library";
import { type DetailHeaderView, queryStatus } from "../queries/freshness";
import { movieHeaderQuery } from "../queries/movies";
import { useRuntime } from "../runtime/runtime";

export type MovieDetailView = DetailHeaderView<MovieHeader>;

/**
 * The Movie detail hero read: the editorial `/movies/:id` payload (title, year,
 * overview, runtime, release, genres, poster + fanart). Watched/watchlist state
 * is read separately from the shared movie-library cache, so this query stays a
 * pure content fetch that retries on its own.
 */
export function useMovieDetail(movieId: number): MovieDetailView {
  const runtime = useRuntime();
  const query = useQuery(movieHeaderQuery(runtime, movieId));
  return {
    header: query.data,
    ...queryStatus(query, query.data !== undefined),
    refetch: () => void query.refetch(),
  };
}
