import { createQueryCachePolicy, createQueryClient } from "@cue/core/runtime/query-cache";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { del, get, set } from "idb-keyval";

export { PERSIST_BUSTER, PERSIST_MAX_AGE } from "@cue/core/runtime/query-cache";

export const queryClient = createQueryClient();

export const { shouldDehydrateQuery } = createQueryCachePolicy(queryClient);

/** IndexedDB, so a large restored blob never blocks the main thread. */
export const queryPersister = createAsyncStoragePersister({
  key: "cue.query-cache",
  storage: {
    getItem: (key) => get<string>(key).then((value) => value ?? null),
    setItem: (key, value) => set(key, value),
    removeItem: (key) => del(key),
  },
});

/** The one teardown dependency the runtime takes, in place of both objects. */
export const clearPersistedCaches = async (): Promise<void> => {
  queryClient.clear();
  await queryPersister.removeClient();
};
