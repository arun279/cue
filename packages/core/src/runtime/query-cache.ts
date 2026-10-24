import {
  QueryClient as Client,
  type DehydratedState,
  type Query,
  type QueryClient,
} from "@tanstack/react-query";
import { queryKeys } from "../data/query-keys";
import { DEFAULT_TRAKT_POLICY, type TraktPolicy } from "../data/trakt/policy";
import { backoffMs } from "../domain/write-queue/classify";
import { shouldRetryRead } from "../sync-contract";
import { PERSISTED_CACHE } from "./persist-buster";

export const PERSIST_BUSTER = PERSISTED_CACHE.buster;

const PERSISTED_KEY_HEADS: ReadonlySet<unknown> = new Set([
  "library",
  "movie-library",
  "watchlist",
  "users",
  "history",
  "calendar",
  "genres",
]);

export const PERSIST_MAX_AGE = Number.POSITIVE_INFINITY;

export function createQueryClient(policy: TraktPolicy = DEFAULT_TRAKT_POLICY): QueryClient {
  return new Client({
    defaultOptions: {
      queries: {
        gcTime: PERSIST_MAX_AGE,
        staleTime: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: (failureCount, error) => shouldRetryRead(failureCount, error, policy.readAttempts),
        retryDelay: (attempt) => backoffMs(attempt, policy.retryDelayMs),
      },
    },
  });
}

export function createQueryCachePolicy(queryClient: QueryClient): {
  shouldDehydrateQuery(query: Query): boolean;
} {
  const paintsALibraryCard = (showId: unknown): boolean => {
    const library = queryClient.getQueryData<{
      readonly entries: readonly { readonly showId: number }[];
    }>(queryKeys.library());
    return library?.entries.some((entry) => entry.showId === showId) ?? false;
  };

  return {
    shouldDehydrateQuery(query) {
      if (query.state.data === undefined) return false;
      const [head, section, showId] = query.queryKey;
      if (head !== "show") return PERSISTED_KEY_HEADS.has(head);
      // A season tree only while a screen uses it: Up Next placing a card, or an open detail.
      const kept = section === "info" || (section === "seasons" && query.getObserversCount() > 0);
      return kept && paintsALibraryCard(showId);
    },
  };
}

export function restorableCache<T extends { readonly clientState: DehydratedState }>(client: T): T {
  return {
    ...client,
    clientState: {
      ...client.clientState,
      queries: client.clientState.queries.map((query) =>
        query.state.status === "error"
          ? {
              ...query,
              state: {
                ...query.state,
                status: "success",
                error: null,
                fetchFailureCount: 0,
                fetchFailureReason: null,
              },
            }
          : query,
      ),
    },
  };
}
