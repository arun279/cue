import { queryStatus } from "@cue/core/queries/freshness";
import { movieHeaderQuery } from "@cue/core/queries/movies";
import { useRuntime } from "@cue/core/runtime/runtime";
import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { TEST_IDS } from "../ui/test-ids";

/** Movie detail: the hero facts, over the shared read. */
export function MovieDetail({ movieId }: { readonly movieId: number }): ReactElement {
  const runtime = useRuntime();
  const query = useQuery(movieHeaderQuery(runtime, movieId));
  const header = query.data;
  const { isLoading } = queryStatus(query, header !== undefined);

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
