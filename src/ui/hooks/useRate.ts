import { queryKeys } from "@data/query-keys";
import type { EpisodeIds, MovieIds, ShowIds } from "@domain/model/ids";
import { buildRateOp, buildUnrateOp, type RateSection } from "@domain/write-queue/ops";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type RatingMap, useRuntime } from "@ui/runtime/runtime";
import { useCallback, useState } from "react";

type RateIds = ShowIds | EpisodeIds | MovieIds;

export interface RateController {
  ratingFor(trakt: number): number | null;
  rate(ids: RateIds, value: number): Promise<void>;
  clearRating(ids: RateIds): Promise<void>;
  clearError(): void;
  readonly error: string | null;
  /** The existing-ratings read is still in flight; the control locks until it resolves. */
  readonly isLoading: boolean;
  /** The existing-ratings read failed; a prior rating may be present but unknown. */
  readonly isError: boolean;
}

/**
 * The 1–10 rating control's data: reads the section's current ratings and
 * writes optimistically through the durable queue. Setting a rating patches the
 * cache instantly, then enqueues `POST /sync/ratings`; clearing enqueues
 * `.../remove` whose inverse restores the prior value. A re-rate coalesces on the
 * op's `itemKey`, so only the last value is sent. A hard failure rolls back.
 */
export function useRate(section: RateSection): RateController {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const key = queryKeys.ratings(section);
  const query = useQuery({ queryKey: key, queryFn: () => runtime.loadRatings(section) });
  const [error, setError] = useState<string | null>(null);

  const patch = useCallback(
    (trakt: number, value: number | null) => {
      queryClient.setQueryData<RatingMap>(key, (old) => {
        const next: Record<number, number> = { ...(old ?? {}) };
        if (value === null) delete next[trakt];
        else next[trakt] = value;
        return next;
      });
    },
    [queryClient, key],
  );

  const rate = useCallback(
    async (ids: RateIds, value: number) => {
      // Cancel in-flight reads so a settling background refetch can't clobber the
      // optimistic patch; forward `before` so an Undo of a re-rate restores it.
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<RatingMap>(key)?.[ids.trakt] ?? null;
      patch(ids.trakt, value);
      const outcome = await runtime.submit(
        buildRateOp({
          opId: crypto.randomUUID(),
          section,
          ids,
          rating: value,
          previousRating: before,
        }),
      );
      if (outcome === "failed") {
        patch(ids.trakt, before);
        setError("Couldn't save your rating. Please try again.");
        return;
      }
      // Only revalidate once the write is applied on Trakt; a still-queued op would
      // otherwise refetch stale server data over the optimistic value.
      if (outcome === "done") void queryClient.invalidateQueries({ queryKey: key });
    },
    [queryClient, key, patch, runtime, section],
  );

  const clearRating = useCallback(
    async (ids: RateIds) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<RatingMap>(key)?.[ids.trakt];
      if (before === undefined) return;
      patch(ids.trakt, null);
      const outcome = await runtime.submit(
        buildUnrateOp({ opId: crypto.randomUUID(), section, ids, previousRating: before }),
      );
      if (outcome === "failed") {
        patch(ids.trakt, before);
        setError("Couldn't remove your rating. Please try again.");
        return;
      }
      if (outcome === "done") void queryClient.invalidateQueries({ queryKey: key });
    },
    [queryClient, key, patch, runtime, section],
  );

  return {
    ratingFor: (trakt) => query.data?.[trakt] ?? null,
    rate,
    clearRating,
    clearError: () => setError(null),
    error,
    isLoading: query.isPending,
    isError: query.isError,
  };
}
