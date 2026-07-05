import { requestPersistentStorage } from "@app/persist";
import { PERSIST_BUSTER, PERSIST_MAX_AGE, queryClient, queryPersister } from "@app/query-client";
import { router } from "@app/router";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { RouterProvider } from "@tanstack/react-router";
import { type ReactElement, useEffect } from "react";

/**
 * Composition root: the persisted Query cache wraps the router
 * so a restored cache paints before the router's first fetch resolves. `maxAge`
 * is decoupled from `staleTime` in `query-client.ts`.
 */
export function AppProviders(): ReactElement {
  useEffect(() => {
    void requestPersistentStorage();
  }, []);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        maxAge: PERSIST_MAX_AGE,
        buster: PERSIST_BUSTER,
      }}
    >
      <RouterProvider router={router} />
    </PersistQueryClientProvider>
  );
}
