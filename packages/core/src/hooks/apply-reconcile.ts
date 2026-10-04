import type { QueryClient } from "@tanstack/react-query";
import type { ActivitiesReconcile } from "../runtime/runtime";

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
