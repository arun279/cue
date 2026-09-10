import { epCode } from "@cue/core/domain/model/library";
import { combineStatus } from "@cue/core/queries/freshness";
import { showInfoQuery, showProgressQuery, showSeasonsQuery } from "@cue/core/queries/shows";
import { useRuntime } from "@cue/core/runtime/runtime";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import type { ReactElement } from "react";
import { FlatList, Text, View } from "react-native";
import { TEST_IDS } from "../ui/test-ids";

/** Show detail: the hero facts, the viewer's progress, and the season stream. */
export function ShowDetail({ showId }: { readonly showId: number }): ReactElement {
  const runtime = useRuntime();
  const { header, isLoading } = useQueries({
    queries: [showInfoQuery(runtime, showId), showProgressQuery(runtime, showId)],
    combine: ([info, progress]) => {
      const header =
        info.data === undefined || progress.data === undefined
          ? undefined
          : { ...info.data, ...progress.data };
      return { header, ...combineStatus([info, progress], header !== undefined) };
    },
  });
  const seasons = useQuery(showSeasonsQuery(runtime, showId));

  if (isLoading || header === undefined) {
    return <Text testID={TEST_IDS.showDetailSkeleton}>Loading…</Text>;
  }

  return (
    <View testID={TEST_IDS.screenShowDetail}>
      <Text accessibilityRole="header">{header.title}</Text>
      <Text testID={TEST_IDS.showProgress}>{`${header.completed} of ${header.aired} watched`}</Text>
      <FlatList
        testID={TEST_IDS.seasonList}
        data={seasons.data ?? []}
        keyExtractor={(season) => String(season.number)}
        renderItem={({ item: season }) => (
          <View testID={TEST_IDS.seasonRow(season.number)}>
            <Text>{`Season ${season.number}`}</Text>
            {season.episodes.map((episode) => (
              <Link
                key={episode.ids.trakt}
                href={`/show/${showId}/episode/${season.number}/${episode.number}`}
                testID={TEST_IDS.episodeRow(episode.ids.trakt)}
              >
                {epCode(season.number, episode.number)}
              </Link>
            ))}
          </View>
        )}
      />
    </View>
  );
}
