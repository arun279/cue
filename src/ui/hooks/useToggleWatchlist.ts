import { queryKeys } from "@data/query-keys";
import type { ShowIds } from "@domain/model/ids";
import { buildAddWatchlistOp, buildRemoveWatchlistOp } from "@domain/write-queue/ops";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { patchLibraryEntry } from "@ui/hooks/library-cache";
import { USER_STATE_STALE_TIME } from "@ui/hooks/query-freshness";
import { useTrackedSubmit } from "@ui/hooks/useOptimisticWrite";
import { useRuntime } from "@ui/runtime/runtime";
import { useCallback, useState } from "react";

export interface WatchlistController {
  isOnWatchlist(showId: number): boolean;
  toggle(ids: ShowIds): Promise<void>;
  clearError(): void;
  readonly error: string | null;
  /** The membership read is still in flight; the toggle locks until it resolves. */
  readonly isLoading: boolean;
  /** The membership read failed; current membership is unknown. */
  readonly isError: boolean;
}

/**
 * The show watchlist toggle. Add/remove writes `POST /sync/watchlist`(+
 * remove) through the durable queue, optimistically flipping both the watchlist
 * membership cache and the library entry's `inWatchlist` flag so the My Shows
 * "To watch" bucket updates instantly (a not-yet-started watchlisted show buckets
 * as To watch). A hard failure rolls both back.
 */
export function useToggleWatchlist(): WatchlistController {
  const runtime = useRuntime();
  const submit = useTrackedSubmit();
  const queryClient = useQueryClient();
  const key = queryKeys.watchlist("shows");
  const query = useQuery({
    queryKey: key,
    queryFn: () => runtime.loadWatchlistIds("shows"),
    staleTime: USER_STATE_STALE_TIME,
  });
  const [error, setError] = useState<string | null>(null);

  const patch = useCallback(
    (showId: number, onWatchlist: boolean) => {
      queryClient.setQueryData<readonly number[]>(key, (old) => {
        const set = new Set(old ?? []);
        if (onWatchlist) set.add(showId);
        else set.delete(showId);
        return [...set];
      });
      patchLibraryEntry(queryClient, showId, (entry) => ({ ...entry, inWatchlist: onWatchlist }));
    },
    [queryClient, key],
  );

  const toggle = useCallback(
    async (ids: ShowIds) => {
      const showId = ids.trakt;
      // Cancel in-flight reads so a settling membership refetch can't clobber the flip.
      await queryClient.cancelQueries({ queryKey: key });
      const onNow = (query.data ?? []).includes(showId);
      const next = !onNow;
      patch(showId, next);
      const op = next
        ? buildAddWatchlistOp({ opId: crypto.randomUUID(), section: "shows", ids })
        : buildRemoveWatchlistOp({ opId: crypto.randomUUID(), section: "shows", ids });
      const outcome = await submit(op);
      if (outcome === "failed") {
        patch(showId, onNow);
        setError("Couldn't update your watchlist. Please try again.");
        return;
      }
      // Revalidate only once the write landed; the library re-read then materializes
      // a watchlist-only show into the To-watch bucket. A still-queued op would
      // instead refetch pre-write membership over the optimistic flip.
      if (outcome === "done") {
        void queryClient.invalidateQueries({ queryKey: key });
        void queryClient.invalidateQueries({ queryKey: queryKeys.library() });
      }
    },
    [queryClient, key, patch, query.data, submit],
  );

  return {
    isOnWatchlist: (showId) => (query.data ?? []).includes(showId),
    toggle,
    clearError: () => setError(null),
    error,
    isLoading: query.isPending,
    isError: query.isError,
  };
}
