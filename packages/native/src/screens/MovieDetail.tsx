import { useMovieDetail } from "@cue/core/hooks/useMovieDetail";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { TEST_IDS } from "../ui/test-ids";

/** Movie detail: the hero facts, over the shared read. */
export function MovieDetail({ movieId }: { readonly movieId: number }): ReactElement {
  const { header, isLoading } = useMovieDetail(movieId);

  if (isLoading || header === undefined) {
    return <Text testID={TEST_IDS.movieDetailSkeleton}>Loading…</Text>;
  }

  return (
    <View testID={TEST_IDS.screenMovieDetail}>
      <Text accessibilityRole="header">{header.title}</Text>
      {header.year !== null && <Text testID={TEST_IDS.movieYear}>{header.year}</Text>}
    </View>
  );
}
