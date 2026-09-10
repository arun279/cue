import { useQuery } from "@tanstack/react-query";
import { EMPTY_SHOW_ART, type ShowArt, selectArt, showInfoQuery } from "../queries/shows";
import { useRuntime } from "../runtime/runtime";

export type { ShowArt };

/**
 * Deferred per-card show art. The bounded cold-sync read paints the queue and
 * buckets WITHOUT a per-show `/shows/:id` art fan-out; a card instead reads its
 * own poster and backdrop once `enabled` says it has settled on screen. Each app
 * decides what settling means, because the two have nothing in common: the
 * browser watches an `IntersectionObserver` and a virtualized native list
 * unmounts a row the reader scrolls past.
 *
 * The art is a slice of the shared `showInfo` entity, the SAME cache entry the
 * Show detail hero reads, so the two never fetch `/shows/:id` twice: a card that
 * already resolved hands its show's facts to the detail screen, and a show
 * opened from Search paints its card with no read at all. Empty lists (not yet
 * resolved, or a show with no art) fall through to the designed placeholder.
 */
export function useShowArt(showId: number, enabled: boolean): ShowArt {
  const runtime = useRuntime();
  const query = useQuery({ ...showInfoQuery(runtime, showId), enabled, select: selectArt });
  return query.data ?? EMPTY_SHOW_ART;
}
