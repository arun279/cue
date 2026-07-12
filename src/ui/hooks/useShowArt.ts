import { queryKeys } from "@data/query-keys";
import { useQuery } from "@tanstack/react-query";
import { CONTENT_STALE_TIME_MS } from "@ui/hooks/query-freshness";
import { useRuntime } from "@ui/runtime/runtime";

export interface ShowArtSlice {
  readonly posters: readonly string[];
  readonly backdrops: readonly string[];
}

const EMPTY: ShowArtSlice = { posters: [], backdrops: [] };

/**
 * Deferred per-card show art. The bounded cold-sync read paints the
 * queue and buckets WITHOUT a per-show `/shows/:id` art fan-out; a show row instead
 * lazily fetches its own poster/backdrop here as it renders. Because Library is
 * window-virtualized and Up Next is a small queue, only cards actually in the DOM
 * fire this: art loads per visible row, not for every library show up front.
 *
 * Returns the Trakt inline poster + backdrop candidates for the image resolvers;
 * empty lists (not yet resolved, or a show with no art) fall through to the
 * designed placeholder. Cached by trakt id at the content horizon, so revisiting
 * a row or seeing the same show on two surfaces never refetches.
 */
export function useShowArt(showId: number): ShowArtSlice {
  const runtime = useRuntime();
  const query = useQuery({
    queryKey: queryKeys.showArt(showId),
    queryFn: () => runtime.loadShowArt(showId),
    staleTime: CONTENT_STALE_TIME_MS,
  });
  return query.data ?? EMPTY;
}
