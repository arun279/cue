import { createQueryCachePolicy, createQueryClient } from "@cue/core/runtime/query-cache";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import Storage from "expo-sqlite/kv-store";

export const queryClient = createQueryClient();

export const { shouldDehydrateQuery } = createQueryCachePolicy(queryClient);

/**
 * The same persister the web build uses, over the bulk store instead of
 * idb-keyval. Its `storage` argument wants `getItem`, `setItem` and `removeItem`
 * returning a value or a promise, which is exactly what `expo-sqlite/kv-store`
 * is.
 */
export const queryPersister = createAsyncStoragePersister({
  key: "cue.query-cache",
  storage: Storage,
});

/** The one teardown dependency the runtime takes, in place of both objects. */
export const clearPersistedCaches = async (): Promise<void> => {
  queryClient.clear();
  await queryPersister.removeClient();
};
