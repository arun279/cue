import { epCode } from "@cue/core/domain/model/library";
import { useSeasons } from "@cue/core/hooks/useSeasons";
import { useShowDetail } from "@cue/core/hooks/useShowDetail";
import { Link } from "expo-router";
import type { ReactElement } from "react";
import { FlatList, Text, View } from "react-native";
import { TEST_IDS } from "../ui/test-ids";

/** Show detail: the hero facts, the viewer's progress, and the season stream. */
export function ShowDetail({ showId }: { readonly showId: number }): ReactElement {
  const { header, isLoading } = useShowDetail(showId);
  const seasons = useSeasons(showId);

  if (isLoading || header === undefined) {
    return <Text testID={TEST_IDS.showDetailSkeleton}>Loading…</Text>;
  }

  return (
    <View testID={TEST_IDS.screenShowDetail}>
      <Text accessibilityRole="header">{header.title}</Text>
      <Text testID={TEST_IDS.showProgress}>{`${header.completed} of ${header.aired} watched`}</Text>
      <FlatList
        testID={TEST_IDS.seasonList}
        data={seasons.seasons}
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
