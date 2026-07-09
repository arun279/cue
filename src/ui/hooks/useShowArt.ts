import { queryKeys } from "@data/query-keys";
import { useQuery } from "@tanstack/react-query";
import { CONTENT_STALE_TIME_MS } from "@ui/hooks/query-freshness";
import { useRuntime } from "@ui/runtime/runtime";

/**
 * Deferred per-card show art. The bounded cold-sync read paints the
 * queue and buckets WITHOUT a per-show `/shows/:id` art fan-out; a show row instead
 * lazily fetches its own poster/backdrop here as it renders. Because My Shows is
 * window-virtualized and Up Next is a small queue, only cards actually in the DOM
 * fire this — art loads per visible row, not for every library show up front.
 *
 * Returns the Trakt inline poster URLs to hand to `<Poster>`; an empty list (not
 * yet resolved, or a show with no art) falls through to the designed placeholder
 * tile. Cached by trakt id at the content horizon, so revisiting a row — or seeing
 * the same show in both Up Next and My Shows — never refetches.
 */
export function useShowArt(showId: number): readonly string[] {
  const runtime = useRuntime();
  const query = useQuery({
    queryKey: queryKeys.showArt(showId),
    queryFn: () => runtime.loadShowArt(showId),
    staleTime: CONTENT_STALE_TIME_MS,
  });
  return query.data?.posters ?? [];
}
