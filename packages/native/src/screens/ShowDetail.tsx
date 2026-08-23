import { epCode } from "@cue/core/domain/model/library";
import { useSeasons } from "@cue/core/hooks/useSeasons";
import { useShowDetail } from "@cue/core/hooks/useShowDetail";
import { Link } from "expo-router";
import type { ReactElement } from "react";
import { FlatList, Text, View } from "react-native";

/** Show detail: the hero facts, the viewer's progress, and the season stream. */
export function ShowDetail({ showId }: { readonly showId: number }): ReactElement {
  const { header, isLoading } = useShowDetail(showId);
  const seasons = useSeasons(showId);

  if (isLoading || header === undefined) {
    return <Text testID="show-detail-skeleton">Loading…</Text>;
  }

  return (
    <View testID="screen-show-detail">
      <Text accessibilityRole="header">{header.title}</Text>
      <Text testID="show-progress">{`${header.completed} of ${header.aired} watched`}</Text>
      <FlatList
        testID="season-list"
        data={seasons.seasons}
        keyExtractor={(season) => String(season.number)}
        renderItem={({ item: season }) => (
          <View testID="season-row">
            <Text>{`Season ${season.number}`}</Text>
            {season.episodes.map((episode) => (
              <Link
                key={episode.ids.trakt}
                href={`/show/${showId}/episode/${season.number}/${episode.number}`}
                testID="episode-row"
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
