import { invalidateShowProgress } from "@data/query-invalidation";
import { queryKeys } from "@data/query-keys";
import {
  groupHistory,
  type HistoryDay,
  type HistoryEntry,
  historyRange,
  historyScopeKey,
} from "@domain/history";
import { localTimeZone } from "@domain/time";
import {
  buildMarkEpisodeOp,
  buildMarkMovieOp,
  buildRemoveHistoryPlayOp,
} from "@domain/write-queue/ops";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { queryStatus, USER_STATE_STALE_TIME } from "@ui/hooks/query-freshness";
import { useOptimisticWrite } from "@ui/hooks/useOptimisticWrite";
import { type HistorySection, type SubmitOutcome, useRuntime } from "@ui/runtime/runtime";
import { useCallback, useMemo, useRef, useState } from "react";

/** The history type filter, in user words; mapped to the history endpoint slice. */
export type HistoryFilter = "all" | "tv" | "movies";

/**
 * The full history read scope: which medium (type filter) and which decade window
 * (a year, or a month within it, or the unbounded recent feed when both are
 * undefined). The History screen derives this from the URL so every scope is
 * deep-linkable and scroll-restorable.
 */
export interface HistoryScope {
  readonly filter: HistoryFilter;
  readonly year?: number;
  readonly month?: number;
  readonly preview?: boolean;
}

const SECTION: Record<HistoryFilter, HistorySection> = {
  all: "all",
  tv: "episodes",
  movies: "movies",
};

/**
 * The transient snackbar after a per-play removal. `removed` offers the Undo;
 * `restored` confirms a best-effort re-add. The copy is deliberately honest: the
 * removal is exact (by history id), the restore is not forensic.
 */
type RemovalToast =
  | { readonly kind: "removed"; readonly entry: HistoryEntry }
  | { readonly kind: "restored" };

export interface HistoryView {
  readonly days: readonly HistoryDay[];
  readonly filter: HistoryFilter;
  readonly isLoading: boolean;
  readonly isError: boolean;
  /** True while a change-driven refetch is in flight: drives the sync pill. */
  readonly isFetching: boolean;
  /** Epoch ms of the last successful read, for the pill's recency. */
  readonly syncedAt: number;
  readonly hasData: boolean;
  readonly isEmpty: boolean;
  refetch(): void;
  readonly hasMore: boolean;
  readonly isLoadingMore: boolean;
  /** The most recent "Load earlier" page fetch failed (first-page data still shows). */
  readonly isLoadMoreError: boolean;
  loadEarlier(): void;
  removePlay(entry: HistoryEntry): Promise<void>;
  undo(): Promise<void>;
  readonly toast: RemovalToast | null;
  dismissToast(): void;
  readonly error: string | null;
  clearError(): void;
}

const withoutId = (set: ReadonlySet<number>, id: number): Set<number> => {
  const next = new Set(set);
  next.delete(id);
  return next;
};

/**
 * The Diary read + reversal hook. An infinite query over
 * `/users/me/history`: the FIRST page paints, then "Load earlier" walks one page
 * at a time (history is unbounded; a full walk is forbidden). Loaded pages are
 * flattened and grouped by the viewer's local day. A type filter [All · TV ·
 * Movies] re-scopes the feed server-side. Each row can remove its own exact play
 * via a real Trakt history id (never an item-scoped wipe), optimistically hidden
 * with an Undo that re-adds it best-effort. The query is `staleTime: Infinity`,
 * gated only by the last_activities poll, so a mark on any surface surfaces here.
 */
