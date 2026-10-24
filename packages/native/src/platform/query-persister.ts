import { createQueryCachePolicy, restorableCache } from "@cue/core/runtime/query-cache";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { updateId } from "expo-updates";
import { nativeAppVersion } from "./app-version";
import { createAppQueryClient } from "./query-client";
import { bulkStorage } from "./stores";

export const queryClient = createAppQueryClient();

export const { shouldDehydrateQuery } = createQueryCachePolicy(queryClient);

export const queryPersister = createAsyncStoragePersister({
  key: "cue.query-cache",
  storage: bulkStorage,
  serialize: (client) => JSON.stringify(restorableCache(client)),
});

// A persisted cache restores only into the build or update that wrote it.
// https://tanstack.com/query/v5/docs/framework/react/plugins/persistQueryClient#cache-busting
export const persistBuster = updateId ?? nativeAppVersion;

export const clearPersistedCaches = async (): Promise<void> => {
  queryClient.clear();
  await queryPersister.removeClient();
};
