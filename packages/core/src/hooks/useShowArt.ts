import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../data/query-keys";
import type { ShowInfo } from "../data/trakt/show-detail";
import { useRuntime } from "../runtime/runtime";
import { CONTENT_STALE_TIME_MS } from "./query-freshness";

export interface ShowArt {
  readonly posters: readonly string[];
  readonly backdrops: readonly string[];
}

const EMPTY: ShowArt = { posters: [], backdrops: [] };

/** Module-level so TanStack can memoize the slice instead of re-deriving it per render. */
const selectArt = (info: ShowInfo): ShowArt => ({
  posters: info.posters,
  backdrops: info.backdrops,
});

/**
 * How long a card must hold still on screen before it is worth a GET. A card
 * flicked past crosses the viewport in well under this, so a scroll spends
 * nothing; a card the reader stops on resolves right after the scroll settles.
 */
export const ART_SETTLE_MS = 250;

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
  const query = useQuery({
    queryKey: queryKeys.showInfo(showId),
    queryFn: () => runtime.loadShowInfo(showId),
    staleTime: CONTENT_STALE_TIME_MS,
    enabled,
    select: selectArt,
  });
  return query.data ?? EMPTY;
}
