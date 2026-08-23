import { queryKeys } from "../data/query-keys";
import type { MovieHeader } from "../data/trakt/movie-library";
import { useRuntime } from "../runtime/runtime";
import { type DetailHeaderView, useDetailHeader } from "./useDetailHeader";

export type MovieDetailView = DetailHeaderView<MovieHeader>;

/**
 * The Movie detail hero read: the editorial `/movies/:id` payload (title, year,
 * overview, runtime, release, genres, poster + fanart). Watched/watchlist state
 * is read separately from the shared movie-library cache, so this query stays a
 * pure content fetch that retries on its own.
 */
export function useMovieDetail(movieId: number): MovieDetailView {
  const runtime = useRuntime();
  return useDetailHeader(queryKeys.movieHeader(movieId), () => runtime.loadMovieHeader(movieId));
}