export function useHistory(scope: HistoryScope): HistoryView {
  const { filter, year, month, preview } = scope;
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const submit = useOptimisticWrite();
  // Optimistically-hidden plays (removed but not yet revalidated), so a removal
  // takes effect instantly and rolls back verbatim on a hard failure.
  const [removedIds, setRemovedIds] = useState<ReadonlySet<number>>(() => new Set());
  const [toast, setToast] = useState<RemovalToast | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The decade window (`start_at`/`end_at`): undefined for the unbounded recent
  // feed. A scoped read is finite, so "Load earlier" naturally runs out of pages.
  const range = useMemo(
    () => (year === undefined ? undefined : historyRange(year, month)),
    [year, month],
  );
  const scopeKey = preview === true ? "preview" : historyScopeKey(year, month);

  const query = useInfiniteQuery({
    queryKey: queryKeys.history(filter, scopeKey),
    queryFn: ({ pageParam }) => runtime.loadHistory(SECTION[filter], pageParam, range),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.pageCount ? last.page + 1 : undefined),
    staleTime: USER_STATE_STALE_TIME,
  });

  const days = useMemo<HistoryDay[]>(() => {
    const all = query.data?.pages.flatMap((page) => page.entries) ?? [];
    const visible = removedIds.size === 0 ? all : all.filter((e) => !removedIds.has(e.historyId));
    return groupHistory(visible, { now: Date.now(), timeZone: localTimeZone() });
  }, [query.data, removedIds]);

  // A removal or its Undo touches the Diary itself, the lifetime counts, and the
  // watched library (removing the last play un-watches the item).
  const revalidate = useCallback(
    (entry: HistoryEntry) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.historyPrefix() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.userStats() });
      if (entry.type === "movie") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.movieLibrary() });
        return;
      }
      // Episode play: also refresh the show's OWN detail reads: its header
      // (overall X/Y + next-up), its season tree (per-season counts + per-episode
      // ticks + watched dates), and that episode's detail. These live on separate
      // cache keys the last-activities gate never re-syncs for a local write, so
      // without this a Diary removal/undo leaves show detail reading pre-removal
      // progress until the content window lapses. `showProgressKeys` includes
      // `library()`, the Up Next aggregate.
      const episode =
        entry.season !== null && entry.number !== null
          ? { season: entry.season, number: entry.number }
          : undefined;
      invalidateShowProgress(queryClient, entry.mediaId, episode);
    },
    [queryClient],
  );

  // The in-flight remove per history id, so Undo can await the remove's OUTCOME
  // before deciding: a remove that hard-failed left the play on the server, so
  // re-adding it would DUPLICATE the play rather than restore it. Bounded by the
  // distinct plays removed in a session.
  const removeOutcomes = useRef(new Map<number, Promise<SubmitOutcome>>());

  const removePlay = useCallback(
    async (entry: HistoryEntry) => {
      setError(null);
      setRemovedIds((prev) => new Set(prev).add(entry.historyId));
      // Confirmation + Undo at the point of action, mounted synchronously with the
      // optimistic hide: the durable removal settles behind it.
      setToast({ kind: "removed", entry });
      const op = buildRemoveHistoryPlayOp({
        opId: crypto.randomUUID(),
        ids: [entry.historyId],
        restore: {
          section: entry.type === "movie" ? "movies" : "episodes",
          ids: entry.ids,
          watchedAt: entry.watchedAt,
        },
      });
      const settled = submit([op], {
        rollback: () => setRemovedIds((prev) => withoutId(prev, entry.historyId)),
        revalidate: () => revalidate(entry),
      });
      removeOutcomes.current.set(entry.historyId, settled);
      const outcome = await settled;
      if (outcome === "failed") {
        // The remove hard-failed: the play is still on the server. `rollback`
        // already un-hid the row; drop the now-meaningless Undo toast and say so.
        setToast((cur) =>
          cur?.kind === "removed" && cur.entry.historyId === entry.historyId ? null : cur,
        );
        setError("Couldn't remove that play. Please try again.");
      }
    },
    [submit, revalidate],
  );

  const undo = useCallback(async () => {
    const cur = toast;
    if (cur === null || cur.kind !== "removed") return;
    const { entry } = cur;
    // Wait for the remove to actually settle before restoring. If it hard-failed,
    // the play was NEVER deleted: re-adding it would duplicate the play (the
    // exact history loss the user is fanatical about). So enqueue no restore; just
    // re-show the row and drop the toast (removePlay already surfaces the error).
    const removeOutcome = await removeOutcomes.current.get(entry.historyId);
    if (removeOutcome === "failed") {
      setRemovedIds((prev) => withoutId(prev, entry.historyId));
      setToast((c) => (c?.kind === "removed" && c.entry.historyId === entry.historyId ? null : c));
      return;
    }
    // The remove landed (or is durably queued): un-hide optimistically and re-add
    // the play best-effort (a fresh mark op: Trakt may mint a new history id).
    setRemovedIds((prev) => withoutId(prev, entry.historyId));
    setToast(null);
    const op =
      entry.type === "movie"
        ? buildMarkMovieOp({
            opId: crypto.randomUUID(),
            ids: entry.ids,
            watchedAt: entry.watchedAt,
          })
        : buildMarkEpisodeOp({
            opId: crypto.randomUUID(),
            ids: entry.ids,
            watchedAt: entry.watchedAt,
          });
    const outcome = await submit([op], {
      // The re-add hard-failed: the play IS gone on the server, so re-hide the row
      // rather than leave a phantom that vanishes on the next refetch.
      rollback: () => setRemovedIds((prev) => new Set(prev).add(entry.historyId)),
      revalidate: () => revalidate(entry),
    });
    if (outcome === "failed") {
      setError("Couldn't restore that play. Please try again.");
      return;
    }
    // Only now, on a KEPT restore (landed or durably queued), claim it restored.
    setToast({ kind: "restored" });
  }, [toast, submit, revalidate]);

  const entryCount = query.data?.pages.reduce((n, page) => n + page.entries.length, 0) ?? 0;

  // Stable identities: the History screen re-arms its infinite-scroll observer
  // and both consumers re-run their snackbar effect on these, so a fresh closure
  // per render would churn the observer and reset the snack timer on every render.
  const { refetch: queryRefetch, fetchNextPage } = query;
  const refetch = useCallback(() => void queryRefetch(), [queryRefetch]);
  const loadEarlier = useCallback(() => void fetchNextPage(), [fetchNextPage]);
  const dismissToast = useCallback(() => setToast(null), []);
  const clearError = useCallback(() => setError(null), []);

  return {
    days,
    filter,
    ...queryStatus(query, query.data !== undefined),
    isEmpty: query.data !== undefined && entryCount === 0,
    refetch,
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    isLoadMoreError: query.isFetchNextPageError,
    loadEarlier,
    removePlay,
    undo,
    toast,
    dismissToast,
    error,
    clearError,
  };
}
