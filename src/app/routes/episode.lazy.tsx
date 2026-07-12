import { createLazyRoute } from "@tanstack/react-router";
import { EpisodeSheet } from "@ui/screens/episode-detail/EpisodeSheet";
import type { ReactElement } from "react";

export const Route = createLazyRoute("/show/$showId/episode/$season/$episode")({
  component: EpisodeSheetRoute,
});

/** The show page renders beneath via the parent route's Outlet; this leaf only
 * presents the sheet. */
function EpisodeSheetRoute(): ReactElement {
  const { showId, season, episode } = Route.useParams();
  return <EpisodeSheet showId={Number(showId)} season={Number(season)} number={Number(episode)} />;
}
