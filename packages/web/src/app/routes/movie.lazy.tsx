import { createLazyRoute } from "@tanstack/react-router";
import { MovieDetail } from "@ui/screens/movie-detail/MovieDetail";
import type { ReactElement } from "react";

export const Route = createLazyRoute("/movie/$movieId")({ component: MovieDetailRoute });

function MovieDetailRoute(): ReactElement {
  const { movieId } = Route.useParams();
  return <MovieDetail movieId={Number(movieId)} />;
}
