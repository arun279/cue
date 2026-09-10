import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "../data/query-keys";
import type { CueRuntime } from "../runtime/runtime";

const SEARCH_TYPES = "show,movie";

export const searchQuery = (runtime: CueRuntime, query: string) =>
  queryOptions({
    queryKey: queryKeys.search(query, SEARCH_TYPES),
    queryFn: () => runtime.search(query),
  });
