import { epCode } from "@cue/core/domain/model/library";
import { useEpisode } from "@cue/core/hooks/useEpisode";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { TEST_IDS } from "../ui/test-ids";

export interface EpisodeSheetProps {
  readonly showId: number;
  readonly season: number;
  readonly episode: number;
}

/** The episode sheet's content. The presentation, the detents and the physics
 * are the stack's, declared once in the shared tab layout. */
export function EpisodeSheet({ showId, season, episode }: EpisodeSheetProps): ReactElement {
  const { episode: detail, isLoading } = useEpisode(showId, season, episode);

  if (isLoading || detail === undefined) {
    return <Text testID={TEST_IDS.episodeSkeleton}>Loading…</Text>;
  }

  return (
    <View testID={TEST_IDS.screenEpisode}>
      <Text accessibilityRole="header">{detail.title ?? epCode(season, episode)}</Text>
      <Text testID={TEST_IDS.episodeCode}>{epCode(detail.season, detail.number)}</Text>
      <Text testID={TEST_IDS.episodeWatched}>{detail.watched ? "Watched" : "Not watched"}</Text>
    </View>
  );
}
