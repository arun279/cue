import { infiniteQueryOptions } from "@tanstack/react-query";
import { queryKeys } from "../data/query-keys";
import type { HistoryRange } from "../domain/history";
import type { CueRuntime, HistorySection } from "../runtime/runtime";
import { USER_STATE_STALE_TIME } from "./freshness";

export type HistoryFilter = "all" | "tv" | "movies";

const SECTION: Record<HistoryFilter, HistorySection> = {
  all: "all",
  tv: "episodes",
  movies: "movies",
};

export const historyQuery = (
  runtime: CueRuntime,
  filter: HistoryFilter,
  scope: string,
  range?: HistoryRange,
) =>
  infiniteQueryOptions({
    queryKey: queryKeys.history(filter, scope),
    queryFn: ({ pageParam }) => runtime.loadHistory(SECTION[filter], pageParam, range),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.pageCount ? last.page + 1 : undefined),
    staleTime: USER_STATE_STALE_TIME,
  });
