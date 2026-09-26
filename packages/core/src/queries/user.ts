import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "../data/query-keys";
import type { CueRuntime } from "../runtime/runtime";
import { USER_STATE_STALE_TIME } from "./freshness";

export const userStatsQuery = (runtime: CueRuntime) =>
  queryOptions({
    queryKey: queryKeys.userStats(),
    queryFn: () => runtime.loadStats(),
    staleTime: USER_STATE_STALE_TIME,
  });

export const userProfileQuery = (runtime: CueRuntime) =>
  queryOptions({
    queryKey: queryKeys.userSettings(),
    queryFn: () => runtime.loadUserProfile(),
    staleTime: USER_STATE_STALE_TIME,
  });
