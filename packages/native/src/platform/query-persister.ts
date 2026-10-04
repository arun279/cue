import { createQueryCachePolicy } from "@cue/core/runtime/query-cache";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import Storage from "expo-sqlite/kv-store";
import { createAppQueryClient } from "./query-client";

export const queryClient = createAppQueryClient();

export const { shouldDehydrateQuery } = createQueryCachePolicy(queryClient);

export const queryPersister = createAsyncStoragePersister({
  key: "cue.query-cache",
  storage: Storage,
});

export const clearPersistedCaches = async (): Promise<void> => {
  queryClient.clear();
  await queryPersister.removeClient();
};
