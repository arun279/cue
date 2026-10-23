import type { QueryClient } from "@tanstack/react-query";
import type { ActivitiesReconcile } from "../runtime/runtime";

/** Activity stamps only move when Trakt data changes, so a read that failed is fetched again
 * whenever Trakt answers a poll, rather than waiting for its data to change. */
export function refetchFailedReads(queryClient: QueryClient): Promise<void> {
  return queryClient.refetchQueries({
    type: "active",
    predicate: (query) => query.state.status === "error" && query.state.fetchStatus === "idle",
  });
}

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
  const refreshed = reconcile.keys.every((queryKey) =>
    queryClient
      .getQueryCache()
      .findAll({ queryKey, type: "active" })
      .every((query) => query.state.status === "success" && query.state.fetchStatus === "idle"),
  );
  if (!refreshed) return false;
  await reconcile.commit();
  return true;
}
