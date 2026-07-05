import { createLazyRoute } from "@tanstack/react-router";
import { EpisodeDetail } from "@ui/screens/episode-detail/EpisodeDetail";
import type { ReactElement } from "react";

export const Route = createLazyRoute("/show/$showId/episode/$season/$episode")({
  component: EpisodeDetailRoute,
});

function EpisodeDetailRoute(): ReactElement {
  const { showId, season, episode } = Route.useParams();
  return <EpisodeDetail showId={Number(showId)} season={Number(season)} number={Number(episode)} />;
}
