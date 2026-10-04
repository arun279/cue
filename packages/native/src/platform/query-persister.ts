import { createQueryCachePolicy, createQueryClient } from "@cue/core/runtime/query-cache";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import Storage from "expo-sqlite/kv-store";
import { deliverQueryUpdatesInMicrotasks } from "./query-notifications";

deliverQueryUpdatesInMicrotasks();

export const queryClient = createQueryClient();

export const { shouldDehydrateQuery } = createQueryCachePolicy(queryClient);

export const queryPersister = createAsyncStoragePersister({
  key: "cue.query-cache",
  storage: Storage,
});

export const clearPersistedCaches = async (): Promise<void> => {
  queryClient.clear();
  await queryPersister.removeClient();
};
