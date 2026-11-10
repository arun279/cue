import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { updateId } from "expo-updates";
import {
  createQueryCachePolicy,
  restorableCache,
  writeQueryCache,
} from "@/core/runtime/query-cache";
import { nativeAppVersion } from "./app-version";
import { createAppQueryClient } from "./query-client";
import { bulkStorage } from "./stores";

export const queryClient = createAppQueryClient();

export const { shouldDehydrateQuery } = createQueryCachePolicy(queryClient);

const CACHE_KEY = "cue.query-cache";

export const queryPersister = createAsyncStoragePersister({
  key: CACHE_KEY,
  storage: bulkStorage,
  serialize: (client) => JSON.stringify(restorableCache(client)),
});

// A persisted cache restores only into the build or update that wrote it.
// https://tanstack.com/query/v5/docs/framework/react/plugins/persistQueryClient#cache-busting
export const persistBuster = updateId ?? nativeAppVersion;

/** The persister waits up to a second between saves; this one saves now. */
export const saveQueryCache = (): Promise<void> =>
  writeQueryCache(queryClient, bulkStorage, CACHE_KEY, persistBuster);

export const clearPersistedCaches = async (): Promise<void> => {
  queryClient.clear();
  await queryPersister.removeClient();
};
