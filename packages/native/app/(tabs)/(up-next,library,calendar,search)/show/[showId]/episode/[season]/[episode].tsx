import { Redirect, useLocalSearchParams } from "expo-router";
import type { ReactElement } from "react";
import { parseId } from "../../../../../../../src/route-params";
import { EpisodeSheet } from "../../../../../../../src/screens/EpisodeSheet";

export default function EpisodeRoute(): ReactElement {
  const params = useLocalSearchParams<{ showId: string; season: string; episode: string }>();
  const showId = parseId(params.showId);
  const season = parseId(params.season);
  const episode = parseId(params.episode);
  if (showId === null || season === null || episode === null) {
    return <Redirect href="/+not-found" />;
  }
  return <EpisodeSheet showId={showId} season={season} episode={episode} />;
}
