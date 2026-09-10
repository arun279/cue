import type { QueryClient } from "@tanstack/react-query";
import type { ActivitiesReconcile } from "../runtime/runtime";

/**
 * Apply one `/sync/last_activities` reconcile, shared by the background poll and
 * Settings' manual "Sync now": invalidate exactly the diffed keys, then advance
 * the persisted baseline ONLY after those queries refetched and none ended in
 * error. A failed refetch must be re-detected on the next pass rather than
 * silently skipped by an advanced snapshot. `isCancelled` lets an unmounting
 * caller abandon the commit so a torn-down session never advances the baseline.
 */
export async function applyReconcile(
  queryClient: QueryClient,
  reconcile: ActivitiesReconcile,
  isCancelled?: () => boolean,
): Promise<boolean> {
  if (reconcile.keys.length > 0) {
    await Promise.all(
      reconcile.keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
    if (isCancelled?.() === true) return false;
  }
  const anyError = reconcile.keys.some((queryKey) =>
    queryClient
      .getQueryCache()
      .findAll({ queryKey })
      .some((query) => query.state.status === "error"),
  );
  if (anyError) return false;
  await reconcile.commit();
  return true;
}
