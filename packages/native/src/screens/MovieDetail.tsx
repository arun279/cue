import { useMovieDetail } from "@cue/core/hooks/useMovieDetail";
import type { ReactElement } from "react";
import { Text, View } from "react-native";

/** Movie detail: the hero facts, over the shared read. */
export function MovieDetail({ movieId }: { readonly movieId: number }): ReactElement {
  const { header, isLoading } = useMovieDetail(movieId);

  if (isLoading || header === undefined) {
    return <Text testID="movie-detail-skeleton">Loading…</Text>;
  }

  return (
    <View testID="screen-movie-detail">
      <Text accessibilityRole="header">{header.title}</Text>
      {header.year !== null && <Text testID="movie-year">{header.year}</Text>}
    </View>
  );
}
