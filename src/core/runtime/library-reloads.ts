import { hashKey, type QueryClient } from "@tanstack/react-query";
import { invalidateChangedShows } from "../data/query-invalidation";
import { queryKeys } from "../data/query-keys";
import type { EpisodeDetail } from "../data/trakt/episode-detail";
import type { SeasonView } from "../data/trakt/show-detail";
import { historyTargetsOf } from "../domain/write-queue/ops";
import type { QueuedOp } from "../domain/write-queue/types";
import type { UpNextData } from "./runtime";

const LIBRARY = hashKey(queryKeys.library());

/** Shows with one of `episodes` in a cached season tree or episode page. */
function showsHolding(qc: QueryClient, episodes: ReadonlySet<number>): number[] {
  const trees = qc
    .getQueriesData<readonly SeasonView[]>({ queryKey: queryKeys.showSection("seasons") })
    .map(([key, tree]) => [key[2], tree?.flatMap((season) => season.episodes) ?? []] as const);
  const pages = qc
    .getQueriesData<EpisodeDetail>({ queryKey: queryKeys.showSection("episode") })
    .map(([key, page]) => [key[2], page?.ids === undefined ? [] : [page]] as const);
  return [...trees, ...pages].flatMap(([showId, held]) =>
    typeof showId === "number" && held.some(({ ids }) => episodes.has(ids.trakt)) ? [showId] : [],
  );
}

/** Shows a queued or in-flight write names, directly or through an episode cached under them. */
function writtenShowIds(qc: QueryClient, ops: readonly QueuedOp[]): ReadonlySet<number> {
  const targets = ops.map(historyTargetsOf);
  const episodes = new Set(targets.flatMap((target) => target.episodes));
  return new Set([
    ...targets.flatMap((target) => target.shows),
    ...(episodes.size === 0 ? [] : showsHolding(qc, episodes)),
  ]);
}

/**
 * Each library reload refreshes the watched state of the shows it finds changed against the
 * library it replaces. A show with a write still on its way is left to that write's own refresh.
 */
export function refreshChangedShows(
  qc: QueryClient,
  pendingOps: () => readonly QueuedOp[],
): () => void {
  const entries = () => qc.getQueryData<UpNextData>(queryKeys.library())?.entries;
  let previous = entries();
  return qc.getQueryCache().subscribe((event) => {
    if (event.query.queryHash !== LIBRARY || (event.type !== "updated" && event.type !== "added"))
      return;
    const current = entries();
    if (event.type === "updated" && event.action.type === "success" && !event.action.manual) {
      invalidateChangedShows(qc, previous, current ?? [], writtenShowIds(qc, pendingOps()));
    }
    previous = current;
  });
}
