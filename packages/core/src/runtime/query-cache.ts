import {
  QueryClient as Client,
  type DehydratedState,
  partialMatchKey,
  type Query,
  type QueryClient,
} from "@tanstack/react-query";
import { queryKeys } from "../data/query-keys";
import { DEFAULT_TRAKT_POLICY, type TraktPolicy } from "../data/trakt/policy";
import { backoffMs } from "../domain/write-queue/classify";
import { shouldRetryRead } from "../sync-contract";

// The reads a cold boot paints from, kept in memory for as long as they are persisted.
const BOOT_KEYS = [
  queryKeys.library(),
  queryKeys.movieLibrary(),
  queryKeys.movieWatchlist(),
  queryKeys.userSettings(),
  queryKeys.genres(),
  queryKeys.firstPlay(),
  queryKeys.history("all"),
  queryKeys.history("tv"),
  queryKeys.history("movies"),
  queryKeys.showSection("info"),
];

export const PERSIST_MAX_AGE = Number.POSITIVE_INFINITY;

export function createQueryClient(policy: TraktPolicy = DEFAULT_TRAKT_POLICY): QueryClient {
  const client = new Client({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: (failureCount, error) => shouldRetryRead(failureCount, error, policy.readAttempts),
        retryDelay: (attempt) => backoffMs(attempt, policy.retryDelayMs),
      },
    },
  });
  for (const queryKey of BOOT_KEYS) client.setQueryDefaults(queryKey, { gcTime: PERSIST_MAX_AGE });
  return client;
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
  // Calendar windows start on the current day, so only the newest window of each length is read again.
  const isNewestWindow = (start: unknown, days: unknown): boolean =>
    queryClient
      .getQueryCache()
      .findAll({ queryKey: ["calendar"] })
      .every(({ queryKey }) => queryKey[3] !== days || String(queryKey[2]) <= String(start));

  return {
    shouldDehydrateQuery(query) {
      if (query.state.data === undefined) return false;
      const [head, section, id, days] = query.queryKey;
      if (head === "calendar") return isNewestWindow(id, days);
      if (head !== "show") return BOOT_KEYS.some((key) => partialMatchKey(query.queryKey, key));
      // A season tree only while a screen uses it: Up Next placing a card, or an open detail.
      const kept = section === "info" || (section === "seasons" && query.getObserversCount() > 0);
      return kept && paintsALibraryCard(id);
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
