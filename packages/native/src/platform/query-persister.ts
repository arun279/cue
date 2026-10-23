import { createQueryCachePolicy, restorableCache } from "@cue/core/runtime/query-cache";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { createAppQueryClient } from "./query-client";
import { bulkStorage } from "./stores";

export const queryClient = createAppQueryClient();

export const { shouldDehydrateQuery } = createQueryCachePolicy(queryClient);

export const queryPersister = createAsyncStoragePersister({
  key: "cue.query-cache",
  storage: bulkStorage,
  serialize: (client) => JSON.stringify(restorableCache(client)),
});

export const clearPersistedCaches = async (): Promise<void> => {
  queryClient.clear();
  await queryPersister.removeClient();
};
