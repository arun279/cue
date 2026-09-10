import { Redirect, useLocalSearchParams } from "expo-router";
import type { ReactElement } from "react";
import { parseId } from "../../../../src/route-params";
import { MovieDetail } from "../../../../src/screens/MovieDetail";

export default function MovieRoute(): ReactElement {
  const movieId = parseId(useLocalSearchParams<{ movieId: string }>().movieId);
  if (movieId === null) return <Redirect href="/+not-found" />;
  return <MovieDetail movieId={movieId} />;
}
