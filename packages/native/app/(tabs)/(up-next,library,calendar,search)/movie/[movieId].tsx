import { useLocalSearchParams } from "expo-router";
import type { ReactElement } from "react";
import { parseId } from "../../../../src/route-params";
import { MovieDetail } from "../../../../src/screens/MovieDetail";
import NotFound from "../../../../src/screens/NotFound";

export default function MovieRoute(): ReactElement {
  const movieId = parseId(useLocalSearchParams<{ movieId: string }>().movieId);
  if (movieId === null) return <NotFound />;
  return <MovieDetail movieId={movieId} />;
}
